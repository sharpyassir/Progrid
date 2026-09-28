import { useEffect, useState } from 'react';
import type { Locale } from './i18n';

/** Latin digits and the Gregorian calendar in both languages: engineers compare times with logs and terminals. */
export const intlLocale = (l: Locale) => (l === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB');

function safeTz(tz: string | null | undefined) {
  if (!tz) return undefined;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}

export function fmtDateTime(iso: string | Date | null | undefined, tz: string | undefined, locale: Locale, opts: Intl.DateTimeFormatOptions = {}) {
  if (!iso) return '';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: safeTz(tz), ...opts }).format(d);
}

export const fmtDate = (iso: string | Date | null | undefined, tz: string | undefined, locale: Locale) =>
  fmtDateTime(iso, tz, locale, { hour: undefined, minute: undefined, year: 'numeric', weekday: 'short' });

export const fmtTime = (iso: string | Date | null | undefined, tz: string | undefined, locale: Locale) =>
  fmtDateTime(iso, tz, locale, { day: undefined, month: undefined });

/** Short zone label, e.g. "GMT+3". */
export function zoneLabel(tz: string | undefined, locale: Locale) {
  try {
    const part = new Intl.DateTimeFormat(intlLocale(locale), { timeZone: safeTz(tz), timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName');
    return part?.value ?? tz ?? '';
  } catch {
    return tz ?? '';
  }
}

/** "YYYY-MM-DD" of an instant in a time zone. */
export function dayKey(iso: string | Date, tz: string | undefined) {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: safeTz(tz), year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return p;
}

/** Offset of a time zone from UTC at an instant, in minutes. */
function offsetMinutes(tz: string | undefined, at: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: safeTz(tz), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** A wall clock "YYYY-MM-DDTHH:mm" in `tz` as a Date (for manual time entries). */
export function zonedToUtc(local: string, tz: string | undefined) {
  const [date, time = '00:00'] = local.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const first = new Date(guess.getTime() - offsetMinutes(tz, guess) * 60_000);
  return new Date(guess.getTime() - offsetMinutes(tz, first) * 60_000);
}

/** The current wall clock in `tz` as "YYYY-MM-DDTHH:mm" (default of datetime inputs). */
export function nowLocalInput(tz: string | undefined, at = new Date()) {
  const shifted = new Date(at.getTime() + offsetMinutes(tz, at) * 60_000);
  return shifted.toISOString().slice(0, 16);
}

/** Current month "YYYY-MM" in a time zone. */
export const currentMonth = (tz: string | undefined) => dayKey(new Date(), tz).slice(0, 7);

/** Re-renders every `ms` and returns the current time in milliseconds. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** "1h 04m", "12m 05s" or "45s"; units come from the dictionary. */
export function fmtDuration(totalSeconds: number, units: { h: string; m: string; s: string; d: string }, withSeconds = true) {
  const s = Math.max(0, Math.floor(Math.abs(totalSeconds)));
  const days = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (days) return `${days}${units.d} ${h}${units.h}`;
  if (h) return withSeconds ? `${h}${units.h} ${pad(m)}${units.m} ${pad(sec)}${units.s}` : `${h}${units.h} ${pad(m)}${units.m}`;
  if (m) return withSeconds ? `${m}${units.m} ${pad(sec)}${units.s}` : `${m}${units.m}`;
  return withSeconds ? `${sec}${units.s}` : `0${units.m}`;
}

export function fmtMinutes(minutes: number, units: { h: string; m: string }) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}${units.h} ${String(m).padStart(2, '0')}${units.m}` : `${m}${units.m}`;
}
