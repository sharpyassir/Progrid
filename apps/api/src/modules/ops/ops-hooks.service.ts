import { Injectable } from '@nestjs/common';
import type { Ticket, TicketStatus } from '@prisma/client';
import type { OpsContext } from './guards/ops-context';
import { TimersService } from './timers/timers.service';

/**
 * Side effects that cross ops areas, in one place so the desk does not depend on every area:
 * what `/me` and the ticket workspace add, what counts as engineer activity (for the idle
 * timer), which status a ticket closes into, and what closing a ticket revokes.
 */
@Injectable()
export class OpsHooks {
  constructor(private readonly timers: TimersService) {}

  /** Extra fields of GET /ops/v1/me. */
  async meExtras(ops: OpsContext): Promise<Record<string, unknown>> {
    return { runningTimer: await this.timers.current(ops.userId) };
  }

  /** Extra fields of the ticket workspace. */
  async ticketExtras(ops: OpsContext, t: Ticket): Promise<Record<string, unknown>> {
    const timer = await this.timers.current(ops.userId);
    return { timer: timer && timer.ticketId === t.id ? timer : null };
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
