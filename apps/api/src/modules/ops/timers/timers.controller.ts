import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { AssignmentGuard, EngineerGuard, ResidencyGuard } from '../guards/ops.guards';
import { Ops, type OpsContext } from '../guards/ops-context';
import { TimersService } from './timers.service';
import { TimesheetsService } from '../timesheets/timesheets.service';
import { OpsHooks } from '../ops-hooks.service';

class StartTimerDto {
  @IsOptional() @IsString() ticketId?: string;
  @IsOptional() @IsString() maintenanceRunId?: string;
  @IsOptional() @IsString() @Length(0, 2000) note?: string;
}

class StopTimerDto {
  @IsOptional() @IsString() @Length(0, 2000) note?: string;
  @IsOptional() @IsBoolean() billable?: boolean;
}

class ActivityDto {
  /** The ticket on screen, if any. */
  @IsOptional() @IsString() ticketId?: string;
}

class PeriodQuery {
  /** "2026-09" (default: this month, UTC). */
  @IsOptional() @Matches(/^\d{4}-\d{2}$/) month?: string;
  /** ISO week "2026-W39" instead of a month. */
  @IsOptional() @Matches(/^\d{4}-W\d{2}$/) week?: string;
}

class ManualEntryDto {
  @IsOptional() @IsString() ticketId?: string;
  @IsOptional() @IsString() maintenanceRunId?: string;
  @IsInt() @Min(1) @Max(12 * 60) minutes: number;
  @Type(() => Date) @IsDate() startedAt: Date;
  /** Why the timer was not used; manual entries are flagged for the support lead. */
  @IsString() @Length(5, 1000) reason: string;
  @IsOptional() @IsString() @Length(0, 2000) note?: string;
  @IsOptional() @IsBoolean() billable?: boolean;
}

class UpdateEntryDto {
  @IsOptional() @IsInt() @Min(1) @Max(12 * 60) minutes?: number;
  @IsOptional() @Type(() => Date) @IsDate() startedAt?: Date;
  @IsOptional() @IsString() @Length(5, 1000) reason?: string;
  @IsOptional() @IsString() @Length(0, 2000) note?: string;
  @IsOptional() @IsBoolean() billable?: boolean;
}

/** Work timers, activity heartbeats and the engineer's own timesheet (/ops/v1). */
@ApiTags('ops')
@ApiBearerAuth()
@UseGuards(EngineerGuard, AssignmentGuard, ResidencyGuard)
@Controller('ops/v1')
export class OpsTimersController {
  constructor(private readonly timers: TimersService, private readonly timesheets: TimesheetsService, private readonly hooks: OpsHooks) {}

  @Get('timers/current')
  async current(@Ops() ops: OpsContext) {
    return { timer: await this.timers.current(ops.userId) };
  }

  /** One running timer per engineer, on a ticket or a maintenance run (409 timer_running otherwise). */
  @Post('timers/start') @HttpCode(201)
  start(@Ops() ops: OpsContext, @Body() dto: StartTimerDto) {
    return this.timers.start(ops, dto);
  }

  /** Stops the running timer and creates a DRAFT worklog. */
  @Post('timers/stop') @HttpCode(200)
  stop(@Ops() ops: OpsContext, @Body() dto: StopTimerDto) {
    return this.timers.stop(ops, ops.userId, { note: dto.note, billable: dto.billable });
  }

  /** Heartbeat from the ops console while the engineer works (keeps the running timer from going idle). */
  @Post('activity') @HttpCode(204)
  async activity(@Ops() ops: OpsContext, @Body() dto: ActivityDto) {
    await this.hooks.activity(ops.userId, dto.ticketId);
  }

  @Get('timesheet')
  timesheet(@Ops() ops: OpsContext, @Query() q: PeriodQuery) {
    return this.timesheets.mine(ops, q);
  }

  @Post('timesheet/entries') @HttpCode(201)
  manual(@Ops() ops: OpsContext, @Body() dto: ManualEntryDto) {
    return this.timesheets.createManual(ops, dto);
  }

  @Patch('timesheet/entries/:id')
  updateEntry(@Ops() ops: OpsContext, @Param('id') id: string, @Body() dto: UpdateEntryDto) {
    return this.timesheets.updateEntry(ops, id, dto);
  }

  @Delete('timesheet/entries/:id')
  deleteEntry(@Ops() ops: OpsContext, @Param('id') id: string) {
    return this.timesheets.deleteEntry(ops, id);
  }

  /** Submits the DRAFT entries of a month (or ISO week) for approval. */
  @Post('timesheet/submit') @HttpCode(200)
  submit(@Ops() ops: OpsContext, @Body() dto: PeriodQuery) {
    return this.timesheets.submit(ops, dto);
  }
}
