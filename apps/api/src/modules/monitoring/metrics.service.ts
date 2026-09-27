import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NatsService, Subjects } from '../../common/nats/nats.service';
import { ApiError } from '../../common/errors/api-error';
import { loadConfig } from '../../config/config';
import type { MetricSampleV1 } from '../../drivers/agent-protocol';
import type { Actor } from '../../common/auth/actor';

export type Period = '1h' | '6h' | '24h' | '7d' | '30d';
const PERIODS: Record<Period, { ms: number; hourly: boolean }> = {
  '1h': { ms: 3_600_000, hourly: false },
  '6h': { ms: 6 * 3_600_000, hourly: false },
  '24h': { ms: 24 * 3_600_000, hourly: false },
  '7d': { ms: 7 * 86_400_000, hourly: true },
  '30d': { ms: 30 * 86_400_000, hourly: true },
};
const RAW_RETENTION_DAYS = 14;
const HOURLY_RETENTION_DAYS = 365;

/**
 * Server metrics: ingests metrics.v1 from host agents (deriving per second rates from the
 * agent's cumulative counters), fabricates samples for the fake driver, serves time series,
 * rolls raw minutes into hours and enforces retention.
 */
@Injectable()
export class MetricsService {
  private readonly log = new Logger(MetricsService.name);

  constructor(private readonly prisma: PrismaService, private readonly nats: NatsService) {}

  listen() {
    this.nats.subscribe<MetricSampleV1>(Subjects.metrics, (s) => this.ingest(s).catch((e) => this.log.warn(`ingest: ${e.message}`)));
  }

  async ingest(s: MetricSampleV1) {
    const at = minute(new Date(s.at));
    const cursor = await this.prisma.metricCursor.findUnique({ where: { serverId: s.serverId } });
    const rate = (now: number, prev: bigint | undefined, dt: number) => (prev === undefined || dt <= 0 || now < Number(prev) ? 0 : (now - Number(prev)) / dt);
    const dt = cursor ? (at.getTime() - cursor.at.getTime()) / 1000 : 0;
    const row: Prisma.MetricSampleCreateInput = {
      serverId: s.serverId, at,
      cpuPercent: round(s.cpuPercent), memoryUsedMb: Math.round(s.memoryUsedMb), memoryTotalMb: Math.round(s.memoryTotalMb),
      netInBps: round(rate(s.netInBytes, cursor?.netInBytes, dt)), netOutBps: round(rate(s.netOutBytes, cursor?.netOutBytes, dt)),
      diskReadBps: round(rate(s.diskReadBytes, cursor?.diskReadBytes, dt)), diskWriteBps: round(rate(s.diskWriteBytes, cursor?.diskWriteBytes, dt)),
    };
    await this.prisma.$transaction([
      this.prisma.metricSample.upsert({ where: { serverId_at: { serverId: s.serverId, at } }, create: row, update: row }),
      this.prisma.metricCursor.upsert({
        where: { serverId: s.serverId },
        create: { serverId: s.serverId, at, netInBytes: BigInt(s.netInBytes), netOutBytes: BigInt(s.netOutBytes), diskReadBytes: BigInt(s.diskReadBytes), diskWriteBytes: BigInt(s.diskWriteBytes) },
        update: { at, netInBytes: BigInt(s.netInBytes), netOutBytes: BigInt(s.netOutBytes), diskReadBytes: BigInt(s.diskReadBytes), diskWriteBytes: BigInt(s.diskWriteBytes) },
      }),
    ]);
  }

  /**
   * Fake driver only: one plausible sample per minute per server so graphs and alerts can be
   * exercised without a hypervisor. A server tagged `load-test` runs hot, which is how the
   * alert path is demonstrated. Real numbers come from the host agent.
   */
  async tickSynthetic(now = new Date()) {
    if (loadConfig().HYPERVISOR_DRIVER !== 'fake') return 0;
    const at = minute(now);
    const servers = await this.prisma.server.findMany({ where: { status: { in: ['active', 'rebooting', 'resizing', 'rebuilding'] }, deletedAt: null }, select: { id: true, memoryMb: true, tags: true } });
    if (!servers.length) return 0;
    const t = at.getTime() / 60_000;
    const data = servers.map((s, i) => {
      const hot = s.tags.includes('load-test');
      const phase = (t + i * 7) / 17;
      const cpu = hot ? 88 + 8 * Math.sin(phase) : 12 + 10 * Math.sin(phase) + 4 * Math.sin(phase * 3.7) + hash(s.id + t) * 6;
      const memFrac = hot ? 0.82 + 0.05 * Math.sin(phase / 2) : 0.35 + 0.08 * Math.sin(phase / 3) + i * 0.02;
      const netOut = (hot ? 14e6 : 2e5) * (1 + 0.5 * Math.sin(phase * 2)) + hash(s.id + t + 1) * 5e4;
      return {
        serverId: s.id, at,
        cpuPercent: round(clamp(cpu, 0, 100)), memoryUsedMb: Math.round(s.memoryMb * clamp(memFrac, 0.05, 0.98)), memoryTotalMb: s.memoryMb,
        netInBps: round(netOut * 0.3), netOutBps: round(netOut), diskReadBps: round(3e5 * hash(s.id + t + 2)), diskWriteBps: round(9e5 * hash(s.id + t + 3)),
        diskUsedPercent: round(clamp(22 + i * 3 + (t % 1440) / 300, 0, 100)),
      };
    });
    const r = await this.prisma.metricSample.createMany({ data, skipDuplicates: true });
    return r.count;
  }

  async series(actor: Actor, serverId: string, period: Period = '1h') {
    const p = PERIODS[period];
    if (!p) throw ApiError.invalid('period must be one of 1h, 6h, 24h, 7d, 30d');
    const server = await this.prisma.server.findFirst({ where: { id: serverId, deletedAt: null, project: { teamId: actor.teamId, ...(actor.projectId ? { id: actor.projectId } : {}) } }, select: { id: true, memoryMb: true } });
    if (!server) throw ApiError.notFound('server', serverId);
    const from = new Date(Date.now() - p.ms);
    const rows = p.hourly
      ? await this.prisma.metricHourly.findMany({ where: { serverId, at: { gte: from } }, orderBy: { at: 'asc' } })
      : await this.prisma.metricSample.findMany({ where: { serverId, at: { gte: from } }, orderBy: { at: 'asc' } });
    // The current hour is not rolled up yet; append its raw minutes at hourly resolution.
    const extra = p.hourly ? await this.prisma.metricSample.findMany({ where: { serverId, at: { gte: new Date(Math.max(from.getTime(), rows.length ? rows[rows.length - 1].at.getTime() + 3_600_000 : from.getTime())) } }, orderBy: { at: 'asc' } }) : [];
    const points = [...rows, ...bucketHourly(extra)].map((r) => ({
      at: r.at.toISOString(), cpu: r.cpuPercent, cpuMax: 'cpuMax' in r ? r.cpuMax : undefined,
      memoryUsedMb: r.memoryUsedMb, memoryTotalMb: r.memoryTotalMb || server.memoryMb,
      netInBps: r.netInBps, netOutBps: r.netOutBps, diskReadBps: r.diskReadBps, diskWriteBps: r.diskWriteBps,
      diskUsedPercent: 'diskUsedPercent' in r ? r.diskUsedPercent : undefined,
    }));
    const latest = points[points.length - 1];
    return { serverId, period, resolution: p.hourly ? 'hour' : 'minute', from: from.toISOString(), to: new Date().toISOString(), latest: latest ?? null, points };
  }

  /** Hourly job: roll the previous hour into MetricHourly and prune old rows. */
  async rollupAndPrune(now = new Date()) {
    const hourEnd = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
    const hourStart = new Date(hourEnd.getTime() - 3_600_000);
    const rows = await this.prisma.$queryRaw<{ serverId: string; cpu: number; cpuMax: number; mem: number; memTotal: number; nin: number; nout: number; dr: number; dw: number; n: number }[]>`
      SELECT "serverId", AVG("cpuPercent") AS cpu, MAX("cpuPercent") AS "cpuMax", AVG("memoryUsedMb") AS mem, MAX("memoryTotalMb") AS "memTotal",
             AVG("netInBps") AS nin, AVG("netOutBps") AS nout, AVG("diskReadBps") AS dr, AVG("diskWriteBps") AS dw, COUNT(*)::int AS n
      FROM "MetricSample" WHERE "at" >= ${hourStart} AND "at" < ${hourEnd} GROUP BY "serverId"`;
    if (rows.length) {
      await this.prisma.metricHourly.createMany({
        data: rows.map((r) => ({ serverId: r.serverId, at: hourStart, cpuPercent: round(Number(r.cpu)), cpuMax: round(Number(r.cpuMax)), memoryUsedMb: Math.round(Number(r.mem)), memoryTotalMb: Number(r.memTotal), netInBps: round(Number(r.nin)), netOutBps: round(Number(r.nout)), diskReadBps: round(Number(r.dr)), diskWriteBps: round(Number(r.dw)), samples: r.n })),
        skipDuplicates: true,
      });
    }
    const [a, b] = await Promise.all([
      this.prisma.metricSample.deleteMany({ where: { at: { lt: new Date(now.getTime() - RAW_RETENTION_DAYS * 86_400_000) } } }),
      this.prisma.metricHourly.deleteMany({ where: { at: { lt: new Date(now.getTime() - HOURLY_RETENTION_DAYS * 86_400_000) } } }),
    ]);
    this.log.log(`rolled up ${rows.length} servers for ${hourStart.toISOString()}, pruned ${a.count} raw and ${b.count} hourly rows`);
    return rows.length;
  }
}

function bucketHourly<T extends { at: Date; cpuPercent: number; memoryUsedMb: number; memoryTotalMb: number; netInBps: number; netOutBps: number; diskReadBps: number; diskWriteBps: number }>(rows: T[]) {
  const buckets = new Map<number, T[]>();
  for (const r of rows) {
    const k = Math.floor(r.at.getTime() / 3_600_000) * 3_600_000;
    buckets.set(k, [...(buckets.get(k) ?? []), r]);
  }
  return [...buckets.entries()].map(([k, rs]) => {
    const avg = (f: (r: T) => number) => rs.reduce((s, r) => s + f(r), 0) / rs.length;
    return { at: new Date(k), cpuPercent: round(avg((r) => r.cpuPercent)), cpuMax: round(Math.max(...rs.map((r) => r.cpuPercent))), memoryUsedMb: Math.round(avg((r) => r.memoryUsedMb)), memoryTotalMb: rs[rs.length - 1].memoryTotalMb, netInBps: round(avg((r) => r.netInBps)), netOutBps: round(avg((r) => r.netOutBps)), diskReadBps: round(avg((r) => r.diskReadBps)), diskWriteBps: round(avg((r) => r.diskWriteBps)), samples: rs.length };
  });
}

/**
 * Disk usage reported from inside a VM (managed care reporter, database agents): the host
 * agent cannot see the guest's filesystem. The value goes onto the samples of the last five
 * minutes, or a sample of its own when there are none, so the disk alert has something to average.
 */
export async function recordDiskUsage(prisma: PrismaService, serverId: string, percent: number | undefined | null, at = new Date()) {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return;
  const value = round(clamp(percent, 0, 100));
  const r = await prisma.metricSample.updateMany({ where: { serverId, at: { gte: new Date(at.getTime() - 5 * 60_000) } }, data: { diskUsedPercent: value } });
  if (!r.count) await prisma.metricSample.createMany({ data: [{ serverId, at: minute(at), diskUsedPercent: value }], skipDuplicates: true });
}

const minute = (d: Date) => new Date(Math.floor(d.getTime() / 60_000) * 60_000);
const round = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
/** Deterministic noise in [0, 1) so synthetic series look alive but repeat across restarts. */
function hash(s: string | number) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}
