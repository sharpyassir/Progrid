/**
 * Plain words for the five field cron expressions maintenance tasks use: "every day at 03:00",
 * "every Sunday at 02:00", "on day 1 of each month at 04:00", "every 15 minutes". Anything
 * this helper does not recognize comes back as the raw expression, so nothing is ever hidden.
 */
import type { Locale } from './i18n';

interface Words {
  everyDayAt: (time: string) => string;
  everyWeekdayAt: (days: string, time: string) => string;
  monthDayAt: (day: number, time: string) => string;
  everyNMinutes: (n: number) => string;
  everyMinute: string;
  everyHour: string;
  everyHourAt: (minute: number) => string;
  everyNHours: (n: number) => string;
  rangeAt: (from: string, to: string, time: string) => string;
}

const WORDS: Record<Locale, Words> = {
  en: {
    everyDayAt: (time) => `every day at ${time}`,
    everyWeekdayAt: (days, time) => `every ${days} at ${time}`,
    monthDayAt: (day, time) => `on day ${day} of each month at ${time}`,
    everyNMinutes: (n) => `every ${n} minutes`,
    everyMinute: 'every minute',
    everyHour: 'every hour',
    everyHourAt: (m) => `every hour at minute ${m}`,
    everyNHours: (n) => `every ${n} hours`,
    rangeAt: (from, to, time) => `every ${from} to ${to} at ${time}`,
  },
  tr: {
    everyDayAt: (time) => `her gün saat ${time}`,
    everyWeekdayAt: (days, time) => `her ${days} saat ${time}`,
    monthDayAt: (day, time) => `her ayın ${day}. günü saat ${time}`,
    everyNMinutes: (n) => `${n} dakikada bir`,
    everyMinute: 'her dakika',
    everyHour: 'her saat başı',
    everyHourAt: (m) => `her saat, ${m}. dakikada`,
    everyNHours: (n) => `${n} saatte bir`,
    rangeAt: (from, to, time) => `${from} ile ${to} arası her gün saat ${time}`,
  },
  ar: {
    everyDayAt: (time) => `كل يوم الساعة ${time}`,
    everyWeekdayAt: (days, time) => `كل يوم ${days} الساعة ${time}`,
    monthDayAt: (day, time) => `يوم ${day} من كل شهر الساعة ${time}`,
    everyNMinutes: (n) => (n <= 10 ? `كل ${n} دقايق` : `كل ${n} دقيقة`),
    everyMinute: 'كل دقيقة',
    everyHour: 'كل ساعة',
    everyHourAt: (m) => `كل ساعة عند الدقيقة ${m}`,
    everyNHours: (n) => (n <= 10 ? `كل ${n} ساعات` : `كل ${n} ساعة`),
    rangeAt: (from, to, time) => `كل يوم من ${from} إلى ${to} الساعة ${time}`,
  },
};

const INTL: Record<Locale, string> = { en: 'en', tr: 'tr', ar: 'ar-SA-u-nu-latn-ca-gregory' };

/** Weekday name, 0 (or 7) is Sunday. 1 January 2023 was a Sunday. */
function weekday(d: number, locale: Locale) {
  return new Intl.DateTimeFormat(INTL[locale], { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + (d % 7))));
}

function list(items: string[], locale: Locale) {
  try {
    return new Intl.ListFormat(INTL[locale], { style: 'long', type: 'conjunction' }).format(items);
  } catch {
    return items.join(', ');
  }
}

const int = (s: string, min: number, max: number) => (/^\d+$/.test(s) && +s >= min && +s <= max ? +s : null);

/** Weekday field: a day, a range (1-5) or a list (1,3,5), described with the time. */
function onDays(field: string, time: string, locale: Locale, w: Words) {
  const range = /^(\d)-(\d)$/.exec(field);
  if (range) {
    const [a, b] = [int(range[1], 0, 7), int(range[2], 0, 7)];
    return a !== null && b !== null && a < b ? w.rangeAt(weekday(a, locale), weekday(b, locale), time) : null;
  }
  const parts = field.split(',').map((p) => int(p, 0, 7));
  if (parts.some((p) => p === null)) return null;
  return w.everyWeekdayAt(list(parts.map((p) => weekday(p!, locale)), locale), time);
}

/** The description with a capital first letter, for the start of a line or sentence. The raw expression stays as it is. */
export function describeCronSentence(expr: string, locale: Locale) {
  const d = describeCron(expr, locale);
  return d === expr.trim() ? d : d.charAt(0).toLocaleUpperCase(INTL[locale]) + d.slice(1);
}

export function describeCron(expr: string, locale: Locale): string {
  const raw = expr.trim();
  const f = raw.split(/\s+/);
  if (f.length !== 5) return raw;
  const [min, hour, dom, mon, dow] = f;
  const w = WORDS[locale] ?? WORDS.en;
  if (mon !== '*') return raw;

  // Minute and hour steps, every day of every month.
  if (dom === '*' && dow === '*') {
    if (min === '*' && hour === '*') return w.everyMinute;
    const step = /^\*\/(\d+)$/.exec(min);
    if (step && hour === '*') {
      const n = int(step[1], 1, 59);
      return n === null ? raw : n === 1 ? w.everyMinute : w.everyNMinutes(n);
    }
    const m = int(min, 0, 59);
    if (m !== null && hour === '*') return m === 0 ? w.everyHour : w.everyHourAt(m);
    const hstep = /^\*\/(\d+)$/.exec(hour);
    if (m === 0 && hstep) {
      const n = int(hstep[1], 1, 23);
      return n === null ? raw : n === 1 ? w.everyHour : w.everyNHours(n);
    }
  }

  const m = int(min, 0, 59), h = int(hour, 0, 23);
  if (m === null || h === null) return raw;
  const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  if (dom === '*' && dow === '*') return w.everyDayAt(time);
  if (dom === '*') return onDays(dow, time, locale, w) ?? raw;
  if (dow === '*') {
    const d = int(dom, 1, 31);
    return d === null ? raw : w.monthDayAt(d, time);
  }
  return raw;
}
