import { condition, continueAsNew, defineSignal, setHandler } from '@temporalio/workflow';
import { act } from './proxies';

/** Sent by the API after every checklist change (and on cancel or resume). */
export const checklistUpdated = defineSignal('checklistUpdated');

export interface OnboardingInput {
  contractId: string;
}

/**
 * Started when a support lead activates a contract (DRAFT to ONBOARDING). Creates the default
 * checklist, then waits for `checklistUpdated` signals. When every item is done it moves the
 * contract to ACTIVE, which starts billing. It also re-checks every six hours in case a signal
 * was lost, and ends when the contract is suspended, cancelled or already active.
 */
export async function managedOnboarding(input: OnboardingInput): Promise<string> {
  let dirty = true;
  setHandler(checklistUpdated, () => {
    dirty = true;
  });
  await act.managedEnsureChecklist(input.contractId);
  for (let i = 0; i < 500; i++) {
    if (dirty) {
      dirty = false;
      const state = await act.managedOnboardingCheck(input.contractId);
      if (state !== 'waiting') return state;
    }
    const signalled = await condition(() => dirty, '6 hours');
    if (!signalled) dirty = true;
  }
  return continueAsNew<typeof managedOnboarding>(input);
}
