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
import { AdminManagedContractsController, ManagedContractsController } from './contracts/contracts.controller';
import { OnboardingService } from './onboarding/onboarding.service';
import { ResponsibilityService } from './responsibility/responsibility.service';
import { AssetsService } from './assets/assets.service';
import { AdminManagedAssetsController, ManagedAssetsController } from './assets/assets.controller';

/**
 * Managed cloud: we operate customer servers (on the platform or elsewhere) under an SLA.
 * Customer endpoints live under /v1/managed, staff endpoints under /admin/managed, and the
 * Alertmanager and heartbeat receivers under /internal. See docs/managed-cloud-operations.md.
 */
@Module({
  imports: [EventsModule, BillingModule],
  controllers: [
    ManagedPlansController, AdminManagedPlansController,
    ManagedContractsController, AdminManagedContractsController,
    ManagedAssetsController, AdminManagedAssetsController,
  ],
  providers: [ManagedWorkflows, ManagedNotify, ManagedPlansService, ContractTermsService, ManagedAccessService, OnboardingService, ResponsibilityService, ContractsService, AssetsService],
  exports: [ManagedWorkflows, ManagedNotify, ManagedPlansService, ContractTermsService, OnboardingService, ContractsService, AssetsService],
})
export class ManagedModule {}
