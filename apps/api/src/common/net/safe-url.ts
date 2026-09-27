import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Guards outbound requests to customer supplied URLs (webhooks) against reaching the
 * management network, the metadata service or a host's loopback. The check runs when a
 * URL is registered and again right before every delivery, since DNS can change.
 */
const BLOCKED_V4 = [
  ['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['100.64.0.0', 10], ['0.0.0.0', 8], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const;

function v4ToInt(ip: string) {
  return ip.split('.').reduce((n, o) => (n << 8) + Number(o), 0) >>> 0;
}

export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const n = v4ToInt(ip);
    return !BLOCKED_V4.some(([base, bits]) => (n >>> (32 - bits)) === (v4ToInt(base) >>> (32 - bits)));
  }
  if (kind === 6) {
    const v = ip.toLowerCase();
    if (v === '::1' || v === '::' || v.startsWith('fe80:') || v.startsWith('fc') || v.startsWith('fd')) return false;
    if (v.startsWith('::ffff:')) return isPublicAddress(v.slice(7));
    return true;
  }
  return false;
}

/** Throws with a short reason when the URL must not be called from the platform. */
export async function assertSafeUrl(raw: string): Promise<void> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('not a valid URL'); }
  if (url.protocol !== 'https:') throw new Error('only https URLs are accepted');
  if (url.username || url.password) throw new Error('credentials in the URL are not accepted');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) throw new Error('local hosts are not accepted');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error('the host does not resolve');
  if (addrs.some((a) => !isPublicAddress(a.address))) throw new Error('the host resolves to a private address');
}
