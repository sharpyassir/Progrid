import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy } from './lib/security-headers';

/**
 * Sets the Content Security Policy with a fresh nonce on every page request. Next.js reads the
 * nonce from the request's policy header and puts it on the scripts it inlines.
 */
export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  // The host decides the API and gateway origins allowed in connect-src (ops.progrid.co or ops.progrid.sa).
  const csp = contentSecurityPolicy(nonce, undefined, req.headers.get('x-forwarded-host') ?? req.headers.get('host'));
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('content-security-policy', csp);
  return res;
}

export const config = {
  // Pages only: static assets and images carry no scripts.
  matcher: [{ source: '/((?!_next/static|_next/image|brand/|favicon|apple-touch-icon).*)', missing: [{ type: 'header', key: 'next-router-prefetch' }] }],
};
