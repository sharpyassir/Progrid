import { NextResponse, type NextRequest } from 'next/server';
import { apexOf, DEFAULT_DOMAIN, DEFAULT_SA_DOMAIN } from '@/lib/site-shared';
import { REF_COOKIE, REF_COOKIE_MAX_AGE, refCodeFrom, refCookieValue } from '@/lib/referral';

/**
 * Stores a partner referral code from `?ref=` (lib/referral.ts). The website is global: visitors are
 * no longer sent to a country storefront (lib/geo-redirect.ts is kept for the rules and tests).
 */
export function middleware(req: NextRequest) {
  const domains = { domain: process.env.PRGD_DOMAIN || DEFAULT_DOMAIN, saDomain: process.env.PRGD_DOMAIN_SA || DEFAULT_SA_DOMAIN };
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '';
  const res = NextResponse.next();
  const secure = req.nextUrl.protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';
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
