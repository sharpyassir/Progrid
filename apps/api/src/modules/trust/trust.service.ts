import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiError } from '../../common/errors/api-error';
import { EventsService } from '../events/events.service';
import { TemporalService } from '../../common/temporal/temporal.service';

/** Prefix of Team.suspensionReason for suspensions that paying lifts automatically. */
export const BILLING_SUSPENSION = 'billing:';

/**
 * Trust & safety: pre-flight checks before any resource is created, plus the hooks
 * AI-ops / abuse reports use to flag and suspend accounts.
 */
@Injectable()
export class TrustService {
  private readonly log = new Logger(TrustService.name);

  constructor(private readonly prisma: PrismaService, private readonly events: EventsService, private readonly temporal: TemporalService) {}

  /** Throws if the team may not create resources right now. */
  async assertCanProvision(teamId: string) {
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: teamId }, include: { credits: true, abuseFlags: { where: { resolvedAt: null } } } });
    if (team.status === 'suspended') throw new ApiError(403, 'account_suspended', 'This account is suspended. Contact support.');
    if (team.status === 'closed') throw new ApiError(403, 'account_closed', 'This account is closed.');
    if (team.abuseFlags.some((f) => f.score >= 80)) throw new ApiError(403, 'account_under_review', 'This account is under review. Contact support.');

    // Owners must confirm their email; new accounts also need a verified phone/ID or prepaid credit.
    const owner = await this.prisma.teamMember.findFirst({ where: { teamId, role: 'owner' }, include: { user: { select: { emailVerified: true } } } });
    if (owner && !owner.user.emailVerified) throw new ApiError(403, 'email_unverified', 'Confirm your email address first. Check your inbox for the link, or request a new one.');
    if (team.status === 'pending_verification') {
      const prepaid = team.credits.reduce((s, c) => s + (c.kind === 'prepaid' ? c.remainingMinor : 0), 0);
      if (team.kycLevel < 1 && prepaid <= 0) {
        throw new ApiError(403, 'verification_required', 'Verify your phone number or add prepaid credit before creating servers.');
      }
    }
  }

  /** Outbound bandwidth cap for accounts with no verification history (anti-spam). */
  async outboundLimitMbps(teamId: string): Promise<number | null> {
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: teamId } });
    return team.kycLevel >= 2 ? null : 100;
  }

  async flag(input: { teamId: string; serverId?: string; kind: 'mining' | 'spam' | 'scanning' | 'ddos_source' | 'phishing' | 'payment_fraud' | 'report'; score: number; evidence?: Record<string, unknown>; source: string }) {
    const flag = await this.prisma.abuseFlag.create({ data: { ...input, evidence: (input.evidence ?? {}) as Prisma.InputJsonValue } });
    await this.prisma.team.update({ where: { id: input.teamId }, data: { riskScore: { increment: input.score } } });
    await this.events.emit('abuse.flagged', { flagId: flag.id, kind: input.kind, score: input.score }, { teamId: input.teamId });
    if (input.score >= 90) await this.suspend(input.teamId, `automatic: ${input.kind}`);
    return flag;
  }

  /**
   * Suspends a team. Running servers are powered off through the normal power workflow (not
   * deleted, so a false positive is recoverable) and marked so reinstating powers them back
   * on. They keep being metered while off, like any stopped server. Safe to call again: it
   * retries servers that are still running.
   */
  async suspend(teamId: string, reason: string) {
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: teamId }, select: { status: true } });
    if (team.status === 'closed') return;
    const first = team.status !== 'suspended';
    await this.prisma.team.update({ where: { id: teamId }, data: { status: 'suspended', suspensionReason: reason, ...(first ? { suspendedAt: new Date() } : {}) } });
    const n = await this.powerOffRunning(teamId, reason);
    if (first) await this.events.emit('account.suspended', { reason, serversPoweredOff: n }, { teamId });
  }

  /** Powers off whatever is still running for a suspended team (retries earlier failures). */
  async enforceSuspension(teamId: string) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId }, select: { status: true, suspensionReason: true } });
    if (team?.status !== 'suspended') return 0;
    return this.powerOffRunning(teamId, team.suspensionReason ?? 'account suspended');
  }

  async reinstate(teamId: string) {
    await this.prisma.team.update({ where: { id: teamId }, data: { status: 'active', suspensionReason: null, suspendedAt: null } });
    // Servers from before this change were left in the old `suspended` state; they are powered off too.
    await this.prisma.server.updateMany({ where: { project: { teamId }, status: 'suspended', deletedAt: null }, data: { status: 'off', statusMessage: null, suspendedPoweredOff: true } });
    const servers = await this.prisma.server.findMany({ where: { project: { teamId }, suspendedPoweredOff: true, deletedAt: null } });
    let started = 0;
    for (const s of servers) {
      // A server that is not off (its stop failed, or someone started it by hand) only loses the mark.
      if (s.status !== 'off') {
        await this.prisma.server.update({ where: { id: s.id }, data: { suspendedPoweredOff: false, statusMessage: null } });
        continue;
      }
      if (await this.power(s.id, 'start', 'provisioning')) started++;
      await this.prisma.server.update({ where: { id: s.id }, data: { suspendedPoweredOff: false, statusMessage: null } });
    }
    await this.events.emit('account.reinstated', { serversPoweredOn: started }, { teamId });
  }

  /** Lifts a suspension for non payment once nothing is left 14 days overdue. Other suspensions stay. */
  async reinstateIfSettled(teamId: string) {
    const team = await this.prisma.team.findUnique({ where: { id: teamId }, select: { status: true, suspensionReason: true } });
    if (team?.status !== 'suspended' || !team.suspensionReason?.startsWith(BILLING_SUSPENSION)) return false;
    const overdue = await this.prisma.invoice.count({ where: { teamId, status: 'open', reminderStage: { gte: 14 } } });
    if (overdue) return false;
    await this.reinstate(teamId);
    return true;
  }

  private async powerOffRunning(teamId: string, reason: string) {
    const servers = await this.prisma.server.findMany({ where: { project: { teamId }, status: 'active', deletedAt: null }, select: { id: true } });
    let n = 0;
    for (const s of servers) {
      await this.prisma.server.update({ where: { id: s.id }, data: { suspendedPoweredOff: true, statusMessage: `Powered off: ${reason}` } });
      if (await this.power(s.id, 'stop', 'active')) n++;
    }
    return n;
  }

  /** Records a power action and starts the powerServer workflow, like a customer's start or stop. */
  private async power(serverId: string, op: 'start' | 'stop', nextStatus: 'provisioning' | 'active') {
    const action = await this.prisma.$transaction(async (tx) => {
      const a = await tx.serverAction.create({ data: { serverId, type: op, params: op === 'stop' ? { force: false } : {}, requestedBy: 'system:suspension' } });
      await tx.server.update({ where: { id: serverId }, data: { status: nextStatus } });
      return a;
    });
    const workflowId = `powerServer-${action.id}`;
    try {
      await this.temporal.start('powerServer', [{ serverId, actionId: action.id, op, force: false }] as never, workflowId);
      await this.prisma.serverAction.update({ where: { id: action.id }, data: { workflowId, status: 'running' } });
      return true;
    } catch (err) {
      this.log.error(`suspension could not ${op} server ${serverId}: ${(err as Error).message}`);
      await this.prisma.serverAction.update({ where: { id: action.id }, data: { status: 'failed', error: 'workflow_start_failed', finishedAt: new Date() } });
      if (op === 'start') await this.prisma.server.update({ where: { id: serverId }, data: { status: 'off' } });
      return false;
    }
  }
}
