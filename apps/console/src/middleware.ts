import { NextResponse, type NextRequest } from 'next/server';
import { contentSecurityPolicy } from './lib/security-headers';

/** A fresh nonce and Content Security Policy for every page (lib/security-headers.ts). */
export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce, req.headers.get('x-forwarded-host') ?? req.headers.get('host'));
  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set('content-security-policy', csp);
  return res;
}

export const config = {
  matcher: [{ source: '/((?!_next/static|_next/image|brand/|favicon|apple-touch-icon).*)', missing: [{ type: 'header', key: 'next-router-prefetch' }] }],
};
