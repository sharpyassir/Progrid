import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HostKeyVerifier } from '../src/host-keys';
import type { Gateway } from '../src/server';
import { fingerprintBlob } from '../src/ssh-keys';
import { until } from './helpers/client';
import { FakeApi } from './helpers/fake-api';
import { ManualKills, connect, newSession, openTerminal, startGateway } from './helpers/setup';
import { TestSshServer } from './helpers/ssh-server';

const SUDO_PASSWORD = 'S3cr3t-sudo-pw!';

let api: FakeApi;
let ssh: TestSshServer;
let gateway: Gateway;
let port: number;
let spoolDir: string;
const kills = new ManualKills();

const target = () => ({ host: '127.0.0.1', port: ssh.port, username: 'prgd' });

function parseCast(body: Buffer) {
  const lines = body.toString('utf8').trimEnd().split('\n');
  const header = JSON.parse(lines[0]);
  const events = lines.slice(1).map((l) => JSON.parse(l) as [number, string, string]);
  return { header, events, output: events.filter((e) => e[1] === 'o').map((e) => e[2]).join('') };
}

async function recordingOf(sessionId: string) {
  const key = `sessions/2026/09/${sessionId}.cast`;
  await until(() => api.uploads.has(key) && api.eventsOf(sessionId).some((e) => e.type === 'recording_stored'), 'the recording');
  return { key, ...api.uploads.get(key)!, ...parseCast(api.uploads.get(key)!.body) };
}

beforeAll(async () => {
  api = new FakeApi();
  await api.listen();
  ssh = new TestSshServer({ caKey: api.ca.privateKey, principal: 'prgd-asset-asset1', sudoPassword: SUDO_PASSWORD });
  await ssh.listen();
  const g = await startGateway(api, { killListener: kills });
  gateway = g.gateway;
  port = g.port;
  spoolDir = g.config.spoolDir;
});

afterAll(async () => {
  await gateway?.close();
  await Promise.race([ssh?.close(), new Promise((r) => setTimeout(r, 1000))]);
  await api?.close();
});

describe('terminal sessions', () => {
  it('runs a session end to end: certificate login, echo, resize, recording, events', async () => {
    const s = newSession(api, target());
    const c = await openTerminal(port, s);

    const ready = c.frame('ready')!;
    expect(ready.sessionId).toBe(s.sessionId);
    expect(typeof ready.expiresAt).toBe('string');
    expect(ready.banner).toMatch(/This session is recorded/);
    expect(ready.policy).toEqual({ clipboardPaste: true, fileDownload: false });
    expect(ready.recorded).toBe(true);

    c.type('echo hello gateway\r');
    await c.waitOutput('hello gateway\r\n$ ');
    c.send({ type: 'resize', cols: 100, rows: 40 });
    c.type('size\r');
    await c.waitOutput('100x40');
    c.send({ type: 'ping' });
    await c.waitFrame('pong');
    c.type('exit\r');
    const closed = await c.waitFrame('closed');
    expect(closed.reason).toBe('ssh_closed');
    expect((await c.closed).code).toBe(1000);

    // What the gateway told the API.
    const check = api.checks.find((b) => b.sessionId === s.sessionId)!;
    expect(String(check.publicKey)).toMatch(/^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI/);
    expect(check.gatewayId).toBe('gw-test');
    expect(check.clientIp).toBe('127.0.0.1');
    expect(ssh.authFailures).toEqual([]);
    expect(ssh.log).toContain(`auth ok prgd-session-${s.sessionId}`);
    expect(ssh.forbidden).toEqual([]);

    const rec = await recordingOf(s.sessionId);
    const events = api.eventsOf(s.sessionId);
    const started = events.find((e) => e.type === 'started')!;
    const hostBlob = Buffer.from(ssh.hostKeyLine.split(' ')[1], 'base64');
    expect(started.hostKey).toBe(`ssh-ed25519 ${hostBlob.toString('base64')}`);
    expect(started.hostKeyFingerprint).toBe(fingerprintBlob(hostBlob));
    expect(started.gatewayId).toBe('gw-test');
    const ended = events.find((e) => e.type === 'ended')!;
    expect(ended.reason).toBe('ssh_closed');
    expect(ended.bytesIn).toBe(Buffer.byteLength('echo hello gateway\rsize\rexit\r'));
    expect(ended.bytesOut).toBeGreaterThan(20);
    const stored = events.find((e) => e.type === 'recording_stored')!;
    expect(stored.recordingKey).toBe(rec.key);
    expect(stored.recordingSize).toBe(rec.body.length);
    expect(events.map((e) => e.type)).toEqual(['started', 'ended', 'recording_stored']);

    // A valid asciicast v2 file.
    expect(rec.contentType).toBe('application/x-asciicast');
    expect(rec.header).toMatchObject({ version: 2, width: 80, height: 24, env: { TERM: 'xterm-256color' } });
    expect(typeof rec.header.timestamp).toBe('number');
    expect(rec.header.title).toContain('web-1');
    for (const e of rec.events) {
      expect(e).toHaveLength(3);
      expect(typeof e[0]).toBe('number');
      expect(['o', 'r']).toContain(e[1]);
    }
    expect(rec.events.map((e) => e[0])).toEqual([...rec.events.map((e) => e[0])].sort((a, b) => a - b));
    expect(rec.events).toContainEqual([expect.any(Number), 'r', '100x40']);
    expect(rec.output).toContain('hello gateway');
    expect(rec.output).toContain('100x40');
    expect(rec.events.some((e) => e[1] === 'i')).toBe(false);

    // The spool file is gone once uploaded.
    await until(() => readdirSync(spoolDir).length === 0, 'the spool to empty');
  });

  it('answers sudo with the stored password, never showing or recording it', async () => {
    const s = newSession(api, target(), { sudoPassword: SUDO_PASSWORD, expiredUploadUrl: true });
    const c = await openTerminal(port, s);
    c.type('sudo whoami\r');
    await c.waitOutput('\r\nroot\r\n$ ');
    await c.waitFor(() => c.frames.some((f) => f.type === 'notice' && /sudo password/.test(String(f.message))), 'the sudo notice');
    c.type('leak\r');
    await c.waitOutput('the password is ********!');
    c.type('exit\r');
    await c.waitFrame('closed');
    expect(ssh.sudoAnswers).toBeGreaterThanOrEqual(1);

    const rec = await recordingOf(s.sessionId);
    expect(c.output).not.toContain(SUDO_PASSWORD);
    expect(JSON.stringify(c.frames)).not.toContain(SUDO_PASSWORD);
    expect(rec.body.toString()).not.toContain(SUDO_PASSWORD);
    expect(rec.output).toContain('[sudo] password for prgd: ');
    expect(rec.output).toContain('the password is ********!');
    // Injected keystrokes are not counted as the engineer's input.
    expect(api.eventsOf(s.sessionId).find((e) => e.type === 'ended')!.bytesIn).toBe(Buffer.byteLength('sudo whoami\rleak\rexit\r'));
    expect(api.secretReads).toContainEqual({ sessionId: s.sessionId, ref: 'assets/asset1' });
    // The first upload URL had expired: the gateway asked for a new one.
    expect(api.recordingUrlCalls).toContain(s.sessionId);
  });

  it('stops answering sudo when the stored password is wrong', async () => {
    const s = newSession(api, target(), { sudoPassword: 'not-the-password' });
    const c = await openTerminal(port, s);
    const before = ssh.lines.filter((l) => l === '<password>').length;
    c.type('sudo whoami\r');
    await c.waitFor(() => c.frames.some((f) => f.type === 'notice' && /not accepted/.test(String(f.message))), 'the give up notice');
    await new Promise((r) => setTimeout(r, 200));
    expect(ssh.lines.filter((l) => l === '<password>').length - before).toBe(1);
    expect(c.output).not.toContain('not-the-password');
    c.ws.close();
    await c.closed;
  });

  it('ends the session at grant expiry after notices', async () => {
    const s = newSession(api, target(), { expiresAt: new Date(Date.now() + 3500) });
    const c = await openTerminal(port, s);
    const closed = await c.waitFrame('closed', 8000);
    expect(closed.reason).toBe('grant_expired');
    const notices = c.frames.filter((f) => f.type === 'notice').map((f) => String(f.message));
    expect(notices.some((m) => m.startsWith('Access ends in 2 seconds'))).toBe(true);
    expect(notices.some((m) => m.startsWith('Access ends in 1 second'))).toBe(true);
    expect(c.frames.findIndex((f) => f.type === 'notice')).toBeLessThan(c.frames.findIndex((f) => f.type === 'closed'));
    await until(() => api.eventsOf(s.sessionId).some((e) => e.type === 'ended'), 'ended');
    expect(api.eventsOf(s.sessionId).find((e) => e.type === 'ended')!.reason).toBe('grant_expired');
  });

  it('follows an extension the API reports in an event answer', async () => {
    const s = newSession(api, target(), { expiresAt: new Date(Date.now() + 2500), heartbeatSeconds: 1 });
    const c = await openTerminal(port, s);
    api.extend(s.sessionId, new Date(Date.now() + 600_000));
    await c.waitFor(() => c.frames.some((f) => f.type === 'notice' && /Access extended until/.test(String(f.message))), 'the extension notice');
    await new Promise((r) => setTimeout(r, 2000));
    expect(c.frame('closed')).toBeUndefined();
    c.type('echo still here\r');
    await c.waitOutput('still here\r\n');
    c.ws.close();
    await until(() => api.eventsOf(s.sessionId).some((e) => e.type === 'ended'), 'ended');
    expect(api.eventsOf(s.sessionId).find((e) => e.type === 'ended')!.reason).toBe('client_closed');
    expect(api.eventsOf(s.sessionId).filter((e) => e.type === 'heartbeat').length).toBeGreaterThanOrEqual(1);
  });

  it('ends the session on a kill message and ignores kills for other sessions', async () => {
    const s = newSession(api, target());
    const c = await openTerminal(port, s);
    kills.emit({ sessionId: 'someone-else', reason: 'nope' });
    await new Promise((r) => setTimeout(r, 100));
    expect(c.frame('closed')).toBeUndefined();
    kills.emit({ sessionId: s.sessionId, grantId: `grant-${s.sessionId}`, gatewayId: 'gw-test', reason: 'staff kill', at: new Date().toISOString() });
    const closed = await c.waitFrame('closed');
    expect(closed).toMatchObject({ reason: 'killed', message: 'staff kill' });
    await until(() => api.eventsOf(s.sessionId).some((e) => e.type === 'ended'), 'ended');
    expect(api.eventsOf(s.sessionId).find((e) => e.type === 'ended')!.reason).toBe('killed');
    await recordingOf(s.sessionId);
    expect(gateway.sessions.has(s.sessionId)).toBe(false);
  });

  it('ends the session when an event answer says kill', async () => {
    const s = newSession(api, target(), { heartbeatSeconds: 1 });
    api.onEvent = (ev) => (ev.sessionId === s.sessionId && ev.type === 'heartbeat' ? { action: 'kill', reason: 'grant revoked: ticket_closed' } : undefined);
    try {
      const c = await openTerminal(port, s);
      const closed = await c.waitFrame('closed', 5000);
      expect(closed).toMatchObject({ reason: 'killed', message: 'grant revoked: ticket_closed' });
      const hb = api.eventsOf(s.sessionId).find((e) => e.type === 'heartbeat')!;
      expect(hb.bytesOut).toBeGreaterThan(0);
      expect(hb.bytesIn).toBe(0);
    } finally {
      api.onEvent = () => undefined;
    }
  });

  it('ends the session when the browser disconnects', async () => {
    const s = newSession(api, target());
    const c = await openTerminal(port, s);
    c.type('echo bye\r');
    await c.waitOutput('bye\r\n');
    c.ws.terminate();
    await until(() => api.eventsOf(s.sessionId).some((e) => e.type === 'ended'), 'ended');
    expect(api.eventsOf(s.sessionId).find((e) => e.type === 'ended')!.reason).toBe('client_closed');
    const rec = await recordingOf(s.sessionId);
    expect(rec.output).toContain('bye');
    await until(() => ssh.channels.size === 0, 'the shell to close');
  });
});

describe('refusals', () => {
  it('closes on a bad token', async () => {
    const c = connect(port, 'cmsessunknown');
    await c.opened;
    c.send({ type: 'auth', token: 'prgd_gws_wrong' });
    const closed = await c.waitFrame('closed');
    expect(closed.reason).toBe('token_invalid');
    expect((await c.closed).code).toBe(4001);
    expect(api.events.some((e) => e.sessionId === 'cmsessunknown')).toBe(false);
  });

  it('closes on a used token', async () => {
    const s = newSession(api, target());
    api.used.add(s.token);
    const c = connect(port, s.sessionId);
    await c.opened;
    c.send({ type: 'auth', token: s.token });
    expect((await c.waitFrame('closed')).reason).toBe('token_used');
    expect((await c.closed).code).toBe(4003);
  });

  it('refuses WebSocket upgrades from other origins', async () => {
    const c = connect(port, 'cmsess1', 'https://evil.test');
    await expect(c.opened).rejects.toThrow(/403/);
    expect(c.upgradeStatus).toBe(403);
    const other = connect(port, 'cmsess1', 'https://other.ops.test');
    await other.opened;
    other.ws.close();
  });

  it('closes when the auth frame does not arrive in time', async () => {
    const c = connect(port, 'cmsess1');
    await c.opened;
    const t = Date.now();
    const closed = await c.waitFrame('closed', 3000);
    expect(closed.reason).toBe('auth_timeout');
    expect(Date.now() - t).toBeGreaterThanOrEqual(900);
    expect((await c.closed).code).toBe(4001);
  });

  it('closes when the first frame is not auth', async () => {
    const c = connect(port, 'cmsess1');
    await c.opened;
    c.send({ type: 'input', data: 'ls\r' });
    expect((await c.waitFrame('closed')).reason).toBe('auth_required');
  });

  it('refuses a host key that changed since first use', async () => {
    const other = new TestSshServer({ caKey: api.ca.privateKey, principal: 'prgd-asset-asset1' });
    await other.listen();
    try {
      // Same asset, same address as the pinned one would be: here the asset id pin trips.
      const s = newSession(api, { host: '127.0.0.1', port: other.port, username: 'prgd' });
      const c = connect(port, s.sessionId);
      await c.opened;
      c.send({ type: 'auth', token: s.token });
      const closed = await c.waitFrame('closed');
      expect(closed.reason).toBe('error');
      expect(String(closed.message)).toContain('host_key_mismatch');
      expect((await c.closed).code).toBe(1011);
      await until(() => api.eventsOf(s.sessionId).some((e) => e.type === 'ended'), 'ended');
      const types = api.eventsOf(s.sessionId).map((e) => e.type);
      expect(types).toEqual(['error', 'ended']);
      expect(api.eventsOf(s.sessionId)[0].error).toContain('host_key_mismatch');
      expect(other.log).toEqual([]);
    } finally {
      await Promise.race([other.close(), new Promise((r) => setTimeout(r, 500))]);
    }
  });

  it('enforces a known_hosts file when one is configured', async () => {
    const file = join(tmpdir(), `prgd-known-hosts-${process.pid}`);
    const wrong = new TestSshServer({ caKey: api.ca.privateKey, principal: 'x' });
    writeFileSync(file, `# managed assets\n[127.0.0.1]:${ssh.port} ${wrong.hostKeyLine}\n`);
    const strict = await startGateway(api, { hostKeys: new HostKeyVerifier(file) });
    try {
      const s1 = newSession(api, target());
      const c1 = connect(strict.port, s1.sessionId);
      await c1.opened;
      c1.send({ type: 'auth', token: s1.token });
      expect(String((await c1.waitFrame('closed')).message)).toContain('host_key_mismatch');

      writeFileSync(file, `[127.0.0.1]:${ssh.port} ${ssh.hostKeyLine}\n`);
      const ok = await startGateway(api, { hostKeys: new HostKeyVerifier(file) });
      try {
        const s2 = newSession(api, target());
        const c2 = await openTerminal(ok.port, s2);
        c2.type('exit\r');
        expect((await c2.waitFrame('closed')).reason).toBe('ssh_closed');
      } finally {
        await ok.gateway.close();
      }
    } finally {
      await strict.gateway.close();
    }
  });

  it('refuses upgrades beyond PRGD_GATEWAY_MAX_SESSIONS and answers /healthz', async () => {
    const small = await startGateway(api, { env: { PRGD_GATEWAY_MAX_SESSIONS: '1' } });
    try {
      const a = connect(small.port, 'cmsess1');
      await a.opened;
      const b = connect(small.port, 'cmsess2');
      await expect(b.opened).rejects.toThrow(/503/);
      const health = await (await fetch(`http://127.0.0.1:${small.port}/healthz`)).json();
      expect(health).toMatchObject({ ok: true, gatewayId: 'gw-test', sessions: 1, maxSessions: 1, hostKeys: 'trust_on_first_use' });
      a.ws.close();
      expect((await fetch(`http://127.0.0.1:${small.port}/v1/terminal`)).status).toBe(404);
    } finally {
      await small.gateway.close();
    }
  });

  it('never calls the API without the gateway secret', () => {
    expect(api.unauthorized).toEqual([]);
    expect(existsSync(spoolDir)).toBe(true);
  });
});
