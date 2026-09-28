import { Client, type ClientChannel } from 'ssh2';
import { ED25519, ED25519_CERT, sshString, type EphemeralKey } from './ssh-keys';

/* eslint-disable @typescript-eslint/no-require-imports */
// ssh2 has no public API for OpenSSH user certificates (see signCertAuth below), so the gateway
// uses two of its internal helpers. Pinned by the lockfile and covered by the tests.
const { parseKey } = require('ssh2/lib/protocol/keyParser.js') as { parseKey: (data: string) => object | Error };
const { sendPacket } = require('ssh2/lib/protocol/utils.js') as { sendPacket: (proto: unknown, packet: Buffer) => void };
/* eslint-enable @typescript-eslint/no-require-imports */

const CERT_KEY = Symbol('prgd.certKey');
const USERAUTH_REQUEST = 50;

interface CertKey {
  [CERT_KEY]: { blob: Buffer; key: EphemeralKey };
}

interface ProtocolInternals {
  _kex: { sessionID: Buffer };
  _packetRW: { write: { alloc(n: number): Buffer; allocStart: number; finalize(p: Buffer): Buffer } };
  _authsQueue: string[];
  authPK: (username: string, pubKey: unknown, keyAlgo?: unknown, cbSign?: unknown) => void;
}

/**
 * ssh2 (1.x) signs public key authentication with the key algorithm name also used as the
 * signature format name. For certificates that is wrong: the algorithm is
 * "ssh-ed25519-cert-v01@openssh.com" but the signature blob must say "ssh-ed25519", and OpenSSH
 * refuses anything else. So for certificate keys the gateway writes the USERAUTH_REQUEST itself:
 *
 *   byte 50, string user, string "ssh-connection", string "publickey", bool signed,
 *   string "ssh-ed25519-cert-v01@openssh.com", string certificate blob,
 *   [string (string "ssh-ed25519", string signature over session id + the fields above)]
 */
function patchCertAuth(client: Client) {
  const proto = (client as unknown as { _protocol: ProtocolInternals })._protocol;
  const original = proto.authPK.bind(proto);
  proto.authPK = (username: string, pubKey: unknown, keyAlgo?: unknown, cbSign?: unknown) => {
    const ck = (pubKey as Partial<CertKey> | undefined)?.[CERT_KEY];
    if (!ck) return original(username, pubKey, keyAlgo, cbSign);
    const signed = typeof cbSign === 'function' || typeof keyAlgo === 'function';
    const fields = Buffer.concat([
      Buffer.from([USERAUTH_REQUEST]),
      sshString(username),
      sshString('ssh-connection'),
      sshString('publickey'),
      Buffer.from([signed ? 1 : 0]),
      sshString(ED25519_CERT),
      sshString(ck.blob),
    ]);
    let payload = fields;
    if (signed) {
      const sig = ck.key.sign(Buffer.concat([sshString(proto._kex.sessionID), fields]));
      payload = Buffer.concat([fields, sshString(Buffer.concat([sshString(ED25519), sshString(sig)]))]);
    }
    const w = proto._packetRW.write;
    const packet = w.alloc(payload.length);
    packet.set(payload, w.allocStart);
    proto._authsQueue.push('publickey');
    sendPacket(proto, w.finalize(packet));
  };
}

/** An ssh2 parsed key object standing for the certificate; the patched authPK signs with the ephemeral key. */
function certKeyObject(key: EphemeralKey, blob: Buffer) {
  const base = parseKey(key.publicLine);
  if (base instanceof Error) throw base;
  return Object.create(base, {
    [CERT_KEY]: { value: { blob, key } },
    type: { value: ED25519_CERT },
    isPrivateKey: { value: () => true },
    getPublicSSH: { value: () => blob },
    sign: { value: (data: Buffer) => key.sign(data) },
  });
}

export interface SshTarget {
  host: string;
  port: number;
  username: string;
}

export interface SshConnectOptions {
  target: SshTarget;
  key: EphemeralKey;
  certificateBlob: Buffer;
  /** Called with the host key blob; return false to refuse the host. */
  verifyHostKey: (blob: Buffer) => boolean;
  readyTimeoutMs: number;
}

/** Connects with the certificate; resolves with the connected client. */
export function connectWithCertificate(opts: SshConnectOptions): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    const key = certKeyObject(opts.key, opts.certificateBlob);
    let tried = false;
    const onError = (e: Error) => {
      client.removeListener('ready', onReady);
      client.end();
      reject(e);
    };
    const onReady = () => {
      client.removeListener('error', onError);
      resolve(client);
    };
    client.once('error', onError);
    client.once('ready', onReady);
    client.connect({
      host: opts.target.host,
      port: opts.target.port,
      username: opts.target.username,
      readyTimeout: opts.readyTimeoutMs,
      keepaliveInterval: 15_000,
      keepaliveCountMax: 4,
      agentForward: false,
      hostVerifier: (blob: Buffer) => opts.verifyHostKey(blob),
      // One method only: the certificate. No password, no keyboard interactive, no agent.
      authHandler: (_methods: unknown, _partial: unknown, next: (m: unknown) => void) => {
        if (tried) return next(false);
        tried = true;
        next({ type: 'publickey', username: opts.target.username, key });
      },
    } as never);
    patchCertAuth(client);
    // The gateway never asks for forwarding, X11 or agent channels; refuse any the server offers.
    client.on('tcp connection', (_i, _accept, rejectCh) => rejectCh());
    client.on('x11', (_i, _accept, rejectCh) => rejectCh());
  });
}

/** Opens the interactive shell with a pty. No exec, no subsystems (sftp), no forwarding. */
export function openShell(client: Client, cols: number, rows: number): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    client.shell({ term: 'xterm-256color', cols, rows, width: 0, height: 0 }, (err, stream) => (err ? reject(err) : resolve(stream)));
  });
}
