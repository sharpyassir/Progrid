'use client';

import { useEffect } from 'react';
import { useSite } from './site-context';
import { refCodeFrom } from '@/lib/referral';

/**
 * Counts a visit through a partner link (the middleware already stored the code in a cookie).
 * Sent from the browser so the API sees the visitor's own address; counted once a day per visitor.
 */
export function RefBeacon() {
  const site = useSite();
  useEffect(() => {
    const code = refCodeFrom(window.location.search);
    if (!code) return;
    fetch(`${site.urls.api}/v1/affiliates/clicks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, path: window.location.pathname, referrer: document.referrer || undefined }),
      keepalive: true,
    }).catch(() => undefined);
  }, [site.urls.api]);
  return null;
}
