import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../../common/redis/redis.service';

/**
 * Live run updates over Redis pub/sub (channel connect:run:<id>), so the SSE endpoint in any
 * API replica sees steps written by any worker. Events: {type:"step", step} and
 * {type:"run", run:{id,status,...}}.
 */
@Injectable()
export class RunEvents {
  private readonly log = new Logger(RunEvents.name);

  constructor(private readonly redis: RedisService) {}

  channel(runId: string) {
    return `connect:run:${runId}`;
  }

  publish(runId: string, event: Record<string, unknown>) {
    this.redis.client.publish(this.channel(runId), JSON.stringify(event)).catch((e) => this.log.debug(`publish failed: ${(e as Error).message}`));
  }

  /** Subscribes on a dedicated connection. Returns the unsubscribe function. */
  async subscribe(runId: string, onEvent: (e: Record<string, unknown>) => void): Promise<() => Promise<void>> {
    const sub = this.redis.client.duplicate();
    sub.on('error', () => undefined);
    const channel = this.channel(runId);
    sub.on('message', (ch: string, msg: string) => {
      if (ch !== channel) return;
      try {
        onEvent(JSON.parse(msg));
      } catch {
        /* ignore malformed */
      }
    });
    await sub.subscribe(channel);
    return async () => {
      await sub.unsubscribe(channel).catch(() => undefined);
      sub.disconnect();
    };
  }
}
