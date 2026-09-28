/**
 * A small five field cron parser and next run calculator (minute hour day-of-month month
 * day-of-week), evaluated in an IANA time zone. Supports `*`, numbers, ranges (`1-5`), lists
 * (`1,15`), steps (`*\/15`, `0-30/10`) and names (`JAN`, `MON`); day-of-week 0 and 7 are
 * Sunday. As in Vixie cron, when both day fields are restricted a day matches either one.
 */
import { localParts, zonedTime } from '../sla/sla-calculator';

export interface CronSchedule {
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  dayRestricted: boolean;
  weekdayRestricted: boolean;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function field(spec: string, min: number, max: number, names?: string[], nameBase = 0): Set<number> {
  const out = new Set<number>();
  const value = (v: string) => {
    const upper = v.toUpperCase();
    const named = names?.indexOf(upper) ?? -1;
    const n = named >= 0 ? named + nameBase : /^\d+$/.test(v) ? Number(v) : NaN;
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`"${v}" is out of range ${min} to ${max}`);
    return n;
  };
  for (const part of spec.split(',')) {
    const [range, stepText] = part.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`bad step in "${part}"`);
    let lo: number, hi: number;
    if (range === '*') [lo, hi] = [min, max];
    else if (range.includes('-')) {
      const [a, b] = range.split('-');
      [lo, hi] = [value(a), value(b)];
      if (lo > hi) throw new Error(`bad range "${range}"`);
    } else {
      lo = value(range);
      hi = stepText === undefined ? lo : max;
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): CronSchedule {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('A cron expression has five fields: minute hour day-of-month month day-of-week');
  const [m, h, dom, mon, dow] = parts;
  const weekdays = field(dow, 0, 7, DAYS);
  if (weekdays.has(7)) {
    weekdays.delete(7);
    weekdays.add(0);
  }
  return {
    minutes: field(m, 0, 59),
    hours: field(h, 0, 23),
    days: field(dom, 1, 31),
    months: field(mon, 1, 12, MONTHS, 1),
    weekdays,
    dayRestricted: dom !== '*',
    weekdayRestricted: dow !== '*',
  };
}

export function isValidCron(expr: string) {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

function dayMatches(s: CronSchedule, year: number, month: number, day: number) {
  if (!s.months.has(month)) return false;
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const byDay = s.days.has(day);
  const byWeekday = s.weekdays.has(weekday);
  if (s.dayRestricted && s.weekdayRestricted) return byDay || byWeekday;
  if (s.dayRestricted) return byDay;
  if (s.weekdayRestricted) return byWeekday;
  return true;
}

/** The first time strictly after `after` that matches, in `timeZone` wall clock time. */
export function nextRun(expr: string | CronSchedule, after: Date, timeZone = 'UTC'): Date {
  const s = typeof expr === 'string' ? parseCron(expr) : expr;
  const start = new Date(Math.floor(after.getTime() / 60_000) * 60_000 + 60_000);
  const p = localParts(start, timeZone);
  const hours = [...s.hours].sort((a, b) => a - b);
  const minutes = [...s.minutes].sort((a, b) => a - b);
  let date = new Date(Date.UTC(p.year, p.month - 1, p.day));
  for (let i = 0; i < 366 * 8; i++, date = new Date(date.getTime() + 86_400_000)) {
    const [y, mo, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
    if (!dayMatches(s, y, mo, d)) continue;
    const first = i === 0;
    for (const h of hours) {
      if (first && h < p.hour) continue;
      for (const m of minutes) {
        if (first && h === p.hour && m < p.minute) continue;
        const at = zonedTime(y, mo, d, h, m, timeZone);
        if (at > after) return at;
      }
    }
  }
  throw new Error(`"${typeof expr === 'string' ? expr : 'schedule'}" never runs`);
}
