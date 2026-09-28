import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import type { ContractorPayoutStatus } from '@prisma/client';
import { CurrentActor, RequireScopes } from '../../../common/auth/decorators';
import type { Actor } from '../../../common/auth/actor';
import { AssignmentGuard, EngineerGuard, ResidencyGuard } from '../guards/ops.guards';
import { Ops, type OpsContext } from '../guards/ops-context';
import { PayoutsService } from './payouts.service';

class GenerateDto {
  /** Only this engineer profile (default: every external engineer with a rate). */
  @IsOptional() @IsString() engineerId?: string;
}

class PayoutQuery {
  @IsOptional() @Matches(/^\d{4}-\d{2}$/) period?: string;
  @IsOptional() @IsIn(['DRAFT', 'ISSUED', 'PAID']) status?: ContractorPayoutStatus;
  @IsOptional() @IsString() engineerId?: string;
}

class UpdatePayoutDto {
  @IsIn(['ISSUED', 'PAID']) status: 'ISSUED' | 'PAID';
  /** The bank transfer reference; required for PAID. */
  @IsOptional() @IsString() @Length(1, 200) paidReference?: string;
  @IsOptional() @Type(() => Date) @IsDate() paidAt?: Date;
}

function sendPdf(res: Response, body: Uint8Array, name: string) {
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `inline; filename="${name}"`);
  res.end(Buffer.from(body));
}

/** The engineer's own payouts, read only (/ops/v1/payouts). */
@ApiTags('ops')
@ApiBearerAuth()
@UseGuards(EngineerGuard, AssignmentGuard, ResidencyGuard)
@Controller('ops/v1/payouts')
export class OpsPayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get()
  mine(@Ops() ops: OpsContext) {
    return this.payouts.mine(ops);
  }

  @Get(':id/statement')
  async statement(@Ops() ops: OpsContext, @Param('id') id: string, @Res() res: Response) {
    const p = await this.payouts.myStatement(ops, id);
    sendPdf(res, p.statement!, `progrid-statement-${p.period}.pdf`);
  }
}

/** Contractor payouts for full staff (/admin/ops/payouts). */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/ops/payouts')
export class AdminOpsPayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get() @RequireScopes('admin')
  list(@Query() q: PayoutQuery) {
    return this.payouts.adminList(q);
  }

  /** Generates or regenerates the DRAFT payouts of a month ("2026-09"). */
  @Post(':month/generate') @RequireScopes('admin') @HttpCode(200)
  generate(@CurrentActor() actor: Actor, @Param('month') month: string, @Body() dto: GenerateDto) {
    return this.payouts.generate(actor, month, dto.engineerId);
  }

  @Get(':id') @RequireScopes('admin')
  get(@Param('id') id: string) {
    return this.payouts.adminGet(id);
  }

  /** ISSUED (sends the statement), or PAID with the manual transfer reference. */
  @Patch(':id') @RequireScopes('admin')
  update(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: UpdatePayoutDto) {
    return this.payouts.setStatus(actor, id, dto);
  }

  @Get(':id/statement') @RequireScopes('admin')
  async statement(@Param('id') id: string, @Res() res: Response) {
    const p = await this.payouts.statement(id);
    sendPdf(res, p.statement!, `progrid-statement-${p.period}-${id}.pdf`);
  }
}
