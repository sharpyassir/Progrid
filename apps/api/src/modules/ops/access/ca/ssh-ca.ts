import { createPrivateKey, generateKeyPairSync, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { SignJWT, compactDecrypt, importJWK, type JWK } from 'jose';
import { open, seal } from '../../../../common/crypto/secretbox';
import { loadConfig } from '../../../../config/config';
import { ED25519_CERT, SshReader, ed25519Line, parseEd25519PublicKey, rawEd25519, signUserCertificate } from './openssh';

export interface SignRequest {
  /** OpenSSH ed25519 public key line of the key to certify (the gateway's ephemeral key). */
  publicKey: string;
  serial: bigint;
  keyId: string;
  principals: string[];
  validAfter: Date;
  validBefore: Date;
}

/**
 * Issues short lived SSH user certificates. Private keys never reach the API: the gateway sends
 * the public half of its per session key and gets the certificate back (docs/devops-console.md).
 */
export interface SshCertificateAuthority {
  readonly name: 'local' | 'step-ca';
  /** Returns the certificate as an OpenSSH line ("ssh-ed25519-cert-v01@openssh.com AAAA... keyId"). */
  sign(req: SignRequest): Promise<string>;
  /** Revokes a certificate by serial. Certificates are short lived; this is defense in depth. */
  revoke(serial: string, reason: string): Promise<void>;
  /** The CA public key hosts trust (sshd TrustedUserCAKeys). */
  publicKey(): Promise<string>;
}

/**
 * Development and tests (PRGD_SSH_CA=local): an ed25519 CA key generated on first use and stored
 * in prgd_ssh_ca_keys, sealed with the secretbox key. Revocation is recorded on the certificate
 * rows only (hosts would need a KRL; use step-ca in production).
 */
export class LocalSshCa implements SshCertificateAuthority {
  readonly name = 'local' as const;
  private key?: { privateKey: ReturnType<typeof createPrivateKey>; line: string };
  constructor(private readonly prisma: Pick<PrismaClient, 'sshCaKey'>) {}

  private async load() {
    if (this.key) return this.key;
    let row = await this.prisma.sshCaKey.findUnique({ where: { name: 'local' } });
    if (!row) {
      const { privateKey } = generateKeyPairSync('ed25519');
      const line = ed25519Line(rawEd25519(privateKey), 'prgd-local-ca');
      try {
        row = await this.prisma.sshCaKey.create({ data: { name: 'local', publicKey: line, privateKey: seal(privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()) } });
      } catch (e) {
        // Another process created it first.
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
        row = await this.prisma.sshCaKey.findUniqueOrThrow({ where: { name: 'local' } });
      }
    }
    this.key = { privateKey: createPrivateKey(open(row.privateKey)), line: row.publicKey };
    return this.key;
  }

  async sign(req: SignRequest) {
    const { privateKey } = await this.load();
    return signUserCertificate({ ...req, sourceAddresses: sourceAddresses() }, { privateKey });
  }

  async revoke() {
    // Nothing to call: the certificate row carries revokedAt.
  }

  async publicKey() {
    return (await this.load()).line;
  }
}

type Fetch = typeof fetch;

/**
 * Smallstep step-ca (PRGD_SSH_CA=step-ca): signs through POST /1.0/ssh/sign with a one time token
 * from a JWK provisioner, and revokes through POST /1.0/ssh/revoke. PRGD_STEPCA_JWK is the
 * provisioner's private JWK, either as JSON or as the encrypted key from ca.json (a compact JWE)
 * with PRGD_STEPCA_PASSWORD. Point NODE_EXTRA_CA_CERTS at the step root certificate so TLS verifies.
 */
export class StepCaSshCa implements SshCertificateAuthority {
  readonly name = 'step-ca' as const;
  private jwk?: JWK;
  constructor(
    private readonly cfg: { url: string; provisioner: string; jwk: string; password?: string; rootFingerprint?: string },
    private readonly http: Fetch = fetch,
  ) {}

  private async key(): Promise<JWK> {
    if (this.jwk) return this.jwk;
    let text = this.cfg.jwk.trim();
    if (!text.startsWith('{')) {
      if (!this.cfg.password) throw new Error('PRGD_STEPCA_PASSWORD is required to decrypt the provisioner key');
      // step-ca encrypts provisioner keys with a password (PBES2), which jose accepts only when asked to.
      const { plaintext } = await compactDecrypt(text, new TextEncoder().encode(this.cfg.password), { keyManagementAlgorithms: ['PBES2-HS256+A128KW', 'PBES2-HS384+A192KW', 'PBES2-HS512+A256KW'] });
      text = new TextDecoder().decode(plaintext);
    }
    this.jwk = JSON.parse(text) as JWK;
    return this.jwk;
  }

  /** One time token for one request (aud is the endpoint, like `step ssh certificate` makes). */
  async token(path: string, subject: string, extra: Record<string, unknown> = {}) {
    const jwk = await this.key();
    const alg = jwk.alg ?? (jwk.kty === 'OKP' ? 'EdDSA' : 'ES256');
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ ...extra, ...(this.cfg.rootFingerprint ? { sha: this.cfg.rootFingerprint } : {}) })
      .setProtectedHeader({ alg, kid: jwk.kid, typ: 'JWT' })
      .setIssuer(this.cfg.provisioner)
      .setSubject(subject)
      .setAudience(`${this.base()}${path}`)
      .setIssuedAt(now)
      .setNotBefore(now - 30)
      .setExpirationTime(now + 300)
      .setJti(randomUUID())
      .sign(await importJWK(jwk, alg));
  }

  async sign(req: SignRequest) {
    parseEd25519PublicKey(req.publicKey);
    const validAfter = req.validAfter.toISOString();
    const validBefore = req.validBefore.toISOString();
    const ott = await this.token('/1.0/ssh/sign', req.keyId, { step: { ssh: { certType: 'user', keyID: req.keyId, principals: req.principals, validAfter, validBefore } } });
    const body = { publicKey: req.publicKey.trim().split(/\s+/)[1], ott, certType: 'user', keyID: req.keyId, principals: req.principals, validAfter, validBefore };
    const r = await this.http(`${this.base()}/1.0/ssh/sign`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    const text = await r.text();
    if (!r.ok) throw new Error(`step-ca sign: ${r.status} ${text.slice(0, 300)}`);
    const crt = (JSON.parse(text) as { crt?: string }).crt;
    if (!crt) throw new Error('step-ca sign: no certificate in the response');
    const type = new SshReader(Buffer.from(crt, 'base64')).text();
    if (type !== ED25519_CERT) throw new Error(`step-ca sign: unexpected certificate type ${type}`);
    return `${type} ${crt} ${req.keyId}`;
  }

  async revoke(serial: string, reason: string) {
    const ott = await this.token('/1.0/ssh/revoke', serial);
    const r = await this.http(`${this.base()}/1.0/ssh/revoke`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ serial, ott, reasonCode: 0, reason: reason.slice(0, 200), passive: true }), signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`step-ca revoke: ${r.status} ${(await r.text()).slice(0, 300)}`);
  }

  /** GET /ssh/roots answers the user CA keys as base64 wire format keys. */
  async publicKey() {
    const r = await this.http(`${this.base()}/ssh/roots`, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`step-ca roots: ${r.status}`);
    const k = ((await r.json()) as { userKey?: string[] }).userKey?.[0];
    if (!k) throw new Error('step-ca has no SSH user key');
    return `${new SshReader(Buffer.from(k, 'base64')).text()} ${k} step-ca`;
  }

  private base() {
    return this.cfg.url.replace(/\/$/, '');
  }
}

/** CIDRs the gateway connects from; certificates are only usable from there when set. */
function sourceAddresses() {
  const v = loadConfig().PRGD_GATEWAY_SOURCE_ADDRESSES;
  return v ? v.split(',').map((x) => x.trim()).filter(Boolean) : undefined;
}

export function createSshCa(prisma: Pick<PrismaClient, 'sshCaKey'>): SshCertificateAuthority {
  const c = loadConfig();
  if (c.PRGD_SSH_CA === 'step-ca') {
    if (!c.PRGD_STEPCA_URL || !c.PRGD_STEPCA_PROVISIONER || !c.PRGD_STEPCA_JWK) throw new Error('PRGD_STEPCA_URL, PRGD_STEPCA_PROVISIONER and PRGD_STEPCA_JWK are required when PRGD_SSH_CA=step-ca');
    return new StepCaSshCa({ url: c.PRGD_STEPCA_URL, provisioner: c.PRGD_STEPCA_PROVISIONER, jwk: c.PRGD_STEPCA_JWK, password: c.PRGD_STEPCA_PASSWORD, rootFingerprint: c.PRGD_STEPCA_ROOT_FINGERPRINT });
  }
  return new LocalSshCa(prisma);
}
