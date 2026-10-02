import { headers } from 'next/headers';
import { DEFAULT_DOMAIN, DEFAULT_SA_DOMAIN, resolveSite, type SiteConfig, type SiteInfo } from './site-shared';

/** Runtime settings of the www container (env), with the build time addresses as fallback. */
export function siteConfig(): SiteConfig {
  return {
    domain: (process.env.PRGD_DOMAIN || DEFAULT_DOMAIN).toLowerCase(),
    saDomain: (process.env.PRGD_DOMAIN_SA || DEFAULT_SA_DOMAIN).toLowerCase(),
    fallback: {
      www: process.env.NEXT_PUBLIC_WWW_URL ?? 'http://localhost:3001',
      console: process.env.NEXT_PUBLIC_CONSOLE_URL ?? 'http://localhost:3000',
      api: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
    },
    fallbackSite: process.env.PRGD_DEV_SITE === 'sa' ? 'sa' : 'global',
  };
}

/** The storefront and addresses of the current request. Caddy passes the original Host. */
export async function getSite(): Promise<SiteInfo> {
  const h = await headers();
  return resolveSite(h.get('x-forwarded-host') ?? h.get('host'), siteConfig());
}
