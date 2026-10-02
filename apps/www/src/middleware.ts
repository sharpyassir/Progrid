import { NextResponse, type NextRequest } from 'next/server';
import { clientIp, decideGeoRedirect, SITE_COOKIE, SITE_COOKIE_MAX_AGE } from '@/lib/geo-redirect';
import { countryOf } from '@/lib/geoip';
import { apexOf, DEFAULT_DOMAIN, DEFAULT_SA_DOMAIN } from '@/lib/site-shared';
import { REF_COOKIE, REF_COOKIE_MAX_AGE, refCodeFrom, refCookieValue } from '@/lib/referral';

/**
 * Sends visitors from Saudi Arabia who open progrid.co to the same page on progrid.sa
 * (lib/geo-redirect.ts has the rules), and stores a partner referral code from `?ref=` (lib/referral.ts).
 * Runs on the Node.js runtime to read the local country database.
 */
export function middleware(req: NextRequest) {
  const domains = { domain: process.env.PRGD_DOMAIN || DEFAULT_DOMAIN, saDomain: process.env.PRGD_DOMAIN_SA || DEFAULT_SA_DOMAIN };
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
  const decision = decideGeoRedirect(
    {
      method: req.method,
      host,
      pathname: req.nextUrl.pathname,
      search: req.nextUrl.search,
      userAgent: req.headers.get('user-agent'),
      siteCookie: req.cookies.get(SITE_COOKIE)?.value,
      ip: clientIp(req.headers),
    },
    { ...domains, countryOf },
  );
  if (decision.type === 'redirect') {
    const res = NextResponse.redirect(decision.location, 302);
    // The answer depends on the visitor's address: never cache it in a shared cache.
    res.headers.set('cache-control', 'private, no-store');
    return res;
  }
  const res = NextResponse.next();
  const secure = req.nextUrl.protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';
  if (decision.setGlobalCookie) res.cookies.set(SITE_COOKIE, 'global', { path: '/', maxAge: SITE_COOKIE_MAX_AGE, sameSite: 'lax', secure });
  // A partner link: remember the code on the parent domain so the console on console.<domain> sees it.
  const ref = refCodeFrom(req.nextUrl.search);
  if (ref) {
    const apex = apexOf(host, domains);
    res.cookies.set(REF_COOKIE, refCookieValue(ref, Date.now()), { path: '/', maxAge: REF_COOKIE_MAX_AGE, sameSite: 'lax', secure, ...(apex ? { domain: apex } : {}) });
  }
  return res;
}

export const config = {
  runtime: 'nodejs',
  matcher: ['/((?!_next/|api/|brand/|favicon|robots.txt|sitemap.xml|openapi.yaml).*)'],
};
