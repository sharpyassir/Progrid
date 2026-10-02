/**
 * Security headers of the ops console. External engineers reach customer servers from this app,
 * so it loads nothing from third parties: no analytics, no fonts or scripts from a CDN.
 *
 * The Content Security Policy needs a nonce for the scripts Next.js inlines, so middleware.ts
 * builds it per request with `contentSecurityPolicy`. Connections are limited to this app, the
 * API and the terminal gateway.
 */

/** Build time addresses: the fallback for hosts that are not ops.<domain> (local runs, previews). */
const FALLBACK = {
  api: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  ops: process.env.NEXT_PUBLIC_OPS_URL ?? 'http://localhost:3002',
  gateway: process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'ws://localhost:4100',
};

/**
 * Addresses for the host this console is served on, so one build serves ops.progrid.co (the
 * primary one, where staff register passkeys) and ops.progrid.sa:
 *   ops.<domain>  ->  api.<domain>, wss://gateway.<domain>
 */
export function urlsForHost(hostname: string | null | undefined) {
  const h = (hostname ?? '').toLowerCase().replace(/:\d+$/, '');
  if (!h.startsWith('ops.') || h.split('.').length < 3) return FALLBACK;
  const domain = h.slice('ops.'.length);
  return { api: `https://api.${domain}`, ops: `https://${h}`, gateway: `wss://gateway.${domain}` };
}

const current = typeof window === 'undefined' ? FALLBACK : urlsForHost(window.location.hostname);
/** The API of this domain; computed in the browser from the page's host. */
export const API_URL = current.api;
/** This console's own address (ops.progrid.co in production). */
export const OPS_URL = current.ops;
/** The terminal gateway (prgd-gateway). The API hands out session URLs on this origin. */
export const GATEWAY_URL = current.gateway;

function origin(url: string) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

export function contentSecurityPolicy(nonce: string, dev = process.env.NODE_ENV !== 'production', host?: string | null) {
  const urls = urlsForHost(host);
  const api = origin(urls.api);
  // The gateway of this domain, and the configured one (the API may hand out either).
  const gateway = [...new Set([origin(urls.gateway), origin(FALLBACK.gateway)])].join(' ');
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
  if (!dev && urls.api.startsWith('https://')) parts.push('upgrade-insecure-requests');
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
