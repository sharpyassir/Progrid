import { createHash, createPublicKey, randomBytes, sign, verify, type KeyObject } from 'node:crypto';
// Copied from apps/api/src/modules/ops/access/ca/openssh.ts so the tests sign and check
// certificates exactly the way the API does.

/**
 * OpenSSH wire format helpers and ed25519 user certificates (PROTOCOL.certkeys), on node:crypto
 * so the platform needs no SSH library. Only ed25519 keys are accepted and issued.
 */

export const ED25519 = 'ssh-ed25519';
export const ED25519_CERT = 'ssh-ed25519-cert-v01@openssh.com';

const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const u64 = (n: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(n);
  return b;
};
export const sshString = (v: Buffer | string) => {
  const b = typeof v === 'string' ? Buffer.from(v, 'utf8') : v;
  return Buffer.concat([u32(b.length), b]);
};

/** Reads the length prefixed fields of an SSH wire buffer. */
export class SshReader {
  private off = 0;
  constructor(private readonly buf: Buffer) {}
  string(): Buffer {
    if (this.off + 4 > this.buf.length) throw new Error('truncated SSH data');
    const n = this.buf.readUInt32BE(this.off);
    this.off += 4;
    if (this.off + n > this.buf.length) throw new Error('truncated SSH data');
    const v = this.buf.subarray(this.off, this.off + n);
    this.off += n;
    return v;
  }
  text() {
    return this.string().toString('utf8');
  }
  uint32() {
    const v = this.buf.readUInt32BE(this.off);
    this.off += 4;
    return v;
  }
  uint64() {
    const v = this.buf.readBigUInt64BE(this.off);
    this.off += 8;
    return v;
  }
  get offset() {
    return this.off;
  }
  get done() {
    return this.off >= this.buf.length;
  }
}

/** Raw 32 byte ed25519 public key from an OpenSSH line ("ssh-ed25519 AAAA... comment"). */
export function parseEd25519PublicKey(line: string): Buffer {
  const [type, b64] = line.trim().split(/\s+/);
  if (type !== ED25519 || !b64) throw new Error('only ssh-ed25519 public keys are accepted');
  const r = new SshReader(Buffer.from(b64, 'base64'));
  if (r.text() !== ED25519) throw new Error('key type does not match');
  const pk = r.string();
  if (pk.length !== 32) throw new Error('bad ed25519 key length');
  return Buffer.from(pk);
}

export const ed25519Blob = (pk: Buffer) => Buffer.concat([sshString(ED25519), sshString(pk)]);

/** OpenSSH line for a raw ed25519 public key. */
export function ed25519Line(pk: Buffer, comment = '') {
  return `${ED25519} ${ed25519Blob(pk).toString('base64')}${comment ? ` ${comment}` : ''}`;
}

/** SHA256 fingerprint as ssh-keygen prints it. */
export function fingerprint(line: string) {
  const b64 = line.trim().split(/\s+/)[1];
  return 'SHA256:' + createHash('sha256').update(Buffer.from(b64, 'base64')).digest('base64').replace(/=+$/, '');
}

/** Raw public key bytes of a node ed25519 KeyObject. */
export function rawEd25519(key: KeyObject): Buffer {
  const jwk = (key.type === 'private' ? createPublicKey(key) : key).export({ format: 'jwk' }) as { x: string };
  return Buffer.from(jwk.x, 'base64url');
}

/** A random uint64 serial (never zero, top bit clear so it prints the same signed and unsigned). */
export function randomSerial(): bigint {
  const v = randomBytes(8).readBigUInt64BE() & 0x7fff_ffff_ffff_ffffn;
  return v === 0n ? 1n : v;
}

export interface CertRequest {
  /** The ed25519 key to certify (OpenSSH line). */
  publicKey: string;
  serial: bigint;
  keyId: string;
  principals: string[];
  validAfter: Date;
  validBefore: Date;
  /** CIDRs the certificate may be used from (critical option source-address). */
  sourceAddresses?: string[];
  /** Extensions granted; default permit-pty only (no agent, port or X11 forwarding). */
  extensions?: string[];
}

/** Signs an OpenSSH ed25519 user certificate with an ed25519 CA key. Returns the certificate line. */
export function signUserCertificate(req: CertRequest, ca: { privateKey: KeyObject }): string {
  const pk = parseEd25519PublicKey(req.publicKey);
  const caPk = rawEd25519(ca.privateKey);
  const options = (pairs: [string, string][]) =>
    Buffer.concat(pairs.sort((a, b) => a[0].localeCompare(b[0])).map(([name, value]) => Buffer.concat([sshString(name), sshString(value ? sshString(value) : Buffer.alloc(0))])));
  const body = Buffer.concat([
    sshString(ED25519_CERT),
    sshString(randomBytes(32)),
    sshString(pk),
    u64(req.serial),
    u32(1), // SSH_CERT_TYPE_USER
    sshString(req.keyId),
    sshString(Buffer.concat(req.principals.map((p) => sshString(p)))),
    u64(BigInt(Math.floor(req.validAfter.getTime() / 1000))),
    u64(BigInt(Math.floor(req.validBefore.getTime() / 1000))),
    sshString(options(req.sourceAddresses?.length ? [['source-address', req.sourceAddresses.join(',')]] : [])),
    sshString(options((req.extensions ?? ['permit-pty']).map((e) => [e, '']))),
    sshString(Buffer.alloc(0)), // reserved
    sshString(ed25519Blob(caPk)),
  ]);
  const sig = sign(null, body, ca.privateKey);
  const cert = Buffer.concat([body, sshString(Buffer.concat([sshString(ED25519), sshString(sig)]))]);
  return `${ED25519_CERT} ${cert.toString('base64')} ${req.keyId}`;
}

export interface ParsedCertificate {
  type: string;
  publicKey: Buffer;
  serial: bigint;
  certType: number;
  keyId: string;
  principals: string[];
  validAfter: Date;
  validBefore: Date;
  criticalOptions: Record<string, string>;
  extensions: string[];
  signatureKey: Buffer;
  /** True when the signature verifies against signatureKey. */
  signatureValid: boolean;
}

/** Parses (and checks the signature of) an ed25519 user certificate line. */
export function parseCertificate(line: string): ParsedCertificate {
  const [, b64] = line.trim().split(/\s+/);
  const raw = Buffer.from(b64, 'base64');
  const r = new SshReader(raw);
  const type = r.text();
  if (type !== ED25519_CERT) throw new Error(`unsupported certificate type ${type}`);
  r.string(); // nonce
  const publicKey = Buffer.from(r.string());
  const serial = r.uint64();
  const certType = r.uint32();
  const keyId = r.text();
  const pr = new SshReader(Buffer.from(r.string()));
  const principals: string[] = [];
  while (!pr.done) principals.push(pr.text());
  const validAfter = new Date(Number(r.uint64()) * 1000);
  const validBefore = new Date(Number(r.uint64()) * 1000);
  const readOptions = (buf: Buffer) => {
    const or = new SshReader(buf);
    const out: Record<string, string> = {};
    while (!or.done) {
      const name = or.text();
      const data = or.string();
      out[name] = data.length ? new SshReader(Buffer.from(data)).text() : '';
    }
    return out;
  };
  const criticalOptions = readOptions(Buffer.from(r.string()));
  const extensions = Object.keys(readOptions(Buffer.from(r.string())));
  r.string(); // reserved
  const signatureKeyBlob = Buffer.from(r.string());
  const signedLength = r.offset;
  const sigBlob = new SshReader(Buffer.from(r.string()));
  sigBlob.text();
  const signature = sigBlob.string();
  const kr = new SshReader(signatureKeyBlob);
  kr.text();
  const signatureKey = Buffer.from(kr.string());
  const caKey = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: signatureKey.toString('base64url') }, format: 'jwk' });
  const signatureValid = verify(null, raw.subarray(0, signedLength), caKey, signature);
  return { type, publicKey, serial, certType, keyId, principals, validAfter, validBefore, criticalOptions, extensions, signatureKey, signatureValid };
}
