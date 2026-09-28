import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { connect as natsConnect, JSONCodec } from 'nats';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KILL_SUBJECT, NatsKillListener } from '../src/kill';
import type { Gateway } from '../src/server';
import { until } from './helpers/client';
import { FakeApi } from './helpers/fake-api';
import { newSession, openTerminal, startGateway } from './helpers/setup';
import { TestSshServer } from './helpers/ssh-server';

/**
 * Kill over a real nats-server. Set NATS_SERVER_BIN, or have nats-server on the PATH; skipped
 * otherwise (the injectable listener path is covered in gateway.test.ts).
 */
const onPath = spawnSync('nats-server', ['--version']).error === undefined ? 'nats-server' : '';
const BIN = process.env.NATS_SERVER_BIN && existsSync(process.env.NATS_SERVER_BIN) ? process.env.NATS_SERVER_BIN : onPath;
const TOKEN = 'test-nats-token';

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });

describe.skipIf(!BIN)('kill over NATS', () => {
  let nats: ChildProcess;
  let natsUrl: string;
  let api: FakeApi;
  let ssh: TestSshServer;
  let gateway: Gateway;
  let port: number;

  beforeAll(async () => {
    const natsPort = await freePort();
    natsUrl = `nats://127.0.0.1:${natsPort}`;
    let out = '';
    nats = spawn(BIN, ['-a', '127.0.0.1', '-p', String(natsPort), '--auth', TOKEN], { stdio: ['ignore', 'pipe', 'pipe'] });
    nats.stderr!.on('data', (d) => (out += d.toString()));
    await until(() => /Server is ready/.test(out), 'nats-server', 10_000);
    api = new FakeApi();
    await api.listen();
    ssh = new TestSshServer({ caKey: api.ca.privateKey, principal: 'prgd-asset-asset1' });
    await ssh.listen();
    const g = await startGateway(api, { killListener: new NatsKillListener(natsUrl, TOKEN) });
    gateway = g.gateway;
    port = g.port;
  });

  afterAll(async () => {
    await gateway?.close();
    await Promise.race([ssh?.close(), new Promise((r) => setTimeout(r, 500))]);
    await api?.close();
    nats?.kill();
  });

  it('closes the session named in a kill message on prgd.gateway.sessions.kill', async () => {
    const s = newSession(api, { host: '127.0.0.1', port: ssh.port, username: 'prgd' });
    const c = await openTerminal(port, s);
    const nc = await natsConnect({ servers: natsUrl, token: TOKEN });
    const jc = JSONCodec();
    // Give the gateway's subscription a moment to be registered on the server.
    await new Promise((r) => setTimeout(r, 200));
    nc.publish(KILL_SUBJECT, jc.encode({ sessionId: 'not-here', reason: 'x' }));
    nc.publish(KILL_SUBJECT, jc.encode({ sessionId: s.sessionId, grantId: `grant-${s.sessionId}`, gatewayId: 'gw-test', reason: 'grant revoked: ticket_closed', at: new Date().toISOString() }));
    await nc.flush();
    const closed = await c.waitFrame('closed', 5000);
    expect(closed).toMatchObject({ reason: 'killed', message: 'grant revoked: ticket_closed' });
    await until(() => api.eventsOf(s.sessionId).some((e) => e.type === 'ended'), 'ended');
    expect(api.eventsOf(s.sessionId).find((e) => e.type === 'ended')!.reason).toBe('killed');
    await nc.close();
  });
});
