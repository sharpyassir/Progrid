import { describe, expect, it } from 'vitest';
import { rateHour, taxRateFor } from './pricing';

// taxRateFor reads the entity settings; the config needs a database URL to parse.
process.env.DATABASE_URL ??= 'postgresql://unit@localhost:5432/unit';

describe('rateHour', () => {
  const monthly = 2400; // $24.00 → 672h → ~3.57¢/h
  it('bills a full hour at monthly/672', () => {
    expect(rateHour({ minutes: 60, monthlyMinor: monthly, hoursPerMonth: 672, chargedThisMonthMinor: 0 })).toBe(4);
  });
  it('pro-rates a partial hour by the minute', () => {
    expect(rateHour({ minutes: 30, monthlyMinor: monthly, hoursPerMonth: 672, chargedThisMonthMinor: 0 })).toBe(2);
  });
  it('never exceeds the monthly cap', () => {
    expect(rateHour({ minutes: 60, monthlyMinor: monthly, hoursPerMonth: 672, chargedThisMonthMinor: 2398 })).toBe(2);
    expect(rateHour({ minutes: 60, monthlyMinor: monthly, hoursPerMonth: 672, chargedThisMonthMinor: 2400 })).toBe(0);
  });
  it('is free when there is no usage or no price', () => {
    expect(rateHour({ minutes: 0, monthlyMinor: monthly, hoursPerMonth: 672, chargedThisMonthMinor: 0 })).toBe(0);
    expect(rateHour({ minutes: 60, monthlyMinor: 0, hoursPerMonth: 672, chargedThisMonthMinor: 0 })).toBe(0);
  });
});

describe('taxRateFor', () => {
  it('charges 15% VAT on Progrid Arabia invoices', () => {
    expect(taxRateFor('progrid_arabia')).toBe(0.15);
  });
  it('charges no tax on Progrid Technologies LLC invoices by default', () => {
    expect(taxRateFor('progrid_llc')).toBe(0);
  });
});
