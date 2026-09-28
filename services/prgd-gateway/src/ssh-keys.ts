import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

/**
 * Ephemeral ed25519 keys and the OpenSSH wire format bits the gateway needs. The private key is
 * a node KeyObject that lives only in memory for one session; it is never exported or written.
 */

export const ED25519 = 'ssh-ed25519';
export const ED25519_CERT = 'ssh-ed25519-cert-v01@openssh.com';

export const sshString = (v: Buffer | string) => {
  const b = typeof v === 'string' ? Buffer.from(v, 'utf8') : v;
  const len = Buffer.alloc(4);
  len.writeUInt32BE(b.length);
  return Buffer.concat([len, b]);
};

/** Reads length prefixed SSH strings. */
export function readSshString(buf: Buffer, off: number): [Buffer, number] {
  if (off + 4 > buf.length) throw new Error('truncated SSH data');
  const n = buf.readUInt32BE(off);
  if (off + 4 + n > buf.length) throw new Error('truncated SSH data');
  return [buf.subarray(off + 4, off + 4 + n), off + 4 + n];
}

export interface EphemeralKey {
  privateKey: KeyObject;
  /** Raw 32 byte public key. */
  raw: Buffer;
  /** OpenSSH public key line, "ssh-ed25519 AAAA... comment". */
  publicLine: string;
  sign(data: Buffer): Buffer;
}

export function generateEphemeralKey(comment = 'prgd-gateway'): EphemeralKey {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  const raw = Buffer.from(jwk.x, 'base64url');
  const blob = Buffer.concat([sshString(ED25519), sshString(raw)]);
  return {
    privateKey,
    raw,
    publicLine: `${ED25519} ${blob.toString('base64')} ${comment}`,
    sign: (data: Buffer) => sign(null, data, privateKey),
  };
}

/** The binary blob of an OpenSSH certificate line, after checking it certifies `key`. */
export function certificateBlob(certLine: string, key: EphemeralKey): Buffer {
  const [type, b64] = certLine.trim().split(/\s+/);
  if (type !== ED25519_CERT || !b64) throw new Error(`unsupported certificate type ${type}`);
  const blob = Buffer.from(b64, 'base64');
  let off = 0;
  let v: Buffer;
  [v, off] = readSshString(blob, off);
  if (v.toString() !== ED25519_CERT) throw new Error('certificate type does not match');
  [, off] = readSshString(blob, off); // nonce
  [v, off] = readSshString(blob, off);
  if (!v.equals(key.raw)) throw new Error('the certificate is not for this session key');
  return blob;
}

/** SHA256 fingerprint of a public key blob, as ssh-keygen -l prints it. */
export function fingerprintBlob(blob: Buffer) {
  return 'SHA256:' + createHash('sha256').update(blob).digest('base64').replace(/=+$/, '');
}

/** The key type name inside a public key blob. */
export function blobType(blob: Buffer) {
  return readSshString(blob, 0)[0].toString('utf8');
}
