import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { CurrentActor, RequireScopes, StaffAreas } from '../../../common/auth/decorators';
import type { Actor } from '../../../common/auth/actor';
import { ReportsService } from './reports.service';

class RecommendationsDto {
  @IsString() @Length(0, 10000) recommendations: string;
}

class GenerateDto {
  /** "2026-09"; defaults to last month. */
  @IsOptional() @Matches(/^\d{4}-\d{2}$/) period?: string;
}

class ReportQuery {
  @IsOptional() @IsString() contractId?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}$/) period?: string;
  @IsOptional() @IsIn(['DRAFT', 'SENT']) status?: 'DRAFT' | 'SENT';
}

function sendPdf(res: Response, file: { filename: string; pdf: Buffer }) {
  res.setHeader('content-type', 'application/pdf');
  res.setHeader('content-disposition', `inline; filename="${file.filename}"`);
  res.send(file.pdf);
}

/** Customer: monthly reports that were sent. Team owners only. */
@ApiTags('managed')
@ApiBearerAuth()
@Controller('v1/managed/contracts/:id/reports')
export class ManagedReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get() @RequireScopes('managed:read')
  list(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.reports.listForCustomer(actor, id);
  }

  @Get(':reportId/pdf') @RequireScopes('managed:read')
  async pdf(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('reportId') reportId: string, @Res() res: Response) {
    sendPdf(res, await this.reports.pdfForCustomer(actor, id, reportId));
  }
}

/** Back office: drafts, edits, sending and regeneration. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/managed/reports')
export class AdminManagedReportsController {
  constructor(private readonly reports: ReportsService) {}

  @StaffAreas('engineer', 'support_lead')
  @Get() @RequireScopes('admin')
  list(@Query() q: ReportQuery) {
    return this.reports.adminList(q);
  }

  @StaffAreas('engineer', 'support_lead')
  @Get(':id') @RequireScopes('admin')
  get(@Param('id') id: string) {
    return this.reports.adminGet(id);
  }

  @StaffAreas('engineer', 'support_lead')
  @Get(':id/pdf') @RequireScopes('admin')
  async pdf(@Param('id') id: string, @Res() res: Response) {
    sendPdf(res, await this.reports.pdf(id));
  }

  /** Edit the recommendations of a draft; the PDF is re-rendered. */
  @StaffAreas('engineer', 'support_lead')
  @Patch(':id') @RequireScopes('admin')
  update(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: RecommendationsDto) {
    return this.reports.updateRecommendations(actor, id, dto.recommendations);
  }

  @StaffAreas('engineer', 'support_lead')
  @Post(':id/send') @RequireScopes('admin') @HttpCode(200)
  send(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.reports.send(id, actor);
  }

  /** (Re)generate a contract's report for a month (default last month). */
  @StaffAreas('engineer', 'support_lead')
  @Post(':contractId/generate') @RequireScopes('admin') @HttpCode(201)
  async generate(@CurrentActor() actor: Actor, @Param('contractId') contractId: string, @Body() dto: GenerateDto) {
    const r = await this.reports.generate(contractId, dto.period ?? ReportsService.previousPeriod(), actor);
    return this.reports.adminGet(r.id);
  }
}
