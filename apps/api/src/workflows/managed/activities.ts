import type { INestApplicationContext } from '@nestjs/common';
import type { ManagedPriority } from '@prisma/client';
import { loadConfig } from '../../config/config';
import { OnboardingService } from '../../modules/managed/onboarding/onboarding.service';
import { ManagedTicketsService } from '../../modules/managed/tickets/tickets.service';
import { PagingService } from '../../modules/managed/oncall/paging.service';

/**
 * Activities of the managed cloud workflows. Thin wrappers over the managed module services so
 * the logic stays testable without Temporal; every activity is safe to retry.
 */
export interface ManagedActivities {
  managedEnsureChecklist(contractId: string): Promise<void>;
  managedOnboardingCheck(contractId: string): Promise<'active' | 'waiting' | 'stopped'>;
  managedSlaPlan(ticketId: string, kind: 'response' | 'resolve', priority: ManagedPriority): Promise<{ state: 'done' } | { state: 'pending'; warnAt: string; dueAt: string; warned: boolean }>;
  managedSlaWarn(ticketId: string, kind: 'response' | 'resolve', priority: ManagedPriority): Promise<'done' | 'warned'>;
  managedSlaBreach(ticketId: string, kind: 'response' | 'resolve', priority: ManagedPriority): Promise<'done' | 'breached'>;
  managedPageAckTimeout(): Promise<number>;
  managedEscalatePage(pageId: string): Promise<string>;
}

export function createManagedActivities(app: INestApplicationContext): ManagedActivities {
  const onboarding = app.get(OnboardingService);
  const tickets = app.get(ManagedTicketsService);
  const paging = app.get(PagingService);

  return {
    async managedEnsureChecklist(contractId) {
      await onboarding.ensureChecklist(contractId);
    },

    async managedOnboardingCheck(contractId) {
      return onboarding.activateIfComplete(contractId, 'workflow');
    },

    managedSlaPlan: (ticketId, kind, priority) => tickets.timerPlan(ticketId, kind, priority),
    managedSlaWarn: (ticketId, kind, priority) => tickets.timerWarn(ticketId, kind, priority),
    managedSlaBreach: (ticketId, kind, priority) => tickets.timerBreach(ticketId, kind, priority),

    async managedPageAckTimeout() {
      return loadConfig().PAGE_ACK_TIMEOUT_SECONDS;
    },

    managedEscalatePage: (pageId) => paging.escalate(pageId),
  };
}
