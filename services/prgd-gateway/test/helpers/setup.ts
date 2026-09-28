import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, type GatewayConfig } from '../../src/config';
import type { KillListener, KillMessage } from '../../src/kill';
import { log } from '../../src/log';
import { Gateway } from '../../src/server';
import type { HostKeyVerifier } from '../../src/host-keys';
import { ORIGIN, TestClient } from './client';
import { FakeApi, GATEWAY_SECRET, type FakeSession } from './fake-api';

log.setSilent(process.env.PRGD_GATEWAY_TEST_LOG !== '1');

/** A kill source the tests drive by hand (the NATS listener has its own test). */
export class ManualKills implements KillListener {
  private handler: ((m: KillMessage) => void) | null = null;
  async start(onKill: (m: KillMessage) => void) {
    this.handler = onKill;
  }
  async close() {
    this.handler = null;
  }
  emit(m: KillMessage) {
    this.handler?.(m);
  }
}

export function testConfig(api: FakeApi, env: Record<string, string> = {}): GatewayConfig {
  return loadConfig({
    PRGD_API_URL: api.url,
    PRGD_GATEWAY_SECRET: GATEWAY_SECRET,
    PRGD_GATEWAY_ID: 'gw-test',
    PRGD_GATEWAY_ALLOWED_ORIGINS: `${ORIGIN},https://other.ops.test`,
    PRGD_GATEWAY_AUTH_TIMEOUT_SECONDS: '1',
    PRGD_GATEWAY_EXPIRY_NOTICES: '2,1',
    PRGD_GATEWAY_SPOOL_DIR: mkdtempSync(join(tmpdir(), 'prgd-gw-spool-')),
    ...env,
  });
}

export async function startGateway(api: FakeApi, opts: { env?: Record<string, string>; killListener?: KillListener | null; hostKeys?: HostKeyVerifier } = {}) {
  const config = testConfig(api, opts.env);
  const gateway = new Gateway({ config, killListener: opts.killListener ?? null, hostKeys: opts.hostKeys });
  const port = await gateway.listen(0, '127.0.0.1');
  return { gateway, port, config };
}

let n = 0;
/** Registers a session with the fake API and returns its token and id. */
export function newSession(api: FakeApi, target: FakeSession['target'], over: Partial<FakeSession> = {}) {
  n += 1;
  const sessionId = `cmsess${n}${randomBytes(3).toString('hex')}`;
  const token = `prgd_gws_${randomBytes(32).toString('base64url')}`;
  api.add(token, { sessionId, assetId: 'asset1', target, expiresAt: new Date(Date.now() + 3600_000), ...over });
  return { sessionId, token };
}

export function connect(port: number, sessionId: string, origin = ORIGIN) {
  return new TestClient(`ws://127.0.0.1:${port}/v1/terminal?session=${sessionId}`, origin);
}

/** Opens a terminal and waits for ready and the first prompt. */
export async function openTerminal(port: number, s: { sessionId: string; token: string }, size = { cols: 80, rows: 24 }) {
  const c = connect(port, s.sessionId);
  await c.opened;
  c.send({ type: 'auth', token: s.token, ...size });
  await c.waitFrame('ready');
  await c.waitOutput('$ ');
  return c;
}
