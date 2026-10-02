import { describe, expect, it } from 'vitest';
import { PLATFORM_TASKS, periodOf } from './catalog';

describe('platform periods', () => {
  it('uses ISO weeks, including the edges of the year', () => {
    expect(periodOf('weekly', new Date('2026-10-02T12:00:00Z'))).toMatchObject({ key: '2026-W40', start: new Date('2026-09-28T00:00:00Z'), end: new Date('2026-10-05T00:00:00Z') });
    // 2026-01-01 is a Thursday: week 1 of 2026 starts on Monday 2025-12-29.
    expect(periodOf('weekly', new Date('2025-12-29T00:00:00Z')).key).toBe('2026-W01');
    // 2027-01-01 is a Friday: it still belongs to the last week of 2026 (which has 53).
    expect(periodOf('weekly', new Date('2027-01-01T23:59:59Z')).key).toBe('2026-W53');
    expect(periodOf('weekly', new Date('2027-01-04T00:00:00Z')).key).toBe('2027-W01');
    // Sunday is the last day of the week.
    expect(periodOf('weekly', new Date('2026-10-04T23:59:59Z')).key).toBe('2026-W40');
  });

  it('uses calendar months and quarters in UTC', () => {
    expect(periodOf('monthly', new Date('2026-12-31T23:59:59Z'))).toMatchObject({ key: '2026-12', end: new Date('2027-01-01T00:00:00Z') });
    expect(periodOf('quarterly', new Date('2026-10-02T00:00:00Z'))).toMatchObject({ key: '2026-Q4', start: new Date('2026-10-01T00:00:00Z'), end: new Date('2027-01-01T00:00:00Z') });
    expect(periodOf('quarterly', new Date('2026-03-31T23:59:59Z')).key).toBe('2026-Q1');
  });

  it('has unique task keys and evidence on the tasks that prove something', () => {
    expect(new Set(PLATFORM_TASKS.map((t) => t.key)).size).toBe(PLATFORM_TASKS.length);
    for (const t of PLATFORM_TASKS) {
      expect(t.key.startsWith(`${t.cadence}.`)).toBe(true);
      if (t.mode === 'auto') expect(t.check).toBeTruthy();
    }
    expect(PLATFORM_TASKS.filter((t) => t.evidenceRequired).map((t) => t.key)).toEqual(expect.arrayContaining(['monthly.restore_test', 'quarterly.dr_drill']));
  });
});
