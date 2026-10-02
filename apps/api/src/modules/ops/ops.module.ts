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
import { SessionsService } from './sessions/sessions.service';
import { AdminOpsSessionsController, GatewayInternalController, GatewaySecretGuard, OpsSessionsController } from './sessions/sessions.controller';
import { ObjectsModule } from '../storage/objects/objects.module';
import { ShiftsService } from './shifts/shifts.service';
import { OpsShiftsController } from './shifts/shifts.controller';
import { PostmortemsService } from './postmortems/postmortems.service';
import { AdminOpsPostmortemsController, OpsPostmortemsController } from './postmortems/postmortems.controller';
import { PayoutsService } from './payouts/payouts.service';
import { AdminOpsPayoutsController, OpsPayoutsController } from './payouts/payouts.controller';
import { OpsMaintenanceController } from './maintenance/ops-maintenance.controller';
import { PlatformChecks } from './platform/checks';
import { PlatformService } from './platform/platform.service';
import { OpsPlatformController, PlatformInternalController, PlatformSecretGuard } from './platform/platform.controller';

/**
 * DevOps console backend: /ops/v1 for engineers (apps/ops), /admin/ops for support leads and
 * full staff. Engineers are users with an EngineerProfile (external contractors) or internal
 * engineer staff; see docs/devops-console.md. Tickets, alerts, paging, maintenance and
 * worklogs come from the managed module.
 */
@Module({
  imports: [EventsModule, ManagedModule, ObjectsModule],
  controllers: [OpsAuthController, OpsDeskController, OpsTimersController, OpsAccessController, OpsSessionsController, OpsShiftsController, OpsPostmortemsController, OpsPayoutsController, OpsMaintenanceController, OpsPlatformController, GatewayInternalController, PlatformInternalController, AdminOpsEngineersController, AdminOpsTimesheetsController, AdminOpsAccessController, AdminOpsSessionsController, AdminOpsPostmortemsController, AdminOpsPayoutsController],
  providers: [OpsAudit, OpsHooks, OpsScopeService, EngineerGuard, AssignmentGuard, ResidencyGuard, OpsAuthService, EngineersService, OffboardingService, DeskService, TimersService, TimesheetsService, GrantsService, SessionsService, GatewaySecretGuard, ShiftsService, PostmortemsService, PayoutsService, PlatformChecks, PlatformService, PlatformSecretGuard],
  exports: [OpsAudit, OpsHooks, TimersService, TimesheetsService, GrantsService, SessionsService, ShiftsService, PostmortemsService, PayoutsService, PlatformService],
})
export class OpsModule {}
