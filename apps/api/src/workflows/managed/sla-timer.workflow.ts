import { condition, defineSignal, setHandler } from '@temporalio/workflow';
import { act } from './proxies';

/** Sent when the ticket gets its first staff response or is closed; the timer re-checks and ends. */
export const slaStop = defineSignal('slaStop');

export interface SlaTimerInput {
  ticketId: string;
  kind: 'response' | 'resolve';
  priority: 'P1' | 'P2' | 'P3' | 'P4';
}

/**
 * Watches one SLA target of one ticket. Sleeps until 75 percent of the target and warns the
 * assignee (email and a low urgency page), then sleeps until the due time, records the breach
 * and escalates to the support lead. The response timer ends at the first staff response and
 * the resolve timer when the ticket is closed: a `slaStop` signal wakes it early, and every
 * step re-checks the ticket anyway. A priority change starts new timers (the id carries the
 * priority) and the old ones end at their next check.
 */
export async function managedSlaTimer(input: SlaTimerInput): Promise<string> {
  let stop = false;
  setHandler(slaStop, () => {
    stop = true;
  });
  for (const phase of ['warn', 'breach'] as const) {
    // Sleep until the phase is due; a stop signal wakes the timer early to look again.
    for (;;) {
      stop = false;
      const plan = await act.managedSlaPlan(input.ticketId, input.kind, input.priority);
      if (plan.state === 'done') return 'done';
      const ms = new Date(phase === 'warn' ? plan.warnAt : plan.dueAt).getTime() - Date.now();
      if (ms <= 0) break;
      const woken = await condition(() => stop, ms);
      if (!woken) break;
    }
    const result = phase === 'warn' ? await act.managedSlaWarn(input.ticketId, input.kind, input.priority) : await act.managedSlaBreach(input.ticketId, input.kind, input.priority);
    if (result === 'done') return 'done';
  }
  return 'breached';
}
