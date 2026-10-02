import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { loadConfig } from '../../config/config';

/**
 * Encryption at rest for small secrets stored in the database (TOTP seeds, webhook secrets).
 * AES 256 GCM with a key derived from SECRETS_KEY (or, when unset, from JWT_SECRET so local
 * development needs no extra setting). Values are stored as `enc:v1:<iv>:<tag>:<ciphertext>`,
 * all base64url. Plain values from before encryption existed are still read as is.
 */
const PREFIX = 'enc:v1:';

function key(): Buffer {
  const c = loadConfig();
  return createHash('sha256').update(c.SECRETS_KEY || c.JWT_SECRET).digest();
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${ct.toString('base64url')}`;
}

export function open(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const [iv, tag, ct] = stored.slice(PREFIX.length).split(':');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

export const isSealed = (v: string) => v.startsWith(PREFIX);

/** A keyed hash for values we compare but should not keep in clear (visitor addresses). */
export function keyedHash(value: string, purpose: string): string {
  return createHmac('sha256', key()).update(`${purpose}:${value}`).digest('base64url').slice(0, 32);
}
