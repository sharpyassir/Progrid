import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequireScopes, StaffAreas } from '../../../common/auth/decorators';
import type { Actor } from '../../../common/auth/actor';
import { OpsSettingsService } from '../settings/ops-settings.service';
import { EngineersService } from './engineers.service';
import { OffboardingService } from './offboarding.service';
import { AccessPolicyDto, AssignDto, CreateEngineerDto, ListEngineersQuery, UpdateEngineerDto } from './engineers.dto';

/**
 * Back office for the DevOps console, /admin/ops: engineers and their assignments (support
 * lead), rates, residency policy and settings (full staff). External engineers never reach
 * /admin: they are not staff and their ops session does not work here.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/ops')
export class AdminOpsEngineersController {
  constructor(private readonly engineers: EngineersService, private readonly offboarding: OffboardingService, private readonly settings: OpsSettingsService) {}

  @StaffAreas('support_lead')
  @Get('engineers') @RequireScopes('admin')
  list(@Query() q: ListEngineersQuery) {
    return this.engineers.list(q);
  }

  /** Rates, currency and the night multiplier are full staff only. */
  @StaffAreas('support_lead')
  @Post('engineers') @RequireScopes('admin') @HttpCode(201)
  create(@CurrentActor() actor: Actor, @Body() dto: CreateEngineerDto) {
    return this.engineers.create(actor, dto);
  }

  @StaffAreas('support_lead')
  @Get('engineers/:id') @RequireScopes('admin')
  get(@Param('id') id: string) {
    return this.engineers.get(id);
  }

  /** Profile fields; `status` SUSPENDED or OFFBOARDED runs the offboarding flow. */
  @StaffAreas('support_lead')
  @Patch('engineers/:id') @RequireScopes('admin')
  update(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: UpdateEngineerDto) {
    return this.engineers.update(actor, id, dto, (p, from) => this.offboarding.onStatusChange(actor, p, from));
  }

  /** Same as PATCH with status OFFBOARDED. */
  @StaffAreas('support_lead')
  @Delete('engineers/:id') @RequireScopes('admin')
  offboard(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.engineers.update(actor, id, { status: 'OFFBOARDED' }, (p, from) => this.offboarding.onStatusChange(actor, p, from));
  }

  @StaffAreas('support_lead')
  @Get('engineers/:id/assignments') @RequireScopes('admin')
  assignments(@Param('id') id: string) {
    return this.engineers.assignments(id);
  }

  /** Refused with 403 residency_blocked when the contract's access policy excludes the engineer's country. */
  @StaffAreas('support_lead')
  @Post('engineers/:id/assignments') @RequireScopes('admin') @HttpCode(201)
  assign(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: AssignDto) {
    return this.engineers.assign(actor, id, dto.contractId);
  }

  @StaffAreas('support_lead')
  @Delete('engineers/:id/assignments/:contractId') @RequireScopes('admin')
  unassign(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('contractId') contractId: string) {
    return this.engineers.unassign(actor, id, contractId, (userId, c) => this.offboarding.onUnassigned(actor, userId, c));
  }

  /** Residency policy of a contract (full staff). Engineers it excludes lose the assignment and their grants. */
  @Patch('contracts/:id/access-policy') @RequireScopes('admin')
  async accessPolicy(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: AccessPolicyDto) {
    const r = await this.engineers.setAccessPolicy(actor, id, dto.accessPolicy);
    for (const e of r.removedAssignments) await this.offboarding.onUnassigned(actor, e.userId, id);
    return r;
  }

  @StaffAreas('support_lead')
  @Get('settings') @RequireScopes('admin')
  getSettings() {
    return this.settings.present();
  }

  /** Full staff: any subset of the settings keys (docs/devops-console.md, "Settings"). */
  @Patch('settings') @RequireScopes('admin')
  setSettings(@CurrentActor() actor: Actor, @Body() body: Record<string, unknown>) {
    return this.settings.update(actor, body);
  }
}
