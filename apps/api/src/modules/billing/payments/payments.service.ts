import { Injectable, Logger } from '@nestjs/common';
import type { Currency, PaymentProvider as ProviderName } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ApiError } from '../../../common/errors/api-error';
import { EventsService } from '../../events/events.service';
import { loadConfig } from '../../../config/config';
import type { Actor } from '../../../common/auth/actor';
import type { PaymentProvider } from './provider';
import { MoyasarProvider } from './moyasar.provider';
import { FakeProvider } from './fake.provider';

/** A pending checkout younger than this is handed out again instead of starting a second one. */
const PENDING_REUSE_MS = 30 * 60_000;

/** Card payments: prepaid credit top ups and paying open invoices, in riyals or dollars through Moyasar. */
@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);
  private readonly providers: Record<'moyasar' | 'fake', PaymentProvider> = { moyasar: new MoyasarProvider(), fake: new FakeProvider() };

  constructor(private readonly prisma: PrismaService, private readonly events: EventsService) {}

  providerFor(currency: Currency): PaymentProvider {
    const c = loadConfig();
    void currency; // one provider serves both currencies
    return this.providers[c.PAYMENT_PROVIDER];
  }

  /** Limits per currency in minor units: keeps typos and card testing out. */
  limits(currency: Currency) {
    return currency === 'SAR' ? { min: 2_000, max: 2_000_000 } : { min: 500, max: 500_000 };
  }

  async topup(actor: Actor, amountMinor: number) {
    if (actor.isAgent) throw ApiError.forbidden('Agents cannot add credit. A person must do this in the console.');
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: actor.teamId } });
    const { min, max } = this.limits(team.currency);
    if (!Number.isInteger(amountMinor) || amountMinor < min || amountMinor > max) throw ApiError.invalid(`Amount must be between ${min / 100} and ${max / 100} ${team.currency}`, { min, max });
    return this.start(actor, team, amountMinor, `pgcloud credit top up for ${team.name}`, undefined);
  }

  async payInvoice(actor: Actor, invoiceId: string) {
    if (actor.isAgent) throw ApiError.forbidden('Agents cannot pay invoices. A person must do this in the console.');
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: actor.teamId } });
    const inv = await this.prisma.invoice.findFirst({ where: { id: invoiceId, teamId: team.id } });
    if (!inv) throw ApiError.notFound('invoice', invoiceId);
    if (inv.status !== 'open') throw ApiError.invalidState(`Invoice ${inv.number} is ${inv.status}`);
    // One checkout at a time per invoice: a recent pending payment is reused instead of starting another.
    const pending = await this.prisma.payment.findFirst({
      where: { invoiceId: inv.id, status: 'pending', createdAt: { gt: new Date(Date.now() - PENDING_REUSE_MS) } },
      orderBy: { createdAt: 'desc' },
    });
    if (pending) {
      const meta = (pending.metadata ?? {}) as { redirectUrl?: string; providerName?: string };
      if (!pending.providerRef || !meta.redirectUrl) throw ApiError.conflict('payment_in_progress', `A payment for invoice ${inv.number} is already being started. Try again in a moment.`);
      return { paymentId: pending.id, provider: meta.providerName ?? pending.provider, amountMinor: pending.amountMinor, currency: pending.currency, redirectUrl: meta.redirectUrl };
    }
    return this.start(actor, team, inv.totalMinor, `pgcloud invoice ${inv.number}`, inv.id);
  }

  list(actor: Actor) {
    return this.prisma.payment.findMany({ where: { teamId: actor.teamId }, orderBy: { createdAt: 'desc' }, take: 50, include: { invoice: { select: { number: true } } } });
  }

  /** Provider webhook or callback: idempotent, so redelivery is harmless. */
  async handle(provider: ProviderName | 'fake', rawBody: Buffer, headers: Record<string, string | undefined>, query?: Record<string, string>) {
    const events = await this.providers[provider as 'moyasar' | 'fake'].parseEvent(rawBody, headers, query);
    const out: { paymentId: string; status: string; successUrl?: string; cancelUrl?: string }[] = [];
    for (const ev of events) {
      const p = await this.prisma.payment.findFirst({ where: { provider, providerRef: ev.providerRef }, include: { invoice: true } });
      if (!p) { this.log.warn(`${provider} event for unknown payment ${ev.providerRef}`); continue; }
      const meta = (p.metadata ?? {}) as { successUrl?: string; cancelUrl?: string };
      if (p.status !== 'pending') { out.push({ paymentId: p.id, status: p.status, ...meta }); continue; }
      if (ev.status === 'succeeded') {
        // Card providers must report what was charged and it must equal our record; the test page reports nothing.
        const mustReport = provider !== 'fake';
        const amountOk = ev.amountMinor === undefined ? !mustReport : ev.amountMinor === p.amountMinor;
        const currencyOk = ev.currency === undefined ? !mustReport : ev.currency.toUpperCase() === p.currency;
        if (!amountOk || !currencyOk) {
          const reason = `amount mismatch: provider reported ${ev.amountMinor ?? '?'} ${ev.currency ?? '?'}, expected ${p.amountMinor} ${p.currency}`;
          this.log.error(`payment ${p.id} (${provider} ${ev.providerRef}) rejected, ${reason}`);
          const r = await this.prisma.payment.updateMany({ where: { id: p.id, status: 'pending' }, data: { status: 'failed', failureReason: reason } });
          if (r.count) await this.events.emit('payment.failed', { paymentId: p.id, invoiceId: p.invoiceId, reason }, { teamId: p.teamId, resource: `payment:${p.id}` });
          out.push({ paymentId: p.id, status: 'failed', ...meta });
          continue;
        }
        const applied = await this.prisma.$transaction(async (tx) => {
          // Claim the pending row first so a concurrent webhook and callback cannot both credit it.
          const claimed = await tx.payment.updateMany({ where: { id: p.id, status: 'pending' }, data: { status: 'succeeded', paidAt: new Date() } });
          if (!claimed.count) return false;
          const invoiceOpen = p.invoiceId ? (await tx.invoice.updateMany({ where: { id: p.invoiceId, status: 'open' }, data: { status: 'paid', paidAt: new Date() } })).count === 1 : false;
          if (p.invoiceId && !invoiceOpen) {
            // The invoice was settled or voided meanwhile; keep the money as credit rather than lose it.
            this.log.warn(`payment ${p.id} arrived for invoice ${p.invoice?.number} that is no longer open; added as credit`);
            await tx.credit.create({ data: { teamId: p.teamId, kind: 'prepaid', currency: p.currency, amountMinor: p.amountMinor, remainingMinor: p.amountMinor, reason: `Payment for invoice ${p.invoice?.number ?? p.invoiceId} that was already closed` } });
          } else if (!p.invoiceId) {
            await tx.credit.create({ data: { teamId: p.teamId, kind: 'prepaid', currency: p.currency, amountMinor: p.amountMinor, remainingMinor: p.amountMinor, reason: `Card top up (${provider} ${ev.providerRef.slice(0, 12)})` } });
          }
          return true;
        });
        if (!applied) { out.push({ paymentId: p.id, status: 'succeeded', ...meta }); continue; }
        // A paid invoice or fresh credit lifts a team that was suspended for non payment.
        await this.liftBillingSuspension(p.teamId);
        await this.events.emit(p.invoiceId ? 'invoice.paid' : 'payment.succeeded', { paymentId: p.id, invoiceId: p.invoiceId, amountMinor: p.amountMinor, currency: p.currency }, { teamId: p.teamId, resource: `payment:${p.id}` });
      } else {
        await this.prisma.payment.updateMany({ where: { id: p.id, status: 'pending' }, data: { status: 'failed', failureReason: ev.reason } });
        await this.events.emit('payment.failed', { paymentId: p.id, invoiceId: p.invoiceId, reason: ev.reason }, { teamId: p.teamId, resource: `payment:${p.id}` });
      }
      out.push({ paymentId: p.id, status: ev.status, ...meta });
    }
    return out;
  }

  private async liftBillingSuspension(teamId: string) {
    await this.prisma.team.updateMany({ where: { id: teamId, status: 'suspended' }, data: { status: 'active' } });
  }

  private async start(actor: Actor, team: { id: string; name: string; currency: Currency }, amountMinor: number, description: string, invoiceId: string | undefined) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    const provider = this.providerFor(team.currency);
    const c = loadConfig();
    const successUrl = `${c.CONSOLE_URL}/billing?payment=success`;
    const cancelUrl = `${c.CONSOLE_URL}/billing?payment=cancel`;
    const metadata = { successUrl, cancelUrl, providerName: provider.name };
    const payment = invoiceId
      ? await this.prisma.$transaction(async (tx) => {
          // Serializes concurrent "pay" clicks on one invoice so only one checkout is created.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice-pay:${invoiceId}`}))`;
          const busy = await tx.payment.findFirst({ where: { invoiceId, status: 'pending', createdAt: { gt: new Date(Date.now() - PENDING_REUSE_MS) } } });
          if (busy) throw ApiError.conflict('payment_in_progress', 'A payment for this invoice is already being started. Try again in a moment.');
          return tx.payment.create({ data: { teamId: team.id, invoiceId, provider: provider.name, currency: team.currency, amountMinor, metadata } });
        })
      : await this.prisma.payment.create({ data: { teamId: team.id, provider: provider.name, currency: team.currency, amountMinor, metadata } });
    try {
      const r = await provider.createCheckout({ paymentId: payment.id, amountMinor, currency: team.currency, description, customer: { email: user.email, name: user.name, teamId: team.id }, successUrl, cancelUrl, callbackUrl: `${c.PUBLIC_API_URL}/v1/billing/payments/${provider.name}/callback` });
      await this.prisma.payment.update({ where: { id: payment.id }, data: { providerRef: r.providerRef, metadata: { ...metadata, redirectUrl: r.redirectUrl } } });
      await this.events.emit('payment.started', { paymentId: payment.id, amountMinor, currency: team.currency, invoiceId }, { actor, resource: `payment:${payment.id}` });
      return { paymentId: payment.id, provider: provider.name, amountMinor, currency: team.currency, redirectUrl: r.redirectUrl };
    } catch (err) {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'failed', failureReason: (err as Error).message } });
      throw err;
    }
  }
}
