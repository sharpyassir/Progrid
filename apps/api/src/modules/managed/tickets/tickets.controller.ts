import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Length, Matches } from 'class-validator';
import { Type } from 'class-transformer';
import { CurrentActor, RequireScopes, StaffAreas } from '../../../common/auth/decorators';
import type { Actor } from '../../../common/auth/actor';
import { ManagedTicketsService } from './tickets.service';
import { AdminListManagedTicketsQuery, CreateManagedTicketDto, ListManagedTicketsQuery, ManagedMessageDto, StaffMessageDto, UpdateManagedTicketDto } from './tickets.dto';
import { SlaService } from '../sla/sla.service';

class HolidayDto {
  @IsIn(['SA', 'TR']) country: 'SA' | 'TR';
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) date: string;
  @IsString() @Length(2, 160) name: string;
}

class HolidayQuery {
  @IsOptional() @IsIn(['SA', 'TR']) country?: 'SA' | 'TR';
  @IsOptional() @Type(() => Number) @IsInt() year?: number;
}

/** Customer: managed tickets. Members may open and read them; internal notes are never returned. */
@ApiTags('managed')
@ApiBearerAuth()
@Controller('v1/managed/tickets')
export class ManagedTicketsController {
  constructor(private readonly tickets: ManagedTicketsService) {}

  @Get() @RequireScopes('managed:read')
  list(@CurrentActor() actor: Actor, @Query() q: ListManagedTicketsQuery) {
    return this.tickets.list(actor, q);
  }

  @Post() @RequireScopes('managed:write') @HttpCode(201)
  create(@CurrentActor() actor: Actor, @Body() dto: CreateManagedTicketDto) {
    return this.tickets.create(actor, dto);
  }

  @Get(':id') @RequireScopes('managed:read')
  get(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.tickets.get(actor, id);
  }

  @Post(':id/messages') @RequireScopes('managed:write') @HttpCode(201)
  reply(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: ManagedMessageDto) {
    return this.tickets.reply(actor, id, dto.body);
  }

  @Post(':id/close') @RequireScopes('managed:write') @HttpCode(200)
  close(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.tickets.close(actor, id);
  }
}

/** Back office: the managed ticket queue and the holiday calendar. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/managed')
export class AdminManagedTicketsController {
  constructor(private readonly tickets: ManagedTicketsService, private readonly sla: SlaService) {}

  @StaffAreas('engineer', 'support_lead')
  @Get('tickets') @RequireScopes('admin')
  list(@CurrentActor() actor: Actor, @Query() q: AdminListManagedTicketsQuery) {
    return this.tickets.adminList(actor, q);
  }

  @StaffAreas('engineer', 'support_lead')
  @Get('tickets/:id') @RequireScopes('admin')
  get(@Param('id') id: string) {
    return this.tickets.adminGet(id);
  }

  /** Assign (support lead, or yourself), change priority (recomputes due times) or status. */
  @StaffAreas('engineer', 'support_lead')
  @Patch('tickets/:id') @RequireScopes('admin')
  update(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: UpdateManagedTicketDto) {
    return this.tickets.update(actor, id, dto);
  }

  @StaffAreas('engineer', 'support_lead')
  @Post('tickets/:id/messages') @RequireScopes('admin') @HttpCode(201)
  reply(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: StaffMessageDto) {
    return this.tickets.staffReply(actor, id, dto);
  }

  @StaffAreas('engineer', 'support_lead')
  @Get('holidays') @RequireScopes('admin')
  holidays(@Query() q: HolidayQuery) {
    return this.sla.list(q.country, q.year);
  }

  @StaffAreas('support_lead')
  @Put('holidays') @RequireScopes('admin')
  setHoliday(@Body() dto: HolidayDto) {
    return this.sla.upsertHoliday(dto.country, dto.date, dto.name);
  }

  @StaffAreas('support_lead')
  @Delete('holidays/:id') @RequireScopes('admin')
  deleteHoliday(@Param('id') id: string) {
    return this.sla.deleteHoliday(id);
  }
}
