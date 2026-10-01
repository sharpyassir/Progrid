import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RedisService } from '../../common/redis/redis.service';
import { ConnectUsageService } from './usage.service';
import { RunService } from './runtime/run.service';

/** Connect background jobs. Each takes a Redis lock so only one API replica runs it. */
@Injectable()
export class ConnectJobs {
  private readonly log = new Logger(ConnectJobs.name);

  constructor(private readonly redis: RedisService, private readonly usage: ConnectUsageService, private readonly runs: RunService) {}

  @Cron('0 7 * * * *') // seven past every hour: meter the hour that ended
  meter() {
    return this.locked('connect-meter', 10 * 60_000, () => this.usage.meterPreviousHour());
  }

  @Cron('0 */5 * * * *') // every five minutes: runs whose approvals expired fail
  expireApprovals() {
    return this.locked('connect-approvals', 4 * 60_000, () => this.runs.failExpiredApprovals());
  }

  private async locked(name: string, ttlMs: number, fn: () => Promise<unknown>) {
    const release = await this.redis.lock(`job:${name}`, ttlMs);
    if (!release) return;
    try {
      await fn();
    } catch (err) {
      this.log.error(`${name} failed: ${(err as Error).message}`);
    } finally {
      await release();
    }
  }
}
