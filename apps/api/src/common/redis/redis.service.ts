import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { loadConfig } from '../../config/config';

/** Sessions, rate limits and scheduler locks. */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly log = new Logger(RedisService.name);
  readonly client: Redis;

  constructor() {
    this.client = new Redis(loadConfig().REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 });
    this.client.on('error', (e) => this.log.warn(`redis: ${e.message}`));
    this.client.connect().catch(() => this.log.warn('redis unavailable; locked jobs are skipped and rate limits are degraded'));
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => undefined);
  }

  /**
   * Simple lock. Returns a release function, or null if the lock is held or Redis cannot be
   * reached. It fails closed: without Redis we cannot tell whether another replica holds the
   * lock, so the caller skips its run rather than risk doing the work twice.
   */
  async lock(key: string, ttlMs: number): Promise<(() => Promise<void>) | null> {
    const token = Math.random().toString(36).slice(2);
    let ok: string | null;
    try {
      ok = await this.client.set(`lock:${key}`, token, 'PX', ttlMs, 'NX');
    } catch (err) {
      this.log.error(`lock ${key} not taken, redis error: ${(err as Error).message}`);
      return null;
    }
    if (ok !== 'OK') return null;
    return async () => {
      await this.client
        .eval(`if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) end`, 1, `lock:${key}`, token)
        .catch(() => undefined);
    };
  }

  /** Fixed-window rate limit. Returns true when the call is allowed. */
  async allow(key: string, limit: number, windowSec: number): Promise<boolean> {
    try {
      const k = `rl:${key}:${Math.floor(Date.now() / 1000 / windowSec)}`;
      const n = await this.client.incr(k);
      if (n === 1) await this.client.expire(k, windowSec);
      return n <= limit;
    } catch {
      return true;
    }
  }
}
