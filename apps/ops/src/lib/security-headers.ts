/**
 * Security headers of the ops console. External engineers reach customer servers from this app,
 * so it loads nothing from third parties: no analytics, no fonts or scripts from a CDN.
 *
 * The Content Security Policy needs a nonce for the scripts Next.js inlines, so middleware.ts
 * builds it per request with `contentSecurityPolicy`. Connections are limited to this app, the
 * API and the terminal gateway.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
/** This console's own address (ops.progrid.sa in production). */
export const OPS_URL = process.env.NEXT_PUBLIC_OPS_URL ?? 'http://localhost:3002';
/** The terminal gateway (prgd-gateway). The API hands out session URLs on this origin. */
export const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'ws://localhost:4100';

function origin(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

export function contentSecurityPolicy(nonce: string, dev = process.env.NODE_ENV !== 'production') {
  const api = origin(API_URL);
  const gateway = origin(GATEWAY_URL);
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    // strict-dynamic lets the nonce'd Next.js bootstrap load its own chunks; dev needs eval for fast refresh.
    'script-src': ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    // React style attributes and the terminal's generated styles.
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'", api, gateway, ...(dev ? ['ws:'] : [])].filter(Boolean),
    'media-src': ["'none'"],
    'object-src': ["'none'"],
    'frame-src': ["'none'"],
    'worker-src': ["'self'", 'blob:'],
    'manifest-src': ["'self'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`);
  if (!dev && API_URL.startsWith('https://')) parts.push('upgrade-insecure-requests');
  return parts.join('; ');
}

export const STATIC_SECURITY_HEADERS = [
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  // Passkeys need publickey-credentials; the terminal may read the clipboard only through paste events.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-read=(), publickey-credentials-get=(self), publickey-credentials-create=(self)' },
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];
