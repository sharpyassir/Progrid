import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min, ValidateIf } from 'class-validator';
import { CurrentActor, RequireScopes, StaffAreas } from '../../../common/auth/decorators';
import type { Actor } from '../../../common/auth/actor';
import { ApiError } from '../../../common/errors/api-error';
import { isLead } from '../managed.constants';
import { OnCallService } from './oncall.service';
import { PagingService } from './paging.service';

class ShiftDto {
  @IsString() userId: string;
  @IsOptional() @IsIn(['PRIMARY', 'SECONDARY']) role?: 'PRIMARY' | 'SECONDARY';
  @Type(() => Date) @IsDate() startsAt: Date;
  @Type(() => Date) @IsDate() endsAt: Date;
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

class UpdateShiftDto {
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsIn(['PRIMARY', 'SECONDARY']) role?: 'PRIMARY' | 'SECONDARY';
  @IsOptional() @Type(() => Date) @IsDate() startsAt?: Date;
  @IsOptional() @Type(() => Date) @IsDate() endsAt?: Date;
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

class ShiftQuery {
  @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @IsOptional() @Type(() => Date) @IsDate() to?: Date;
  @IsOptional() @IsString() userId?: string;
}

class ContactDto {
  /** E.164, e.g. +966500000000; null clears it. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(/^\+[1-9]\d{6,14}$/) phone?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsIn(['SMS', 'WHATSAPP', 'PUSH', 'EMAIL']) pagingChannel?: 'SMS' | 'WHATSAPP' | 'PUSH' | 'EMAIL' | null;
}

class PagesQuery {
  /** true: only unacknowledged high urgency pages */
  @IsOptional() @IsIn(['true', 'false']) open?: string;
  /** true: only pages to the caller */
  @IsOptional() @IsIn(['true', 'false']) mine?: string;
  @IsOptional() @IsString() alertId?: string;
  @IsOptional() @IsString() ticketId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
}

/** Back office: on call schedule, paging contacts and pages. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/managed')
export class AdminManagedOnCallController {
  constructor(private readonly oncall: OnCallService, private readonly paging: PagingService) {}

  @StaffAreas('engineer', 'support_lead')
  @Get('oncall/current') @RequireScopes('admin')
  current() {
    return this.oncall.current();
  }

  @StaffAreas('engineer', 'support_lead')
  @Get('oncall/shifts') @RequireScopes('admin')
  shifts(@Query() q: ShiftQuery) {
    return this.oncall.listShifts(q);
  }

  @StaffAreas('support_lead')
  @Post('oncall/shifts') @RequireScopes('admin') @HttpCode(201)
  createShift(@CurrentActor() actor: Actor, @Body() dto: ShiftDto) {
    return this.oncall.createShift(actor, dto);
  }

  @StaffAreas('support_lead')
  @Patch('oncall/shifts/:id') @RequireScopes('admin')
  updateShift(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: UpdateShiftDto) {
    return this.oncall.updateShift(actor, id, dto);
  }

  @StaffAreas('support_lead')
  @Delete('oncall/shifts/:id') @RequireScopes('admin')
  deleteShift(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.oncall.deleteShift(actor, id);
  }

  @StaffAreas('engineer', 'support_lead')
  @Get('staff') @RequireScopes('admin')
  staff() {
    return this.oncall.staff();
  }

  /** Paging phone and preferred channel. A support lead sets anyone's; everyone else only their own. */
  @StaffAreas('engineer', 'support_lead')
  @Put('staff/:userId/contact') @RequireScopes('admin')
  setContact(@CurrentActor() actor: Actor, @Param('userId') userId: string, @Body() dto: ContactDto) {
    if (userId !== actor.userId && !isLead(actor)) throw ApiError.forbidden('Only a support lead can change another person\'s paging contact');
    return this.oncall.setContact(actor, userId, dto);
  }

  @StaffAreas('engineer', 'support_lead')
  @Get('pages') @RequireScopes('admin')
  pages(@CurrentActor() actor: Actor, @Query() q: PagesQuery) {
    return this.paging.list({ userId: q.mine === 'true' ? actor.userId : undefined, open: q.open === 'true', alertId: q.alertId, ticketId: q.ticketId, limit: q.limit });
  }

  @StaffAreas('engineer', 'support_lead')
  @Post('pages/:id/ack') @RequireScopes('admin') @HttpCode(200)
  ack(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.paging.ack(actor, id);
  }
}
