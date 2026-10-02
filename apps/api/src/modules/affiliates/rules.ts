/**
 * Pure rules of the affiliate program: codes, the referral cookie, self referral, dates.
 * Unit tested in rules.test.ts; the services only wire them to the database.
 */

/** Affiliate codes: 4 to 20 upper case letters and digits. Used as `?ref=CODE` and as the promo code. */
export const CODE_RE = /^[A-Z0-9]{4,20}$/;

export function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const c = raw.trim().toUpperCase();
  return CODE_RE.test(c) ? c : null;
}

/** Name of the first party cookie set by the website and the console on the parent domain. */
export const REF_COOKIE = 'prgd_ref';

/** The prgd_ref value from a Cookie header, if any. */
export function refFromCookieHeader(header: string | undefined): string | undefined {
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === REF_COOKIE) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return undefined; }
    }
  }
  return undefined;
}

/**
 * The cookie holds `CODE.<unix seconds of the click>` so the API can apply the configured cookie
 * duration even though the browser keeps the cookie longer. A bare code (no time) is accepted as
 * a fresh click: it comes from a `?ref=` on the signup page itself.
 */
export function parseRef(raw: unknown, now: Date, cookieDays: number): string | null {
  if (typeof raw !== 'string' || raw.length > 64) return null;
  const [code, ts] = raw.split('.');
  const c = normalizeCode(code);
  if (!c) return null;
  if (ts === undefined) return c;
  const at = Number(ts) * 1000;
  if (!Number.isFinite(at) || at > now.getTime() + 5 * 60_000) return null;
  return now.getTime() - at <= cookieDays * 86_400_000 ? c : null;
}

/**
 * The same mailbox written differently: lower case, no "+tag", and for Gmail no dots and the
 * googlemail.com alias. Used only to compare addresses, never stored as the login.
 */
export function canonicalEmail(email: string): string {
  const [local0, domain0] = email.trim().toLowerCase().split('@');
  if (!domain0) return email.trim().toLowerCase();
  let local = local0.split('+')[0];
  let domain = domain0;
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.replace(/\./g, '');
  return `${local}@${domain}`;
}

export interface SelfReferralInput {
  affiliate: { userId: string; email: string; userEmail: string; ips: string[] };
  customer: { userIds: string[]; emails: string[]; ip?: string | null };
}

/** Why a referral is the affiliate referring themselves, or null. */
export function selfReferralReason(i: SelfReferralInput): 'same_user' | 'same_email' | 'same_ip' | null {
  if (i.customer.userIds.includes(i.affiliate.userId)) return 'same_user';
  const mine = new Set([canonicalEmail(i.affiliate.email), canonicalEmail(i.affiliate.userEmail)]);
  if (i.customer.emails.some((e) => mine.has(canonicalEmail(e)))) return 'same_email';
  if (i.customer.ip && i.affiliate.ips.includes(i.customer.ip)) return 'same_ip';
  return null;
}

/** Same day of month `n` months later, clamped to the month's last day (Jan 31 + 1 = Feb 28). */
export function addMonths(d: Date, n: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
}

/** A readable default code from a name: letters and digits, upper case, plus random digits. */
export function suggestCode(name: string, random: () => number = Math.random): string {
  const base = name.normalize('NFKD').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 10);
  const digits = String(Math.floor(random() * 10_000)).padStart(4, '0');
  return `${base.length >= 2 ? base : 'PRGD'}${digits}`;
}
