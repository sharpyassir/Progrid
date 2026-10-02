import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../../../common/errors/api-error';
import { loadConfig } from '../../../config/config';
import type { CheckoutInput, CheckoutResult, PaymentEvent, PaymentProvider, RefundResult } from './provider';

interface StripeSession { id: string; url?: string | null; status?: string; payment_status?: string; amount_total?: number | null; currency?: string | null; payment_intent?: string | null }
interface StripeEvent { type?: string; data?: { object?: { id?: string; object?: string } } }

/** Seconds a signed webhook stays valid, as in Stripe's own libraries. */
const SIGNATURE_TOLERANCE_S = 300;

/**
 * Stripe Checkout for Progrid Technologies LLC (USD). One Checkout Session per payment; the
 * person pays on Stripe's page and comes back through our callback, and Stripe also sends a
 * signed webhook. Neither is trusted on its own: both lead to a server side fetch of the session,
 * which is the source of truth. Amounts are in cents. Plain HTTPS calls, no SDK.
 */
export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe' as const;

  async createCheckout(i: CheckoutInput): Promise<CheckoutResult> {
    const callback = new URL(i.callbackUrl);
    // Stripe fills in {CHECKOUT_SESSION_ID}; it must stay unescaped in the URL.
    const successUrl = `${callback.toString()}${callback.search ? '&' : '?'}session_id={CHECKOUT_SESSION_ID}`;
    const s = await this.call<StripeSession>('POST', '/v1/checkout/sessions', {
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': i.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(i.amountMinor),
      'line_items[0][price_data][product_data][name]': i.description,
      success_url: successUrl,
      cancel_url: i.cancelUrl,
      customer_email: i.customer.email,
      client_reference_id: i.paymentId,
      'metadata[paymentId]': i.paymentId,
      'metadata[teamId]': i.customer.teamId,
      'payment_intent_data[metadata][paymentId]': i.paymentId,
    });
    if (!s.url) throw new ApiError(502, 'payment_provider_error', 'Stripe returned no checkout URL');
    return { providerRef: s.id, redirectUrl: s.url };
  }

  async parseEvent(rawBody: Buffer, headers: Record<string, string | undefined>, query?: Record<string, string>): Promise<PaymentEvent[]> {
    let sessionId: string | undefined;
    const signature = headers['stripe-signature'];
    if (signature !== undefined) {
      verifySignature(rawBody, signature, loadConfig().STRIPE_WEBHOOK_SECRET ?? '');
      const ev = JSON.parse(rawBody.toString('utf8')) as StripeEvent;
      if (!ev.type?.startsWith('checkout.session.') || ev.data?.object?.object !== 'checkout.session') return [];
      sessionId = ev.data.object.id;
    } else if (query?.session_id) {
      sessionId = query.session_id;
    }
    if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw ApiError.invalid('No Stripe checkout session in the request');
    const s = await this.call<StripeSession>('GET', `/v1/checkout/sessions/${sessionId}`);
    if (s.payment_status === 'paid' || s.payment_status === 'no_payment_required') {
      return [{ providerRef: s.id, status: 'succeeded', amountMinor: s.amount_total ?? undefined, currency: (s.currency ?? '').toUpperCase() as PaymentEvent['currency'] }];
    }
    if (s.status === 'expired') return [{ providerRef: s.id, status: 'failed', reason: 'expired' }];
    return [];
  }

  /** Refunds the payment intent behind the session (POST /v1/refunds). */
  async refund(providerRef: string, amountMinor: number): Promise<RefundResult> {
    const s = await this.call<StripeSession>('GET', `/v1/checkout/sessions/${providerRef}`);
    if (!s.payment_intent) throw new ApiError(409, 'invalid_state', `Stripe session ${providerRef} has no captured payment to refund`);
    const r = await this.call<{ id: string }>('POST', '/v1/refunds', { payment_intent: s.payment_intent, amount: String(amountMinor) });
    return { refundRef: r.id };
  }

  private async call<T>(method: 'GET' | 'POST', path: string, form?: Record<string, string>): Promise<T> {
    const { STRIPE_SECRET_KEY: key, STRIPE_BASE_URL: base } = loadConfig();
    if (!key) throw new ApiError(503, 'payments_unavailable', 'Stripe is not configured');
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${key}`, accept: 'application/json', ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? new URLSearchParams(form).toString() : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const out = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
    if (!res.ok) throw new ApiError(502, 'payment_provider_error', `Stripe: ${out.error?.message ?? res.status}`);
    return out;
  }
}

/** Checks a Stripe-Signature header (t=<unix>,v1=<hex hmac>) over "<t>.<raw body>". */
export function verifySignature(rawBody: Buffer, header: string, secret: string, now = Date.now()) {
  if (!secret) throw ApiError.unauthorized('Stripe webhooks are not configured');
  const parts = header.split(',').map((p) => p.split('=') as [string, string]);
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !sigs.length || Math.abs(now / 1000 - Number(t)) > SIGNATURE_TOLERANCE_S) throw ApiError.unauthorized('Invalid Stripe signature');
  const want = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest();
  const ok = sigs.some((s) => {
    const got = Buffer.from(s, 'hex');
    return got.length === want.length && timingSafeEqual(got, want);
  });
  if (!ok) throw ApiError.unauthorized('Invalid Stripe signature');
}
