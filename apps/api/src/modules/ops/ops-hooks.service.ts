import { Injectable } from '@nestjs/common';
import type { Ticket, TicketStatus } from '@prisma/client';
import type { OpsContext } from './guards/ops-context';

/**
 * Side effects that cross ops areas, in one place so the desk does not depend on every area:
 * what `/me` and the ticket workspace add, what counts as engineer activity (for the idle
 * timer), which status a ticket closes into, and what closing a ticket revokes.
 */
@Injectable()
export class OpsHooks {
  /** Extra fields of GET /ops/v1/me. */
  async meExtras(_ops: OpsContext): Promise<Record<string, unknown>> {
    return {};
  }

  /** Extra fields of the ticket workspace. */
  async ticketExtras(_ops: OpsContext, _t: Ticket): Promise<Record<string, unknown>> {
    return {};
  }

  /** The engineer did something (ticket action, terminal event, heartbeat from the ops console). */
  async activity(_userId: string, _ticketId?: string | null): Promise<void> {}

  /** Status a ticket moves to when an engineer closes it. */
  async closingStatus(_t: Ticket): Promise<Exclude<TicketStatus, 'open' | 'answered'>> {
    return 'closed';
  }

  /** After an engineer closed a ticket. */
  async ticketClosed(_ops: OpsContext, _ticketId: string): Promise<void> {}
}
