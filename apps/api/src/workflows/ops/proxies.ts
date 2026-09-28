/** Activity proxies for the ops console workflows (same retry policy as the managed workflows). */
import { proxyActivities } from '@temporalio/workflow';
import type { OpsActivities } from './activities';

export const act = proxyActivities<OpsActivities>({
  startToCloseTimeout: '5 minutes',
  retry: { initialInterval: '2s', backoffCoefficient: 2, maximumInterval: '1 minute', maximumAttempts: 5, nonRetryableErrorTypes: ['NonRetryable'] },
});

/** Payout statements render PDFs for every engineer: longer, retried twice. */
export const slow = proxyActivities<OpsActivities>({
  startToCloseTimeout: '30 minutes',
  retry: { initialInterval: '10s', backoffCoefficient: 2, maximumInterval: '2 minutes', maximumAttempts: 2, nonRetryableErrorTypes: ['NonRetryable'] },
});
