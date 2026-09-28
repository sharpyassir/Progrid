import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequireScopes, StaffAreas } from '../../../common/auth/decorators';
import type { Actor } from '../../../common/auth/actor';
import { ManagedPlansService } from './plans.service';
import { CreatePlanDto, UpdatePlanDto } from './plans.dto';

@ApiTags('managed')
@ApiBearerAuth()
@Controller('v1/managed/plans')
export class ManagedPlansController {
  constructor(private readonly plans: ManagedPlansService) {}

  /** Active managed cloud plans. */
  @Get() @RequireScopes('managed:read')
  list() {
    return this.plans.listActive();
  }
}

/** Back office: plans and prices. Changing them is full staff only. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/managed/plans')
export class AdminManagedPlansController {
  constructor(private readonly plans: ManagedPlansService) {}

  @StaffAreas('engineer', 'support_lead')
  @Get() @RequireScopes('admin')
  list() {
    return this.plans.listAll();
  }

  @StaffAreas('engineer', 'support_lead')
  @Get(':id') @RequireScopes('admin')
  get(@Param('id') id: string) {
    return this.plans.get(id);
  }

  @Post() @RequireScopes('admin') @HttpCode(201)
  create(@CurrentActor() actor: Actor, @Body() dto: CreatePlanDto) {
    return this.plans.create(actor, dto);
  }

  @Patch(':id') @RequireScopes('admin')
  update(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.plans.update(actor, id, dto);
  }

  @Delete(':id') @RequireScopes('admin')
  remove(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.plans.remove(actor, id);
  }
}
