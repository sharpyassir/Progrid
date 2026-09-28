import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Server, utils, type ServerChannel } from 'ssh2';
import { parseCertificate, rawEd25519 } from './openssh';

/**
 * An in process SSH server that behaves like OpenSSH with TrustedUserCAKeys and an
 * AuthorizedPrincipalsFile: it accepts only an ed25519 user certificate signed by the test CA,
 * valid now, naming the expected principal, and a signature whose format name is "ssh-ed25519"
 * (what OpenSSH insists on for certificate keys). Its shell is a tiny line interpreter:
 *
 *   echo <text>    prints text
 *   size           prints the pty size, COLSxROWS
 *   sudo whoami    asks "[sudo] password for prgd: " (echo off) and prints root for the right password
 *   leak           prints the sudo password (a careless program), to test redaction
 *   exit           ends the shell
 */

const utf8 = (b: Buffer) => b.toString('utf8');

function readString(buf: Buffer, off: number): [Buffer, number] {
  const n = buf.readUInt32BE(off);
  return [buf.subarray(off + 4, off + 4 + n), off + 4 + n];
}

export interface TestSshServerOptions {
  caKey: KeyObject;
  principal: string;
  username?: string;
  sudoPassword?: string;
}

export class TestSshServer {
  readonly hostKey = utils.generateKeyPairSync('ed25519');
  readonly server: Server;
  port = 0;
  readonly log: string[] = [];
  /** Requests the gateway must never make. */
  readonly forbidden: string[] = [];
  readonly authFailures: string[] = [];
  /** Every line the shell received (password lines are recorded as <password>). */
  readonly lines: string[] = [];
  sudoAnswers = 0;
  channels = new Set<ServerChannel>();

  constructor(private readonly opts: TestSshServerOptions) {
    const caRaw = rawEd25519(opts.caKey);
    const username = opts.username ?? 'prgd';
    this.server = new Server({ hostKeys: [this.hostKey.private] }, (client) => {
      client.on('authentication', (ctx) => {
        if (ctx.method !== 'publickey') {
          this.authFailures.push(`method ${ctx.method}`);
          return ctx.reject(['publickey']);
        }
        if (ctx.username !== username) {
          this.authFailures.push(`user ${ctx.username}`);
          return ctx.reject(['publickey']);
        }
        if (ctx.key.algo !== 'ssh-ed25519-cert-v01@openssh.com') {
          this.authFailures.push(`algo ${ctx.key.algo}`);
          return ctx.reject(['publickey']);
        }
        let cert;
        try {
          cert = parseCertificate(`${ctx.key.algo} ${ctx.key.data.toString('base64')}`);
        } catch (e) {
          this.authFailures.push(`parse ${(e as Error).message}`);
          return ctx.reject(['publickey']);
        }
        const now = Date.now();
        const problems = [
          !cert.signatureValid && 'bad CA signature',
          !cert.signatureKey.equals(caRaw) && 'unknown CA',
          cert.certType !== 1 && 'not a user certificate',
          !cert.principals.includes(opts.principal) && `principal ${cert.principals.join(',')}`,
          !(cert.validAfter.getTime() <= now && now < cert.validBefore.getTime()) && 'not valid now',
          !cert.extensions.includes('permit-pty') && 'no permit-pty',
        ].filter(Boolean) as string[];
        if (problems.length) {
          this.authFailures.push(problems.join('; '));
          return ctx.reject(['publickey']);
        }
        if (!ctx.signature) return ctx.accept(); // the "would you accept this key" query
        // ssh2 strips the signature format name only when it equals the key algorithm; with the
        // correct name ("ssh-ed25519") the blob arrives whole, as OpenSSH would parse it.
        let sig: Buffer;
        try {
          const [name, off] = readString(ctx.signature, 0);
          if (utf8(name) !== 'ssh-ed25519') throw new Error(`signature format ${utf8(name)}`);
          [sig] = readString(ctx.signature, off);
        } catch (e) {
          this.authFailures.push(`signature ${(e as Error).message}`);
          return ctx.reject(['publickey']);
        }
        const userKey = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: cert.publicKey.toString('base64url') }, format: 'jwk' });
        if (!ctx.blob || !verify(null, ctx.blob, userKey, sig)) {
          this.authFailures.push('signature does not verify');
          return ctx.reject(['publickey']);
        }
        this.log.push(`auth ok ${cert.keyId}`);
        ctx.accept();
      });
      client.on('ready', () => {
        client.on('session', (accept) => {
          const session = accept();
          const size = { cols: 80, rows: 24 };
          session.on('pty', (acc, _rej, info) => {
            size.cols = info.cols;
            size.rows = info.rows;
            acc?.();
          });
          session.on('window-change', (acc, _rej, info) => {
            size.cols = info.cols;
            size.rows = info.rows;
            acc?.();
          });
          session.on('exec', (_acc, rej) => {
            this.forbidden.push('exec');
            rej?.();
          });
          session.on('subsystem', (_acc, rej, info) => {
            this.forbidden.push(`subsystem ${info.name}`);
            rej?.();
          });
          session.on('auth-agent', (_acc, rej) => {
            this.forbidden.push('auth-agent');
            rej?.();
          });
          session.on('x11', (_acc, rej) => {
            this.forbidden.push('x11');
            rej?.();
          });
          session.on('shell', (acc) => this.shell(acc(), size));
        });
        client.on('request', (_acc, rej, name) => {
          this.forbidden.push(`request ${name}`);
          rej?.();
        });
        client.on('tcpip', (_acc, rej) => {
          this.forbidden.push('tcpip');
          rej();
        });
      });
      client.on('error', () => undefined);
    });
  }

  private shell(ch: ServerChannel, size: { cols: number; rows: number }) {
    this.channels.add(ch);
    ch.on('close', () => this.channels.delete(ch));
    let line = '';
    let password = false;
    const pw = this.opts.sudoPassword ?? '';
    ch.write('welcome to the test asset\r\n$ ');
    const run = (cmd: string) => {
      if (password) {
        this.lines.push('<password>');
        password = false;
        if (cmd === pw && pw) {
          this.sudoAnswers += 1;
          ch.write('\r\nroot\r\n$ ');
        } else {
          ch.write('\r\nSorry, try again.\r\n[sudo] password for prgd: ');
          password = true;
        }
        return;
      }
      this.lines.push(cmd);
      ch.write('\r\n');
      if (cmd.startsWith('echo ')) ch.write(cmd.slice(5) + '\r\n');
      else if (cmd === 'size') ch.write(`${size.cols}x${size.rows}\r\n`);
      else if (cmd === 'leak') ch.write(`the password is ${pw}!\r\n`);
      else if (cmd === 'sudo whoami') {
        ch.write('[sudo] password for prgd: ');
        password = true;
        return;
      } else if (cmd === 'exit') {
        ch.exit(0);
        ch.end();
        return;
      } else if (cmd) ch.write(`sh: ${cmd}: not found\r\n`);
      ch.write('$ ');
    };
    ch.on('data', (d: Buffer) => {
      for (const c of d.toString('utf8')) {
        if (c === '\r' || c === '\n') {
          if (c === '\n' && line === '' && !password) continue;
          const cmd = line;
          line = '';
          run(cmd);
        } else if (c === '\x7f') {
          line = line.slice(0, -1);
          if (!password) ch.write('\b \b');
        } else {
          line += c;
          if (!password) ch.write(c);
        }
      }
    });
  }

  /** The host key as an OpenSSH public key line. */
  get hostKeyLine() {
    return this.hostKey.public.trim();
  }

  async listen() {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.port = (this.server.address() as AddressInfo).port;
    return this.port;
  }

  async close() {
    for (const ch of this.channels) ch.close();
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}
