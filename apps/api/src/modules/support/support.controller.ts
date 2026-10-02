import { Body, Controller, Get, Headers, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { loadConfig } from '../../config/config';
import { ApiError } from '../../common/errors/api-error';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentActor, Public, RequireScopes, StaffAreas } from '../../common/auth/decorators';
import type { Actor } from '../../common/auth/actor';
import { SupportService } from './support.service';
import { ResendInboundService } from './resend-inbound.service';
import { AdminListTicketsQuery, CreateTicketDto, ListTicketsQuery, SetPlanDto, TicketMessageDto } from './support.dto';

@ApiTags('support')
@ApiBearerAuth()
@Controller('v1/support')
export class SupportController {
  constructor(
    private readonly support: SupportService,
    private readonly resendInbound: ResendInboundService,
  ) {}

  /** Plan catalog with prices; public so the website can show it. */
  @Public() @Get('plans')
  plans(@Query('currency') currency?: string) {
    return this.support.plans(currency === 'USD' ? 'USD' : 'SAR');
  }

  /**
   * Inbound email webhook. Postmark posts {From, Subject, TextBody, StrippedTextReply}; Resend and
   * generic relays post {from, subject, text}. Guarded by SUPPORT_INBOUND_SECRET, sent as the
   * X-Inbound-Secret header or the ?secret query parameter.
   */
  @Public() @Post('inbound') @HttpCode(200)
  inbound(@Body() raw: Record<string, unknown>, @Headers('x-inbound-secret') header?: string, @Query('secret') query?: string) {
    const expected = loadConfig().SUPPORT_INBOUND_SECRET;
    const given = header ?? query ?? '';
    if (!expected || given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) throw new ApiError(401, 'unauthorized', 'Bad inbound secret');
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    const fromRaw = str(raw.From) || str(raw.from) || str((raw.sender as Record<string, unknown> | undefined)?.email);
    const from = /<([^>]+)>/.exec(fromRaw)?.[1] ?? fromRaw;
    const to = (str(raw.To) || str(raw.to)).split(',').map((a) => (/<([^>]+)>/.exec(a)?.[1] ?? a).trim()).filter(Boolean);
    return this.support.inbound({ from, subject: str(raw.Subject) || str(raw.subject), text: str(raw.StrippedTextReply) || str(raw.TextBody) || str(raw.text), to });
  }

  /**
   * Resend inbound receiving: the `email.received` webhook, signed with Svix using
   * RESEND_WEBHOOK_SECRET. Mail to SUPPORT_INBOX is fetched from Resend and handled like the
   * generic inbound endpoint; repeated deliveries of the same email are ignored.
   */
  @Public() @Post('inbound/resend') @HttpCode(200)
  inboundResend(@Req() req: Request & { rawBody?: Buffer }, @Headers('svix-id') id?: string, @Headers('svix-timestamp') timestamp?: string, @Headers('svix-signature') signature?: string) {
    return this.resendInbound.handle(req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {})), { id, timestamp, signature });
  }

  @Get('plan') @RequireScopes('support:read')
  current(@CurrentActor() actor: Actor) {
    return this.support.current(actor);
  }

  @Put('plan') @RequireScopes('billing:write')
  setPlan(@CurrentActor() actor: Actor, @Body() dto: SetPlanDto) {
    return this.support.setPlan(actor, dto.plan);
  }

  @Get('tickets') @RequireScopes('support:read')
  list(@CurrentActor() actor: Actor, @Query() q: ListTicketsQuery) {
    return this.support.list(actor, q);
  }

  @Post('tickets') @RequireScopes('support:write') @HttpCode(201)
  create(@CurrentActor() actor: Actor, @Body() dto: CreateTicketDto) {
    return this.support.create(actor, dto);
  }

  @Get('tickets/:id') @RequireScopes('support:read')
  get(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.support.get(actor, id);
  }

  @Post('tickets/:id/messages') @RequireScopes('support:write') @HttpCode(201)
  reply(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: TicketMessageDto) {
    return this.support.reply(actor, id, dto);
  }

  @Post('tickets/:id/close') @RequireScopes('support:write') @HttpCode(200)
  close(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.support.close(actor, id);
  }
}

/** Back office: the support queue. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/v1/support')
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @StaffAreas('support')
  @Get('tickets') @RequireScopes('admin')
  list(@Query() q: AdminListTicketsQuery) {
    return this.support.adminList(q);
  }

  @StaffAreas('support')
  @Get('tickets/:id') @RequireScopes('admin')
  get(@Param('id') id: string) {
    return this.support.adminGet(id);
  }

  @StaffAreas('support')
  @Post('tickets/:id/reply') @RequireScopes('admin') @HttpCode(201)
  reply(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: TicketMessageDto & { close?: boolean }) {
    return this.support.adminReply(actor, id, dto, !!dto.close);
  }

  @StaffAreas('support')
  @Post('tickets/:id/close') @RequireScopes('admin') @HttpCode(200)
  close(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.support.adminClose(actor, id);
  }
}
