import { Injectable } from '@nestjs/common';
import type { Ticket, TicketStatus } from '@prisma/client';
import type { OpsContext } from './guards/ops-context';
import { TimersService } from './timers/timers.service';
import { GrantsService, LIVE_GRANT, presentGrant } from './access/grants.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Side effects that cross ops areas, in one place so the desk does not depend on every area:
 * what `/me` and the ticket workspace add, what counts as engineer activity (for the idle
 * timer), which status a ticket closes into, and what closing a ticket revokes.
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
    return { runningTimer, activeGrants: grants.map((g) => presentGrant(g)) };
  }

  /** Extra fields of the ticket workspace. */
  async ticketExtras(ops: OpsContext, t: Ticket): Promise<Record<string, unknown>> {
    const [timer, grants] = await Promise.all([
      this.timers.current(ops.userId),
      this.prisma.accessGrant.findMany({ where: { ticketId: t.id, ...(ops.external ? { userId: ops.userId } : {}) }, include: { asset: { select: { id: true, name: true } }, user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } }),
    ]);
    return { timer: timer && timer.ticketId === t.id ? timer : null, grants: grants.map((g) => presentGrant(g)) };
  }

  /** The engineer did something (ticket action, terminal event, heartbeat from the ops console). */
  async activity(userId: string, _ticketId?: string | null): Promise<void> {
    await this.timers.activity(userId);
  }

  /** Status a ticket moves to when an engineer closes it. */
  async closingStatus(_t: Ticket): Promise<Exclude<TicketStatus, 'open' | 'answered'>> {
    return 'closed';
  }

  /** After an engineer closed a ticket. */
  async ticketClosed(_ops: OpsContext, _ticketId: string): Promise<void> {}
}
