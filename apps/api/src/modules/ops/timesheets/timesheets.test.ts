import { describe, expect, it } from 'vitest';
import { periodRange } from './timesheets.service';
import { billedMinutes } from '../timers/timers.service';

describe('timesheet periods and timer minutes', () => {
  it('turns a month or an ISO week into a UTC range', () => {
    expect(periodRange({ month: '2026-09' })).toMatchObject({ start: new Date('2026-09-01T00:00:00Z'), end: new Date('2026-10-01T00:00:00Z'), label: '2026-09' });
    // ISO week 39 of 2026 starts on Monday 21 September.
    expect(periodRange({ week: '2026-W39' })).toMatchObject({ start: new Date('2026-09-21T00:00:00Z'), end: new Date('2026-09-28T00:00:00Z') });
    // Week 1 of 2027 starts on Monday 4 January (January 4th is a Monday).
    expect(periodRange({ week: '2027-W01' }).start).toEqual(new Date('2027-01-04T00:00:00Z'));
    // Week 1 of 2026 starts on Monday 29 December 2025.
    expect(periodRange({ week: '2026-W01' }).start).toEqual(new Date('2025-12-29T00:00:00Z'));
    expect(() => periodRange({ week: '2026-39' })).toThrow();
  });

  it('bills whole minutes, at least one', () => {
    const t = new Date('2026-09-28T10:00:00Z');
    expect(billedMinutes(t, new Date(t.getTime() + 5_000))).toBe(1);
    expect(billedMinutes(t, new Date(t.getTime() + 60_000))).toBe(1);
    expect(billedMinutes(t, new Date(t.getTime() + 61_000))).toBe(2);
    expect(billedMinutes(t, new Date(t.getTime() + 90 * 60_000))).toBe(90);
  });
});
