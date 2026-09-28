import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

export type HostKeyDecision =
  | { ok: true; firstUse: boolean }
  | { ok: false; reason: 'host_key_mismatch' | 'host_key_unknown' | 'host_key_revoked' };

interface KnownHostLine {
  marker: '' | '@revoked' | '@cert-authority';
  patterns: string[];
  blob: Buffer;
}

/** The name known_hosts uses for a host and port: "host", or "[host]:port" off port 22. */
export const knownHostsName = (host: string, port: number) => (port === 22 ? host : `[${host}]:${port}`);

function globToRegExp(glob: string) {
  return new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
}

function patternMatches(pattern: string, name: string) {
  if (pattern.startsWith('|1|')) {
    const [, , salt, hash] = pattern.split('|');
    if (!salt || !hash) return false;
    return createHmac('sha1', Buffer.from(salt, 'base64')).update(name).digest('base64') === hash;
  }
  return globToRegExp(pattern).test(name);
}

function hostMatches(patterns: string[], name: string) {
  let hit = false;
  for (const p of patterns) {
    const negated = p.startsWith('!');
    if (patternMatches(negated ? p.slice(1) : p, name)) {
      if (negated) return false;
      hit = true;
    }
  }
  return hit;
}

export function parseKnownHosts(text: string): KnownHostLine[] {
  const out: KnownHostLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    let marker: KnownHostLine['marker'] = '';
    if (parts[0] === '@revoked' || parts[0] === '@cert-authority') marker = parts.shift() as KnownHostLine['marker'];
    const [hosts, , b64] = parts;
    if (!hosts || !b64) continue;
    out.push({ marker, patterns: hosts.split(','), blob: Buffer.from(b64, 'base64') });
  }
  return out;
}

/**
 * Host key checks. With a known_hosts file (PRGD_GATEWAY_KNOWN_HOSTS) a host must be listed with
 * the key it presents. Without one the first key an asset presents is trusted and pinned in memory
 * for the life of the process (trust on first use), and every later session to that asset must
 * see the same key (restart the gateway to forget pins after a rebuild). Pins are per asset id and also per address, so an address reused by another
 * asset is not trusted blindly either.
 */
export class HostKeyVerifier {
  private readonly pins = new Map<string, Buffer>();
  private lines: KnownHostLine[] | null = null;

  constructor(private readonly knownHostsFile = '') {
    if (knownHostsFile) this.lines = parseKnownHosts(readFileSync(knownHostsFile, 'utf8'));
  }

  get enforcing() {
    return this.lines !== null;
  }

  /** Rereads the known_hosts file (SIGHUP). */
  reload() {
    if (this.knownHostsFile) this.lines = parseKnownHosts(readFileSync(this.knownHostsFile, 'utf8'));
  }

  check(assetId: string, host: string, port: number, blob: Buffer): HostKeyDecision {
    const name = knownHostsName(host, port);
    if (this.lines) {
      const matching = this.lines.filter((l) => hostMatches(l.patterns, name) || (port === 22 && hostMatches(l.patterns, `[${host}]:22`)));
      if (matching.some((l) => l.marker === '@revoked' && l.blob.equals(blob))) return { ok: false, reason: 'host_key_revoked' };
      const plain = matching.filter((l) => l.marker === '');
      if (plain.some((l) => l.blob.equals(blob))) return { ok: true, firstUse: false };
      return { ok: false, reason: plain.length ? 'host_key_mismatch' : 'host_key_unknown' };
    }
    const keys = [`asset:${assetId}`, `addr:${name}`];
    for (const k of keys) {
      const pinned = this.pins.get(k);
      if (pinned && !pinned.equals(blob)) return { ok: false, reason: 'host_key_mismatch' };
    }
    const firstUse = !this.pins.has(keys[0]);
    for (const k of keys) this.pins.set(k, Buffer.from(blob));
    return { ok: true, firstUse };
  }
}
