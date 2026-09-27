import { loadConfig } from '../../../config/config';
import type { CheckoutInput, CheckoutResult, PaymentEvent, PaymentProvider, RefundResult } from './provider';

/** Development and demo: a hosted page of our own that succeeds or fails on a click. */
export class FakeProvider implements PaymentProvider {
  readonly name = 'fake' as const;

  async createCheckout(i: CheckoutInput): Promise<CheckoutResult> {
    const ref = `fake_${i.paymentId}`;
    return { providerRef: ref, redirectUrl: `${loadConfig().PUBLIC_API_URL}/v1/billing/payments/fake/pay?ref=${ref}&amount=${i.amountMinor}&currency=${i.currency}&success=${encodeURIComponent(i.successUrl)}&cancel=${encodeURIComponent(i.cancelUrl)}` };
  }

  async parseEvent(_raw: Buffer, _h: Record<string, string | undefined>, query?: Record<string, string>): Promise<PaymentEvent[]> {
    if (!query?.ref) return [];
    return [{ providerRef: query.ref, status: query.outcome === 'fail' ? 'failed' : 'succeeded', reason: query.outcome === 'fail' ? 'declined in the test page' : undefined }];
  }

  /** No card was charged, so the refund always succeeds. */
  async refund(providerRef: string, amountMinor: number): Promise<RefundResult> {
    return { refundRef: `fake_refund_${providerRef}_${amountMinor}_${Date.now()}` };
  }
}
