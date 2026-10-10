import type { BillingEntity, Currency } from '@prisma/client';
import { BILLING_ENTITY, currencyForCountry } from '../../common/entities/entities';
import { startOfMonth } from './pricing';

/** The billing columns of a team that decide its currency and VAT. */
export interface TeamBilling {
  country: string;
  currency: Currency;
  billingEntity?: BillingEntity;
  pendingCountry?: string | null;
  pendingCurrency?: Currency | null;
  billingChangeAt?: Date | null;
}

/**
 * How the team is billed at `at`. Progrid Arabia always invoices; the billing country decides
 * currency and VAT. A country change that moves the team into or out of Saudi Arabia changes the
 * currency, so it waits in the pending columns until billingChangeAt (the start of a month): usage
 * before it stays in the old currency, usage from it is rated in the new one, even before the
 * monthly run folds the pending columns into the team.
 */
export function billingAt(t: TeamBilling, at: Date): { entity: BillingEntity; country: string; currency: Currency } {
  if (t.billingChangeAt && (t.pendingCurrency || t.pendingCountry) && at.getTime() >= t.billingChangeAt.getTime()) {
    return { entity: BILLING_ENTITY, country: t.pendingCountry ?? t.country, currency: t.pendingCurrency ?? t.currency };
  }
  return { entity: BILLING_ENTITY, country: t.country, currency: t.currency };
}

/** Start of the next billing period (calendar month, UTC). */
export function nextBillingPeriod(now: Date): Date {
  const m = startOfMonth(now);
  return new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
}

export type CountryChange =
  | { kind: 'now'; data: { country: string; pendingCountry: null; pendingCurrency: null; billingChangeAt: null } }
  | { kind: 'scheduled'; currency: Currency; effectiveAt: Date; data: { pendingCountry: string; pendingCurrency: Currency; billingChangeAt: Date } };

/**
 * What a change of billing country does to the team row. Same currency (DE to US): the new
 * country applies now and any scheduled change is dropped. Different currency (into or out of
 * Saudi Arabia, or a currency staff chose): scheduled for the first day of next month, so a month
 * is invoiced in one currency with one VAT treatment.
 */
export function planCountryChange(team: TeamBilling, country: string, now: Date, currency: Currency = currencyForCountry(country)): CountryChange {
  if (currency === team.currency) return { kind: 'now', data: { country, pendingCountry: null, pendingCurrency: null, billingChangeAt: null } };
  const effectiveAt = nextBillingPeriod(now);
  return { kind: 'scheduled', currency, effectiveAt, data: { pendingCountry: country, pendingCurrency: currency, billingChangeAt: effectiveAt } };
}
