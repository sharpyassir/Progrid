import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsIn, IsInt, IsOptional, IsString, Length, Max, Min, ValidateIf } from 'class-validator';
import { CurrentActor, RequireScopes, StaffAreas } from '../../../common/auth/decorators';
import type { Actor } from '../../../common/auth/actor';
import { PaginationQuery } from '../../../common/pagination';
import { periodBounds, periodKey } from '../managed.constants';
import { WorkLogsService } from './worklogs.service';
import { ManagedBillingService } from '../billing-hooks/managed-billing.service';

class CreateWorkLogDto {
  @IsString() contractId: string;
  @IsOptional() @IsString() ticketId?: string;
  /** Support leads may log time for another engineer. */
  @IsOptional() @IsString() userId?: string;
  @IsInt() @Min(1) @Max(24 * 60) minutes: number;
  @IsOptional() @IsBoolean() billable?: boolean;
  @IsOptional() @IsString() @Length(0, 2000) note?: string;
  @IsOptional() @Type(() => Date) @IsDate() workedAt?: Date;
}

class UpdateWorkLogDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() ticketId?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(24 * 60) minutes?: number;
  @IsOptional() @IsBoolean() billable?: boolean;
  @IsOptional() @IsString() @Length(0, 2000) note?: string;
  @IsOptional() @Type(() => Date) @IsDate() workedAt?: Date;
}

class ListWorkLogsQuery extends PaginationQuery {
  @IsOptional() @IsString() contractId?: string;
  @IsOptional() @IsString() ticketId?: string;
  /** A user id or "me". */
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @IsOptional() @Type(() => Date) @IsDate() to?: Date;
  @IsOptional() @IsIn(['true', 'false']) billable?: string;
}

class PeriodQuery {
  /** "2026-09"; defaults to the current month. */
  @IsOptional() @IsString() period?: string;
}

/** Back office: engineer time and the managed bill preview. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/managed')
export class AdminManagedWorkLogsController {
  constructor(private readonly worklogs: WorkLogsService, private readonly billing: ManagedBillingService) {}

  @StaffAreas('engineer', 'support_lead')
  @Get('worklogs') @RequireScopes('admin')
  list(@CurrentActor() actor: Actor, @Query() q: ListWorkLogsQuery) {
    return this.worklogs.list(actor, q);
  }

  @StaffAreas('engineer', 'support_lead')
  @Post('worklogs') @RequireScopes('admin') @HttpCode(201)
  create(@CurrentActor() actor: Actor, @Body() dto: CreateWorkLogDto) {
    return this.worklogs.create(actor, dto);
  }

  @StaffAreas('engineer', 'support_lead')
  @Patch('worklogs/:id') @RequireScopes('admin')
  update(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: UpdateWorkLogDto) {
    return this.worklogs.update(actor, id, dto);
  }

  @StaffAreas('engineer', 'support_lead')
  @Delete('worklogs/:id') @RequireScopes('admin')
  remove(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.worklogs.remove(actor, id);
  }

  /** Included, used and overage minutes for a month, and the managed lines already accrued. */
  @StaffAreas('engineer', 'support_lead')
  @Get('contracts/:id/usage') @RequireScopes('admin')
  usage(@Param('id') id: string, @Query() q: PeriodQuery) {
    const { start, end } = periodBounds(q.period ?? periodKey(new Date()));
    return this.billing.usage(id, start, end);
  }
}
