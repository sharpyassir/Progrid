import { condition, continueAsNew, defineSignal, setHandler } from '@temporalio/workflow';
import { act } from './proxies';

/** Sent when the timer is stopped (by the engineer, the idle rule or offboarding). */
export const timerStopped = defineSignal('timerStopped');

export interface TimerIdleInput {
  timerId: string;
}

/**
 * Watches one running work timer. Sleeps until timerIdlePromptSeconds after the last activity
 * (ticket action, terminal session event or ops console heartbeat), prompts the engineer, then
 * sleeps until timerAutoStopSeconds after the last activity and stops the timer. Activity only
 * moves `lastActivityAt` in the database: each wake re-reads it and sleeps again when the
 * engineer was active in the meantime. A `timerStopped` signal ends the workflow at once.
 */
export async function opsTimerIdle(input: TimerIdleInput): Promise<string> {
  let stopped = false;
  setHandler(timerStopped, () => {
    stopped = true;
  });
  for (let i = 0; i < 500; i++) {
    if (stopped) return 'stopped';
    const plan = await act.opsTimerIdlePlan(input.timerId);
    if (plan.state === 'stopped') return 'stopped';
    const next = new Date(plan.prompted ? plan.stopAt : plan.promptAt).getTime();
    const ms = next - Date.now();
    if (ms > 0) {
      await condition(() => stopped, ms);
      continue;
    }
    if (!plan.prompted) {
      if ((await act.opsTimerIdlePrompt(input.timerId)) === 'stopped') return 'stopped';
    } else if ((await act.opsTimerIdleStop(input.timerId)) === 'stopped') {
      return 'auto_stopped';
    }
  }
  return continueAsNew<typeof opsTimerIdle>(input);
}
