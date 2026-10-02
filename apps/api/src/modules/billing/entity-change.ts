import type { BillingEntity, Currency } from '@prisma/client';
import { currencyForEntity } from '../../common/entities/entities';
import { startOfMonth } from './pricing';

/** The billing columns of a team that decide who invoices it, in which currency. */
export interface TeamBilling {
  country: string;
  currency: Currency;
  billingEntity: BillingEntity;
  pendingCountry?: string | null;
  pendingBillingEntity?: BillingEntity | null;
  billingChangeAt?: Date | null;
}

/**
 * Who bills the team at `at`. A staff approved change (pending*) applies from billingChangeAt,
 * the start of a billing period, so usage before it stays with the old company and currency and
 * usage after it goes to the new one, even before the pending columns are folded in.
 */
export function billingAt(t: TeamBilling, at: Date): { entity: BillingEntity; country: string; currency: Currency } {
  if (t.pendingBillingEntity && t.billingChangeAt && at.getTime() >= t.billingChangeAt.getTime()) {
    return { entity: t.pendingBillingEntity, country: t.pendingCountry ?? t.country, currency: currencyForEntity(t.pendingBillingEntity) };
  }
  return { entity: t.billingEntity, country: t.country, currency: t.currency };
}

/** Start of the next billing period (calendar month, UTC). */
export function nextBillingPeriod(now: Date): Date {
  const m = startOfMonth(now);
  return new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
}
