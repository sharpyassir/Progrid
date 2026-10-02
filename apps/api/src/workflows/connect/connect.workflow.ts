import { proxyActivities } from '@temporalio/workflow';
import type { ConnectActivities } from './activities';

/** A run can take up to its timeoutSeconds limit (max 900 s) plus model latency. */
const runner = proxyActivities<ConnectActivities>({
  startToCloseTimeout: '20 minutes',
  retry: { maximumAttempts: 1 },
});

/** Async and webhook runs, and runs resumed after an approval. */
export async function connectRunWorkflow(input: { runId: string }): Promise<void> {
  await runner.connectExecuteRun(input.runId);
}

/**
 * Started with a cronSchedule when an agent whose deployed workflow has a schedule trigger is
 * deployed (workflow id connect-schedule-<agentId>); terminated on pause, redeploy or delete.
 * Each firing creates and runs one run with source "schedule".
 */
export async function connectScheduleWorkflow(input: { agentId: string }): Promise<string> {
  return runner.connectScheduledRun(input.agentId);
}
