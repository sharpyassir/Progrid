import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches } from 'class-validator';
import { CurrentActor, RequireScopes, StaffAreas } from '../../../common/auth/decorators';
import type { Actor } from '../../../common/auth/actor';
import { ContractsService } from './contracts.service';
import { ActivateContractDto, AdminListContractsQuery, ReasonDto, RenewContractDto, RequestContractDto, StaffCreateContractDto, UpdateContractDto } from './contracts.dto';
import { OnboardingService } from '../onboarding/onboarding.service';
import { ResponsibilityService } from '../responsibility/responsibility.service';

class OnboardingItemDto {
  @IsBoolean() done: boolean;
  @IsOptional() @IsString() @Length(0, 2000) note?: string;
}

class AddOnboardingItemDto {
  @IsString() @Matches(/^[a-z][a-z0-9_]{1,40}$/) key: string;
  @IsString() @Length(2, 200) title: string;
}

class ResponsibilityDto {
  @IsString() @Length(2, 160) area: string;
  @IsIn(['PROGRID', 'CUSTOMER', 'SHARED']) owner: 'PROGRID' | 'CUSTOMER' | 'SHARED';
  @IsOptional() @IsString() @Length(0, 1000) notes?: string;
  @IsOptional() @IsInt() sortOrder?: number;
}

class UpdateResponsibilityDto {
  @IsOptional() @IsString() @Length(2, 160) area?: string;
  @IsOptional() @IsIn(['PROGRID', 'CUSTOMER', 'SHARED']) owner?: 'PROGRID' | 'CUSTOMER' | 'SHARED';
  @IsOptional() @IsString() @Length(0, 1000) notes?: string;
  @IsOptional() @IsInt() sortOrder?: number;
}

/** Customer: request and read managed cloud contracts. Team owners only. */
@ApiTags('managed')
@ApiBearerAuth()
@Controller('v1/managed/contracts')
export class ManagedContractsController {
  constructor(private readonly contracts: ContractsService) {}

  @Post() @RequireScopes('managed:write') @HttpCode(201)
  request(@CurrentActor() actor: Actor, @Body() dto: RequestContractDto) {
    return this.contracts.request(actor, dto);
  }

  @Get() @RequireScopes('managed:read')
  list(@CurrentActor() actor: Actor) {
    return this.contracts.listForTeam(actor);
  }

  @Get(':id') @RequireScopes('managed:read')
  get(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.contracts.getForTeam(actor, id);
  }
}

/** Back office: contract lifecycle, onboarding checklist and responsibility matrix. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/managed/contracts')
export class AdminManagedContractsController {
  constructor(private readonly contracts: ContractsService, private readonly onboarding: OnboardingService, private readonly responsibility: ResponsibilityService) {}

  @StaffAreas('engineer', 'support_lead')
  @Get() @RequireScopes('admin')
  list(@Query() q: AdminListContractsQuery) {
    return this.contracts.adminList(q);
  }

  @StaffAreas('support_lead')
  @Post() @RequireScopes('admin') @HttpCode(201)
  create(@CurrentActor() actor: Actor, @Body() dto: StaffCreateContractDto) {
    return this.contracts.createForTeam(actor, dto);
  }

  @StaffAreas('engineer', 'support_lead')
  @Get(':id') @RequireScopes('admin')
  get(@Param('id') id: string) {
    return this.contracts.adminGet(id);
  }

  @StaffAreas('support_lead')
  @Patch(':id') @RequireScopes('admin')
  update(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: UpdateContractDto) {
    return this.contracts.update(actor, id, dto);
  }

  @StaffAreas('support_lead')
  @Post(':id/activate') @RequireScopes('admin') @HttpCode(200)
  activate(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: ActivateContractDto) {
    return this.contracts.activate(actor, id, dto);
  }

  @StaffAreas('support_lead')
  @Post(':id/suspend') @RequireScopes('admin') @HttpCode(200)
  suspend(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.contracts.suspend(actor, id, dto.reason);
  }

  @StaffAreas('support_lead')
  @Post(':id/resume') @RequireScopes('admin') @HttpCode(200)
  resume(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.contracts.resume(actor, id);
  }

  @StaffAreas('support_lead')
  @Post(':id/cancel') @RequireScopes('admin') @HttpCode(200)
  cancel(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.contracts.cancel(actor, id, dto.reason);
  }

  @StaffAreas('support_lead')
  @Post(':id/renew') @RequireScopes('admin') @HttpCode(200)
  renew(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: RenewContractDto) {
    return this.contracts.renew(actor, id, dto.termMonths);
  }

  @StaffAreas('engineer', 'support_lead')
  @Get(':id/handover') @RequireScopes('admin')
  async handover(@Param('id') id: string) {
    return { text: await this.contracts.handoverDocument(id) };
  }

  // ---- onboarding ----

  @StaffAreas('engineer', 'support_lead')
  @Get(':id/onboarding') @RequireScopes('admin')
  checklist(@Param('id') id: string) {
    return this.onboarding.list(id, true);
  }

  @StaffAreas('support_lead')
  @Post(':id/onboarding') @RequireScopes('admin') @HttpCode(201)
  addItem(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: AddOnboardingItemDto) {
    return this.onboarding.addItem(actor, id, dto);
  }

  @StaffAreas('engineer', 'support_lead')
  @Patch(':id/onboarding/:key') @RequireScopes('admin')
  setItem(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('key') key: string, @Body() dto: OnboardingItemDto) {
    return this.onboarding.setItem(actor, id, key, dto);
  }

  // ---- responsibility matrix ----

  @StaffAreas('engineer', 'support_lead')
  @Get(':id/responsibilities') @RequireScopes('admin')
  responsibilities(@Param('id') id: string) {
    return this.responsibility.list(id);
  }

  @StaffAreas('support_lead')
  @Post(':id/responsibilities') @RequireScopes('admin') @HttpCode(201)
  addResponsibility(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: ResponsibilityDto) {
    return this.responsibility.create(actor, id, dto);
  }

  @StaffAreas('support_lead')
  @Patch(':id/responsibilities/:rid') @RequireScopes('admin')
  updateResponsibility(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('rid') rid: string, @Body() dto: UpdateResponsibilityDto) {
    return this.responsibility.update(actor, id, rid, dto);
  }

  @StaffAreas('support_lead')
  @Delete(':id/responsibilities/:rid') @RequireScopes('admin')
  removeResponsibility(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('rid') rid: string) {
    return this.responsibility.remove(actor, id, rid);
  }
}
