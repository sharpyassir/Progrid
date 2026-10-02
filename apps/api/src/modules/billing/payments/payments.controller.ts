import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';
import type { Request, Response } from 'express';
import { CurrentActor, Public, RequireScopes } from '../../../common/auth/decorators';
import type { Actor } from '../../../common/auth/actor';
import { PaymentsService } from './payments.service';
import { InvoicesService } from '../invoices.service';
import { renderInvoicePdf } from '../invoice-pdf';
import { ApiError } from '../../../common/errors/api-error';
import { loadConfig } from '../../../config/config';

class TopupDto { @IsInt() @Min(1) amountMinor: number; }

@ApiTags('billing')
@ApiBearerAuth()
@Controller('v1/billing')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService, private readonly invoices: InvoicesService) {}

  /** Start a card payment that becomes prepaid credit. Returns the hosted page to send the person to. */
  @Post('topup') @RequireScopes('billing:write') @HttpCode(201)
  topup(@CurrentActor() actor: Actor, @Body() dto: TopupDto) {
    return this.payments.topup(actor, dto.amountMinor);
  }

  @Post('invoices/:id/pay') @RequireScopes('billing:write') @HttpCode(201)
  pay(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.payments.payInvoice(actor, id);
  }

  @Get('payments') @RequireScopes('billing:read')
  async list(@CurrentActor() actor: Actor) {
    return { data: await this.payments.list(actor) };
  }

  @Get('invoices/:id/pdf') @RequireScopes('billing:read')
  async pdf(@CurrentActor() actor: Actor, @Param('id') id: string, @Res() res: Response) {
    const inv = await this.invoices.getForPdf(actor.teamId, id);
    if (!inv) throw ApiError.notFound('invoice', id);
    const buf = await renderInvoicePdf(inv);
    res.setHeader('content-type', 'application/pdf');
    res.setHeader('content-disposition', `inline; filename="${inv.number}.pdf"`);
    res.send(buf);
  }

  /** Moyasar → us. Verified with the shared webhook token, then the invoice is fetched. */
  @Public() @Post('payments/moyasar/webhook') @HttpCode(200)
  async moyasarWebhook(@Req() req: Request & { rawBody?: Buffer }, @Headers() headers: Record<string, string>) {
    await this.payments.handle('moyasar', req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {})), headers);
    return { received: true };
  }

  /** Moyasar → browser → us after the hosted page. We verify by retrieving the invoice, then redirect. */
  @Public() @Get('payments/moyasar/callback')
  async moyasarCallback(@Req() req: Request & { rawBody?: Buffer }, @Headers() headers: Record<string, string>, @Query() query: Record<string, string>, @Res() res: Response) {
    const raw = req.rawBody ?? Buffer.from(typeof req.body === 'string' ? req.body : new URLSearchParams(req.body ?? {}).toString());
    const out = await this.payments.handle('moyasar', raw, headers, query);
    const r = out[0];
    res.redirect(r ? (r.status === 'succeeded' ? r.successUrl : r.cancelUrl) ?? `${loadConfig().CONSOLE_URL}/billing` : `${loadConfig().CONSOLE_URL}/billing`);
  }

  /** Stripe → us (Progrid Technologies LLC). Verified with the Stripe-Signature header, then the session is fetched. */
  @Public() @Post('payments/stripe/webhook') @HttpCode(200)
  async stripeWebhook(@Req() req: Request & { rawBody?: Buffer }, @Headers() headers: Record<string, string>) {
    if (!req.rawBody) throw ApiError.invalid('Raw body required');
    await this.payments.handle('stripe', req.rawBody, headers);
    return { received: true };
  }

  /** Stripe → browser → us after Checkout (?session_id=cs_...). We retrieve the session, then redirect. */
  @Public() @Get('payments/stripe/callback')
  async stripeCallback(@Query() query: Record<string, string>, @Res() res: Response) {
    const out = await this.payments.handle('stripe', Buffer.alloc(0), {}, { session_id: query.session_id ?? '' });
    const r = out[0];
    res.redirect(r ? (r.status === 'succeeded' ? r.successUrl : r.cancelUrl) ?? `${loadConfig().CONSOLE_URL}/billing` : `${loadConfig().CONSOLE_URL}/billing`);
  }

  /** Built in test checkout page for development and demos. */
  @Public() @Get('payments/fake/pay')
  fakePage(@Query() q: Record<string, string>, @Res() res: Response) {
    const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: q.currency || 'USD' }).format(Number(q.amount || 0) / 100);
    const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>Test payment</title>
<style>body{font-family:system-ui,sans-serif;background:#f8fafc;display:grid;place-items:center;min-height:100vh;margin:0}.card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;max-width:380px;width:100%}h1{font-size:18px;margin:0 0 4px}p{color:#64748b;font-size:14px}.amt{font-size:32px;font-weight:700;margin:12px 0 20px}button{width:100%;padding:12px;border-radius:8px;border:0;font-weight:600;font-size:15px;cursor:pointer;margin-top:8px}.ok{background:#2563eb;color:#fff}.no{background:#fff;border:1px solid #cbd5e1}</style></head>
<body><form class="card" method="get" action="/v1/billing/payments/fake/confirm"><h1>Test payment page</h1><p>No real card is charged. This page stands in for Moyasar and Stripe in development.</p><div class="amt">${esc(amount)}</div>
<input type="hidden" name="ref" value="${esc(q.ref || '')}"><input type="hidden" name="success" value="${esc(q.success || '')}"><input type="hidden" name="cancel" value="${esc(q.cancel || '')}">
<button class="ok" name="outcome" value="ok">Pay ${esc(amount)}</button><button class="no" name="outcome" value="fail">Decline</button></form></body></html>`);
  }

  @Public() @Get('payments/fake/confirm')
  async fakeConfirm(@Query() q: Record<string, string>, @Res() res: Response) {
    const c = loadConfig();
    if (c.PAYMENT_PROVIDER !== 'fake' && c.PAYMENT_PROVIDER_LLC !== 'fake') throw ApiError.notFound('page', 'fake');
    const out = await this.payments.handle('fake', Buffer.alloc(0), {}, q);
    const r = out[0];
    res.redirect((r?.status === 'succeeded' ? q.success : q.cancel) || `${loadConfig().CONSOLE_URL}/billing`);
  }
}
