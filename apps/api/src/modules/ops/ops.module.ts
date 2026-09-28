import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { ManagedModule } from '../managed/managed.module';
import { OpsAudit } from './ops-audit.service';
import { OpsHooks } from './ops-hooks.service';
import { AssignmentGuard, EngineerGuard, OpsScopeService, ResidencyGuard } from './guards/ops.guards';
import { OpsAuthService } from './auth/ops-auth.service';
import { OpsAuthController } from './auth/ops-auth.controller';
import { EngineersService } from './engineers/engineers.service';
import { OffboardingService } from './engineers/offboarding.service';
import { AdminOpsEngineersController } from './engineers/admin-ops.controller';
import { DeskService } from './desk/desk.service';
import { OpsDeskController } from './desk/desk.controller';
import { TimersService } from './timers/timers.service';
import { OpsTimersController } from './timers/timers.controller';
import { TimesheetsService } from './timesheets/timesheets.service';
import { AdminOpsTimesheetsController } from './timesheets/admin-timesheets.controller';
import { GrantsService } from './access/grants.service';
import { AdminOpsAccessController, OpsAccessController } from './access/access.controller';

/**
 * DevOps console backend: /ops/v1 for engineers (apps/ops), /admin/ops for support leads and
 * full staff. Engineers are users with an EngineerProfile (external contractors) or internal
 * engineer staff; see docs/devops-console.md. Tickets, alerts, paging, maintenance and
 * worklogs come from the managed module.
 */
@Module({
  imports: [EventsModule, ManagedModule],
  controllers: [OpsAuthController, OpsDeskController, OpsTimersController, OpsAccessController, AdminOpsEngineersController, AdminOpsTimesheetsController, AdminOpsAccessController],
  providers: [OpsAudit, OpsHooks, OpsScopeService, EngineerGuard, AssignmentGuard, ResidencyGuard, OpsAuthService, EngineersService, OffboardingService, DeskService, TimersService, TimesheetsService, GrantsService],
  exports: [OpsAudit, OpsHooks, TimersService, TimesheetsService, GrantsService],
})
export class OpsModule {}
