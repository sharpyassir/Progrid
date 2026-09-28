import { describe, expect, it } from 'vitest';
import { computePayout, isNightHour, nightMinutes } from './payout-math';

const at = (iso: string) => new Date(iso);

describe('night minutes in contract local time', () => {
  it('knows the 22:00 to 06:00 window across midnight', () => {
    expect([21, 22, 23, 0, 5, 6, 12].map((h) => isNightHour(h, 22, 6))).toEqual([false, true, true, true, true, false, false]);
    expect([0, 1, 2, 3].map((h) => isNightHour(h, 1, 3))).toEqual([false, true, true, false]);
  });

  it('counts Riyadh night minutes (UTC+3)', () => {
    // 18:00 UTC is 21:00 in Riyadh: two hours of work, the second one at night.
    expect(nightMinutes(at('2026-08-10T18:00:00Z'), 120, 'Asia/Riyadh')).toBe(60);
    // 18:30 UTC to 20:15 UTC is 21:30 to 23:15 local: 75 night minutes.
    expect(nightMinutes(at('2026-08-10T18:30:00Z'), 105, 'Asia/Riyadh')).toBe(75);
    // A full night shift, 19:00 UTC to 03:00 UTC, is 22:00 to 06:00 local.
    expect(nightMinutes(at('2026-08-10T19:00:00Z'), 480, 'Asia/Riyadh')).toBe(480);
    // Midday is never night.
    expect(nightMinutes(at('2026-08-11T09:00:00Z'), 60, 'Asia/Riyadh')).toBe(0);
  });

  it('uses the contract zone, not UTC, and handles half hour offsets', () => {
    // 04:00 UTC is 07:00 in Istanbul (day) but night in UTC.
    expect(nightMinutes(at('2026-08-10T04:00:00Z'), 60, 'Europe/Istanbul')).toBe(0);
    expect(nightMinutes(at('2026-08-10T04:00:00Z'), 60, 'UTC')).toBe(60);
    // Kolkata is UTC+5:30: 16:00 UTC is 21:30 local, so 30 of 60 minutes are night.
    expect(nightMinutes(at('2026-08-10T16:00:00Z'), 60, 'Asia/Kolkata')).toBe(30);
  });
});

describe('payout math', () => {
  const rates = { hourlyRateMinor: 3000, standbyFeeMinor: 5000, nightMultiplier: 1.5, nightStartHour: 22, nightEndHour: 6 };

  it('adds standby fees, day hours and night hours at the multiplier', () => {
    const p = computePayout([
      { id: 'a', startedAt: at('2026-08-10T18:00:00Z'), minutes: 120, timeZone: 'Asia/Riyadh' },
      { id: 'b', startedAt: at('2026-08-11T09:00:00Z'), minutes: 60, timeZone: 'Asia/Riyadh' },
    ], 2, rates);
    expect(p).toMatchObject({ workedMinutes: 180, nightMinutes: 60, workMinor: 7500 + 3000, standbyShifts: 2, standbyMinor: 10_000, totalMinor: 20_500 });
    expect(p.lines.map((l) => l.amountMinor)).toEqual([7500, 3000]);
  });

  it('rounds each line to a minor unit and totals the lines', () => {
    const p = computePayout([{ id: 'x', startedAt: at('2026-08-11T09:00:00Z'), minutes: 7, timeZone: 'Asia/Riyadh' }, { id: 'y', startedAt: at('2026-08-11T10:00:00Z'), minutes: 7, timeZone: 'Asia/Riyadh' }], 0, { ...rates, hourlyRateMinor: 1000 });
    expect(p.lines.map((l) => l.amountMinor)).toEqual([117, 117]);
    expect(p.totalMinor).toBe(234);
  });

  it('pays only standby when there is no work', () => {
    expect(computePayout([], 3, rates)).toMatchObject({ workedMinutes: 0, workMinor: 0, standbyMinor: 15_000, totalMinor: 15_000 });
  });
});
