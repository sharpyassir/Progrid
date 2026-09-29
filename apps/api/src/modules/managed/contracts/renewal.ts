import type { ManagedContractStatus } from '@prisma/client';
import { startOfMonth } from '../../billing/pricing';
import { dayMs } from '../managed.constants';

/** The renewal reminder goes to the owners this many days before the term ends. */
export const RENEWAL_NOTICE_DAYS = 30;
/** cancelReason when a contract with auto renewal off reaches the end of its term. */
export const NOT_RENEWED_REASON = 'Not renewed';
/** cancelReason when the customer scheduled a cancellation without giving a reason. */
export const CUSTOMER_CANCEL_REASON = 'Cancelled by the customer';

/**
 * `d` plus `months` calendar months in UTC, same time of day. A day that does not exist in the
 * target month is clamped to its last day (Jan 31 plus one month is Feb 28 or 29).
 */
export function addMonthsUtc(d: Date, months: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
}

/**
 * The next term end after an automatic renewal: `termEndsAt` plus whole terms until it lies
 * after `now`. Every step counts from the original end, so a 31st does not drift to the 28th.
 */
export function nextTermEnd(termEndsAt: Date, termMonths: number, now: Date): Date {
  const months = Math.max(1, termMonths);
  let k = 1;
  let next = addMonthsUtc(termEndsAt, months);
  while (next <= now) next = addMonthsUtc(termEndsAt, months * ++k);
  return next;
}

/** When a customer cancellation takes effect: the start of next calendar month (UTC). */
export function endOfCurrentMonth(now: Date): Date {
  return startOfMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)));
}

export interface TermState {
  status: ManagedContractStatus;
  autoRenew: boolean;
  termMonths: number;
  termEndsAt: Date | null;
  cancelAt: Date | null;
  renewalNoticeAt: Date | null;
}

export type TermDecision =
  | { kind: 'none' }
  /** Extend the term to `termEndsAt`. */
  | { kind: 'renew'; termEndsAt: Date }
  /** Cancel with cancelledAt = `at`. */
  | { kind: 'cancel'; at: Date; why: 'scheduled' | 'not_renewed' }
  /** Email the renewal reminder. */
  | { kind: 'notice' };

/**
 * What the daily renewal job does with one contract at `now`. Only ACTIVE and SUSPENDED
 * contracts have a running term. The contract ends at whichever comes first: a scheduled
 * cancellation, or the term end when auto renewal is off. A contract with a scheduled
 * cancellation is never renewed and gets no reminder (the customer already decided).
 */
export function termDecision(c: TermState, now: Date): TermDecision {
  if (c.status !== 'ACTIVE' && c.status !== 'SUSPENDED') return { kind: 'none' };
  const termEnd = !c.autoRenew && c.termEndsAt ? c.termEndsAt : null;
  if (c.cancelAt && (!termEnd || c.cancelAt <= termEnd)) {
    if (c.cancelAt <= now) return { kind: 'cancel', at: c.cancelAt, why: 'scheduled' };
  } else if (termEnd && termEnd <= now) {
    return { kind: 'cancel', at: termEnd, why: 'not_renewed' };
  }
  if (c.cancelAt || !c.termEndsAt) return { kind: 'none' };
  if (c.termEndsAt <= now) return c.autoRenew ? { kind: 'renew', termEndsAt: nextTermEnd(c.termEndsAt, c.termMonths, now) } : { kind: 'none' };
  if (!c.renewalNoticeAt && c.termEndsAt.getTime() - now.getTime() <= RENEWAL_NOTICE_DAYS * dayMs) return { kind: 'notice' };
  return { kind: 'none' };
}
