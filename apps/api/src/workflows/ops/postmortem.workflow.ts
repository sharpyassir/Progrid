import { condition, defineSignal, setHandler } from '@temporalio/workflow';
import { act } from './proxies';

/** Sent when the postmortem is submitted. */
export const postmortemDone = defineSignal('postmortemDone');

export interface PostmortemDueInput {
  postmortemId: string;
}

/**
 * Started when a P1 is resolved and its postmortem is required (due 48 hours after the
 * resolution). Reminds the author a day before the due time and tells the support lead when it
 * is overdue. Ends when the postmortem is submitted.
 */
export async function opsPostmortemDue(input: PostmortemDueInput): Promise<string> {
  let done = false;
  setHandler(postmortemDone, () => {
    done = true;
  });
  for (let i = 0; i < 10; i++) {
    if (done) return 'submitted';
    const plan = await act.opsPostmortemPlan(input.postmortemId);
    if (plan.state === 'done') return 'submitted';
    const next = !plan.reminded ? plan.remindAt : !plan.overdue ? plan.dueAt : null;
    if (!next) return 'overdue';
    const ms = new Date(next).getTime() - Date.now();
    if (ms > 0) {
      await condition(() => done, ms);
      continue;
    }
    if (!plan.reminded) await act.opsPostmortemRemind(input.postmortemId);
    else await act.opsPostmortemOverdue(input.postmortemId);
  }
  return 'stopped';
}
