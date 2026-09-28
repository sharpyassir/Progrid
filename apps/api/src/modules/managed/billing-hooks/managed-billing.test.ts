import { describe, expect, it } from 'vitest';
import { billableFraction } from './managed-billing.service';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const august = { start: d('2026-08-01'), end: d('2026-09-01') };

describe('managed plan fee proration', () => {
  it('bills the whole month for a contract active all month', () => {
    expect(billableFraction(august, { from: d('2026-05-10'), to: null }, [])).toBe(1);
  });

  it('prorates the first partial month from activation', () => {
    expect(billableFraction(august, { from: d('2026-08-16'), to: null }, [])).toBeCloseTo(16 / 31, 10);
  });

  it('bills a cancelled contract up to the cancellation date', () => {
    expect(billableFraction(august, { from: d('2026-01-01'), to: d('2026-08-11') }, [])).toBeCloseTo(10 / 31, 10);
    expect(billableFraction(august, { from: d('2026-01-01'), to: d('2026-07-20') }, [])).toBe(0);
  });

  it('skips suspensions, including one still running', () => {
    expect(billableFraction(august, { from: d('2026-01-01'), to: null }, [{ from: d('2026-08-05'), to: d('2026-08-10') }])).toBeCloseTo(26 / 31, 10);
    expect(billableFraction(august, { from: d('2026-01-01'), to: null }, [{ from: d('2026-08-21'), to: null }])).toBeCloseTo(20 / 31, 10);
    // Overlapping suspensions are not subtracted twice.
    expect(billableFraction(august, { from: d('2026-01-01'), to: null }, [{ from: d('2026-08-01'), to: d('2026-08-11') }, { from: d('2026-08-06'), to: d('2026-08-16') }])).toBeCloseTo(16 / 31, 10);
  });

  it('bills nothing for a contract activated after the month', () => {
    expect(billableFraction(august, { from: d('2026-09-02'), to: null }, [])).toBe(0);
  });
});
