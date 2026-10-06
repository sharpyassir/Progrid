import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { loadConfig, type AppConfig } from '../../config/config';

/**
 * Encryption at rest for secrets stored in the database (TOTP seeds, webhook secrets, database
 * passwords, app environments, join tokens...). AES 256 GCM. See docs/security/key-management.md.
 *
 * Formats:
 *  - `enc:v2:<kid>:<iv>:<tag>:<ciphertext>`: the current format. The key is an HKDF-SHA256 sub key
 *    (info "prgd/enc/v2") of the keyring entry <kid>. New values are sealed with the active
 *    (first) key of SECRETS_KEYS, or with SECRETS_KEY as the single key "k1".
 *  - `enc:v1:<iv>:<tag>:<ciphertext>`: the legacy format, keyed with sha256(SECRETS_KEY or, when
 *    unset, JWT_SECRET). Still read; `prisma/reseal.ts` rewrites it to v2.
 *  - anything else is a plain value from before encryption existed and is returned as is.
 *
 * Without any key configured (local development, or a production that has not set one yet) new
 * values are still sealed in the v1 format with the legacy key, so nothing changes for them.
 */
const V1 = 'enc:v1:';
const V2 = 'enc:v2:';

export interface RingKey {
  kid: string;
  enc: Buffer;
  mac: Buffer;
}

export interface Keyring {
  /** Key new values are sealed with; undefined means legacy v1 sealing. */
  active?: RingKey;
  keys: Map<string, RingKey>;
  /** sha256 of SECRETS_LEGACY_KEY ?? SECRETS_KEY ?? JWT_SECRET: v1 values and keyedHash. */
  legacy: Buffer;
}

/** A key from configuration: 64 hex characters, base64 of 32 or more bytes, or a plain string. */
export function parseKeyMaterial(raw: string): Buffer {
  const v = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(v)) return Buffer.from(v, 'hex');
  if (/^[A-Za-z0-9+/_-]{43,}={0,2}$/.test(v)) {
    const b = Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (b.length >= 32) return b;
  }
  return Buffer.from(v, 'utf8');
}

/** "kid1:material,kid2:material" into ordered entries. Throws on a malformed entry. */
export function parseKeyList(list: string): { kid: string; material: string }[] {
  const out: { kid: string; material: string }[] = [];
  for (const part of list.split(',').map((p) => p.trim()).filter(Boolean)) {
    const i = part.indexOf(':');
    const kid = i > 0 ? part.slice(0, i).trim() : '';
    const material = i > 0 ? part.slice(i + 1).trim() : '';
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(kid) || !material) throw new Error('SECRETS_KEYS takes "kid:key" entries separated by commas (kid: letters, digits, _ or -)');
    if (out.some((o) => o.kid === kid)) throw new Error(`SECRETS_KEYS names the key id "${kid}" twice`);
    out.push({ kid, material });
  }
  return out;
}

function ringKey(kid: string, material: string): RingKey {
  const ikm = parseKeyMaterial(material);
  const sub = (info: string) => Buffer.from(hkdfSync('sha256', ikm, Buffer.alloc(0), info, 32));
  return { kid, enc: sub('prgd/enc/v2'), mac: sub('prgd/hmac/v2') };
}

export type KeyConfig = Pick<AppConfig, 'JWT_SECRET'> & { SECRETS_KEY?: string; SECRETS_KEYS?: string; SECRETS_LEGACY_KEY?: string };

export function buildKeyring(c: KeyConfig): Keyring {
  const entries = c.SECRETS_KEYS ? parseKeyList(c.SECRETS_KEYS) : c.SECRETS_KEY ? [{ kid: 'k1', material: c.SECRETS_KEY }] : [];
  const keys = new Map(entries.map((e) => [e.kid, ringKey(e.kid, e.material)] as const));
  return {
    active: entries.length ? keys.get(entries[0].kid) : undefined,
    keys,
    legacy: createHash('sha256').update(c.SECRETS_LEGACY_KEY || c.SECRETS_KEY || c.JWT_SECRET).digest(),
  };
}

let cached: { cfg: AppConfig; ring: Keyring } | undefined;
let warned = false;

/** The keyring of the running process (rebuilt when the configuration object changes). */
export function keyring(): Keyring {
  const cfg = loadConfig();
  if (cached?.cfg !== cfg) {
    cached = { cfg, ring: buildKeyring(cfg) };
    if (!cached.ring.active && cfg.NODE_ENV === 'production' && !warned) {
      warned = true;
      new Logger('secretbox').error(
        'SECURITY: neither SECRETS_KEYS nor SECRETS_KEY is set in production. Secrets at rest are sealed with a key derived from JWT_SECRET (legacy v1). ' +
          'Set SECRETS_KEYS and run prisma/reseal.ts (docs/security/key-management.md).',
      );
    }
  }
  return cached.ring;
}

function gcm(key: Buffer, plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ct.toString('base64url')}`;
}

function ungcm(key: Buffer, iv: string | undefined, tag: string | undefined, ct: string | undefined) {
  if (iv === undefined || tag === undefined || ct === undefined) throw new Error('malformed sealed value');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

export function sealWith(ring: Keyring, plain: string): string {
  if (!ring.active) return `${V1}${gcm(ring.legacy, plain)}`;
  return `${V2}${ring.active.kid}:${gcm(ring.active.enc, plain)}`;
}

export function openWith(ring: Keyring, stored: string): string {
  if (stored.startsWith(V2)) {
    const [kid, iv, tag, ct] = stored.slice(V2.length).split(':');
    const k = ring.keys.get(kid);
    if (!k) throw new Error(`value sealed with key "${kid}", which is not in SECRETS_KEYS`);
    return ungcm(k.enc, iv, tag, ct);
  }
  if (stored.startsWith(V1)) {
    const [iv, tag, ct] = stored.slice(V1.length).split(':');
    return ungcm(ring.legacy, iv, tag, ct);
  }
  return stored;
}

export function seal(plain: string): string {
  return sealWith(keyring(), plain);
}

/** Opens a sealed value; values without the enc: prefix (stored before encryption) pass through. */
export function open(stored: string): string {
  return openWith(keyring(), stored);
}

/** Null safe seal and open for optional columns (empty strings stay empty). */
export function sealOpt<T extends string | null | undefined>(v: T): T {
  return (typeof v === 'string' && v !== '' ? seal(v) : v) as T;
}
export function openOpt<T extends string | null | undefined>(v: T): T {
  return (typeof v === 'string' ? open(v) : v) as T;
}

export const isSealed = (v: string) => v.startsWith(V1) || v.startsWith(V2);

/** True when the value is sealed with the active key (nothing for reseal to do). */
export function isCurrent(v: string, ring = keyring()): boolean {
  return ring.active ? v.startsWith(`${V2}${ring.active.kid}:`) : v.startsWith(V1);
}

/**
 * Environment maps (app and deploy envVars, Json columns) are stored as {"enc": "<sealed JSON>"}
 * so the column type stays Json. Plain maps from before are read as is.
 */
export function sealJson(map: Record<string, string> | null | undefined): { enc: string } {
  return { enc: seal(JSON.stringify(map ?? {})) };
}

export function isSealedJson(stored: unknown): stored is { enc: string } {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return false;
  const enc = (stored as { enc?: unknown }).enc;
  return typeof enc === 'string' && isSealed(enc) && Object.keys(stored).length === 1;
}

export function openJson(stored: unknown): Record<string, string> {
  if (isSealedJson(stored)) return JSON.parse(open(stored.enc)) as Record<string, string>;
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) return stored as Record<string, string>;
  return {};
}

/**
 * A keyed hash for values we compare but should not keep in clear (visitor addresses, card
 * fingerprints). It stays on the legacy key on purpose: the results are persisted and looked up
 * (affiliate click dedupe per day, card fingerprints matched across teams), so a new key would
 * silently break those matches. Pin SECRETS_LEGACY_KEY before rotating JWT_SECRET to keep it stable.
 */
export function keyedHash(value: string, purpose: string): string {
  return createHmac('sha256', keyring().legacy).update(`${purpose}:${value}`).digest('base64url').slice(0, 32);
}
export const keyedHashLegacy = keyedHash;

/** Keyed hash on the HKDF sub key of the active key, for new uses that are not looked up across rotations. */
export function keyedHashV2(value: string, purpose: string): string {
  const ring = keyring();
  return createHmac('sha256', ring.active?.mac ?? ring.legacy).update(`${purpose}:${value}`).digest('base64url').slice(0, 32);
}
