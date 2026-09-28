/** Activity proxies for the managed cloud workflows (same retry policy as the core workflows). */
import { proxyActivities } from '@temporalio/workflow';
import type { ManagedActivities } from './activities';

export const act = proxyActivities<ManagedActivities>({
  startToCloseTimeout: '5 minutes',
  retry: { initialInterval: '2s', backoffCoefficient: 2, maximumInterval: '1 minute', maximumAttempts: 5, nonRetryableErrorTypes: ['NonRetryable'] },
});

/** Playbook runs and report rendering: long, heartbeating, retried at most twice. */
export const slow = proxyActivities<ManagedActivities>({
  startToCloseTimeout: '3 hours',
  heartbeatTimeout: '2 minutes',
  retry: { initialInterval: '10s', backoffCoefficient: 2, maximumInterval: '2 minutes', maximumAttempts: 2, nonRetryableErrorTypes: ['NonRetryable'] },
});
