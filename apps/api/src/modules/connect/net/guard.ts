import { BlockList, isIP, type LookupFunction } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import * as http from 'node:http';
import * as https from 'node:https';

/**
 * Outbound network guard for every Connect tool that reaches a customer supplied address
 * (http_request, webhook_out, notify webhooks, database and SMTP hosts).
 *
 *  - only http and https, no credentials in the URL
 *  - the host is resolved and EVERY address must be public: private (10/8, 172.16/12,
 *    192.168/16), loopback, link local (incl. 169.254.169.254 metadata), CGNAT (100.64/10, which
 *    also covers the platform's WireGuard and management ranges inside 10/8), multicast,
 *    reserved, IPv6 ULA (fc00::/7), link local, loopback, and IPv4 mapped forms of all of these
 *  - the check runs inside the socket's DNS lookup, so the address that is checked is the
 *    address that is connected to (no DNS rebinding window)
 *  - redirects are followed by hand (max 3) and every hop is checked again
 *  - timeout 15 s, response capped at 1 MB (the rest is dropped and `truncated` is set)
 *
 * An admin only allowlist (CONNECT_NETWORK_ALLOWLIST) can open specific CIDRs or host names.
 */

export interface Address {
  address: string;
  family: number;
}
export type Resolver = (host: string) => Promise<Address[]>;

export interface NetPolicy {
  /** CIDRs, IPs and host names (exact or "*.suffix") that may be reached although private. */
  allowlist: { ips: BlockList; hosts: string[] };
  resolver: Resolver;
}

export class NetBlockedError extends Error {
  readonly code = 'network_blocked';
}

const BLOCKED = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) BLOCKED.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [
  ['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8], ['2001:db8::', 32], ['100::', 64],
] as const) BLOCKED.addSubnet(net, bits, 'ipv6');

export const defaultResolver: Resolver = (host) => dnsLookup(host, { all: true, verbatim: true });

export function parseAllowlist(raw: string): NetPolicy['allowlist'] {
  const ips = new BlockList();
  const hosts: string[] = [];
  for (const entry of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    const [addr, bits] = entry.split('/');
    const kind = isIP(addr);
    if (kind) ips.addSubnet(addr, bits ? Number(bits) : kind === 4 ? 32 : 128, kind === 4 ? 'ipv4' : 'ipv6');
    else hosts.push(entry.toLowerCase());
  }
  return { ips, hosts };
}

export function makePolicy(allowlist: string, resolver: Resolver = defaultResolver): NetPolicy {
  return { allowlist: parseAllowlist(allowlist), resolver };
}

/** The IPv4 address inside an IPv4 mapped or NAT64 IPv6 address, else null. */
function embeddedV4(ip: string): string | null {
  const v = ip.toLowerCase();
  const dotted = /^(?:::ffff:|::ffff:0:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (dotted) return dotted[1];
  const hex = /^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(v);
  if (hex) {
    const a = parseInt(hex[1], 16);
    const b = parseInt(hex[2], 16);
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  }
  return null;
}

/** True when the address is private, loopback, link local, reserved or otherwise not on the internet. */
export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return BLOCKED.check(ip, 'ipv4');
  if (kind === 6) {
    const v4 = embeddedV4(ip);
    if (v4) return BLOCKED.check(v4, 'ipv4');
    return BLOCKED.check(ip, 'ipv6');
  }
  return true;
}

function hostAllowlisted(host: string, policy: NetPolicy) {
  const h = host.toLowerCase();
  return policy.allowlist.hosts.some((p) => (p.startsWith('*.') ? h.endsWith(p.slice(1)) : h === p));
}

function addressAllowed(host: string, ip: string, policy: NetPolicy): boolean {
  if (!isBlockedAddress(ip)) return true;
  if (hostAllowlisted(host, policy)) return true;
  const kind = isIP(ip);
  const v4 = kind === 6 ? embeddedV4(ip) : null;
  return v4 ? policy.allowlist.ips.check(v4, 'ipv4') : policy.allowlist.ips.check(ip, kind === 4 ? 'ipv4' : 'ipv6');
}

/** True when `host` matches one of the patterns (exact or "*.example.com"). An empty list allows every host. */
export function hostMatches(host: string, patterns: string[] | undefined): boolean {
  if (!patterns?.length) return true;
  const h = host.toLowerCase();
  return patterns.some((raw) => {
    const p = raw.trim().toLowerCase();
    if (!p) return false;
    if (p.startsWith('*.')) return h.endsWith(p.slice(1)) && h.length > p.length - 1;
    return h === p;
  });
}

/** Resolves a host and returns its addresses when every one may be connected to, or throws. */
export async function checkedAddresses(host: string, policy: NetPolicy): Promise<Address[]> {
  const bare = host.replace(/^\[|\]$/g, '');
  if (!bare) throw new NetBlockedError('no host given');
  const lower = bare.toLowerCase();
  if ((lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.internal') || lower.endsWith('.local')) && !hostAllowlisted(lower, policy)) {
    throw new NetBlockedError(`${host} is a local host name`);
  }
  const addrs = isIP(bare) ? [{ address: bare, family: isIP(bare) }] : await policy.resolver(bare).catch(() => [] as Address[]);
  if (!addrs.length) throw new NetBlockedError(`${host} does not resolve`);
  const bad = addrs.find((a) => !addressAllowed(bare, a.address, policy));
  if (bad) throw new NetBlockedError(`${host} resolves to a private or reserved address (${bad.address}); only public addresses can be reached`);
  return addrs;
}

/**
 * One address of a host that may be connected to, or throws. Used for database and SMTP hosts,
 * which are then connected to by that IP, so there is no second lookup to race.
 */
export async function resolveSafeHost(host: string, policy: NetPolicy): Promise<Address> {
  const addrs = await checkedAddresses(host, policy);
  return addrs.find((a) => a.family === 4) ?? addrs[0];
}

/** Checks scheme, credentials and the allowed hosts list of a URL (not its addresses). */
export function checkUrl(raw: string, allowedHosts?: string[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new NetBlockedError('not a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new NetBlockedError('only http and https URLs can be called');
  if (url.username || url.password) throw new NetBlockedError('credentials in the URL are not accepted; use the connection auth settings');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!hostMatches(host, allowedHosts)) throw new NetBlockedError(`${host} is not in the connection's allowed hosts`);
  return url;
}

function guardedLookup(policy: NetPolicy): LookupFunction {
  return ((hostname: string, options: { all?: boolean } | number, cb: (...args: unknown[]) => void) => {
    const all = typeof options === 'object' && !!options?.all;
    checkedAddresses(hostname, policy)
      .then((ok) => (all ? cb(null, ok) : cb(null, ok[0].address, ok[0].family)))
      .catch((err) => cb(err));
  }) as unknown as LookupFunction;
}

export interface SafeRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
}

export interface SafeResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
  url: string;
  redirects: number;
  bytes: number;
}

export interface SafeFetchOptions {
  policy: NetPolicy;
  allowedHosts?: string[];
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export const HTTP_TIMEOUT_MS = 15_000;
export const HTTP_MAX_BYTES = 1024 * 1024;
export const HTTP_MAX_REDIRECTS = 3;

/** One HTTP exchange with the guard in the socket lookup. Rejects IP literals that are blocked. */
function once(url: URL, req: SafeRequest, opts: Required<Omit<SafeFetchOptions, 'allowedHosts' | 'maxRedirects'>>, deadline: number): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    // Node does not call `lookup` for an IP literal, so literals are checked here.
    if (isIP(host) && !addressAllowed(host, host, opts.policy)) return reject(new NetBlockedError(`${host} is a private or reserved address; only public addresses can be reached`));
    const lower = host.toLowerCase();
    if ((lower === 'localhost' || lower.endsWith('.localhost')) && !hostAllowlisted(lower, opts.policy)) return reject(new NetBlockedError('local hosts cannot be reached'));
    const mod = url.protocol === 'https:' ? https : http;
    const remaining = Math.max(1, deadline - Date.now());
    const r = mod.request(url, {
      method: req.method ?? 'GET',
      headers: req.headers,
      lookup: guardedLookup(opts.policy),
      timeout: remaining,
      agent: false,
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let truncated = false;
      res.on('data', (c: Buffer) => {
        if (truncated) return;
        if (size + c.length > opts.maxBytes) {
          chunks.push(c.subarray(0, opts.maxBytes - size));
          size = opts.maxBytes;
          truncated = true;
          res.destroy();
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), truncated });
          return;
        }
        chunks.push(c);
        size += c.length;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), truncated }));
      res.on('error', (e) => (truncated ? undefined : reject(e)));
    });
    const timer = setTimeout(() => r.destroy(new Error(`request timed out after ${opts.timeoutMs / 1000} s`)), remaining);
    r.on('timeout', () => r.destroy(new Error(`request timed out after ${opts.timeoutMs / 1000} s`)));
    r.on('error', (e) => { clearTimeout(timer); reject(e); });
    r.on('close', () => clearTimeout(timer));
    if (req.body !== undefined) r.write(req.body);
    r.end();
  });
}

/** Guarded HTTP request with manual, re-checked redirects. */
export async function safeFetch(rawUrl: string, req: SafeRequest, opts: SafeFetchOptions): Promise<SafeResponse> {
  const o = { policy: opts.policy, timeoutMs: opts.timeoutMs ?? HTTP_TIMEOUT_MS, maxBytes: opts.maxBytes ?? HTTP_MAX_BYTES };
  const maxRedirects = opts.maxRedirects ?? HTTP_MAX_REDIRECTS;
  const deadline = Date.now() + o.timeoutMs;
  let url = checkUrl(rawUrl, opts.allowedHosts);
  let current: SafeRequest = req;
  for (let hop = 0; ; hop++) {
    const res = await once(url, current, o, deadline);
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop >= maxRedirects) throw new NetBlockedError(`more than ${maxRedirects} redirects`);
      url = checkUrl(new URL(location, url).toString(), opts.allowedHosts);
      // 303, and 301/302 after a POST, continue as GET without a body (what browsers do).
      const method = (current.method ?? 'GET').toUpperCase();
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
        const headers = { ...(current.headers ?? {}) };
        for (const k of Object.keys(headers)) if (/^content-(type|length)$/i.test(k)) delete headers[k];
        current = { method: 'GET', headers };
      }
      // Never forward credentials to a different host.
      if (new URL(rawUrl).host !== url.host && current.headers) {
        const headers = { ...current.headers };
        for (const k of Object.keys(headers)) if (/^(authorization|cookie|proxy-authorization)$/i.test(k)) delete headers[k];
        current = { ...current, headers };
      }
      continue;
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(', ') : v;
    return { status: res.status, headers, body: res.body.toString('utf8'), truncated: res.truncated, url: url.toString(), redirects: hop, bytes: res.body.length };
  }
}
