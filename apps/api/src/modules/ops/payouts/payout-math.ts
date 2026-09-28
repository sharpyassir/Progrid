/**
 * Contractor pay (spec 5.4). Pure functions, for tests.
 *
 *   pay = standbyFee x completed shifts
 *       + day minutes / 60 x hourlyRate
 *       + night minutes / 60 x hourlyRate x nightMultiplier
 *
 * Night is 22:00 to 06:00 in the contract's local time (the contract calendar's zone: Riyadh or
 * Istanbul), not the engineer's. Each worklog line is rounded to a minor unit; the total is the
 * sum of the lines, so the statement always adds up.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();
/** Local hour and minute of an instant in a zone. */
function localTime(timeZone: string, at: number) {
  let f = formatters.get(timeZone);
  if (!f) formatters.set(timeZone, (f = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })));
  const [hour, minute] = f.format(at).split(':').map(Number);
  return { hour, minute };
}

export const isNightHour = (hour: number, start: number, end: number) => (start > end ? hour >= start || hour < end : hour >= start && hour < end);

/** Minutes of [start, start + minutes) that fall in the night window of `timeZone`. */
export function nightMinutes(start: Date, minutes: number, timeZone: string, nightStartHour = 22, nightEndHour = 6): number {
  let night = 0;
  let m = 0;
  // Walk one local clock hour at a time: every minute of an hour is day or night alike.
  while (m < minutes) {
    const { hour, minute } = localTime(timeZone, start.getTime() + m * 60_000);
    const span = Math.min(60 - minute, minutes - m);
    if (isNightHour(hour, nightStartHour, nightEndHour)) night += span;
    m += span;
  }
  return night;
}

export interface PayoutWorkLog {
  id: string;
  startedAt: Date;
  minutes: number;
  /** IANA zone of the contract the work was for. */
  timeZone: string;
}

export interface PayoutRates {
  hourlyRateMinor: number;
  standbyFeeMinor: number;
  nightMultiplier: number;
  nightStartHour: number;
  nightEndHour: number;
}

export function computePayout(worklogs: PayoutWorkLog[], completedShifts: number, r: PayoutRates) {
  const lines = worklogs.map((w) => {
    const night = nightMinutes(w.startedAt, w.minutes, w.timeZone, r.nightStartHour, r.nightEndHour);
    const day = w.minutes - night;
    const amountMinor = Math.round((day * r.hourlyRateMinor + night * r.hourlyRateMinor * r.nightMultiplier) / 60);
    return { workLogId: w.id, startedAt: w.startedAt, minutes: w.minutes, nightMinutes: night, amountMinor };
  });
  const workedMinutes = lines.reduce((a, l) => a + l.minutes, 0);
  const night = lines.reduce((a, l) => a + l.nightMinutes, 0);
  const workMinor = lines.reduce((a, l) => a + l.amountMinor, 0);
  const standbyMinor = completedShifts * r.standbyFeeMinor;
  return { lines, workedMinutes, nightMinutes: night, workMinor, standbyShifts: completedShifts, standbyMinor, totalMinor: workMinor + standbyMinor };
}
