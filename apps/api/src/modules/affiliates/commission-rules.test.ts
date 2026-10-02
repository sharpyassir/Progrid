import { describe, expect, it } from 'vitest';
import { computeCommissions, discountFor, reversalFor, toBp } from './commission-rules';
import { defaultAffiliateSettings } from './settings';

const rates = defaultAffiliateSettings().rates;

describe('computeCommissions', () => {
  it('pays each category its own rate on the amount before tax', () => {
    const out = computeCommissions({
      lines: [{ resourceType: 'server', amountMinor: 10_000 }, { resourceType: 'volume', amountMinor: 2_000 }, { resourceType: 'app_instance', amountMinor: 5_000 }, { resourceType: 'connect_execution', amountMinor: 1_000 }, { resourceType: 'connect_ai_output', amountMinor: 4_000 }, { resourceType: 'support', amountMinor: 3_000 }],
      discountMinor: 0, taxMinor: 3_750, nonCashMinor: 0,
    }, rates);
    expect(out).toEqual([
      { category: 'web_hosting', baseMinor: 5_000, rateBp: 3000, amountMinor: 1_500 },
      { category: 'connect', baseMinor: 1_000, rateBp: 3000, amountMinor: 300 },
      { category: 'servers', baseMinor: 12_000, rateBp: 1500, amountMinor: 1_800 },
    ]);
  });

  it('takes the discount off each category in proportion', () => {
    const out = computeCommissions({ lines: [{ resourceType: 'server', amountMinor: 8_000 }, { resourceType: 'app', amountMinor: 2_000 }], discountMinor: 1_000, taxMinor: 1_350, nonCashMinor: 0 }, rates);
    expect(out).toEqual([
      { category: 'web_hosting', baseMinor: 1_800, rateBp: 3000, amountMinor: 540 },
      { category: 'servers', baseMinor: 7_200, rateBp: 1500, amountMinor: 1_080 },
    ]);
  });

  it('earns nothing on the part paid with free credit', () => {
    // 10000 net + 1500 tax = 11500 payable; 5750 promo credit leaves half paid with money.
    const half = computeCommissions({ lines: [{ resourceType: 'app_instance', amountMinor: 10_000 }], discountMinor: 0, taxMinor: 1_500, nonCashMinor: 5_750 }, rates);
    expect(half).toEqual([{ category: 'web_hosting', baseMinor: 5_000, rateBp: 3000, amountMinor: 1_500 }]);
    expect(computeCommissions({ lines: [{ resourceType: 'app_instance', amountMinor: 10_000 }], discountMinor: 0, taxMinor: 1_500, nonCashMinor: 11_500 }, rates)).toEqual([]);
  });

  it('skips categories at 0% and empty invoices', () => {
    expect(computeCommissions({ lines: [{ resourceType: 'connect_ai_input', amountMinor: 50_000 }], discountMinor: 0, taxMinor: 0, nonCashMinor: 0 }, rates)).toEqual([]);
    expect(computeCommissions({ lines: [], discountMinor: 0, taxMinor: 0, nonCashMinor: 0 }, rates)).toEqual([]);
  });

  it('uses rates with decimals', () => {
    expect(toBp(12.5)).toBe(1250);
    expect(computeCommissions({ lines: [{ resourceType: 'server', amountMinor: 999 }], discountMinor: 0, taxMinor: 0, nonCashMinor: 0 }, { ...rates, servers: 12.5 })).toEqual([{ category: 'servers', baseMinor: 999, rateBp: 1250, amountMinor: 125 }]);
  });
});

describe('discountFor', () => {
  const ref = { status: 'active', discountPercent: 10, discountUntil: new Date('2027-01-15T00:00:00Z') };
  it('applies to periods that start before the discount ends', () => {
    expect(discountFor(12_345, ref, new Date('2027-01-01T00:00:00Z'))).toBe(1_235);
    expect(discountFor(12_345, ref, new Date('2027-02-01T00:00:00Z'))).toBe(0);
  });
  it('needs an active referral with a discount', () => {
    expect(discountFor(10_000, null, new Date('2026-12-01'))).toBe(0);
    expect(discountFor(10_000, { ...ref, status: 'blocked' }, new Date('2026-12-01'))).toBe(0);
    expect(discountFor(10_000, { ...ref, discountPercent: 0 }, new Date('2026-12-01'))).toBe(0);
  });
});

describe('reversalFor', () => {
  it('reverses in proportion and never more than is left', () => {
    expect(reversalFor({ amountMinor: 1_000, reversedMinor: 0 }, 0.25)).toBe(250);
    expect(reversalFor({ amountMinor: 1_000, reversedMinor: 900 }, 0.25)).toBe(100);
    expect(reversalFor({ amountMinor: 1_000, reversedMinor: 0 }, 1.5)).toBe(1_000);
    expect(reversalFor({ amountMinor: 1_000, reversedMinor: 0 }, -1)).toBe(0);
  });
});
