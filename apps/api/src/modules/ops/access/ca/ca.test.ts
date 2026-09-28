import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { exportJWK, decodeJwt, decodeProtectedHeader, CompactEncrypt } from 'jose';
import { ED25519_CERT, ed25519Line, fingerprint, parseCertificate, parseEd25519PublicKey, rawEd25519, signUserCertificate } from './openssh';
import { StepCaSshCa } from './ssh-ca';

const gatewayKey = () => ed25519Line(rawEd25519(generateKeyPairSync('ed25519').publicKey), 'gw');

describe('OpenSSH user certificates', () => {
  it('signs an ed25519 user certificate that parses and verifies', () => {
    const ca = generateKeyPairSync('ed25519');
    const pub = gatewayKey();
    const validAfter = new Date('2026-09-28T10:00:00Z');
    const validBefore = new Date('2026-09-28T12:00:00Z');
    const line = signUserCertificate({ publicKey: pub, serial: 123456789n, keyId: 'prgd-session-s1', principals: ['prgd-asset-a1'], validAfter, validBefore, sourceAddresses: ['10.8.0.0/24'] }, { privateKey: ca.privateKey });
    expect(line.startsWith(`${ED25519_CERT} `)).toBe(true);
    const c = parseCertificate(line);
    expect(c).toMatchObject({ serial: 123456789n, certType: 1, keyId: 'prgd-session-s1', principals: ['prgd-asset-a1'], validAfter, validBefore, extensions: ['permit-pty'], criticalOptions: { 'source-address': '10.8.0.0/24' }, signatureValid: true });
    expect(c.publicKey.equals(parseEd25519PublicKey(pub))).toBe(true);
    expect(c.signatureKey.equals(rawEd25519(ca.privateKey))).toBe(true);

    // A certificate changed after signing no longer verifies.
    const raw = Buffer.from(line.split(' ')[1], 'base64');
    raw[raw.length - 100] ^= 0xff;
    expect(parseCertificate(`${ED25519_CERT} ${raw.toString('base64')}`).signatureValid).toBe(false);
  });

  it('accepts ed25519 public keys only and prints ssh-keygen style fingerprints', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 });
    expect(() => parseEd25519PublicKey(`ssh-rsa ${rsa.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')}`)).toThrow('only ssh-ed25519');
    expect(fingerprint(gatewayKey())).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
  });
});

describe('step-ca adapter', () => {
  it('signs through /1.0/ssh/sign with a one time token and revokes by serial', async () => {
    const provisioner = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = { ...(await exportJWK(provisioner.privateKey)), kid: 'kid-1', alg: 'ES256' };
    // The encrypted key form step-ca keeps in ca.json.
    const encrypted = await new CompactEncrypt(new TextEncoder().encode(JSON.stringify(jwk))).setProtectedHeader({ alg: 'PBES2-HS256+A128KW', enc: 'A128GCM', p2c: 1000 }).encrypt(new TextEncoder().encode('provisioner-password'));
    const ca = generateKeyPairSync('ed25519');
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      calls.push({ url, body });
      if (url.endsWith('/1.0/ssh/sign')) {
        const line = signUserCertificate({ publicKey: `ssh-ed25519 ${body.publicKey}`, serial: 42n, keyId: body.keyID, principals: body.principals, validAfter: new Date(body.validAfter), validBefore: new Date(body.validBefore) }, { privateKey: ca.privateKey });
        return new Response(JSON.stringify({ crt: line.split(' ')[1] }), { status: 201 });
      }
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const stepca = new StepCaSshCa({ url: 'https://ca.internal:9000/', provisioner: 'prgd-gateway', jwk: encrypted, password: 'provisioner-password', rootFingerprint: 'abc123' }, fakeFetch);
    const validAfter = new Date(Date.now() - 60_000);
    const validBefore = new Date(Date.now() + 3600_000);
    const line = await stepca.sign({ publicKey: gatewayKey(), serial: 1n, keyId: 'prgd-session-s2', principals: ['prgd-asset-a2'], validAfter, validBefore });
    expect(parseCertificate(line)).toMatchObject({ principals: ['prgd-asset-a2'], keyId: 'prgd-session-s2', signatureValid: true });

    const sign = calls[0];
    expect(sign.url).toBe('https://ca.internal:9000/1.0/ssh/sign');
    expect(sign.body).toMatchObject({ certType: 'user', keyID: 'prgd-session-s2', principals: ['prgd-asset-a2'], validBefore: validBefore.toISOString() });
    const ott = sign.body.ott as string;
    expect(decodeProtectedHeader(ott)).toMatchObject({ alg: 'ES256', kid: 'kid-1' });
    expect(decodeJwt(ott)).toMatchObject({ iss: 'prgd-gateway', sub: 'prgd-session-s2', aud: 'https://ca.internal:9000/1.0/ssh/sign', sha: 'abc123', step: { ssh: { certType: 'user', principals: ['prgd-asset-a2'] } } });

    await stepca.revoke('42', 'ticket_closed');
    expect(calls[1].url).toBe('https://ca.internal:9000/1.0/ssh/revoke');
    expect(calls[1].body).toMatchObject({ serial: '42', passive: true, reason: 'ticket_closed' });
    expect(decodeJwt(calls[1].body.ott as string)).toMatchObject({ sub: '42', aud: 'https://ca.internal:9000/1.0/ssh/revoke' });
  });
});
