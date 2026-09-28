import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import type { WorkLogStatus } from '@prisma/client';
import { CurrentActor, RequireScopes, StaffAreas } from '../../../common/auth/decorators';
import type { Actor } from '../../../common/auth/actor';
import { TimesheetsService } from './timesheets.service';

const STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID'] as const;

class OverviewQuery {
  @IsOptional() @IsIn(STATUSES) status?: WorkLogStatus;
  @IsOptional() @Matches(/^\d{4}-\d{2}$/) month?: string;
}

class EntriesQuery {
  @IsOptional() @Matches(/^\d{4}-\d{2}$/) month?: string;
  @IsOptional() @Matches(/^\d{4}-W\d{2}$/) week?: string;
  @IsOptional() @IsIn(STATUSES) status?: WorkLogStatus;
}

class ReviewDto {
  @IsIn(['APPROVED', 'REJECTED']) decision: 'APPROVED' | 'REJECTED';
  /** The entries to review; or `month` for every submitted entry of that month. */
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @IsString({ each: true }) workLogIds?: string[];
  @IsOptional() @Matches(/^\d{4}-\d{2}$/) month?: string;
  /** Required when rejecting; shown to the engineer. */
  @IsOptional() @IsString() @Length(0, 2000) comment?: string;
}

/** Timesheet approval for support leads (/admin/ops/timesheets). */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/ops/timesheets')
export class AdminOpsTimesheetsController {
  constructor(private readonly timesheets: TimesheetsService) {}

  /** Engineers with entries in a status (default SUBMITTED: waiting for review). */
  @StaffAreas('support_lead')
  @Get() @RequireScopes('admin')
  overview(@Query() q: OverviewQuery) {
    return this.timesheets.overview(q);
  }

  /** `engineerId` is the engineer profile id or the user id. */
  @StaffAreas('support_lead')
  @Get(':engineerId') @RequireScopes('admin')
  async entries(@Param('engineerId') id: string, @Query() q: EntriesQuery) {
    return this.timesheets.entries(await this.timesheets.resolveEngineer(id), q);
  }

  @StaffAreas('support_lead')
  @Post(':engineerId/approve') @RequireScopes('admin') @HttpCode(200)
  async review(@CurrentActor() actor: Actor, @Param('engineerId') id: string, @Body() dto: ReviewDto) {
    return this.timesheets.review(actor, await this.timesheets.resolveEngineer(id), dto);
  }
}
