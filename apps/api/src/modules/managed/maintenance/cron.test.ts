import { describe, expect, it } from 'vitest';
import { isValidCron, nextRun, parseCron } from './cron';

const utc = (s: string) => new Date(`${s}Z`);

describe('cron parser', () => {
  it('parses fields, ranges, lists, steps and names', () => {
    const c = parseCron('*/15 9-17 1,15 JAN-MAR MON-FRI');
    expect([...c.minutes]).toEqual([0, 15, 30, 45]);
    expect([...c.hours]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect([...c.days]).toEqual([1, 15]);
    expect([...c.months]).toEqual([1, 2, 3]);
    expect([...c.weekdays]).toEqual([1, 2, 3, 4, 5]);
    expect([...parseCron('0 0 * * 7').weekdays]).toEqual([0]);
    expect([...parseCron('5/20 * * * *').minutes]).toEqual([5, 25, 45]);
  });

  it('rejects bad expressions', () => {
    for (const bad of ['', '* * * *', '60 * * * *', '* 24 * * *', '* * 0 * *', '* * * 13 *', '* * * * 8', '*/0 * * * *', '5-1 * * * *', 'a * * * *']) expect(isValidCron(bad), bad).toBe(false);
    expect(isValidCron('0 3 * * 5')).toBe(true);
  });
});

describe('next run', () => {
  it('finds the next minute, hour and day', () => {
    expect(nextRun('* * * * *', utc('2026-10-01T10:00:30'))).toEqual(utc('2026-10-01T10:01:00'));
    expect(nextRun('30 * * * *', utc('2026-10-01T10:30:00'))).toEqual(utc('2026-10-01T11:30:00'));
    expect(nextRun('0 3 * * *', utc('2026-10-01T03:00:00'))).toEqual(utc('2026-10-02T03:00:00'));
    expect(nextRun('0 0 1 * *', utc('2026-12-15T00:00:00'))).toEqual(utc('2027-01-01T00:00:00'));
  });

  it('matches weekdays (Friday 03:00 for patching)', () => {
    // 1 October 2026 is a Thursday.
    expect(nextRun('0 3 * * 5', utc('2026-10-01T12:00:00'))).toEqual(utc('2026-10-02T03:00:00'));
    expect(nextRun('0 3 * * FRI', utc('2026-10-02T03:00:00'))).toEqual(utc('2026-10-09T03:00:00'));
  });

  it('treats restricted day of month and day of week as either one', () => {
    // The 15th or any Monday, whichever comes first.
    expect(nextRun('0 0 15 * 1', utc('2026-10-06T00:00:00'))).toEqual(utc('2026-10-12T00:00:00'));
    expect(nextRun('0 0 15 * 1', utc('2026-10-12T00:00:00'))).toEqual(utc('2026-10-15T00:00:00'));
  });

  it('evaluates in the task time zone', () => {
    // 02:00 in Riyadh is 23:00 UTC the day before.
    expect(nextRun('0 2 * * *', utc('2026-10-01T12:00:00'), 'Asia/Riyadh')).toEqual(utc('2026-10-01T23:00:00'));
    expect(nextRun('0 2 * * 5', utc('2026-10-01T12:00:00'), 'Asia/Riyadh')).toEqual(utc('2026-10-01T23:00:00'));
    expect(nextRun('0 9 * * *', utc('2026-10-01T05:59:00'), 'Europe/Istanbul')).toEqual(utc('2026-10-01T06:00:00'));
  });

  it('handles month ends and leap years', () => {
    expect(nextRun('0 0 31 * *', utc('2026-09-01T00:00:00'))).toEqual(utc('2026-10-31T00:00:00'));
    expect(nextRun('0 0 29 2 *', utc('2026-03-01T00:00:00'))).toEqual(utc('2028-02-29T00:00:00'));
  });
});
