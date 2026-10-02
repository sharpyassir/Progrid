import type { Currency } from '@prisma/client';

export interface CheckoutInput {
  paymentId: string;
  amountMinor: number;
  currency: Currency;
  description: string;
  customer: { email: string; name: string; teamId: string };
  /** Where the provider sends the person afterwards. */
  successUrl: string;
  cancelUrl: string;
  /** Where the provider sends the person and posts confirmation (Moyasar and Stripe callback). */
  callbackUrl: string;
  /** Public API base of this checkout (the test page lives there). */
  apiBase: string;
}

export interface CheckoutResult { providerRef: string; redirectUrl: string }

export interface RefundResult { refundRef: string }

export interface PaymentEvent { providerRef: string; status: 'succeeded' | 'failed'; amountMinor?: number; currency?: Currency; reason?: string }

/** One card payment provider. Adapters do HTTP only; the service owns the database. */
export interface PaymentProvider {
  readonly name: 'moyasar' | 'stripe' | 'fake';
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  /** Verifies a webhook or callback and turns it into normalized events. Throws on a bad signature. */
  parseEvent(rawBody: Buffer, headers: Record<string, string | undefined>, query?: Record<string, string>): Promise<PaymentEvent[]>;
  /** Refunds part or all of a captured payment back to the card. Throws when the provider refuses. */
  refund(providerRef: string, amountMinor: number): Promise<RefundResult>;
}
