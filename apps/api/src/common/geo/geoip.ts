import { existsSync, readFileSync, statSync } from 'node:fs';
import { isIP } from 'node:net';
import { Logger } from '@nestjs/common';
import { Reader, type Response } from 'mmdb-lib';
import { loadConfig } from '../../config/config';

/**
 * IP address to country, from a local MaxMind format database: DB-IP "IP to Country Lite"
 * (CC BY 4.0, https://db-ip.com). No license key and no network call. The file is downloaded when
 * the image is built (apps/api/Dockerfile) or mounted at GEOIP_DB_PATH; without it every lookup
 * answers null. Used only to prefill the country on the signup form. Billing never follows it.
 */
type Row = { country?: { iso_code?: string }; country_code?: string };

const log = new Logger('GeoIp');
let cache: { path: string; mtime: number; reader: Reader<Response> | null } | undefined;

function reader(): Reader<Response> | null {
  const path = loadConfig().GEOIP_DB_PATH;
  if (!path || !existsSync(path)) return null;
  const mtime = statSync(path).mtimeMs;
  if (cache?.path === path && cache.mtime === mtime) return cache.reader;
  try {
    cache = { path, mtime, reader: new Reader<Response>(readFileSync(path)) };
  } catch (err) {
    log.warn(`cannot read ${path}: ${(err as Error).message}`);
    cache = { path, mtime, reader: null };
  }
  return cache.reader;
}

/** ISO 3166-1 alpha-2 country of an address, or null when unknown, private or without a database. */
export function countryOfIp(ip: string | undefined | null): string | null {
  const addr = (ip ?? '').trim().replace(/^::ffff:/, '');
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

/** Whether a country database is loaded (for /v1/geo and health output). */
export function geoIpAvailable() {
  return reader() !== null;
}
