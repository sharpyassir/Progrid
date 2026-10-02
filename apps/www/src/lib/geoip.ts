import { existsSync, readFileSync, statSync } from 'node:fs';
import { isIP } from 'node:net';
import { Reader, type Response } from 'mmdb-lib';

/**
 * Country of an IP address from a local DB-IP "IP to Country Lite" database (mmdb, CC BY 4.0,
 * https://db-ip.com). Downloaded when the image is built (apps/www/Dockerfile, refreshed monthly)
 * or mounted at GEOIP_DB_PATH. No database means no country, and so no redirect.
 */
type Row = { country?: { iso_code?: string }; country_code?: string };

let cache: { path: string; mtime: number; reader: Reader<Response> | null } | undefined;

export function geoDbPath() {
  return process.env.GEOIP_DB_PATH || '/app/geoip/dbip-country-lite.mmdb';
}

function reader(): Reader<Response> | null {
  const path = geoDbPath();
  try {
    if (!existsSync(path)) return null;
    const mtime = statSync(path).mtimeMs;
    if (cache?.path === path && cache.mtime === mtime) return cache.reader;
    cache = { path, mtime, reader: new Reader<Response>(readFileSync(path)) };
  } catch {
    cache = { path, mtime: 0, reader: null };
  }
  return cache.reader;
}

export function countryOf(ip: string): string | null {
  const addr = ip.trim().replace(/^::ffff:/, '');
  if (!isIP(addr)) return null;
  const r = reader();
  if (!r) return null;
  try {
    const row = r.get(addr) as Row | null;
    const cc = row?.country?.iso_code ?? row?.country_code;
    return typeof cc === 'string' && /^[A-Z]{2}$/.test(cc) ? cc : null;
  } catch {
    return null;
  }
}
