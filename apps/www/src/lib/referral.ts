/**
 * Partner referral links (docs/affiliates.md). A page opened with `?ref=CODE` stores the code in
 * the first party cookie `prgd_ref` on the parent domain (progrid.co or progrid.sa), so the
 * console on the same domain sends it with the signup. A later click on another partner's link
 * replaces it (last click wins). The cookie carries the click time; the API decides how many days
 * a click counts, so the browser keeps it for up to a year.
 *
 * Pure: shared by the middleware, the click beacon and the tests.
 */
export const REF_COOKIE = 'prgd_ref';
export const REF_COOKIE_MAX_AGE = 365 * 86_400;

/** The partner code in a query string, upper case, or null when absent or malformed. */
export function refCodeFrom(search: string): string | null {
  const raw = new URLSearchParams(search).get('ref');
  const c = raw?.trim().toUpperCase() ?? '';
  return /^[A-Z0-9]{4,20}$/.test(c) ? c : null;
}

/** CODE.<unix seconds of the click> */
export function refCookieValue(code: string, nowMs: number): string {
  return `${code}.${Math.floor(nowMs / 1000)}`;
}
