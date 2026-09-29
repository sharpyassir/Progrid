import { describe, expect, it } from 'vitest';
import { billableFraction } from '../billing-hooks/managed-billing.service';
import { addMonthsUtc, endOfCurrentMonth, nextTermEnd, termDecision, type TermState } from './renewal';

const d = (s: string) => new Date(s.includes('T') ? s : `${s}T00:00:00Z`);
const contract = (over: Partial<TermState> = {}): TermState => ({ status: 'ACTIVE', autoRenew: true, termMonths: 12, termEndsAt: d('2026-10-15T09:30:00Z'), cancelAt: null, renewalNoticeAt: null, ...over });

describe('renewal date math', () => {
  it('adds calendar months in UTC and keeps the time of day', () => {
    expect(addMonthsUtc(d('2026-03-15T09:30:00Z'), 12)).toEqual(d('2027-03-15T09:30:00Z'));
    expect(addMonthsUtc(d('2026-11-30'), 3)).toEqual(d('2027-02-28'));
    expect(addMonthsUtc(d('2027-01-31'), 1)).toEqual(d('2027-02-28'));
    expect(addMonthsUtc(d('2028-01-31'), 1)).toEqual(d('2028-02-29'));
    expect(addMonthsUtc(d('2028-02-29'), 12)).toEqual(d('2029-02-28'));
  });

  it('renews by whole terms counted from the old end until the end is in the future', () => {
    expect(nextTermEnd(d('2026-09-29'), 12, d('2026-09-29T00:10:00Z'))).toEqual(d('2027-09-29'));
    // Missed by more than a term (job down, or a 1 month term): repeat.
    expect(nextTermEnd(d('2026-06-30'), 1, d('2026-09-29'))).toEqual(d('2026-09-30'));
    expect(nextTermEnd(d('2026-01-31'), 1, d('2026-03-01'))).toEqual(d('2026-03-31'));
    expect(nextTermEnd(d('2024-02-29'), 12, d('2026-03-01'))).toEqual(d('2027-02-28'));
    // An end exactly at now is not in the future.
    expect(nextTermEnd(d('2026-01-01'), 6, d('2026-07-01'))).toEqual(d('2027-01-01'));
  });

  it('schedules a customer cancellation for the start of next month in UTC', () => {
    expect(endOfCurrentMonth(d('2026-09-29T12:00:00Z'))).toEqual(d('2026-10-01'));
    expect(endOfCurrentMonth(d('2026-12-31T23:59:59Z'))).toEqual(d('2027-01-01'));
    expect(endOfCurrentMonth(d('2026-10-01'))).toEqual(d('2026-11-01'));
  });

  it('bills a cancellation scheduled for the end of the month for the whole month and nothing after', () => {
    const cancelAt = endOfCurrentMonth(d('2026-09-10'));
    expect(billableFraction({ start: d('2026-09-01'), end: d('2026-10-01') }, { from: d('2026-01-01'), to: cancelAt }, [])).toBe(1);
    expect(billableFraction({ start: d('2026-10-01'), end: d('2026-11-01') }, { from: d('2026-01-01'), to: cancelAt }, [])).toBe(0);
  });
});

describe('renewal job decisions', () => {
  const now = d('2026-10-16');

  it('renews a contract with auto renewal on once the term ended', () => {
    expect(termDecision(contract(), now)).toEqual({ kind: 'renew', termEndsAt: d('2027-10-15T09:30:00Z') });
    expect(termDecision(contract({ status: 'SUSPENDED' }), now).kind).toBe('renew');
  });

  it('ends a contract with auto renewal off at the term end, not at the time the job runs', () => {
    expect(termDecision(contract({ autoRenew: false }), now)).toEqual({ kind: 'cancel', at: d('2026-10-15T09:30:00Z'), why: 'not_renewed' });
  });

  it('cancels at a scheduled cancelAt once it passed', () => {
    const cancelAt = d('2026-10-01');
    expect(termDecision(contract({ cancelAt, termEndsAt: d('2027-03-01') }), now)).toEqual({ kind: 'cancel', at: cancelAt, why: 'scheduled' });
    expect(termDecision(contract({ cancelAt: d('2026-11-01'), termEndsAt: d('2027-03-01') }), now)).toEqual({ kind: 'none' });
  });

  it('never renews a contract with a scheduled cancellation', () => {
    // Term ended on the 15th, cancellation on the 1st of next month: keep running until then.
    expect(termDecision(contract({ cancelAt: d('2026-11-01') }), now)).toEqual({ kind: 'none' });
  });

  it('takes whichever end comes first when auto renewal is off and a cancellation is scheduled', () => {
    expect(termDecision(contract({ autoRenew: false, cancelAt: d('2026-11-01') }), now)).toEqual({ kind: 'cancel', at: d('2026-10-15T09:30:00Z'), why: 'not_renewed' });
    expect(termDecision(contract({ autoRenew: false, cancelAt: d('2026-10-01') }), now)).toEqual({ kind: 'cancel', at: d('2026-10-01'), why: 'scheduled' });
  });

  it('sends the reminder once, 30 days before the term ends', () => {
    const termEndsAt = d('2026-11-10');
    expect(termDecision(contract({ termEndsAt }), d('2026-10-10'))).toEqual({ kind: 'none' });
    expect(termDecision(contract({ termEndsAt }), d('2026-10-11'))).toEqual({ kind: 'notice' });
    expect(termDecision(contract({ termEndsAt, autoRenew: false }), d('2026-10-20'))).toEqual({ kind: 'notice' });
    expect(termDecision(contract({ termEndsAt, renewalNoticeAt: d('2026-10-11') }), d('2026-10-20'))).toEqual({ kind: 'none' });
    expect(termDecision(contract({ termEndsAt, cancelAt: d('2026-11-01') }), d('2026-10-20'))).toEqual({ kind: 'none' });
  });

  it('leaves contracts without a running term alone', () => {
    for (const status of ['DRAFT', 'ONBOARDING', 'CANCELLED'] as const) expect(termDecision(contract({ status, cancelAt: d('2026-10-01') }), now)).toEqual({ kind: 'none' });
    expect(termDecision(contract({ termEndsAt: null }), now)).toEqual({ kind: 'none' });
  });
});
