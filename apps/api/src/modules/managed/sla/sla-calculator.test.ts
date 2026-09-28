import { describe, expect, it } from 'vitest';
import { addSlaMinutes, dueDates, fractionPoint, localDateKey, offsetMinutes, slaMinutesBetween, zonedTime, type SlaCalendar } from './sla-calculator';

const sa = (holidays: string[] = []): SlaCalendar => ({ coverage: 'BUSINESS_HOURS', country: 'SA', holidays });
const tr = (holidays: string[] = []): SlaCalendar => ({ coverage: 'BUSINESS_HOURS', country: 'TR', holidays });
const always: SlaCalendar = { coverage: 'TWENTY_FOUR_SEVEN', country: 'SA', holidays: [] };
/** Riyadh and Istanbul are both UTC+3. */
const local = (iso: string) => new Date(`${iso}+03:00`);

describe('time zone helpers', () => {
  it('knows Riyadh and Istanbul are three hours ahead of UTC', () => {
    expect(offsetMinutes(new Date('2026-01-15T12:00:00Z'), 'Asia/Riyadh')).toBe(180);
    expect(offsetMinutes(new Date('2026-07-15T12:00:00Z'), 'Europe/Istanbul')).toBe(180);
    expect(zonedTime(2026, 10, 4, 9, 0, 'Asia/Riyadh').toISOString()).toBe('2026-10-04T06:00:00.000Z');
    expect(localDateKey(new Date('2026-10-03T22:30:00Z'), 'Asia/Riyadh')).toBe('2026-10-04');
  });
});

describe('Saudi business hours (Sunday to Thursday, 09:00 to 17:00 Riyadh)', () => {
  it('counts inside one working day', () => {
    expect(addSlaMinutes(local('2026-10-04T10:00:00'), 60, sa())).toEqual(local('2026-10-04T11:00:00'));
  });

  it('carries over the Friday and Saturday weekend', () => {
    // Thursday 16:00 with a two hour target: one hour on Thursday, one on Sunday.
    expect(addSlaMinutes(local('2026-10-01T16:00:00'), 120, sa())).toEqual(local('2026-10-04T10:00:00'));
  });

  it('starts counting at 09:00 when opened before hours', () => {
    expect(addSlaMinutes(local('2026-10-04T07:00:00'), 60, sa())).toEqual(local('2026-10-04T10:00:00'));
  });

  it('starts counting the next working day when opened after hours', () => {
    expect(addSlaMinutes(local('2026-10-05T18:30:00'), 60, sa())).toEqual(local('2026-10-06T10:00:00'));
  });

  it('starts counting on Sunday when opened on the weekend', () => {
    expect(addSlaMinutes(local('2026-10-02T12:00:00'), 60, sa())).toEqual(local('2026-10-04T10:00:00'));
    expect(addSlaMinutes(local('2026-10-03T23:59:00'), 30, sa())).toEqual(local('2026-10-04T09:30:00'));
  });

  it('spans several days', () => {
    // Monday 15:00, eight hours: two on Monday, six on Tuesday.
    expect(addSlaMinutes(local('2026-10-05T15:00:00'), 480, sa())).toEqual(local('2026-10-06T15:00:00'));
    // Five business days (2400 minutes) from Sunday 09:00 ends Thursday 17:00.
    expect(addSlaMinutes(local('2026-10-04T09:00:00'), 2400, sa())).toEqual(local('2026-10-08T17:00:00'));
  });

  it('skips public holidays', () => {
    // National Day, Wednesday 23 September 2026.
    const due = addSlaMinutes(local('2026-09-22T16:00:00'), 120, sa(['2026-09-23']));
    expect(due).toEqual(local('2026-09-24T10:00:00'));
    // Without the holiday the same ticket is due on the Wednesday.
    expect(addSlaMinutes(local('2026-09-22T16:00:00'), 120, sa())).toEqual(local('2026-09-23T10:00:00'));
  });

  it('skips a holiday run next to a weekend', () => {
    // Eid holidays Thursday to Sunday: opened Wednesday 16:30, 60 minutes: 30 on Wednesday, 30 on Monday.
    const holidays = ['2026-10-08', '2026-10-11'];
    expect(addSlaMinutes(local('2026-10-07T16:30:00'), 60, sa(holidays))).toEqual(local('2026-10-12T09:30:00'));
  });

  it('measures counted minutes between two instants', () => {
    expect(slaMinutesBetween(local('2026-10-01T16:00:00'), local('2026-10-04T10:00:00'), sa())).toBe(120);
    expect(slaMinutesBetween(local('2026-10-02T00:00:00'), local('2026-10-03T23:00:00'), sa())).toBe(0);
    expect(slaMinutesBetween(local('2026-10-05T10:00:00'), local('2026-10-05T09:00:00'), sa())).toBe(0);
  });
});

describe('Turkish business hours (Monday to Friday, 09:00 to 17:00 Istanbul)', () => {
  it('carries over the Saturday and Sunday weekend', () => {
    expect(addSlaMinutes(local('2026-10-02T16:00:00'), 120, tr())).toEqual(local('2026-10-05T10:00:00'));
  });

  it('treats Sunday as a day off and Friday as a working day', () => {
    expect(addSlaMinutes(local('2026-10-04T10:00:00'), 60, tr())).toEqual(local('2026-10-05T10:00:00'));
    expect(addSlaMinutes(local('2026-10-02T10:00:00'), 60, tr())).toEqual(local('2026-10-02T11:00:00'));
  });

  it('skips Republic Day', () => {
    expect(addSlaMinutes(local('2026-10-28T16:00:00'), 120, tr(['2026-10-29']))).toEqual(local('2026-10-30T10:00:00'));
  });
});

describe('24/7 coverage', () => {
  it('counts every minute, weekends and nights included', () => {
    expect(addSlaMinutes(local('2026-10-02T16:00:00'), 120, always)).toEqual(local('2026-10-02T18:00:00'));
    expect(addSlaMinutes(local('2026-10-02T23:30:00'), 60, { ...always, holidays: ['2026-10-03'] })).toEqual(local('2026-10-03T00:30:00'));
    expect(slaMinutesBetween(local('2026-10-02T16:00:00'), local('2026-10-03T16:00:00'), always)).toBe(1440);
  });
});

describe('due dates', () => {
  const targets = { response: { P1: 240, P2: 480, P3: 960, P4: 2400 }, resolve: { P1: 480, P2: 960, P3: 2880, P4: 7200 } };

  it('computes response and resolve due times per priority', () => {
    const d = dueDates(local('2026-10-04T09:00:00'), 'P2', targets, sa());
    expect(d.responseDueAt).toEqual(local('2026-10-04T17:00:00'));
    expect(d.resolveDueAt).toEqual(local('2026-10-05T17:00:00'));
  });

  it('finds the 75 percent warning point', () => {
    expect(fractionPoint(local('2026-10-04T09:00:00'), 480, 0.75, sa())).toEqual(local('2026-10-04T15:00:00'));
    expect(fractionPoint(local('2026-10-04T09:00:00'), 60, 0.75, always)).toEqual(local('2026-10-04T09:45:00'));
  });

  it('returns the start for a zero target', () => {
    expect(addSlaMinutes(local('2026-10-02T12:00:00'), 0, sa())).toEqual(local('2026-10-02T12:00:00'));
  });
});
