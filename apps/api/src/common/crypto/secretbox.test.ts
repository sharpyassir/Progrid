import { describe, expect, it } from 'vitest';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { buildKeyring, isCurrent, isSealed, openWith, parseKeyList, parseKeyMaterial, sealWith } from './secretbox';

const JWT = 'jwt-secret-for-unit-tests-0123456789';

/** The v1 format exactly as the code before key rotation wrote it. */
function legacySeal(material: string, plain: string) {
  const key = createHash('sha256').update(material).digest();
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `enc:v1:${iv.toString('base64url')}:${c.getAuthTag().toString('base64url')}:${ct.toString('base64url')}`;
}

describe('secretbox keyring', () => {
  it('opens legacy v1 values sealed with sha256(JWT_SECRET) and with sha256(SECRETS_KEY)', () => {
    const fromJwt = legacySeal(JWT, 'totp-seed');
    expect(openWith(buildKeyring({ JWT_SECRET: JWT }), fromJwt)).toBe('totp-seed');
    // Adding a keyring later keeps reading them (legacy stays sha256(SECRETS_KEY ?? JWT_SECRET)).
    expect(openWith(buildKeyring({ JWT_SECRET: JWT, SECRETS_KEYS: `k1:${randomBytes(32).toString('base64')}` }), fromJwt)).toBe('totp-seed');
    const sk = 'secrets-key-material-0123456789abcdef';
    expect(openWith(buildKeyring({ JWT_SECRET: JWT, SECRETS_KEY: sk }), legacySeal(sk, 'x'))).toBe('x');
    // SECRETS_LEGACY_KEY pins the legacy key so JWT_SECRET can rotate.
    expect(openWith(buildKeyring({ JWT_SECRET: 'a-new-jwt-secret-0123456789abcdef', SECRETS_LEGACY_KEY: JWT }), fromJwt)).toBe('totp-seed');
  });

  it('seals v1 without a keyring and v2 with the active kid; round trips', () => {
    const none = buildKeyring({ JWT_SECRET: JWT });
    const v1 = sealWith(none, 'hello');
    expect(v1.startsWith('enc:v1:')).toBe(true);
    expect(openWith(none, v1)).toBe('hello');

    const ring = buildKeyring({ JWT_SECRET: JWT, SECRETS_KEYS: `k2:${randomBytes(32).toString('base64')}` });
    const v2 = sealWith(ring, 'héllo wörld');
    expect(v2.startsWith('enc:v2:k2:')).toBe(true);
    expect(isSealed(v2)).toBe(true);
    expect(isCurrent(v2, ring)).toBe(true);
    expect(openWith(ring, v2)).toBe('héllo wörld');
    // Plain values from before encryption pass through.
    expect(openWith(ring, 'plain-text')).toBe('plain-text');
  });

  it('SECRETS_KEY alone is the single key k1', () => {
    const ring = buildKeyring({ JWT_SECRET: JWT, SECRETS_KEY: 'secrets-key-material-0123456789abcdef' });
    expect(sealWith(ring, 'x').startsWith('enc:v2:k1:')).toBe(true);
  });

  it('rotates: values of an older kid open while the new kid seals; a removed kid fails loudly', () => {
    const k1 = randomBytes(32).toString('base64');
    const k2 = randomBytes(32).toString('hex');
    const before = buildKeyring({ JWT_SECRET: JWT, SECRETS_KEYS: `k1:${k1}` });
    const old = sealWith(before, 'secret');
    const after = buildKeyring({ JWT_SECRET: JWT, SECRETS_KEYS: `k2:${k2},k1:${k1}` });
    expect(openWith(after, old)).toBe('secret');
    expect(isCurrent(old, after)).toBe(false);
    const resealed = sealWith(after, openWith(after, old));
    expect(resealed.startsWith('enc:v2:k2:')).toBe(true);
    const dropped = buildKeyring({ JWT_SECRET: JWT, SECRETS_KEYS: `k2:${k2}` });
    expect(openWith(dropped, resealed)).toBe('secret');
    expect(() => openWith(dropped, old)).toThrow(/k1/);
  });

  it('detects tampering', () => {
    const ring = buildKeyring({ JWT_SECRET: JWT, SECRETS_KEYS: `k1:${randomBytes(32).toString('base64')}` });
    const v = sealWith(ring, 'secret');
    const parts = v.split(':');
    parts[5] = Buffer.from('other!').toString('base64url');
    expect(() => openWith(ring, parts.join(':'))).toThrow();
  });

  it('parses key material and lists', () => {
    expect(parseKeyMaterial('a'.repeat(64)).length).toBe(32);
    expect(parseKeyMaterial(randomBytes(32).toString('base64')).length).toBe(32);
    expect(parseKeyMaterial('short string').toString()).toBe('short string');
    expect(parseKeyList('a:x, b:y')).toEqual([{ kid: 'a', material: 'x' }, { kid: 'b', material: 'y' }]);
    expect(() => parseKeyList('nokid')).toThrow();
    expect(() => parseKeyList('a:x,a:y')).toThrow(/twice/);
  });
});
