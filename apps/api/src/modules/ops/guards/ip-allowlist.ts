import { isIP } from 'node:net';

/**
 * Whether `ip` falls in one of the CIDRs (or equals one of the plain addresses) in `allowlist`.
 * IPv4 and IPv6; an IPv4 mapped IPv6 address (::ffff:1.2.3.4) is compared as IPv4.
 */
export function ipAllowed(ip: string, allowlist: string[]): boolean {
  const addr = normalize(ip);
  if (!addr) return false;
  return allowlist.some((entry) => {
    const [net, bitsRaw] = entry.trim().split('/');
    const base = normalize(net);
    if (!base || base.family !== addr.family) return false;
    const max = addr.family === 4 ? 32 : 128;
    const bits = bitsRaw === undefined ? max : Number(bitsRaw);
    if (!Number.isInteger(bits) || bits < 0 || bits > max) return false;
    const mask = bits === 0 ? 0n : ((1n << BigInt(bits)) - 1n) << BigInt(max - bits);
    return (addr.value & mask) === (base.value & mask);
  });
}

/** True for a valid address or CIDR. */
export function isCidr(entry: string) {
  const [net, bits] = entry.trim().split('/');
  const a = normalize(net);
  if (!a) return false;
  if (bits === undefined) return true;
  const n = Number(bits);
  return Number.isInteger(n) && n >= 0 && n <= (a.family === 4 ? 32 : 128);
}

function normalize(raw: string | undefined): { family: 4 | 6; value: bigint } | null {
  if (!raw) return null;
  let ip = raw.trim();
  if (ip.toLowerCase().startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  const family = isIP(ip);
  if (family === 4) return { family: 4, value: ip.split('.').reduce((acc, o) => (acc << 8n) + BigInt(Number(o)), 0n) };
  if (family === 6) {
    // Expand an embedded dotted IPv4 tail into two hex groups, then the :: shorthand.
    const hex = ip.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/, (_, a, b, c, d) => `${((+a << 8) | +b).toString(16)}:${((+c << 8) | +d).toString(16)}`);
    const [head, tail] = hex.split('::');
    const h = head ? head.split(':') : [];
    const t = tail ? tail.split(':') : [];
    const groups = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
    if (groups.length !== 8) return null;
    return { family: 6, value: groups.reduce((acc, g) => (acc << 16n) + BigInt(parseInt(g || '0', 16)), 0n) };
  }
  return null;
}
