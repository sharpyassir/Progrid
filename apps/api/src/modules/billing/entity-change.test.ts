import { describe, expect, it } from 'vitest';
import { billingAt, nextBillingPeriod, planCountryChange } from './entity-change';
import { BILLING_ENTITIES, currencyForCountry, entityProfile, publicEntity, vatFor, ZERO_RATED_NOTE } from '../../common/entities/entities';

// The entity profile reads the settings; the config needs a database URL to parse.
process.env.DATABASE_URL ??= 'postgresql://unit@localhost:5432/unit';

describe('one billing entity', () => {
  it('only Progrid Arabia can be assigned; the LLC is history', () => {
    expect(BILLING_ENTITIES).toEqual(['progrid_arabia']);
    expect(entityProfile('progrid_arabia')).toMatchObject({ legacy: false, invoicePrefix: 'PRGD-SA', eInvoicing: 'zatca' });
    expect(entityProfile('progrid_llc')).toMatchObject({ legacy: true, legalName: 'Progrid Technologies LLC', invoicePrefix: 'PRGD-US' });
  });

  it('takes the currency and VAT from the billing country', () => {
    expect(currencyForCountry('SA')).toBe('SAR');
    expect(currencyForCountry('DE')).toBe('USD');
    expect(currencyForCountry(undefined)).toBe('USD');
    expect(vatFor('SA')).toEqual({ rate: 0.15, category: 'standard', note: null });
    expect(vatFor('US')).toEqual({ rate: 0, category: 'zero_rated_export', note: ZERO_RATED_NOTE });
    expect(ZERO_RATED_NOTE).toBe('Zero-rated export of services');
    expect(publicEntity('progrid_arabia', { country: 'DE', currency: 'USD' })).toMatchObject({ id: 'progrid_arabia', currency: 'USD', taxRate: 0, vatCategory: 'zero_rated_export' });
    expect(publicEntity('progrid_arabia', { country: 'SA', currency: 'SAR' })).toMatchObject({ currency: 'SAR', taxRate: 0.15, vatCategory: 'standard', taxNote: null });
  });
});

describe('country changes', () => {
  const now = new Date('2026-10-17T10:00:00Z');
  it('applies a change that keeps the currency at once', () => {
    expect(planCountryChange({ country: 'DE', currency: 'USD' }, 'US', now)).toEqual({ kind: 'now', data: { country: 'US', pendingCountry: null, pendingCurrency: null, billingChangeAt: null } });
  });

  it('schedules a move into or out of Saudi Arabia for the first day of next month', () => {
    const into = planCountryChange({ country: 'DE', currency: 'USD' }, 'SA', now);
    expect(into).toMatchObject({ kind: 'scheduled', currency: 'SAR', data: { pendingCountry: 'SA', pendingCurrency: 'SAR' } });
    expect(into.kind === 'scheduled' && into.effectiveAt.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(planCountryChange({ country: 'SA', currency: 'SAR' }, 'AE', now)).toMatchObject({ kind: 'scheduled', currency: 'USD' });
    // Staff may keep a currency that differs from the country's.
    expect(planCountryChange({ country: 'SA', currency: 'SAR' }, 'AE', now, 'SAR').kind).toBe('now');
  });

  it('bills in the old currency before the change and the new one from it', () => {
    const t = { country: 'DE', currency: 'USD' as const, pendingCountry: 'SA', pendingCurrency: 'SAR' as const, billingChangeAt: nextBillingPeriod(now) };
    expect(billingAt(t, now)).toEqual({ entity: 'progrid_arabia', country: 'DE', currency: 'USD' });
    expect(billingAt(t, new Date('2026-11-01T00:00:00Z'))).toEqual({ entity: 'progrid_arabia', country: 'SA', currency: 'SAR' });
    // The migration schedules a currency on its own (no country change).
    expect(billingAt({ country: 'SA', currency: 'USD', pendingCurrency: 'SAR', billingChangeAt: nextBillingPeriod(now) }, new Date('2026-12-01T00:00:00Z')).currency).toBe('SAR');
    // An LLC team row is billed by Progrid Arabia.
    expect(billingAt({ country: 'US', currency: 'USD', billingEntity: 'progrid_llc' }, now).entity).toBe('progrid_arabia');
  });
});
