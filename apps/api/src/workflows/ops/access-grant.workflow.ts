import { condition, continueAsNew, defineSignal, setHandler } from '@temporalio/workflow';
import { act } from './proxies';

/** Sent when a grant is approved, denied, extended or revoked; the workflow re-reads it. */
export const grantChanged = defineSignal('grantChanged');

export interface AccessGrantInput {
  grantId: string;
}

/**
 * One access grant from request to end. A REQUESTED grant waits for the support lead (a
 * `grantChanged` signal) and expires after grantRequestExpiryMinutes. An APPROVED grant is
 * activated: its certificate window opens (principals limited to the asset, valid until
 * expiresAt; the gateway gets the certificates signed per session). The workflow then sleeps
 * until expiresAt, waking on extensions and revocations, and finally expires the grant, which
 * revokes its certificates and kills live terminal sessions.
 */
export async function opsAccessGrant(input: AccessGrantInput): Promise<string> {
  let changed = false;
  setHandler(grantChanged, () => {
    changed = true;
  });
  for (let i = 0; i < 200; i++) {
    changed = false;
    const plan = await act.opsGrantPlan(input.grantId);
    if (plan.state === 'done') return 'done';
    if (plan.state === 'approved') {
      await act.opsGrantActivate(input.grantId);
      continue;
    }
    const ms = new Date(plan.expiresAt).getTime() - Date.now();
    if (ms > 0) {
      await condition(() => changed, ms);
      continue;
    }
    await act.opsGrantExpire(input.grantId);
  }
  return continueAsNew<typeof opsAccessGrant>(input);
}
