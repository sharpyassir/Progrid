import type { INestApplicationContext } from '@nestjs/common';
import { OnboardingService } from '../../modules/managed/onboarding/onboarding.service';

/**
 * Activities of the managed cloud workflows. Thin wrappers over the managed module services so
 * the logic stays testable without Temporal; every activity is safe to retry.
 */
export interface ManagedActivities {
  managedEnsureChecklist(contractId: string): Promise<void>;
  managedOnboardingCheck(contractId: string): Promise<'active' | 'waiting' | 'stopped'>;
}

export function createManagedActivities(app: INestApplicationContext): ManagedActivities {
  const onboarding = app.get(OnboardingService);

  return {
    async managedEnsureChecklist(contractId) {
      await onboarding.ensureChecklist(contractId);
    },

    async managedOnboardingCheck(contractId) {
      return onboarding.activateIfComplete(contractId, 'workflow');
    },
  };
}
