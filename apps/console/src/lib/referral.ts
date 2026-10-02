/**
 * Partner codes in the console (docs/affiliates.md). The website stores `?ref=CODE` in the
 * `prgd_ref` cookie on the parent domain; a partner link straight to the console
 * (console.<domain>/login?ref=CODE) is stored the same way here. The signup form uses it to
 * prefill the partner code when the API says the click is still recent; only signing up with
 * the code refers the customer.
 */
export const REF_COOKIE = 'prgd_ref';
const MAX_AGE = 365 * 86_400;
const CODE = /^[A-Z0-9]{4,20}$/;

export function normalizeCode(raw: string | null | undefined): string | null {
  const c = (raw ?? '').trim().toUpperCase();
  return CODE.test(c) ? c : null;
}

/** Stores ?ref= from this page's address (last click wins). */
export function captureRef(domain: string | null) {
  if (typeof window === 'undefined') return;
  const code = normalizeCode(new URLSearchParams(window.location.search).get('ref'));
  if (!code) return;
  const parts = [`${REF_COOKIE}=${code}.${Math.floor(Date.now() / 1000)}`, 'path=/', `max-age=${MAX_AGE}`, 'samesite=lax'];
  if (domain) parts.push(`domain=${domain}`);
  if (window.location.protocol === 'https:') parts.push('secure');
  document.cookie = parts.join('; ');
}

/** The stored referral (CODE.<seconds>), if any. */
export function currentRef(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  for (const part of document.cookie.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === REF_COOKIE) return decodeURIComponent(part.slice(i + 1).trim()) || undefined;
  }
  return undefined;
}

/** A promo code passed in the address (?promo=CODE), for links that prefill the signup form. */
export function promoFromUrl(): string {
  if (typeof window === 'undefined') return '';
  return normalizeCode(new URLSearchParams(window.location.search).get('promo')) ?? '';
}

export interface PromoInfo { code: string | null; valid: boolean; discountPercent?: number; discountMonths?: number }
