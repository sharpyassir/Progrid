import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, Min, ValidateIf } from 'class-validator';
import { AssignmentGuard, EngineerGuard, ResidencyGuard } from '../guards/ops.guards';
import { Ops, OpsRefs, type OpsContext } from '../guards/ops-context';
import { DeskService } from './desk.service';

const PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;

class TicketQuery {
  /** true: only tickets assigned to me. */
  @IsOptional() @IsIn(['true', 'false']) mine?: string;
  /** open (default: open and answered), answered, closed, resolved_pending_pm or all. */
  @IsOptional() @IsIn(['open', 'answered', 'closed', 'resolved_pending_pm', 'all']) status?: string;
  @IsOptional() @IsIn(PRIORITIES) priority?: (typeof PRIORITIES)[number];
  @IsOptional() @IsString() contractId?: string;
  @IsOptional() @IsString() assetId?: string;
}

class AlertQuery {
  /** open (default: firing and acknowledged), FIRING, ACKNOWLEDGED, RESOLVED or all. */
  @IsOptional() @IsIn(['open', 'FIRING', 'ACKNOWLEDGED', 'RESOLVED', 'all']) status?: string;
  @IsOptional() @IsString() contractId?: string;
  @IsOptional() @IsString() assetId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
}

class MessageDto {
  @IsString() @Length(1, 20000) body: string;
  /** Internal note: engineers and staff only, never shown to the customer. */
  @IsOptional() @IsBoolean() internal?: boolean;
}

class UpdateTicketDto {
  @IsOptional() @IsIn(['open', 'answered', 'closed']) status?: 'open' | 'answered' | 'closed';
  @IsOptional() @IsIn(PRIORITIES) priority?: (typeof PRIORITIES)[number];
  /** Yourself, or null to unassign. Support leads may assign anyone eligible. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() assigneeId?: string | null;
  /** Root cause, saved as an internal note. Required to close unless one was written before. */
  @IsOptional() @IsString() @Length(10, 5000) rootCause?: string;
}

class EscalateDto {
  @IsString() @Length(3, 2000) reason: string;
}

/**
 * The engineer's desk, /ops/v1: me, contracts, alerts, pages, tickets and assets. Every route
 * runs EngineerGuard (ops session, active engineer, IP allowlist), AssignmentGuard (every
 * referenced object on an assigned contract, 404 otherwise) and ResidencyGuard where marked.
 */
@ApiTags('ops')
@ApiBearerAuth()
@UseGuards(EngineerGuard, AssignmentGuard, ResidencyGuard)
@Controller('ops/v1')
export class OpsDeskController {
  constructor(private readonly desk: DeskService) {}

  @Get('me')
  me(@Ops() ops: OpsContext) {
    return this.desk.me(ops);
  }

  @Get('contracts')
  contracts(@Ops() ops: OpsContext) {
    return this.desk.contracts(ops);
  }

  @Get('alerts')
  alerts(@Ops() ops: OpsContext, @Query() q: AlertQuery) {
    return this.desk.listAlerts(ops, q);
  }

  /** Acknowledges the alert and its pages (stops the escalation) and assigns its ticket to you. */
  @OpsRefs({ id: 'alert' })
  @Post('alerts/:id/ack') @HttpCode(200)
  ackAlert(@Ops() ops: OpsContext, @Param('id') id: string) {
    return this.desk.ackAlert(ops, id);
  }

  @OpsRefs({ id: 'page' })
  @Post('pages/:id/ack') @HttpCode(200)
  ackPage(@Ops() ops: OpsContext, @Param('id') id: string) {
    return this.desk.ackPage(ops, id);
  }

  @Get('tickets')
  tickets(@Ops() ops: OpsContext, @Query() q: TicketQuery) {
    return this.desk.listTickets(ops, q);
  }

  @OpsRefs({ id: 'ticket' })
  @Get('tickets/:id')
  ticket(@Ops() ops: OpsContext, @Param('id') id: string) {
    return this.desk.ticket(ops, id);
  }

  @OpsRefs({ id: 'ticket' })
  @Post('tickets/:id/messages') @HttpCode(201)
  reply(@Ops() ops: OpsContext, @Param('id') id: string, @Body() dto: MessageDto) {
    return this.desk.reply(ops, id, dto.body, !!dto.internal);
  }

  @OpsRefs({ id: 'ticket' })
  @Patch('tickets/:id')
  update(@Ops() ops: OpsContext, @Param('id') id: string, @Body() dto: UpdateTicketDto) {
    return this.desk.update(ops, id, dto);
  }

  @OpsRefs({ id: 'ticket' })
  @Post('tickets/:id/escalate') @HttpCode(200)
  escalate(@Ops() ops: OpsContext, @Param('id') id: string, @Body() dto: EscalateDto) {
    return this.desk.escalate(ops, id, dto.reason);
  }

  @OpsRefs({ id: 'asset' })
  @Get('assets/:id')
  asset(@Ops() ops: OpsContext, @Param('id') id: string) {
    return this.desk.asset(ops, id);
  }
}
