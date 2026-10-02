import { timingSafeEqual } from 'node:crypto';
import { ApiError } from '../../../common/errors/api-error';
import { keyedHash } from '../../../common/crypto/secretbox';
import { loadConfig } from '../../../config/config';
import type { CheckoutInput, CheckoutResult, PaymentEvent, PaymentProvider, RefundResult } from './provider';

interface MoyasarInvoice { id: string; status: string; amount: number; currency: string; url: string; payments?: MoyasarInvoicePayment[] }
interface MoyasarInvoicePayment { id: string; status: string; amount?: number; currency?: string; source?: { type?: string; company?: string; name?: string; number?: string } }
interface MoyasarPayment { id: string; status: string; amount: number; currency: string; invoice_id?: string | null; metadata?: Record<string, string> }

/**
 * Moyasar hosted invoices (mada, Visa, Mastercard, Apple Pay). One invoice per payment; the
 * person pays on Moyasar's page and comes back through the callback, and Moyasar also posts a
 * webhook. Neither the callback query nor the webhook body is trusted: both trigger a server
 * side fetch of the invoice, which is the source of truth. Amounts are in halalas.
 */
export class MoyasarProvider implements PaymentProvider {
  readonly name = 'moyasar' as const;

  async createCheckout(i: CheckoutInput): Promise<CheckoutResult> {
    const inv = await this.call<MoyasarInvoice>('POST', '/v1/invoices', {
      amount: i.amountMinor,
      currency: i.currency,
      description: i.description,
      callback_url: i.callbackUrl,
      success_url: i.callbackUrl,
      back_url: i.cancelUrl,
      metadata: { paymentId: i.paymentId, teamId: i.customer.teamId, email: i.customer.email },
    });
    return { providerRef: inv.id, redirectUrl: inv.url };
  }

  async parseEvent(rawBody: Buffer, headers: Record<string, string | undefined>, query?: Record<string, string>): Promise<PaymentEvent[]> {
    const cfg = loadConfig();
    let invoiceId: string | undefined;
    if ((headers['content-type'] ?? '').includes('application/json') && rawBody.length) {
      // Webhook: authenticated by the shared secret token Moyasar puts in the body.
      const ev = JSON.parse(rawBody.toString('utf8')) as { type?: string; secret_token?: string; data?: { id?: string; invoice_id?: string | null } };
      const want = cfg.MOYASAR_WEBHOOK_SECRET ?? '';
      const got = ev.secret_token ?? '';
      if (!want || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) throw ApiError.unauthorized('Invalid Moyasar webhook token');
      invoiceId = ev.data?.invoice_id ?? undefined;
      if (!invoiceId && ev.data?.id) invoiceId = (await this.call<MoyasarPayment>('GET', `/v1/payments/${ev.data.id}`)).invoice_id ?? undefined;
    } else if (query?.id) {
      // Callback after the hosted page: the query names the payment; look it up.
      const p = await this.call<MoyasarPayment>('GET', `/v1/payments/${query.id}`);
      invoiceId = p.invoice_id ?? undefined;
    } else if (query?.invoice_id) {
      invoiceId = query.invoice_id;
    }
    if (!invoiceId) throw ApiError.invalid('No Moyasar invoice in the request');
    const inv = await this.call<MoyasarInvoice>('GET', `/v1/invoices/${invoiceId}`);
    if (inv.status === 'paid') {
      // Report what was actually captured when Moyasar lists the payments, so the service can
      // compare it with our record; otherwise the invoice amount stands for it.
      const paid = (inv.payments ?? []).filter((p) => p.status === 'paid' && typeof p.amount === 'number');
      const amountMinor = paid.length ? paid.reduce((s, p) => s + (p.amount ?? 0), 0) : inv.amount;
      const currency = (paid.find((p) => p.currency && p.currency.toUpperCase() !== inv.currency.toUpperCase())?.currency ?? inv.currency).toUpperCase();
      return [{ providerRef: inv.id, status: 'succeeded', amountMinor, currency: currency as PaymentEvent['currency'], cardFingerprint: moyasarFingerprint(paid[0]) }];
    }
    if (['failed', 'canceled', 'expired', 'voided'].includes(inv.status)) return [{ providerRef: inv.id, status: 'failed', reason: inv.status }];
    return [];
  }

  /**
   * Refunds through `POST /v1/payments/{id}/refund`. Our providerRef is the Moyasar invoice, so
   * the captured payment on it is looked up first; a payment id (pay_...) is used as is.
   */
  async refund(providerRef: string, amountMinor: number): Promise<RefundResult> {
    let paymentId = providerRef;
    if (!providerRef.startsWith('pay_')) {
      const inv = await this.call<MoyasarInvoice>('GET', `/v1/invoices/${providerRef}`);
      const paid = (inv.payments ?? []).find((p) => p.status === 'paid' || p.status === 'captured' || p.status === 'refunded');
      if (!paid) throw new ApiError(409, 'invalid_state', `Moyasar invoice ${providerRef} has no captured payment to refund`);
      paymentId = paid.id;
    }
    const p = await this.call<MoyasarPayment>('POST', `/v1/payments/${paymentId}/refund`, { amount: amountMinor });
    return { refundRef: p.id };
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const { MOYASAR_SECRET_KEY: key, MOYASAR_BASE_URL: base } = loadConfig();
    if (!key) throw new ApiError(503, 'payments_unavailable', 'Moyasar is not configured');
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`, 'content-type': 'application/json', accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const out = (await res.json().catch(() => ({}))) as T & { message?: string };
    if (!res.ok) throw new ApiError(502, 'payment_provider_error', `Moyasar: ${out.message ?? res.status}`);
    return out;
  }
}

/**
 * Moyasar has no card fingerprint, so one is derived from the masked number (first six and last
 * four digits), the brand and the holder name. Enough to tell the same card again; never stored in clear.
 */
export function moyasarFingerprint(p: MoyasarInvoicePayment | undefined): string | undefined {
  const s = p?.source;
  if (!s?.number || !/\d{4}$/.test(s.number)) return undefined;
  const digits = s.number.replace(/[^0-9]/g, '');
  return `moyasar:${keyedHash(`${(s.company ?? '').toLowerCase()}|${digits}|${(s.name ?? '').trim().toLowerCase()}`, 'card')}`;
}
