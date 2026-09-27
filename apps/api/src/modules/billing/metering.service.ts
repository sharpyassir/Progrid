import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NatsService, Subjects } from '../../common/nats/nats.service';
import type { UsageEventV1 } from '../../drivers/agent-protocol';

/**
 * Ingests usage.v1 events from host agents into the UsageEvent hypertable, and runs
 * the control-plane fallback meter so an agent outage never makes a server free.
 */
@Injectable()
export class MeteringService {
  private readonly log = new Logger(MeteringService.name);

  constructor(private readonly prisma: PrismaService, private readonly nats: NatsService) {}

  listen() {
    this.nats.subscribe<UsageEventV1>(Subjects.usage, (e) => this.ingest([e]));
  }

  async ingest(events: UsageEventV1[]) {
    // Agents before the delta change sent cumulative since boot counters; summing those would overbill.
    events = events.filter((e) => !(e.resourceType === 'bandwidth' && e.meta?.cumulative));
    if (!events.length) return;
    await this.prisma.usageEvent.createMany({
      data: events.map((e) => ({
        at: minuteAligned(new Date(e.at)),
        resourceType: e.resourceType,
        resourceId: e.resourceId,
        projectId: e.projectId,
        hostId: e.hostId,
        quantity: e.quantity,
        unit: e.unit,
        meta: (e.meta ?? {}) as Prisma.InputJsonValue,
      })),
      skipDuplicates: true, // agent + fallback meter may both report the same minute
    });
  }

  /**
   * Fallback meter: every minute, emit one server-minute for every active server and
   * one minute per assigned public IP / snapshot GB. Duplicates from agents are dropped
   * by the unique index on (resourceType, resourceId, at).
   */
  async tickFallback(now = new Date()) {
    const at = minuteAligned(now);
    const [servers, ips, snapshots, volumes, lbs, buckets, dbs] = await Promise.all([
      // Kubernetes workers are customer capacity and bill as servers; control plane nodes, load balancer and database nodes are part of their product's price.
      this.prisma.server.findMany({ where: { status: { in: ['active', 'off', 'rebooting', 'resizing', 'rebuilding'] }, meteredSince: { not: null }, OR: [{ managedBy: null }, { managedBy: { startsWith: 'k8s:' }, tags: { has: 'worker' } }] }, select: { id: true, projectId: true, hostId: true, backupsEnabled: true, managed: true } }),
      // IPs held by a load balancer (the VIP) or its nodes are part of the load balancer price.
      this.prisma.publicIp.findMany({ where: { status: { in: ['assigned', 'reserved'] }, projectId: { not: null }, loadBalancer: null, dbCluster: null, OR: [{ serverId: null }, { server: { managedBy: null } }] }, select: { id: true, projectId: true } }),
      this.prisma.snapshot.findMany({ where: { status: 'available', kind: 'manual' }, select: { id: true, projectId: true, sizeGb: true } }),
    
      this.prisma.volume.findMany({ where: { status: { in: ['available', 'attaching', 'attached', 'detaching', 'resizing'] }, meteredSince: { not: null } }, select: { id: true, projectId: true, sizeGb: true } }),
      this.prisma.loadBalancer.findMany({ where: { status: { in: ['active', 'updating'] }, meteredSince: { not: null } }, select: { id: true, projectId: true, nodes: true } }),
      this.prisma.bucket.findMany({ where: { status: 'active', meteredSince: { not: null }, sizeBytes: { gt: 0 } }, select: { id: true, projectId: true, sizeBytes: true } }),
      this.prisma.dbCluster.findMany({ where: { status: { in: ['active', 'updating'] }, meteredSince: { not: null } }, select: { id: true, projectId: true, nodes: true } }),
    ]);
    // Support plans are team level; the charge lands on the team's oldest project.
    const liveApps = await this.prisma.platformApp.findMany({ where: { status: 'live', meteredSince: { not: null }, deletedAt: null }, select: { id: true, projectId: true, instances: true } });
    const haClusters = await this.prisma.kubeCluster.findMany({ where: { ha: true, status: { in: ['active', 'updating'] }, meteredSince: { not: null } }, select: { id: true, projectId: true } });
    const planTeams = await this.prisma.team.findMany({ where: { supportPlan: { not: 'free' }, status: { not: 'suspended' } }, select: { id: true, projects: { select: { id: true }, orderBy: { createdAt: 'asc' }, take: 1 } } });
    const data: Prisma.UsageEventCreateManyInput[] = [
      ...servers.map((s) => ({ at, resourceType: 'server' as const, resourceId: s.id, projectId: s.projectId, hostId: s.hostId, quantity: 1, unit: 'minute', meta: { source: 'fallback' } })),
      ...servers.filter((s) => s.backupsEnabled && !s.managed).map((s) => ({ at, resourceType: 'backup' as const, resourceId: s.id, projectId: s.projectId, hostId: s.hostId, quantity: 1, unit: 'minute', meta: { source: 'fallback' } })),
      ...liveApps.map((a) => ({ at, resourceType: 'app_instance' as const, resourceId: a.id, projectId: a.projectId, quantity: a.instances, unit: 'instance_minute', meta: { source: 'fallback' } })),
      ...haClusters.map((k) => ({ at, resourceType: 'kubernetes' as const, resourceId: k.id, projectId: k.projectId, quantity: 1, unit: 'minute', meta: { source: 'fallback' } })),
      ...planTeams.filter((t) => t.projects.length).map((t) => ({ at, resourceType: 'support' as const, resourceId: t.id, projectId: t.projects[0].id, quantity: 1, unit: 'minute', meta: { source: 'fallback' } })),
      ...servers.filter((s) => s.managed).map((s) => ({ at, resourceType: 'managed_server' as const, resourceId: s.id, projectId: s.projectId, hostId: s.hostId, quantity: 1, unit: 'minute', meta: { source: 'fallback' } })),
      ...ips.map((ip) => ({ at, resourceType: 'public_ip' as const, resourceId: ip.id, projectId: ip.projectId!, quantity: 1, unit: 'minute', meta: { source: 'fallback' } })),
      ...snapshots.map((sn) => ({ at, resourceType: 'snapshot' as const, resourceId: sn.id, projectId: sn.projectId, quantity: sn.sizeGb, unit: 'gb_minute', meta: { source: 'fallback' } })),
      ...volumes.map((v) => ({ at, resourceType: 'volume' as const, resourceId: v.id, projectId: v.projectId, quantity: v.sizeGb, unit: 'gb_minute', meta: { source: 'fallback' } })),
      ...buckets.map((b) => ({ at, resourceType: 'object_storage' as const, resourceId: b.id, projectId: b.projectId, quantity: Number(b.sizeBytes) / 1e9, unit: 'gb_minute', meta: { source: 'fallback' } })),
      ...dbs.map((d) => ({ at, resourceType: 'database' as const, resourceId: d.id, projectId: d.projectId, quantity: d.nodes, unit: 'node_minute', meta: { source: 'fallback' } })),
      ...lbs.map((lb) => ({ at, resourceType: 'load_balancer' as const, resourceId: lb.id, projectId: lb.projectId, quantity: lb.nodes, unit: 'node_minute', meta: { source: 'fallback' } })),
    ];
    if (!data.length) return 0;
    const r = await this.prisma.usageEvent.createMany({ data, skipDuplicates: true });
    this.log.debug(`fallback meter wrote ${r.count}/${data.length} events for ${at.toISOString()}`);
    return r.count;
  }
}

function minuteAligned(d: Date) {
  return new Date(Math.floor(d.getTime() / 60_000) * 60_000);
}
