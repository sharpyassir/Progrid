import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { connect, JSONCodec, NatsConnection, Subscription } from 'nats';
import { loadConfig } from '../../config/config';

/**
 * Subjects (see agents/host-agent for the other side):
 *   pgcloud.host.<hostId>.jobs      control plane → agent   (request/reply)
 *   pgcloud.host.<hostId>.heartbeat agent → control plane   (every minute)
 *   pgcloud.usage                   agent → control plane   (usage.v1 events)
 *   pgcloud.events.<name>           control plane → internal fan-out
 */
export const Subjects = {
  hostJobs: (hostId: string) => `pgcloud.host.${hostId}.jobs`,
  hostHeartbeat: 'pgcloud.host.*.heartbeat',
  usage: 'pgcloud.usage',
  metrics: 'pgcloud.metrics',
  event: (name: string) => `pgcloud.events.${name}`,
} as const;

@Injectable()
export class NatsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(NatsService.name);
  private readonly codec = JSONCodec();
  private nc?: NatsConnection;

  async onModuleInit() {
    const { NATS_URL, NATS_TOKEN } = loadConfig();
    try {
      this.nc = await connect({ servers: NATS_URL, name: 'pgcloud-api', reconnect: true, maxReconnectAttempts: -1, ...(NATS_TOKEN ? { token: NATS_TOKEN } : {}) });
      this.log.log(`connected to NATS at ${NATS_URL}`);
    } catch (err) {
      // Local dev without NATS still works with the fake driver.
      this.log.warn(`NATS unavailable (${(err as Error).message}); messaging disabled`);
    }
  }

  async onModuleDestroy() {
    await this.nc?.drain();
  }

  get connected() {
    return !!this.nc && !this.nc.isClosed();
  }

  publish<T>(subject: string, data: T) {
    if (!this.nc) return;
    this.nc.publish(subject, this.codec.encode(data));
  }

  async request<TReq, TRes>(subject: string, data: TReq, timeoutMs = 60_000): Promise<TRes> {
    if (!this.nc) throw new Error('NATS not connected');
    const msg = await this.nc.request(subject, this.codec.encode(data), { timeout: timeoutMs });
    return this.codec.decode(msg.data) as TRes;
  }

  subscribe<T>(subject: string, handler: (data: T, subject: string) => Promise<void> | void): Subscription | undefined {
    if (!this.nc) return undefined;
    const sub = this.nc.subscribe(subject);
    (async () => {
      for await (const m of sub) {
        try {
          await handler(this.codec.decode(m.data) as T, m.subject);
        } catch (err) {
          this.log.error(`handler for ${m.subject} failed: ${(err as Error).message}`);
        }
      }
    })();
    return sub;
  }
}
