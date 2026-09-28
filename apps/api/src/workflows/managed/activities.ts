import type { INestApplicationContext } from '@nestjs/common';
import type { ManagedPriority } from '@prisma/client';
import { loadConfig } from '../../config/config';
import { OnboardingService } from '../../modules/managed/onboarding/onboarding.service';
import { ManagedTicketsService } from '../../modules/managed/tickets/tickets.service';
import { PagingService } from '../../modules/managed/oncall/paging.service';
import { MaintenanceService } from '../../modules/managed/maintenance/maintenance.service';
import { Context } from '@temporalio/activity';
import { ReportsService } from '../../modules/managed/reports/reports.service';

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
  managedMaintenanceExecute(runId: string): Promise<'SUCCEEDED' | 'FAILED'>;
  managedMaintenanceMarkFailed(runId: string, error: string): Promise<void>;
  managedMaintenanceFailureTicket(runId: string): Promise<string | null>;
  managedReportGenerate(contractId: string, period: string): Promise<string>;
  managedReportAutoSendAt(period: string): Promise<string>;
  managedReportAutoSend(reportId: string): Promise<string>;
}

export function createManagedActivities(app: INestApplicationContext): ManagedActivities {
  const onboarding = app.get(OnboardingService);
  const tickets = app.get(ManagedTicketsService);
  const paging = app.get(PagingService);
  const maintenance = app.get(MaintenanceService);
  const reports = app.get(ReportsService);

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

    async managedMaintenanceExecute(runId) {
      // Playbooks can be quiet for minutes; heartbeat on a timer so Temporal knows the worker is alive.
      const beat = setInterval(() => Context.current().heartbeat(), 30_000);
      try {
        return await maintenance.execute(runId);
      } finally {
        clearInterval(beat);
      }
    },

    managedMaintenanceMarkFailed: (runId, error) => maintenance.markFailed(runId, error),
    managedMaintenanceFailureTicket: (runId) => maintenance.openFailureTicket(runId),

    async managedReportGenerate(contractId, period) {
      return (await reports.generate(contractId, period)).id;
    },

    async managedReportAutoSendAt(period) {
      return ReportsService.autoSendAt(period).toISOString();
    },

    managedReportAutoSend: (reportId) => reports.autoSend(reportId),
  };
}
