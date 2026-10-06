/**
 * Content Security Policy of the console. The session token lives in the browser, so scripts are
 * limited to this app's own, nonce'd bundles: an injected script cannot run and cannot send
 * anything anywhere but the API of this domain. Built per request by middleware.ts.
 */
function origin(url: string) {
  try { return new URL(url).origin; } catch { return ''; }
}

/** console.<domain> talks to api.<domain>; other hosts use the build time address (lib/urls.ts). */
function apiForHost(host: string | null) {
  const h = (host ?? '').toLowerCase().replace(/:\d+$/, '');
  return h.startsWith('console.') && h.split('.').length >= 3 ? `https://api.${h.slice('console.'.length)}` : '';
}

export function contentSecurityPolicy(nonce: string, host: string | null, dev = process.env.NODE_ENV !== 'production') {
  const fallback = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const api = [...new Set([origin(apiForHost(host)), origin(fallback)])].filter(Boolean);
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com'],
    'img-src': ["'self'", 'data:', 'blob:'],
    'connect-src': ["'self'", ...api, ...(dev ? ['ws:'] : [])],
    'object-src': ["'none'"],
    'frame-src': ["'none'"],
    'base-uri': ["'self'"],
    // Sign in with Google or Microsoft starts with a form post to the API.
    'form-action': ["'self'", ...api],
    'frame-ancestors': ["'none'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`);
  if (!dev) parts.push('upgrade-insecure-requests');
  return parts.join('; ');
}
