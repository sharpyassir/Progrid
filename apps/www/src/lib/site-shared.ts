/**
 * One website, one company, two domains (docs/domains-and-entities.md).
 *
 * Every service is provided and invoiced by Progrid Arabia, a Saudi company. The domain only picks
 * the storefront's display currency:
 *  - global: progrid.co, the global address. Prices shown in US dollars.
 *  - sa: progrid.sa, the Saudi address. Prices shown in riyals with VAT.
 * What a customer is actually billed follows their billing country: Saudi Arabia pays in SAR with
 * 15% VAT, everyone else pays in USD.
 *
 * Which one a request gets follows the host name. Addresses of the console and the API follow the
 * host too (console.<domain>, api.<domain>), so one build serves both domains. Unknown hosts
 * (localhost, previews) fall back to the addresses baked in at build time.
 *
 * Pure: shared by the middleware, server components and the browser.
 */
export type Site = 'global' | 'sa';

export interface SiteUrls { www: string; console: string; api: string }

export interface SiteInfo {
  site: Site;
  /** The apex domain of this request (progrid.co), or null on an unknown host. */
  domain: string | null;
  urls: SiteUrls;
  /** The other domain (legal pages and console links). */
  other: { site: Site; www: string };
  /** The global site's address, the x-default of hreflang. */
  globalWww: string;
  saWww: string;
  currency: 'USD' | 'SAR';
  /** The company that provides the services: Progrid Arabia on both domains. */
  entity: { legalName: string; supportEmail: string };
}

export interface SiteConfig {
  /** progrid.co */
  domain: string;
  /** progrid.sa */
  saDomain: string;
  /** Build time addresses, for hosts that are neither domain. */
  fallback: SiteUrls;
  /** Which storefront an unknown host shows (development). */
  fallbackSite: Site;
}

export const DEFAULT_DOMAIN = 'progrid.co';
export const DEFAULT_SA_DOMAIN = 'progrid.sa';

/** The one company behind both domains. Each domain keeps its own support mailbox. */
export const LEGAL_NAME = 'Progrid Arabia';
const entityFor = (domain: string): SiteInfo['entity'] => ({ legalName: LEGAL_NAME, supportEmail: `support@${domain}` });

/** Lower case host without port and trailing dot. */
export function normalizeHost(host: string | null | undefined) {
  return (host ?? '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
}

/** progrid.co for progrid.co and www.progrid.co; null for anything else. */
export function apexOf(host: string, cfg: Pick<SiteConfig, 'domain' | 'saDomain'>): string | null {
  const h = normalizeHost(host);
  for (const d of [cfg.domain, cfg.saDomain]) if (h === d || h === `www.${d}`) return d;
  return null;
}

export function urlsForDomain(domain: string): SiteUrls {
  return { www: `https://${domain}`, console: `https://console.${domain}`, api: `https://api.${domain}` };
}

export function resolveSite(host: string | null | undefined, cfg: SiteConfig): SiteInfo {
  const apex = apexOf(host ?? '', cfg);
  const site: Site = apex ? (apex === cfg.saDomain ? 'sa' : 'global') : cfg.fallbackSite;
  const urls = apex ? urlsForDomain(apex) : cfg.fallback;
  const globalWww = `https://${cfg.domain}`;
  const saWww = `https://${cfg.saDomain}`;
  const own = site === 'sa' ? cfg.saDomain : cfg.domain;
  return {
    site,
    domain: apex,
    urls,
    other: site === 'sa' ? { site: 'global', www: globalWww } : { site: 'sa', www: saWww },
    globalWww,
    saWww,
    currency: site === 'sa' ? 'SAR' : 'USD', // display currency of the storefront; billing follows the billing country
    entity: entityFor(own),
  };
}
