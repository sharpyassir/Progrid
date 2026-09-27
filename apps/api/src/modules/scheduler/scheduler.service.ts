import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { NatsService, Subjects } from '../../common/nats/nats.service';
import { ApiError } from '../../common/errors/api-error';
import type { Heartbeat } from '../../drivers/agent-protocol';

export interface PlacementRequest {
  regionId: string;
  vcpu: number;
  memoryMb: number;
  diskGb: number;
  /** Server IDs this server must not share a host with (anti-affinity). */
  avoidServerIds?: string[];
  family?: string;
  /** Place only on this host (a clone of a snapshot runs on the node that holds it). */
  onlyHostId?: string;
}

/**
 * Picks the physical host for a new server. Least-loaded-by-memory placement with
 * anti-affinity, under a Redis lock per region so concurrent placements don't overbook.
 * Capacity counters are reserved here and corrected by agent heartbeats.
 */
@Injectable()
export class SchedulerService {
  private readonly log = new Logger(SchedulerService.name);

  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService, private readonly nats: NatsService) {}

  async place(req: PlacementRequest): Promise<{ hostId: string; driverRef: string }> {
    const release = await this.waitLock(`sched:${req.regionId}`, 10_000);
    try {
      const avoidHostIds = req.avoidServerIds?.length
        ? (await this.prisma.server.findMany({ where: { id: { in: req.avoidServerIds } }, select: { hostId: true } }))
            .map((s) => s.hostId)
            .filter((h): h is string => !!h)
        : [];

      const hosts = await this.prisma.host.findMany({
        where: { regionId: req.regionId, status: 'active', id: req.onlyHostId ? { equals: req.onlyHostId, notIn: avoidHostIds } : { notIn: avoidHostIds } },
      });

      const staleAfter = Date.now() - 3 * 60_000;
      const candidates = hosts
        .filter((h) => !h.lastHeartbeatAt || h.lastHeartbeatAt.getTime() > staleAfter || h.driver === 'fake')
        .filter((h) => h.usedMemoryMb + req.memoryMb <= h.totalMemoryMb)
        .filter((h) => h.usedVcpu + req.vcpu <= h.totalVcpu * h.overcommitCpu)
        .filter((h) => h.usedDiskGb + req.diskGb <= h.totalDiskGb)
        .filter((h) => !req.family || req.family === 'shared' || (h.labels as Record<string, unknown>)?.family === req.family)
        .sort((a, b) => a.usedMemoryMb / a.totalMemoryMb - b.usedMemoryMb / b.totalMemoryMb);

      const host = candidates[0];
      if (!host) {
        this.log.warn(`no capacity in ${req.regionId} for ${req.vcpu}vcpu/${req.memoryMb}MB`);
        throw ApiError.quota('No capacity available in this region right now', { region: req.regionId, code: 'no_capacity' });
      }

      await this.prisma.host.update({
        where: { id: host.id },
        data: { usedVcpu: { increment: req.vcpu }, usedMemoryMb: { increment: req.memoryMb }, usedDiskGb: { increment: req.diskGb } },
      });
      return { hostId: host.id, driverRef: host.driverRef };
    } finally {
      await release();
    }
  }

  /** Returns capacity reserved by `place` (on delete or failed provisioning). */
  async release(hostId: string, size: { vcpu: number; memoryMb: number; diskGb: number }) {
    await this.prisma.host.update({
      where: { id: hostId },
      data: { usedVcpu: { decrement: size.vcpu }, usedMemoryMb: { decrement: size.memoryMb }, usedDiskGb: { decrement: size.diskGb } },
    });
  }

  /**
   * Subscribes to host heartbeats; authoritative capacity comes from the agent. A heartbeat
   * brings a host that was marked down back to active, but never overrides a status an admin
   * set (draining, maintenance).
   */
  listenHeartbeats() {
    this.nats.subscribe<Heartbeat>(Subjects.hostHeartbeat, async (hb) => {
      await this.prisma.host.update({
        where: { id: hb.hostId },
        data: {
          totalVcpu: hb.totalVcpu,
          totalMemoryMb: hb.totalMemoryMb,
          totalDiskGb: hb.totalDiskGb,
          usedVcpu: hb.usedVcpu,
          usedMemoryMb: hb.usedMemoryMb,
          usedDiskGb: hb.usedDiskGb,
          lastHeartbeatAt: new Date(hb.at),
        },
      }).catch((e) => this.log.warn(`heartbeat for unknown host ${hb.hostId}: ${e.message}`));
      await this.prisma.host.updateMany({ where: { id: hb.hostId, status: 'down' }, data: { status: 'active' } });
    });
  }

  private async waitLock(key: string, ttlMs: number) {
    for (let i = 0; i < 50; i++) {
      const release = await this.redis.lock(key, ttlMs);
      if (release) return release;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`could not acquire scheduler lock ${key}`);
  }
}
