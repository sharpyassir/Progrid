import { condition, defineSignal, setHandler } from '@temporalio/workflow';
import { act } from './proxies';

/** Sent when the engineer ends the shift with a handover. */
export const shiftEnded = defineSignal('shiftEnded');

export interface ShiftInput {
  shiftId: string;
}

/**
 * Started when an engineer starts a shift. At the scheduled end it revokes the engineer's non
 * emergency access grants. Without a handover it reminds the engineer handoverReminderMinutes
 * (15) after the scheduled end and notifies the support lead after handoverEscalateMinutes (60).
 * Ends as soon as the shift is ended with a handover.
 */
export async function opsShift(input: ShiftInput): Promise<string> {
  let ended = false;
  setHandler(shiftEnded, () => {
    ended = true;
  });
  let pastEnd = false;
  for (let i = 0; i < 50; i++) {
    if (ended) return 'handover';
    const plan = await act.opsShiftPlan(input.shiftId);
    if (plan.state === 'done') return 'handover';
    const next = !pastEnd ? plan.endsAt : !plan.reminded ? plan.remindAt : !plan.escalated ? plan.escalateAt : null;
    if (!next) return 'escalated';
    const ms = new Date(next).getTime() - Date.now();
    if (ms > 0) {
      await condition(() => ended, ms);
      continue;
    }
    if (!pastEnd) {
      await act.opsShiftScheduledEnd(input.shiftId);
      pastEnd = true;
    } else if (!plan.reminded) {
      await act.opsShiftRemind(input.shiftId);
    } else {
      await act.opsShiftEscalate(input.shiftId);
    }
  }
  return 'stopped';
}
