import { connect, JSONCodec, type NatsConnection } from 'nats';
import { log } from './log';

export const KILL_SUBJECT = 'prgd.gateway.sessions.kill';

/** What the API publishes on prgd.gateway.sessions.kill. */
export interface KillMessage {
  sessionId: string;
  grantId?: string;
  gatewayId?: string | null;
  reason?: string;
  at?: string;
}

/** A source of kill messages. NATS in production; tests inject their own. */
export interface KillListener {
  start(onKill: (msg: KillMessage) => void): Promise<void>;
  close(): Promise<void>;
}

/**
 * Subscribes to the kill subject. Keeps reconnecting forever; while NATS is down the heartbeat
 * answer (`action: "kill"`) still ends killed sessions within one heartbeat.
 */
export class NatsKillListener implements KillListener {
  private nc: NatsConnection | null = null;
  private closed = false;

  constructor(private readonly url: string, private readonly token: string, private readonly subject = KILL_SUBJECT) {}

  async start(onKill: (msg: KillMessage) => void) {
    const jc = JSONCodec<KillMessage>();
    const nc = await connect({
      servers: this.url.split(',').map((s) => s.trim()),
      ...(this.token ? { token: this.token } : {}),
      name: 'prgd-gateway',
      reconnect: true,
      maxReconnectAttempts: -1,
      waitOnFirstConnect: true,
    });
    if (this.closed) {
      await nc.close();
      return;
    }
    this.nc = nc;
    log.info('nats connected', { server: nc.getServer(), subject: this.subject });
    const sub = nc.subscribe(this.subject);
    void (async () => {
      for await (const m of sub) {
        try {
          const msg = jc.decode(m.data);
          if (msg && typeof msg.sessionId === 'string') onKill(msg);
        } catch (e) {
          log.warn('bad kill message', { error: (e as Error).message });
        }
      }
    })();
    void (async () => {
      for await (const s of nc.status()) log.info('nats status', { type: s.type, data: typeof s.data === 'string' ? s.data : undefined });
    })();
  }

  async close() {
    this.closed = true;
    if (this.nc) await this.nc.drain().catch(() => undefined);
  }
}
