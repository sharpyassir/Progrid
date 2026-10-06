import { describe, expect, it } from 'vitest';
import { clientIp, decideGeoRedirect, isBot, type GeoRequest } from './geo-redirect';
import { resolveSite } from './site-shared';

const COUNTRY: Record<string, string> = { '2.88.0.1': 'SA', '8.8.8.8': 'US', '2a02:cb80::1': 'SA' };
const opts = { domain: 'progrid.co', saDomain: 'progrid.sa', countryOf: (ip: string) => COUNTRY[ip] ?? null };
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const req = (over: Partial<GeoRequest> = {}): GeoRequest => ({ method: 'GET', host: 'progrid.co', pathname: '/', search: '', userAgent: CHROME, siteCookie: null, ip: '2.88.0.1', ...over });

describe('decideGeoRedirect', () => {
  it('sends a visitor from Saudi Arabia on progrid.co to the same path and query on progrid.sa', () => {
    expect(decideGeoRedirect(req(), opts)).toEqual({ type: 'redirect', reason: 'country', country: 'SA', location: 'https://progrid.sa/' });
    expect(decideGeoRedirect(req({ pathname: '/ar/connect', search: '?utm_source=x&b=1' }), opts)).toMatchObject({ type: 'redirect', location: 'https://progrid.sa/ar/connect?utm_source=x&b=1' });
    expect(decideGeoRedirect(req({ host: 'www.progrid.co', pathname: '/legal/terms' }), opts)).toMatchObject({ type: 'redirect', location: 'https://progrid.sa/legal/terms' });
    expect(decideGeoRedirect(req({ ip: '2a02:cb80::1', method: 'HEAD' }), opts)).toMatchObject({ type: 'redirect' });
  });

  it('keeps everyone else on progrid.co', () => {
    expect(decideGeoRedirect(req({ ip: '8.8.8.8' }), opts)).toMatchObject({ type: 'next', reason: 'other_country' });
  });

  it('never redirects when the country is unknown or there is no database', () => {
    expect(decideGeoRedirect(req({ ip: '10.0.0.1' }), opts)).toMatchObject({ type: 'next', reason: 'unknown_country' });
    expect(decideGeoRedirect(req(), { ...opts, countryOf: () => null })).toMatchObject({ type: 'next', reason: 'unknown_country' });
    expect(decideGeoRedirect(req({ ip: null }), opts)).toMatchObject({ type: 'next', reason: 'no_ip' });
  });

  it('honors the opt out link and its cookie', () => {
    expect(decideGeoRedirect(req({ search: '?site=global' }), opts)).toEqual({ type: 'next', reason: 'opt_out_param', setGlobalCookie: true });
    expect(decideGeoRedirect(req({ siteCookie: 'global' }), opts)).toMatchObject({ type: 'next', reason: 'opt_out_cookie' });
    expect(decideGeoRedirect(req({ siteCookie: 'sa' }), opts)).toMatchObject({ type: 'redirect' });
  });

  it('never redirects crawlers and link previews', () => {
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36',
      'Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Twitterbot/1.0',
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'WhatsApp/2.23.20.0',
      'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36 Chrome-Lighthouse',
      'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
      '',
    ]) expect(decideGeoRedirect(req({ userAgent: ua }), opts)).toMatchObject({ type: 'next', reason: 'bot' });
    expect(isBot(CHROME)).toBe(false);
    expect(isBot('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')).toBe(false);
  });

  it('only acts on page views on the global domain', () => {
    expect(decideGeoRedirect(req({ host: 'progrid.sa' }), opts)).toMatchObject({ type: 'next', reason: 'not_global_domain' });
    expect(decideGeoRedirect(req({ host: 'console.progrid.co' }), opts)).toMatchObject({ type: 'next', reason: 'not_global_domain' });
    expect(decideGeoRedirect(req({ host: 'localhost:3001' }), opts)).toMatchObject({ type: 'next', reason: 'not_global_domain' });
    expect(decideGeoRedirect(req({ method: 'POST' }), opts)).toMatchObject({ type: 'next', reason: 'method' });
    for (const p of ['/_next/static/chunks/main.js', '/brand/progrid-mark.svg', '/og-image.png', '/openapi.yaml', '/api/health']) {
      expect(decideGeoRedirect(req({ pathname: p }), opts)).toMatchObject({ type: 'next', reason: 'asset' });
    }
  });

  it('reads the address Caddy passes', () => {
    const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
    expect(clientIp(h({ 'x-real-ip': '2.88.0.1', 'x-forwarded-for': '9.9.9.9' }))).toBe('2.88.0.1');
    expect(clientIp(h({ 'x-forwarded-for': '2.88.0.1, 10.0.0.2' }))).toBe('2.88.0.1');
    expect(clientIp(h({}))).toBeNull();
  });
});

describe('resolveSite', () => {
  const cfg = { domain: 'progrid.co', saDomain: 'progrid.sa', fallback: { www: 'http://localhost:3001', console: 'http://localhost:3000', api: 'http://localhost:4000' }, fallbackSite: 'global' as const };
  it('derives every address from the host', () => {
    expect(resolveSite('progrid.co', cfg)).toMatchObject({ site: 'global', currency: 'USD', urls: { www: 'https://progrid.co', console: 'https://console.progrid.co', api: 'https://api.progrid.co' }, other: { site: 'sa', www: 'https://progrid.sa' } });
    expect(resolveSite('www.progrid.sa:443', cfg)).toMatchObject({ site: 'sa', currency: 'SAR', urls: { console: 'https://console.progrid.sa', api: 'https://api.progrid.sa' }, entity: { legalName: 'Progrid Arabia', supportEmail: 'support@progrid.sa' } });
  });
  it('falls back to the build time addresses on other hosts', () => {
    expect(resolveSite('localhost:3001', cfg)).toMatchObject({ site: 'global', domain: null, urls: cfg.fallback, entity: { legalName: 'Progrid Technologies LLC' } });
  });
});
