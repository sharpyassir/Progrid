/**
 * SLA due time math. Pure (no I/O) so it can be unit tested; SlaService loads holidays.
 *
 * TWENTY_FOUR_SEVEN plans count every minute. BUSINESS_HOURS plans count only working minutes
 * in the contract's calendar: 09:00 to 17:00 local time on working days that are not public
 * holidays. Saudi Arabia works Sunday to Thursday (Asia/Riyadh), Türkiye Monday to Friday
 * (Europe/Istanbul). Neither zone observes daylight saving time today, but offsets are looked
 * up per day through Intl so a future change is handled.
 */

export type Coverage = 'BUSINESS_HOURS' | 'TWENTY_FOUR_SEVEN';
export type CalendarCountry = 'SA' | 'TR';

export interface CalendarRules {
  timeZone: string;
  /** Working days, 0 = Sunday. */
  workdays: number[];
  startHour: number;
  endHour: number;
}

export const CALENDARS: Record<CalendarCountry, CalendarRules> = {
  SA: { timeZone: 'Asia/Riyadh', workdays: [0, 1, 2, 3, 4], startHour: 9, endHour: 17 },
  TR: { timeZone: 'Europe/Istanbul', workdays: [1, 2, 3, 4, 5], startHour: 9, endHour: 17 },
};

export interface SlaCalendar {
  coverage: Coverage;
  country: CalendarCountry;
  /** Local dates (YYYY-MM-DD) that are public holidays in the country. */
  holidays: Set<string> | string[];
}

const MINUTE = 60_000;
const DAY = 86_400_000;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Local wall clock parts of an instant in a time zone. */
export function localParts(at: Date, timeZone: string) {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(at).map((p) => [p.type, p.value]));
  return { year: +parts.year, month: +parts.month, day: +parts.day, hour: +parts.hour, minute: +parts.minute, second: +parts.second };
}

/** Offset of the zone from UTC at an instant, in minutes (Riyadh is +180). */
export function offsetMinutes(at: Date, timeZone: string) {
  const p = localParts(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / MINUTE);
}

/** The instant a local wall clock time happens in a zone. */
export function zonedTime(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - offsetMinutes(new Date(guess), timeZone) * MINUTE;
  // A second pass settles the rare case where the offset differs at the corrected instant.
  return new Date(guess - offsetMinutes(new Date(first), timeZone) * MINUTE);
}

export function localDateKey(at: Date, timeZone: string) {
  const p = localParts(at, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

interface Window { start: number; end: number }

/** Working window of the local day containing `at`, or null when the day is not a working day. Also returns the start of the next local day. */
function dayInfo(at: Date, rules: CalendarRules, holidays: Set<string>): { window: Window | null; nextDay: number } {
  const p = localParts(at, rules.timeZone);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  const next = new Date(Date.UTC(p.year, p.month - 1, p.day) + DAY);
  const nextDay = zonedTime(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, rules.timeZone).getTime();
  const key = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  if (!rules.workdays.includes(weekday) || holidays.has(key)) return { window: null, nextDay };
  return {
    window: {
      start: zonedTime(p.year, p.month, p.day, rules.startHour, 0, rules.timeZone).getTime(),
      end: zonedTime(p.year, p.month, p.day, rules.endHour, 0, rules.timeZone).getTime(),
    },
    nextDay,
  };
}

const asSet = (h: Set<string> | string[]) => (h instanceof Set ? h : new Set(h));

/** Guard against a calendar with no working days at all (for example every day a holiday). */
const MAX_DAYS = 3 * 366;

/**
 * The instant `minutes` counted minutes after `start`. On business hours plans the count only
 * runs inside working windows, so a ticket opened on Thursday at 16:00 in Riyadh with a
 * 120 minute target is due Sunday at 10:00.
 */
export function addSlaMinutes(start: Date, minutes: number, cal: SlaCalendar): Date {
  if (minutes <= 0) return new Date(start);
  if (cal.coverage === 'TWENTY_FOUR_SEVEN') return new Date(start.getTime() + minutes * MINUTE);
  const rules = CALENDARS[cal.country];
  const holidays = asSet(cal.holidays);
  let cursor = start.getTime();
  let remaining = minutes * MINUTE;
  for (let i = 0; i < MAX_DAYS; i++) {
    const { window, nextDay } = dayInfo(new Date(cursor), rules, holidays);
    if (window) {
      if (cursor < window.start) cursor = window.start;
      if (cursor < window.end) {
        const available = window.end - cursor;
        if (remaining <= available) return new Date(cursor + remaining);
        remaining -= available;
      }
    }
    cursor = nextDay;
  }
  throw new Error('SLA calendar has no working time in the next three years');
}

/** Counted minutes between two instants (0 when `to` is not after `from`). */
export function slaMinutesBetween(from: Date, to: Date, cal: SlaCalendar): number {
  if (to <= from) return 0;
  if (cal.coverage === 'TWENTY_FOUR_SEVEN') return (to.getTime() - from.getTime()) / MINUTE;
  const rules = CALENDARS[cal.country];
  const holidays = asSet(cal.holidays);
  let cursor = from.getTime();
  let total = 0;
  for (let i = 0; i < MAX_DAYS && cursor < to.getTime(); i++) {
    const { window, nextDay } = dayInfo(new Date(cursor), rules, holidays);
    if (window) {
      const s = Math.max(cursor, window.start);
      const e = Math.min(to.getTime(), window.end);
      if (e > s) total += e - s;
    }
    cursor = nextDay;
  }
  return total / MINUTE;
}

export type ManagedPriorityCode = 'P1' | 'P2' | 'P3' | 'P4';
export type Targets = Record<ManagedPriorityCode, number>;

/** Response and resolve due times for a ticket opened at `openedAt`. */
export function dueDates(openedAt: Date, priority: ManagedPriorityCode, targets: { response: Targets; resolve: Targets }, cal: SlaCalendar) {
  return {
    responseDueAt: addSlaMinutes(openedAt, targets.response[priority], cal),
    resolveDueAt: addSlaMinutes(openedAt, targets.resolve[priority], cal),
  };
}

/** The instant a timer reaches `fraction` of its target (0.75 for the warning). */
export function fractionPoint(openedAt: Date, targetMinutes: number, fraction: number, cal: SlaCalendar) {
  return addSlaMinutes(openedAt, targetMinutes * fraction, cal);
}
