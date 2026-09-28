import { Injectable } from '@nestjs/common';
import type { Ticket } from '@prisma/client';
import { canSee, type OpsContext } from './guards/ops-context';
import { assetTags, suggestRunbooks } from './postmortems/runbook-suggest';
import { TimersService } from './timers/timers.service';
import { GrantsService, LIVE_GRANT, presentGrant } from './access/grants.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { presentHandover } from './shifts/shifts.service';

/**
 * Side effects that cross ops areas, in one place so the desk does not depend on every area:
 * what `/me` and the ticket workspace add, and what counts as engineer activity (for the idle
 * timer). Ticket closing side effects hang off ManagedTicketsService.onClosed instead, so they
 * also run when staff or the customer close a ticket.
 */
@Injectable()
export class OpsHooks {
  constructor(private readonly prisma: PrismaService, private readonly timers: TimersService, private readonly grants: GrantsService) {}

  /** Extra fields of GET /ops/v1/me. */
  async meExtras(ops: OpsContext): Promise<Record<string, unknown>> {
    const [runningTimer, grants] = await Promise.all([
      this.timers.current(ops.userId),
      this.prisma.accessGrant.findMany({ where: { userId: ops.userId, status: { in: LIVE_GRANT } }, include: { asset: { select: { id: true, name: true } }, ticket: { select: { id: true, number: true } } }, orderBy: { createdAt: 'desc' } }),
    ]);
    const last = await this.prisma.handover.findFirst({ orderBy: { createdAt: 'desc' }, include: { shift: { include: { user: { select: { id: true, name: true } } } } } });
    return { runningTimer, activeGrants: grants.map((g) => presentGrant(g)), lastHandover: last ? { ...presentHandover(last, ops.external), read: last.readBy.includes(ops.userId) } : null };
  }

  /** Extra fields of the ticket workspace. */
  async ticketExtras(ops: OpsContext, t: Ticket): Promise<Record<string, unknown>> {
    const [timer, grants] = await Promise.all([
      this.timers.current(ops.userId),
      this.prisma.accessGrant.findMany({ where: { ticketId: t.id, ...(ops.external ? { userId: ops.userId } : {}) }, include: { asset: { select: { id: true, name: true } }, user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } }),
    ]);
    const [runbooks, postmortem] = await Promise.all([this.suggestions(ops, t), this.prisma.postmortem.findUnique({ where: { ticketId: t.id } })]);
    return {
      timer: timer && timer.ticketId === t.id ? timer : null,
      grants: grants.map((g) => presentGrant(g)),
      suggestedRunbooks: runbooks,
      postmortem: postmortem ? { id: postmortem.id, status: postmortem.status, dueAt: postmortem.dueAt } : null,
    };
  }

  /** Runbooks matching the asset, the alert names and the ticket text, among those the engineer may see. */
  private async suggestions(ops: OpsContext, t: Ticket) {
    const [asset, alerts, messages, runbooks] = await Promise.all([
      t.assetId ? this.prisma.managedAsset.findUnique({ where: { id: t.assetId } }) : null,
      this.prisma.alert.findMany({ where: { ticketId: t.id }, select: { name: true } }),
      this.prisma.ticketMessage.findMany({ where: { ticketId: t.id, fromSupport: false }, select: { body: true }, take: 3, orderBy: { createdAt: 'asc' } }),
      this.prisma.runbook.findMany({ select: { id: true, slug: true, title: true, tags: true }, take: 2000 }),
    ]);
    const visible = runbooks.filter((r) => r.tags.filter((x) => x.startsWith('contract:')).every((x) => canSee(ops, x.slice(9))));
    return suggestRunbooks(visible, { assetTags: asset ? assetTags(asset) : t.contractId ? [`contract:${t.contractId}`] : [], alertNames: alerts.map((a) => a.name), text: [t.subject, ...messages.map((m) => m.body)].join(' ') });
  }

  /** The engineer did something (ticket action, terminal event, heartbeat from the ops console). */
  async activity(userId: string, _ticketId?: string | null): Promise<void> {
    await this.timers.activity(userId);
  }
}
