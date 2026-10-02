import { Injectable, Logger } from '@nestjs/common';
import type { BillingEntity, Currency, PaymentProvider as ProviderName } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ApiError } from '../../../common/errors/api-error';
import { EventsService } from '../../events/events.service';
import { entityProfile, requestApiBase, returnConsoleUrl } from '../../../common/entities/entities';
import type { Actor } from '../../../common/auth/actor';
import type { PaymentProvider } from './provider';
import { MoyasarProvider } from './moyasar.provider';
import { FakeProvider } from './fake.provider';
import { StripeProvider } from './stripe.provider';
import { TrustService } from '../../trust/trust.service';
import { CommissionService } from '../../affiliates/commission.service';

/** A pending checkout younger than this is handed out again instead of starting a second one. */
const PENDING_REUSE_MS = 30 * 60_000;

type CardProvider = 'moyasar' | 'stripe' | 'fake';

/**
 * Card payments: prepaid credit top ups and paying open invoices. The money goes to the company
 * that bills the team (or issued the invoice): Progrid Arabia collects riyals through Moyasar,
 * Progrid Technologies LLC collects dollars through Stripe, each with its own credentials.
 */
@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);
  private readonly providers: Record<CardProvider, PaymentProvider> = { moyasar: new MoyasarProvider(), stripe: new StripeProvider(), fake: new FakeProvider() };

  constructor(private readonly prisma: PrismaService, private readonly events: EventsService, private readonly trust: TrustService, private readonly commissions: CommissionService) {}

  /** The adapter that took a stored payment (for refunds). */
  providerByName(name: ProviderName): PaymentProvider | undefined {
    return name === 'moyasar' || name === 'stripe' || name === 'fake' ? this.providers[name] : undefined;
  }

  /** The card gateway of a company: Moyasar for Progrid Arabia, Stripe for the LLC (or the test page). */
  providerFor(entity: BillingEntity): PaymentProvider {
    return this.providers[entityProfile(entity).paymentProvider];
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
    return this.start(actor, team, { entity: team.billingEntity, currency: team.currency }, amountMinor, `Progrid credit top up for ${team.name}`, undefined);
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
    const due = inv.totalMinor - inv.creditedMinor;
    if (due <= 0) throw ApiError.invalidState(`Invoice ${inv.number} has nothing left to pay`);
    // Paid to the company that issued the invoice, in its currency, even if the team has moved since.
    return this.start(actor, team, { entity: inv.billingEntity, currency: inv.currency }, due, `Progrid invoice ${inv.number}`, inv.id);
  }

  list(actor: Actor) {
    return this.prisma.payment.findMany({ where: { teamId: actor.teamId }, orderBy: { createdAt: 'desc' }, take: 50, include: { invoice: { select: { number: true } } } });
  }

  /** Provider webhook or callback: idempotent, so redelivery is harmless. */
  async handle(provider: CardProvider, rawBody: Buffer, headers: Record<string, string | undefined>, query?: Record<string, string>) {
    const events = await this.providers[provider].parseEvent(rawBody, headers, query);
    const out: { paymentId: string; status: string; successUrl?: string; cancelUrl?: string }[] = [];
    for (const ev of events) {
      if (ev.status === 'disputed') {
        // A chargeback or dispute opened at the provider (Stripe charge.dispute.created).
        if (ev.paymentId) await this.recordDispute(ev.paymentId, ev.reason);
        continue;
      }
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
          const claimed = await tx.payment.updateMany({ where: { id: p.id, status: 'pending' }, data: { status: 'succeeded', paidAt: new Date(), cardFingerprint: ev.cardFingerprint ?? null } });
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
        await this.commissions.onInvoicePaid(p.invoiceId);
      } else {
        await this.prisma.payment.updateMany({ where: { id: p.id, status: 'pending' }, data: { status: 'failed', failureReason: ev.reason } });
        await this.events.emit('payment.failed', { paymentId: p.id, invoiceId: p.invoiceId, reason: ev.reason }, { teamId: p.teamId, resource: `payment:${p.id}` });
      }
      out.push({ paymentId: p.id, status: ev.status, ...meta });
    }
    return out;
  }

  /**
   * A chargeback or dispute on a payment, from the provider or marked by finance staff (Moyasar
   * has no dispute webhook). Recorded once; affiliate commission on its invoice is reversed.
   */
  async recordDispute(paymentId: string, reason?: string) {
    const r = await this.prisma.payment.updateMany({ where: { id: paymentId, disputedAt: null }, data: { disputedAt: new Date() } });
    if (!r.count) return false;
    const p = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    await this.events.emit('payment.disputed', { paymentId, invoiceId: p.invoiceId, amountMinor: p.amountMinor, currency: p.currency, reason }, { teamId: p.teamId, resource: `payment:${p.id}` });
    await this.commissions.onChargeback(paymentId);
    return true;
  }

  /** Called after money arrives or a debt is settled another way: lifts a suspension for non payment and powers servers back on. */
  async liftBillingSuspension(teamId: string) {
    await this.trust.reinstateIfSettled(teamId).catch((e) => this.log.error(`reinstating team ${teamId} failed: ${(e as Error).message}`));
  }

  private async start(actor: Actor, team: { id: string; name: string }, billing: { entity: BillingEntity; currency: Currency }, amountMinor: number, description: string, invoiceId: string | undefined) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    const provider = this.providerFor(billing.entity);
    const entity = entityProfile(billing.entity);
    // Back to the console the person paid from (their session lives there), else the company's console.
    const consoleUrl = returnConsoleUrl(billing.entity);
    const apiBase = requestApiBase(entity.apiUrl);
    const successUrl = `${consoleUrl}/billing?payment=success`;
    const cancelUrl = `${consoleUrl}/billing?payment=cancel`;
    const metadata = { successUrl, cancelUrl, providerName: provider.name, billingEntity: billing.entity };
    const currency = billing.currency;
    const payment = invoiceId
      ? await this.prisma.$transaction(async (tx) => {
          // Serializes concurrent "pay" clicks on one invoice so only one checkout is created.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice-pay:${invoiceId}`}))`;
          const busy = await tx.payment.findFirst({ where: { invoiceId, status: 'pending', createdAt: { gt: new Date(Date.now() - PENDING_REUSE_MS) } } });
          if (busy) throw ApiError.conflict('payment_in_progress', 'A payment for this invoice is already being started. Try again in a moment.');
          return tx.payment.create({ data: { teamId: team.id, invoiceId, provider: provider.name, currency, amountMinor, metadata } });
        })
      : await this.prisma.payment.create({ data: { teamId: team.id, provider: provider.name, currency, amountMinor, metadata } });
    try {
      const r = await provider.createCheckout({ paymentId: payment.id, amountMinor, currency, description, customer: { email: user.email, name: user.name, teamId: team.id }, successUrl, cancelUrl, callbackUrl: `${apiBase}/v1/billing/payments/${provider.name}/callback`, apiBase });
      await this.prisma.payment.update({ where: { id: payment.id }, data: { providerRef: r.providerRef, metadata: { ...metadata, redirectUrl: r.redirectUrl } } });
      await this.events.emit('payment.started', { paymentId: payment.id, amountMinor, currency, invoiceId, billingEntity: billing.entity }, { actor, resource: `payment:${payment.id}` });
      return { paymentId: payment.id, provider: provider.name, amountMinor, currency, billingEntity: billing.entity, redirectUrl: r.redirectUrl };
    } catch (err) {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'failed', failureReason: (err as Error).message } });
      throw err;
    }
  }
}
