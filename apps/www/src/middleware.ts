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
  // Content Security Policy with a fresh nonce for the scripts Next.js inlines. The site loads
  // nothing from third parties except Google Fonts.
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== 'production';
  // Pricing and partner clicks are fetched from the API of this domain (or the configured one).
  const apexForCsp = apexOf(host, domains) ?? domains.domain;
  const apis = [...new Set([`https://api.${apexForCsp}`, process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'])].filter(Boolean).join(' ');
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${apis}${dev ? ' ws:' : ''}`,
    "object-src 'none'", "frame-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set('x-nonce', nonce);
  reqHeaders.set('content-security-policy', csp);
  const res = NextResponse.next({ request: { headers: reqHeaders } });
  res.headers.set('content-security-policy', csp);
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
