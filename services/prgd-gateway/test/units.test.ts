import { createHmac, generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { HostKeyVerifier, parseKnownHosts } from '../src/host-keys';
import { Redactor, SudoResponder } from '../src/secrets';
import { generateEphemeralKey, certificateBlob } from '../src/ssh-keys';
import { randomSerial, signUserCertificate, parseCertificate } from './helpers/openssh';

const b = (s: string) => Buffer.from(s);

describe('Redactor', () => {
  it('replaces a secret split across chunks and holds back only a possible prefix', () => {
    const r = new Redactor(['hunter22']);
    const out = [r.push(b('pass: hun')), r.push(b('ter22 ok')), r.flush()].map(String).join('');
    expect(out).toBe('pass: ******** ok');
  });

  it('passes output through untouched without secrets and ignores very short values', () => {
    expect(String(new Redactor([]).push(b('abc')))).toBe('abc');
    const r = new Redactor(['ab']);
    expect(r.active).toBe(false);
    expect(String(r.push(b('abab')))).toBe('abab');
  });

  it('never releases a whole secret, whatever the chunking', () => {
    const secret = 'S3cr3t-sudo-pw!';
    const text = `x${secret}y${secret}${secret}z`;
    for (let size = 1; size <= text.length; size++) {
      const r = new Redactor([secret]);
      let out = '';
      for (let i = 0; i < text.length; i += size) out += r.push(b(text.slice(i, i + size))).toString();
      out += r.flush().toString();
      expect(out).toBe('x********y****************z');
    }
  });
});

describe('SudoResponder', () => {
  it('answers the prompt for the login user once per prompt', () => {
    const s = new SudoResponder('prgd', 'pw');
    expect(s.observe(b('$ sudo ls\r\n'))).toEqual({ type: 'none' });
    expect(s.observe(b('[sudo] password for prgd: '))).toEqual({ type: 'inject', value: 'pw' });
    expect(s.observe(b('\r\n'))).toEqual({ type: 'none' });
    expect(s.observe(b('file\r\n$ '))).toEqual({ type: 'none' });
    expect(s.observe(b('\x1b[1m[sudo] password for prgd: \x1b[0m'))).toEqual({ type: 'inject', value: 'pw' });
  });

  it('ignores prompts for other users, prompts in the middle of output, and has nothing to say without a password', () => {
    const s = new SudoResponder('prgd', 'pw');
    expect(s.observe(b('[sudo] password for root: '))).toEqual({ type: 'none' });
    expect(s.observe(b('[sudo] password for prgd: and more text\r\n'))).toEqual({ type: 'none' });
    expect(new SudoResponder('prgd', undefined).observe(b('[sudo] password for prgd: '))).toEqual({ type: 'none' });
  });

  it('gives up after sudo refuses the stored password', () => {
    const s = new SudoResponder('prgd', 'pw');
    expect(s.observe(b('[sudo] password for prgd: ')).type).toBe('inject');
    expect(s.observe(b('\r\nSorry, try again.\r\n[sudo] password for prgd: '))).toEqual({ type: 'give_up' });
    expect(s.observe(b('[sudo] password for prgd: '))).toEqual({ type: 'none' });
    expect(s.enabled).toBe(false);
  });
});

describe('known_hosts', () => {
  const key = (seed: string) => Buffer.concat([Buffer.from([0, 0, 0, 11]), Buffer.from('ssh-ed25519'), Buffer.from([0, 0, 0, 32]), Buffer.alloc(32, seed)]);
  const line = (hosts: string, k: Buffer, marker = '') => `${marker ? marker + ' ' : ''}${hosts} ssh-ed25519 ${k.toString('base64')}`;
  const file = (text: string) => {
    const p = join(mkdtempSync(join(tmpdir(), 'prgd-kh-')), 'known_hosts');
    writeFileSync(p, text);
    return p;
  };

  it('matches plain, bracketed port, wildcard, negated and hashed entries', () => {
    const k1 = key('a');
    const k2 = key('b');
    const salt = randomBytes(20);
    const hashed = `|1|${salt.toString('base64')}|${createHmac('sha1', salt).update('10.8.0.9').digest('base64')}`;
    const v = new HostKeyVerifier(
      file([line('10.8.0.70', k1), line('[10.8.0.71]:2222', k1), line('10.9.*,!10.9.0.66', k2), line(hashed, k2), line('10.8.0.72', k2, '@revoked'), line('10.8.0.72', k2)].join('\n')),
    );
    expect(v.enforcing).toBe(true);
    expect(v.check('a1', '10.8.0.70', 22, k1)).toEqual({ ok: true, firstUse: false });
    expect(v.check('a1', '10.8.0.70', 22, k2)).toEqual({ ok: false, reason: 'host_key_mismatch' });
    expect(v.check('a2', '10.8.0.71', 2222, k1).ok).toBe(true);
    expect(v.check('a2', '10.8.0.71', 22, k1)).toEqual({ ok: false, reason: 'host_key_unknown' });
    expect(v.check('a3', '10.9.3.4', 22, k2).ok).toBe(true);
    expect(v.check('a3', '10.9.0.66', 22, k2)).toEqual({ ok: false, reason: 'host_key_unknown' });
    expect(v.check('a4', '10.8.0.9', 22, k2).ok).toBe(true);
    expect(v.check('a5', '10.8.0.72', 22, k2)).toEqual({ ok: false, reason: 'host_key_revoked' });
  });

  it('pins on first use without a file', () => {
    const v = new HostKeyVerifier();
    expect(v.enforcing).toBe(false);
    expect(v.check('asset1', '10.8.0.70', 22, key('a'))).toEqual({ ok: true, firstUse: true });
    expect(v.check('asset1', '10.8.0.70', 22, key('a'))).toEqual({ ok: true, firstUse: false });
    expect(v.check('asset1', '10.8.0.99', 22, key('b'))).toEqual({ ok: false, reason: 'host_key_mismatch' });
    expect(v.check('asset2', '10.8.0.70', 22, key('b'))).toEqual({ ok: false, reason: 'host_key_mismatch' });
  });

  it('skips comments and blank lines', () => {
    expect(parseKnownHosts('# c\n\n' + line('h', key('a')))).toHaveLength(1);
  });
});

describe('session keys', () => {
  it('generates an in memory ed25519 key whose certificate the API can sign', () => {
    const k = generateEphemeralKey('gw');
    expect(k.publicLine).toMatch(/^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI\S+ gw$/);
    const ca = { privateKey: generateKeyPairSync('ed25519').privateKey };
    const cert = signUserCertificate({ publicKey: k.publicLine, serial: randomSerial(), keyId: 'prgd-session-x', principals: ['prgd-asset-a'], validAfter: new Date(), validBefore: new Date(Date.now() + 60_000) }, ca);
    expect(parseCertificate(cert).signatureValid).toBe(true);
    expect(certificateBlob(cert, k).length).toBeGreaterThan(100);
    expect(() => certificateBlob(cert, generateEphemeralKey())).toThrow(/not for this session key/);
    expect(() => certificateBlob(k.publicLine, k)).toThrow(/unsupported certificate type/);
  });
});

describe('config', () => {
  it('has the documented defaults', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ apiUrl: 'http://api:4000', port: 4100, allowedOrigins: ['https://ops.progrid.sa'], maxSessions: 50, authTimeoutSeconds: 5, keepaliveSeconds: 25, heartbeatSeconds: 30, expiryNoticeSeconds: [300, 60], knownHostsFile: '' });
    expect(c.gatewayId.length).toBeGreaterThan(0);
    expect(loadConfig({ PRGD_API_URL: 'http://x:1/', PRGD_GATEWAY_ALLOWED_ORIGINS: 'https://a/, https://b' })).toMatchObject({ apiUrl: 'http://x:1', allowedOrigins: ['https://a', 'https://b'] });
  });
});
