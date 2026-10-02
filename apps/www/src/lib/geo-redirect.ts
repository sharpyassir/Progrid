import { apexOf } from './site-shared';

/**
 * Whether a visitor to progrid.co should be sent to progrid.sa (docs/domains-and-entities.md).
 * Pure, so it is unit tested (geo-redirect.test.ts) and the middleware only wires it up.
 *
 * Rules, in order:
 *  1. Only page views: GET or HEAD, not files, not /_next, not /api.
 *  2. Only on the global domain (progrid.co and www.progrid.co). progrid.sa never redirects.
 *  3. ?site=global, or the prgd_site=global cookie it sets, keeps the visitor on progrid.co.
 *  4. Crawlers and link preview bots are never redirected, so both sites index cleanly.
 *  5. The country of the visitor's address (local DB-IP database). Unknown country or no
 *     database: no redirect. Saudi Arabia: 302 to the same path and query on progrid.sa.
 * The website only: the console, the API and the ops console work on both domains.
 */
export const SITE_COOKIE = 'prgd_site';
export const SITE_COOKIE_MAX_AGE = 365 * 86_400;

export interface GeoRequest {
  method: string;
  host: string;
  pathname: string;
  /** Raw query string including the leading "?", or "". */
  search: string;
  userAgent: string | null;
  /** Value of the prgd_site cookie. */
  siteCookie?: string | null;
  ip?: string | null;
}

export type GeoDecision =
  | { type: 'next'; reason: string; setGlobalCookie?: boolean }
  | { type: 'redirect'; reason: 'country'; location: string; country: string };

export interface GeoOptions {
  domain: string;
  saDomain: string;
  /** ISO country of an address, or null when unknown or without a database. */
  countryOf: (ip: string) => string | null;
}

/** Search engines, link previews, monitors and headless renderers. */
const BOT = /bot\b|bot\/|crawl|spider|slurp|bingpreview|mediapartners|adsbot|google-inspectiontool|googleother|feedfetcher|apis-google|facebookexternalhit|facebookcatalog|meta-externalagent|embedly|quora link preview|outbrain|pinterest|slackbot|slack-imgproxy|twitterbot|linkedinbot|vkshare|w3c_validator|whatsapp|telegrambot|discordbot|skypeuripreview|applebot|yandex|baiduspider|duckduck|semrush|ahrefs|mj12bot|dotbot|petalbot|bytespider|gptbot|chatgpt-user|oai-searchbot|claudebot|claude-web|perplexitybot|ccbot|amazonbot|lighthouse|headlesschrome|pingdom|uptimerobot|statuscake|site24x7|datadog|prerender/i;

export function isBot(userAgent: string | null | undefined) {
  return !userAgent || BOT.test(userAgent);
}

/** Paths that are not pages: assets, Next internals, API routes, files with an extension. */
export function isAsset(pathname: string) {
  return pathname.startsWith('/_next/') || pathname.startsWith('/api/') || pathname.startsWith('/brand/') || /\/[^/]+\.[a-z0-9]{2,5}$/i.test(pathname);
}

export function decideGeoRedirect(req: GeoRequest, opts: GeoOptions): GeoDecision {
  if (req.method !== 'GET' && req.method !== 'HEAD') return { type: 'next', reason: 'method' };
  if (isAsset(req.pathname)) return { type: 'next', reason: 'asset' };
  if (apexOf(req.host, opts) !== opts.domain) return { type: 'next', reason: 'not_global_domain' };
  const params = new URLSearchParams(req.search);
  if (params.get('site') === 'global') return { type: 'next', reason: 'opt_out_param', setGlobalCookie: true };
  if (req.siteCookie === 'global') return { type: 'next', reason: 'opt_out_cookie' };
  if (isBot(req.userAgent)) return { type: 'next', reason: 'bot' };
  const ip = (req.ip ?? '').trim();
  if (!ip) return { type: 'next', reason: 'no_ip' };
  const country = opts.countryOf(ip);
  if (!country) return { type: 'next', reason: 'unknown_country' };
  if (country !== 'SA') return { type: 'next', reason: 'other_country' };
  return { type: 'redirect', reason: 'country', country, location: `https://${opts.saDomain}${req.pathname}${req.search}` };
}

/** The visitor's address from Caddy: X-Real-IP, else the first X-Forwarded-For entry. */
export function clientIp(headers: { get(name: string): string | null }): string | null {
  const real = headers.get('x-real-ip')?.trim();
  if (real) return real;
  const fwd = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return fwd || null;
}
