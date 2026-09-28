import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { CurrentActor, RequireScopes, StaffAreas } from '../../../common/auth/decorators';
import type { Actor } from '../../../common/auth/actor';
import { PaginationQuery } from '../../../common/pagination';
import { ManagedAlertsService } from './alerts.service';

class ListAlertsQuery extends PaginationQuery {
  /** open (FIRING or ACKNOWLEDGED), FIRING, ACKNOWLEDGED or RESOLVED */
  @IsOptional() @IsIn(['open', 'FIRING', 'ACKNOWLEDGED', 'RESOLVED']) status?: string;
  @IsOptional() @IsIn(['CRITICAL', 'WARNING', 'INFO']) severity?: string;
  @IsOptional() @IsString() contractId?: string;
  @IsOptional() @IsString() assetId?: string;
}

class AlertStatusDto {
  @IsIn(['ACKNOWLEDGED', 'RESOLVED']) status: 'ACKNOWLEDGED' | 'RESOLVED';
}

/** Back office: alerts. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/managed/alerts')
export class AdminManagedAlertsController {
  constructor(private readonly alerts: ManagedAlertsService) {}

  @StaffAreas('engineer', 'support_lead')
  @Get() @RequireScopes('admin')
  list(@Query() q: ListAlertsQuery) {
    return this.alerts.list(q);
  }

  @StaffAreas('engineer', 'support_lead')
  @Get(':id') @RequireScopes('admin')
  get(@Param('id') id: string) {
    return this.alerts.get(id);
  }

  @StaffAreas('engineer', 'support_lead')
  @Patch(':id') @RequireScopes('admin')
  setStatus(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: AlertStatusDto) {
    return this.alerts.setStatus(actor, id, dto.status);
  }

  /** Acknowledge the alert and every open page about it. */
  @StaffAreas('engineer', 'support_lead')
  @Post(':id/ack') @RequireScopes('admin') @HttpCode(200)
  ack(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.alerts.setStatus(actor, id, 'ACKNOWLEDGED');
  }
}
