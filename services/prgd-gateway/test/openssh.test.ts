import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Gateway } from '../src/server';
import { until } from './helpers/client';
import { FakeApi } from './helpers/fake-api';
import { ed25519Line, rawEd25519 } from './helpers/openssh';
import { connect, newSession, startGateway } from './helpers/setup';

/**
 * The same certificate login against a real OpenSSH sshd (TrustedUserCAKeys plus
 * AuthorizedPrincipalsFile, the production asset setup). Runs when sshd and ssh-keygen are
 * installed and the tests run as root (sshd needs it for privilege separation); skipped otherwise.
 */
const SSHD = ['/usr/sbin/sshd', '/usr/local/sbin/sshd'].find((p) => existsSync(p));
const hasKeygen = spawnSync('ssh-keygen', ['-?']).error === undefined;
const runnable = !!SSHD && hasKeygen && process.getuid?.() === 0;

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });

describe.skipIf(!runnable)('real OpenSSH server', () => {
  let api: FakeApi;
  let gateway: Gateway;
  let port: number;
  let sshd: ChildProcess;
  let sshdPort: number;
  let dir: string;
  let sshdLog = '';

  beforeAll(async () => {
    api = new FakeApi();
    await api.listen();
    dir = mkdtempSync(join(tmpdir(), 'prgd-sshd-'));
    const user = userInfo().username;
    writeFileSync(join(dir, 'user_ca.pub'), ed25519Line(rawEd25519(api.ca.privateKey), 'prgd-test-ca') + '\n');
    mkdirSync(join(dir, 'principals'));
    writeFileSync(join(dir, 'principals', user), 'prgd-asset-asset1\n');
    spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(dir, 'host_key')]);
    mkdirSync('/run/sshd', { recursive: true });
    sshdPort = await freePort();
    writeFileSync(
      join(dir, 'sshd_config'),
      [
        `Port ${sshdPort}`,
        'ListenAddress 127.0.0.1',
        `HostKey ${join(dir, 'host_key')}`,
        `PidFile ${join(dir, 'sshd.pid')}`,
        `TrustedUserCAKeys ${join(dir, 'user_ca.pub')}`,
        `AuthorizedPrincipalsFile ${join(dir, 'principals')}/%u`,
        'AuthorizedKeysFile none',
        'PubkeyAuthentication yes',
        'PasswordAuthentication no',
        'KbdInteractiveAuthentication no',
        'PermitRootLogin prohibit-password',
        'StrictModes no',
        'UsePAM no',
        'AllowAgentForwarding no',
        'AllowTcpForwarding no',
        'X11Forwarding no',
        'LogLevel VERBOSE',
      ].join('\n') + '\n',
    );
    sshd = spawn(SSHD!, ['-D', '-e', '-f', join(dir, 'sshd_config')], { stdio: ['ignore', 'pipe', 'pipe'] });
    sshd.stderr!.on('data', (d) => (sshdLog += d.toString()));
    await until(() => /Server listening/.test(sshdLog) || sshd.exitCode !== null, 'sshd to listen', 10_000);
    if (sshd.exitCode !== null) throw new Error(`sshd exited: ${sshdLog}`);
    const g = await startGateway(api);
    gateway = g.gateway;
    port = g.port;
  });

  afterAll(async () => {
    await gateway?.close();
    sshd?.kill();
    await api?.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('logs in with the certificate and runs a shell', async () => {
    const s = newSession(api, { host: '127.0.0.1', port: sshdPort, username: userInfo().username });
    const c = await openTerminalPrompt(port, s);
    c.type('echo real-openssh-$((6*7))\r');
    await c.waitOutput('real-openssh-42');
    c.send({ type: 'resize', cols: 132, rows: 43 });
    c.type('stty size\r');
    await c.waitOutput('43 132');
    c.type('exit\r');
    expect((await c.waitFrame('closed')).reason).toBe('ssh_closed');
    expect(sshdLog).toMatch(/Accepted publickey for \S+ from 127\.0\.0\.1 .*ED25519-CERT.*ID prgd-session-/);
    await until(() => api.eventsOf(s.sessionId).some((e) => e.type === 'recording_stored'), 'the recording');
  });

  it('is refused by sshd when the principal does not match', async () => {
    writeFileSync(join(dir, 'principals', userInfo().username), 'prgd-asset-other\n');
    const s = newSession(api, { host: '127.0.0.1', port: sshdPort, username: userInfo().username });
    const c = connect(port, s.sessionId);
    await c.opened;
    c.send({ type: 'auth', token: s.token });
    const closed = await c.waitFrame('closed');
    expect(closed.reason).toBe('error');
    expect(String(closed.message)).toMatch(/authentication methods failed/i);
  });
});

/** Like openTerminal, but a real shell's prompt varies: wait for ready only. */
async function openTerminalPrompt(port: number, s: { sessionId: string; token: string }) {
  const c = connect(port, s.sessionId);
  await c.opened;
  c.send({ type: 'auth', token: s.token, cols: 80, rows: 24 });
  await c.waitFrame('ready');
  return c;
}
