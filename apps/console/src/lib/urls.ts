import { useSyncExternalStore } from 'react';

/**
 * Public addresses, derived at runtime from the host the console is served on, so one build
 * serves console.progrid.co and console.progrid.sa:
 *   console.<domain>  ->  api.<domain>, <domain> (website)
 * Any other host (localhost, previews) uses the addresses baked in at build time.
 */
export interface Urls { api: string; www: string; console: string; domain: string | null }

const FALLBACK: Urls = {
  api: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  www: process.env.NEXT_PUBLIC_WWW_URL ?? 'https://progrid.co',
  console: process.env.NEXT_PUBLIC_CONSOLE_URL ?? 'http://localhost:3000',
  domain: null,
};

export function urlsForHost(hostname: string | null | undefined, protocol = 'https:'): Urls {
  const h = (hostname ?? '').toLowerCase();
  if (!h.startsWith('console.') || h.split('.').length < 3) return FALLBACK;
  const domain = h.slice('console.'.length);
  return { api: `${protocol}//api.${domain}`, www: `${protocol}//${domain}`, console: `${protocol}//${h}`, domain };
}

/** The addresses for this browser tab (the fallback on the server). */
export function runtimeUrls(): Urls {
  return typeof window === 'undefined' ? FALLBACK : urlsForHost(window.location.hostname, window.location.protocol);
}

const subscribe = () => () => {};
/** For links rendered in components: the server render uses the fallback, the browser the real host. */
export function useUrls(): Urls {
  return useSyncExternalStore(subscribe, runtimeUrls, () => FALLBACK);
}
