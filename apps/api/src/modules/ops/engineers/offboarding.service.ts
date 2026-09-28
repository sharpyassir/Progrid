import { Injectable, Logger } from '@nestjs/common';
import type { EngineerProfile } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { Actor } from '../../../common/auth/actor';
import { ManagedTicketsService } from '../../managed/tickets/tickets.service';
import { OpsAudit } from '../ops-audit.service';
import { GrantsService } from '../access/grants.service';
import { SessionsService } from '../sessions/sessions.service';
import { ShiftsService } from '../shifts/shifts.service';
import { TimersService } from '../timers/timers.service';

/** How far back an asset counts as "accessed" for secret rotation. */
export const ROTATE_LOOKBACK_DAYS = 90;

/**
 * Suspending or offboarding an engineer (spec 3.10). EngineersService ends the engineer's ops
 * sessions; this then revokes every live access grant (which revokes the certificates), kills
 * any live terminal session, stops the running timer, ends the current shift and, when
 * offboarded, removes future shifts and every assignment. Every asset the engineer accessed in
 * the last 90 days gets a P3 "rotate secrets" ticket so the credentials they could have seen
 * are changed.
 */
@Injectable()
export class OffboardingService {
  private readonly log = new Logger(OffboardingService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: OpsAudit,
    private readonly grants: GrantsService,
    private readonly sessions: SessionsService,
    private readonly shifts: ShiftsService,
    private readonly timers: TimersService,
    private readonly tickets: ManagedTicketsService,
  ) {}

  async onStatusChange(actor: Actor, p: EngineerProfile, from: string) {
    const offboarded = p.status === 'OFFBOARDED';
    const reason = p.status.toLowerCase();
    const summary: Record<string, unknown> = { engineerId: p.id, userId: p.userId, from, to: p.status };
    summary.grantsRevoked = await this.grants.revokeWhere({ userId: p.userId }, reason, actor);
    summary.sessionsKilled = await this.sessions.killForUser(p.userId, `engineer ${reason}`);
    summary.timerStopped = !!(await this.timers.stop(actor, p.userId, { reason: 'offboarded' }).catch(() => null));
    summary.shifts = await this.shifts.endForEngineer(p.userId, offboarded);
    if (offboarded) summary.assignmentsRemoved = (await this.prisma.engineerAssignment.deleteMany({ where: { engineerId: p.id } })).count;
    summary.rotateTickets = await this.rotateSecrets(actor, p);
    await this.audit.emit('ops.engineer_access_removed', actor, summary, `engineer:${p.id}`);
    this.log.log(`engineer ${p.id} ${from} -> ${p.status}: ${JSON.stringify(summary)}`);
    return summary;
  }

  /** The engineer lost access to one contract (unassigned, or excluded by a new residency policy): its grants end. */
  async onUnassigned(actor: Actor, userId: string, contractId: string) {
    await this.grants.revokeWhere({ userId, contractId }, 'unassigned', actor);
  }

  /** One P3 ticket per asset the engineer had access to (a grant that became active, or a terminal session) in the last 90 days. */
  private async rotateSecrets(actor: Actor, p: EngineerProfile) {
    const since = new Date(Date.now() - ROTATE_LOOKBACK_DAYS * 86_400_000);
    const [grants, sessions] = await Promise.all([
      this.prisma.accessGrant.findMany({ where: { userId: p.userId, startsAt: { gte: since } }, select: { assetId: true } }),
      this.prisma.terminalSession.findMany({ where: { userId: p.userId, startedAt: { gte: since } }, select: { assetId: true } }),
    ]);
    const assetIds = [...new Set([...grants, ...sessions].map((x) => x.assetId))];
    const user = await this.prisma.user.findUnique({ where: { id: p.userId }, select: { name: true } });
    const created: string[] = [];
    for (const assetId of assetIds) {
      const asset = await this.prisma.managedAsset.findUnique({ where: { id: assetId }, include: { contract: { include: { plan: true } } } });
      if (!asset || asset.removedAt || asset.contract.status === 'CANCELLED') continue;
      const open = await this.prisma.ticket.findFirst({ where: { assetId, source: 'offboarding', status: { in: ['open', 'answered'] } } });
      if (open) {
        await this.tickets.addSystemNote(open.id, `Also rotate what ${user?.name ?? 'the engineer'} (${p.status.toLowerCase()}) could reach.`, true);
        continue;
      }
      const t = await this.tickets.openSystemTicket({
        contract: asset.contract,
        assetId,
        priority: 'P3',
        subject: `Rotate credentials on ${asset.name}`,
        body: `Routine credential rotation: an engineer who worked on ${asset.name} no longer has access to your account. We are rotating the credentials Progrid holds for it (SSH keys, passwords in our secret store, API keys). No action is needed from you.`,
        source: 'offboarding',
        assigneeId: null,
        page: false,
      });
      await this.tickets.addSystemNote(t.id, `Rotate every secret ${user?.name ?? 'the engineer'} could have seen on ${asset.name}: the secret store entry assets/${assetId}, the prgd user's authorized keys and any credentials shown in their terminal sessions. Status: ${p.status.toLowerCase()}${p.statusReason ? ` (${p.statusReason})` : ''}.`, true);
      created.push(t.id);
      await this.audit.emit('ops.rotate_secrets_requested', actor, { contractId: asset.contractId, assetId, ticketId: t.id, engineerId: p.id }, `managed_asset:${assetId}`);
    }
    return created;
  }
}
