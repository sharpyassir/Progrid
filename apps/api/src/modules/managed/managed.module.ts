import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { BillingModule } from '../billing/billing.module';
import { ManagedWorkflows } from './managed-workflows.service';
import { ManagedNotify } from './managed-notify.service';
import { ManagedPlansService } from './plans/plans.service';
import { AdminManagedPlansController, ManagedPlansController } from './plans/plans.controller';
import { ContractsService } from './contracts/contracts.service';
import { ContractTermsService } from './contracts/contract-terms.service';
import { ManagedAccessService } from './contracts/access.service';
import { AdminManagedContractsController, AdminManagedTeamsController, ManagedContractsController, ManagedSummaryController } from './contracts/contracts.controller';
import { OnboardingService } from './onboarding/onboarding.service';
import { ResponsibilityService } from './responsibility/responsibility.service';
import { AssetsService } from './assets/assets.service';
import { AdminManagedAssetsController, ManagedAssetsController } from './assets/assets.controller';
import { SlaService } from './sla/sla.service';
import { OnCallService } from './oncall/oncall.service';
import { PagingService } from './oncall/paging.service';
import { ManagedTicketsService } from './tickets/tickets.service';
import { AdminManagedTicketsController, ManagedTicketsController } from './tickets/tickets.controller';
import { ManagedAlertsService } from './alerts/alerts.service';
import { AdminManagedAlertsController } from './alerts/alerts.controller';
import { ManagedInternalController } from './alerts/internal.controller';
import { AdminManagedOnCallController } from './oncall/oncall.controller';
import { WorkLogsService } from './worklogs/worklogs.service';
import { AdminManagedWorkLogsController } from './worklogs/worklogs.controller';
import { ManagedBillingService } from './billing-hooks/managed-billing.service';
import { MaintenanceService } from './maintenance/maintenance.service';
import { AdminManagedMaintenanceController } from './maintenance/maintenance.controller';
import { ReportsService } from './reports/reports.service';
import { AdminManagedReportsController, ManagedReportsController } from './reports/reports.controller';
import { RunbooksService } from './runbooks/runbooks.service';
import { AdminManagedRunbooksController } from './runbooks/runbooks.controller';

/**
 * Managed cloud: we operate customer servers (on the platform or elsewhere) under an SLA.
 * Customer endpoints live under /v1/managed, staff endpoints under /admin/managed, and the
 * Alertmanager and heartbeat receivers under /internal. See docs/managed-cloud-operations.md.
 */
@Module({
  imports: [EventsModule, BillingModule],
  controllers: [
    ManagedPlansController, AdminManagedPlansController,
    ManagedContractsController, AdminManagedContractsController, ManagedSummaryController, AdminManagedTeamsController,
    ManagedAssetsController, AdminManagedAssetsController,
    ManagedTicketsController, AdminManagedTicketsController,
    AdminManagedAlertsController, ManagedInternalController, AdminManagedOnCallController,
    AdminManagedWorkLogsController, AdminManagedMaintenanceController,
    ManagedReportsController, AdminManagedReportsController,
    AdminManagedRunbooksController,
  ],
  providers: [ManagedWorkflows, ManagedNotify, ManagedPlansService, ContractTermsService, ManagedAccessService, OnboardingService, ResponsibilityService, ContractsService, AssetsService, SlaService, OnCallService, PagingService, ManagedTicketsService, ManagedAlertsService, WorkLogsService, ManagedBillingService, MaintenanceService, ReportsService, RunbooksService],
  exports: [ManagedWorkflows, ManagedNotify, ManagedPlansService, ContractTermsService, OnboardingService, ContractsService, AssetsService, SlaService, OnCallService, PagingService, ManagedTicketsService, ManagedAlertsService, WorkLogsService, ManagedBillingService, MaintenanceService, ReportsService, RunbooksService],
})
export class ManagedModule {}
