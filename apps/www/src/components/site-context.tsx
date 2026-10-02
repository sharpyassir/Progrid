'use client';

import { createContext, useContext } from 'react';
import { resolveSite, type SiteInfo } from '@/lib/site-shared';

/** The storefront of this request (global or sa) and its addresses, resolved on the server from the Host. */
const SiteCtx = createContext<SiteInfo>(resolveSite('', {
  domain: 'progrid.co',
  saDomain: 'progrid.sa',
  fallback: { www: process.env.NEXT_PUBLIC_WWW_URL ?? 'http://localhost:3001', console: process.env.NEXT_PUBLIC_CONSOLE_URL ?? 'http://localhost:3000', api: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000' },
  fallbackSite: 'global',
}));

export function SiteProvider({ value, children }: { value: SiteInfo; children: React.ReactNode }) {
  return <SiteCtx.Provider value={value}>{children}</SiteCtx.Provider>;
}

export function useSite(): SiteInfo {
  return useContext(SiteCtx);
}
