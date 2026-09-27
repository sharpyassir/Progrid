import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TemporalService } from '../../common/temporal/temporal.service';
import type { Actor } from '../../common/auth/actor';
import { ApiError } from '../../common/errors/api-error';
import { IamService } from '../iam/iam.service';
import { TrustService } from '../trust/trust.service';
import { EventsService } from '../events/events.service';
import { SpendService } from '../billing/spend.service';
import { ServersService } from '../compute/servers.service';
import { FirewallsService } from '../network/firewalls.service';
import { IpsService } from '../network/ips.service';
import { LoadBalancersService } from '../lb/lb.service';
import { VolumesService } from '../storage/volumes.service';
import { OBJECT_STORAGE_PROVIDER, ObjectStorageProvider, emptyAndDeleteBucket } from '../storage/objects/objects.provider';
import { renderKubeCloudInit } from './cloud-init';
import { loadConfig } from '../../config/config';
import { agentHost, vipNetworkFor, vrrpPass } from '../../common/platform-agent';
import { CreateClusterDto, DEFAULT_CONTROL_SIZE, KUBE_VERSIONS, MAX_POOLS, NodePoolDto, ScalePoolDto, UpdateClusterDto } from './k8s.dto';

const NODE_IMAGE = 'ubuntu-24-04';
const PRIVATE_NET = '10.0.0.0/8';
const API_PORT = 6443;
/** Owner of platform buckets: not a customer project, so they are neither listed nor billed. */
const PLATFORM_PROJECT = 'platform';

const kubeInclude = {
  region: { select: { id: true, name: true } },
  controlSize: { select: { id: true, vcpu: true, memoryMb: true, diskGb: true } },
  publicIp: { select: { address: true } },
  pools: { include: { size: { select: { id: true, vcpu: true, memoryMb: true, diskGb: true } } }, orderBy: { createdAt: 'asc' as const } },
  nodes: { include: { server: { select: { id: true, name: true, status: true, statusMessage: true, privateIp: true, publicIps: { select: { address: true } } } } }, orderBy: [{ role: 'asc' as const }, { index: 'asc' as const }] },
} satisfies Prisma.KubeClusterInclude;
type KubeRow = Prisma.KubeClusterGetPayload<{ include: typeof kubeInclude }>;

/** What the control plane node reports. */
interface NodeStatus {
  version: number;
  initialized: boolean;
  mounted?: string[];
  caHash?: string;
  kubeconfig?: string;
  apiHealthy?: boolean;
  nodes?: { name: string; ready: boolean; version: string | null }[];
  services?: { namespace: string; name: string; uid: string; ports: { port: number; nodePort: number; protocol: string }[]; ip: string | null }[];
  pvcs?: { namespace: string; name: string; uid: string; phase: string; sizeGb: number; node: string | null }[];
  error?: string;
}

/** Cloud controller bookkeeping stored on the cluster. */
interface CloudState {
  services?: Record<string, { lbId: string; ip?: string | null; ports: string }>;
  volumes?: Record<string, { volumeId: string; node: string; sizeGb: number; pvName: string; mounted?: boolean; pvCreated?: boolean }>;
  deletePvs?: string[];
  removeNodes?: string[];
}

/**
 * Managed Kubernetes: kubeadm clusters on platform owned servers. One or three control plane
 * nodes behind a reserved address, worker pools as ordinary sized servers, a node agent that
 * does the joining, and a cloud controller that turns Services of type LoadBalancer into
 * platform load balancers and pgcloud-block PersistentVolumeClaims into attached volumes.
 */
@Injectable()
export class KubernetesService {
  private readonly log = new Logger(KubernetesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly temporal: TemporalService,
    private readonly iam: IamService,
    private readonly trust: TrustService,
    private readonly events: EventsService,
    private readonly spend: SpendService,
    private readonly servers: ServersService,
    private readonly firewalls: FirewallsService,
    private readonly ips: IpsService,
    private readonly lbs: LoadBalancersService,
    private readonly volumes: VolumesService,
    @Inject(OBJECT_STORAGE_PROVIDER) private readonly storage: ObjectStorageProvider,
  ) {}

  versions() {
    return { data: KUBE_VERSIONS.map((v, i) => ({ version: v, default: i === 0 })) };
  }

  async list(actor: Actor, project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    const rows = await this.prisma.kubeCluster.findMany({ where: { projectId: p.id, deletedAt: null }, include: kubeInclude, orderBy: { createdAt: 'desc' } });
    return { data: rows.map((c) => this.present(c)) };
  }

  async get(actor: Actor, id: string, project?: string) {
    return this.present(await this.own(actor, id, project));
  }

  async kubeconfig(actor: Actor, id: string, project?: string) {
    const c = await this.own(actor, id, project);
    if (!c.kubeconfig) throw ApiError.invalidState('The cluster has not finished bootstrapping; try again in a minute');
    return c.kubeconfig;
  }

  async create(actor: Actor, dto: CreateClusterDto) {
    const project = await this.iam.resolveProject(actor, dto.project);
    await this.trust.assertCanProvision(actor.teamId);
    const [region, controlSize, team] = await Promise.all([
      this.prisma.region.findUnique({ where: { id: dto.region ?? 'sa1' } }),
      this.prisma.size.findUnique({ where: { id: dto.controlSize ?? DEFAULT_CONTROL_SIZE } }),
      this.prisma.team.findUniqueOrThrow({ where: { id: actor.teamId } }),
    ]);
    if (!region?.available) throw ApiError.invalid(`Unknown or unavailable region "${dto.region}"`);
    if (!controlSize?.available || controlSize.memoryMb < 2048) throw ApiError.invalid('Control plane size must be available and have at least 2 GB of memory');
    if (await this.prisma.kubeCluster.findFirst({ where: { projectId: project.id, name: dto.name, deletedAt: null } })) throw ApiError.conflict('name_taken', `A cluster named "${dto.name}" already exists in this project`);
    if (new Set(dto.pools.map((p) => p.name)).size !== dto.pools.length) throw ApiError.invalid('Pool names must be unique');
    const sizes = await this.poolSizes(dto.pools);
    const workers = dto.pools.reduce((n, p) => n + p.count, 0);
    const control = dto.ha ? 3 : 1;
    await this.checkQuota(project.id, dto.pools.map((p) => ({ count: p.count, size: sizes.get(p.size)! })));

    // Spend: workers at the plan price, plus the HA control plane fee. Single control plane nodes are included.
    let monthly = dto.ha ? await this.spend.monthlyPriceMinor('kubernetes', 'k8s-ha', team.currency) : 0;
    for (const p of dto.pools) monthly += (await this.spend.monthlyPriceMinor('server', p.size, team.currency)) * p.count;
    await this.spend.assertCanSpend(actor, project.id, monthly);

    const freeIps = await this.prisma.publicIp.count({ where: { regionId: region.id, status: 'free' } });
    if (freeIps < control + workers + 1) throw ApiError.quota('Not enough public addresses in the region for this cluster right now');

    const vip = await this.ips.reserve(region.id, project.id);
    const fw = await this.firewalls.create(actor, project.id, { name: `k8s-${dto.name}`, rules: firewallRules(!!dto.ha) });
    const version = dto.version ?? KUBE_VERSIONS[0];
    const cluster = await this.prisma.kubeCluster.create({
      data: {
        projectId: project.id, regionId: region.id, name: dto.name, version, ha: !!dto.ha, controlSizeId: controlSize.id,
        publicIpId: vip.id, firewallId: fw.id, vmSecret: randomBytes(24).toString('base64url'), joinToken: kubeadmToken(), certKey: randomBytes(32).toString('hex'),
        pools: { create: dto.pools.map((p) => ({ name: p.name, sizeId: p.size, count: p.count, labels: p.labels ?? {}, taints: (p.taints ?? []) as object[] })) },
      },
      include: { pools: true },
    });
    // Daily etcd snapshots go to a platform owned bucket; without one they stay on the nodes.
    try {
      await this.storage.ensureUser(PLATFORM_PROJECT);
      const bucket = `pgcloud-k8s-${cluster.id.toLowerCase()}`;
      await this.storage.createBucket(PLATFORM_PROJECT, bucket);
      const key = await this.storage.createKey(PLATFORM_PROJECT);
      await this.prisma.kubeCluster.update({ where: { id: cluster.id }, data: { backupBucket: bucket, backupAccessKey: key.accessKey, backupSecretKey: key.secretKey } });
    } catch (err) {
      this.log.warn(`etcd snapshot bucket for ${cluster.id} not ready: ${(err as Error).message}`);
    }
    try {
      for (let i = 0; i < control; i++) await this.addNode(actor, cluster.id, { name: `k8s-${dto.name}-cp-${i}`, role: 'control', index: i, sizeId: controlSize.id, projectId: project.id, regionId: region.id, firewallId: fw.id, version, vmSecret: cluster.vmSecret });
      for (const pool of cluster.pools) for (let i = 0; i < pool.count; i++) await this.addNode(actor, cluster.id, { name: `k8s-${dto.name}-${pool.name}-${i}`, role: 'worker', index: i, poolId: pool.id, sizeId: pool.sizeId, projectId: project.id, regionId: region.id, firewallId: fw.id, version, vmSecret: cluster.vmSecret });
    } catch (err) {
      await this.prisma.kubeCluster.update({ where: { id: cluster.id }, data: { status: 'failed', statusMessage: `node creation failed: ${(err as Error).message}` } });
      throw err;
    }
    await this.temporal.start('createKubernetes', [{ clusterId: cluster.id }], `createKubernetes-${cluster.id}`);
    await this.events.emit('kubernetes.create_requested', { clusterId: cluster.id, name: dto.name, version, ha: !!dto.ha, workers }, { actor, resource: `kubernetes:${cluster.id}` });
    return this.present(await this.prisma.kubeCluster.findUniqueOrThrow({ where: { id: cluster.id }, include: kubeInclude }));
  }

  async update(actor: Actor, id: string, dto: UpdateClusterDto, project?: string) {
    const c = await this.own(actor, id, project);
    if (dto.name && dto.name !== c.name && (await this.prisma.kubeCluster.findFirst({ where: { projectId: c.projectId, name: dto.name, deletedAt: null } }))) throw ApiError.conflict('name_taken', `A cluster named "${dto.name}" already exists in this project`);
    await this.prisma.kubeCluster.update({ where: { id }, data: { name: dto.name } });
    return this.present(await this.own(actor, id, project));
  }

  async remove(actor: Actor, id: string, project?: string) {
    const c = await this.own(actor, id, project);
    if (c.status === 'deleting') return { id, status: 'deleting' };
    await this.prisma.kubeCluster.update({ where: { id }, data: { status: 'deleting', statusMessage: null } });
    await this.temporal.start('deleteKubernetes', [{ clusterId: id }], `deleteKubernetes-${id}`);
    await this.events.emit('kubernetes.delete_requested', { clusterId: id }, { actor, resource: `kubernetes:${id}` });
    return { id, status: 'deleting' };
  }

  // ---- node pools ----

  async addPool(actor: Actor, id: string, dto: NodePoolDto, project?: string) {
    const c = await this.own(actor, id, project);
    this.mustBeSettled(c);
    if (c.pools.length >= MAX_POOLS) throw ApiError.quota(`A cluster can have at most ${MAX_POOLS} pools`);
    if (c.pools.some((p) => p.name === dto.name)) throw ApiError.conflict('name_taken', `Pool "${dto.name}" already exists`);
    const sizes = await this.poolSizes([dto]);
    await this.checkQuota(c.projectId, [{ count: dto.count, size: sizes.get(dto.size)! }]);
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: actor.teamId } });
    await this.spend.assertCanSpend(actor, c.projectId, (await this.spend.monthlyPriceMinor('server', dto.size, team.currency)) * dto.count);
    await this.freshJoinToken(c);
    const pool = await this.prisma.kubeNodePool.create({ data: { clusterId: id, name: dto.name, sizeId: dto.size, count: dto.count, labels: dto.labels ?? {}, taints: (dto.taints ?? []) as object[] } });
    for (let i = 0; i < dto.count; i++) await this.addNode(actor, id, { name: `k8s-${c.name}-${pool.name}-${i}`, role: 'worker', index: i, poolId: pool.id, sizeId: pool.sizeId, projectId: c.projectId, regionId: c.regionId, firewallId: c.firewallId!, version: c.version, vmSecret: c.vmSecret });
    await this.bump(id, actor, 'kubernetes.pool_added', { pool: dto.name, count: dto.count });
    return this.present(await this.own(actor, id, project));
  }

  async scalePool(actor: Actor, id: string, poolId: string, dto: ScalePoolDto, project?: string) {
    const c = await this.own(actor, id, project);
    this.mustBeSettled(c);
    const pool = c.pools.find((p) => p.id === poolId);
    if (!pool) throw ApiError.notFound('pool', poolId);
    const current = c.nodes.filter((n) => n.poolId === poolId);
    if (dto.count > current.length) {
      const extra = dto.count - current.length;
      await this.checkQuota(c.projectId, [{ count: extra, size: pool.size }]);
      const team = await this.prisma.team.findUniqueOrThrow({ where: { id: actor.teamId } });
      await this.spend.assertCanSpend(actor, c.projectId, (await this.spend.monthlyPriceMinor('server', pool.sizeId, team.currency)) * extra);
      await this.freshJoinToken(c);
      const used = new Set(current.map((n) => n.index));
      let index = 0;
      for (let k = 0; k < extra; k++) {
        while (used.has(index)) index++;
        used.add(index);
        await this.addNode(actor, id, { name: `k8s-${c.name}-${pool.name}-${index}`, role: 'worker', index, poolId: pool.id, sizeId: pool.sizeId, projectId: c.projectId, regionId: c.regionId, firewallId: c.firewallId!, version: c.version, vmSecret: c.vmSecret });
      }
    } else if (dto.count < current.length) {
      const victims = [...current].sort((a, b) => b.index - a.index).slice(0, current.length - dto.count);
      await this.removeNodes(c, victims.map((n) => n.id));
    }
    await this.prisma.kubeNodePool.update({ where: { id: poolId }, data: { count: dto.count } });
    await this.bump(id, actor, 'kubernetes.pool_scaled', { pool: pool.name, count: dto.count });
    return this.present(await this.own(actor, id, project));
  }

  async removePool(actor: Actor, id: string, poolId: string, project?: string) {
    const c = await this.own(actor, id, project);
    this.mustBeSettled(c);
    const pool = c.pools.find((p) => p.id === poolId);
    if (!pool) throw ApiError.notFound('pool', poolId);
    if (c.pools.length === 1) throw ApiError.invalid('A cluster keeps at least one pool; delete the cluster instead');
    await this.removeNodes(c, c.nodes.filter((n) => n.poolId === poolId).map((n) => n.id));
    await this.prisma.kubeNodePool.delete({ where: { id: poolId } });
    await this.bump(id, actor, 'kubernetes.pool_removed', { pool: pool.name });
    return this.present(await this.own(actor, id, project));
  }

  // ---- node agents ----

  /** Push the configuration to every active node. Node 0 first; joiners need its CA hash, so they answer 409 until it is known. */
  async pushConfig(id: string): Promise<{ applied: number; nodes: number }> {
    let c = await this.prisma.kubeCluster.findUnique({ where: { id }, include: { ...kubeInclude, publicIp: { include: { block: true } } } });
    if (!c || c.deletedAt) return { applied: 0, nodes: 0 };
    const ordered = [...c.nodes].sort((a, b) => (a.role === b.role ? a.index - b.index : a.role === 'control' ? -1 : 1));
    let applied = 0;
    for (const n of ordered) {
      const ip = agentHost(n.server);
      if (!ip || n.server.status !== 'active') continue;
      if (!c.caHash && !(n.role === 'control' && n.index === 0)) {
        // Learn the CA hash from node 0 before asking anyone to join.
        const st: NodeStatus | null = await this.fetchStatus(c, ordered[0]).catch(() => null);
        if (st?.caHash) c = await this.prisma.kubeCluster.update({ where: { id }, data: { caHash: st.caHash, kubeconfig: st.kubeconfig ? Buffer.from(st.kubeconfig, 'base64').toString('utf8') : undefined }, include: { ...kubeInclude, publicIp: { include: { block: true } } } });
        else continue;
      }
      const body = this.configFor(c, n);
      try {
        const r = await fetch(`http://${ip}:9009/config`, { method: 'POST', headers: { 'X-Pgcloud-Secret': c.vmSecret, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20 * 60_000) });
        if (r.ok) {
          applied++;
          await this.prisma.kubeNode.update({ where: { id: n.id }, data: { appliedVersion: c.configVersion, lastSeenAt: new Date() } });
        } else {
          const detail = await r.text().catch(() => '');
          this.log.warn(`node ${n.server.name} did not apply config v${c.configVersion}: ${r.status} ${detail.slice(0, 300)}`);
          if (r.status === 500) throw ApiError.invalid(`Node ${n.server.name} could not apply the configuration: ${detail.slice(0, 300)}`);
        }
      } catch (err) {
        if (err instanceof ApiError) throw err;
        this.log.warn(`node ${n.server.name} unreachable: ${(err as Error).message}`);
      }
    }
    return { applied, nodes: c.nodes.length };
  }

  /** Every minute: node readiness, kubeconfig, config retries, and the cloud controller. */
  async refreshAll() {
    const clusters = await this.prisma.kubeCluster.findMany({ where: { status: { in: ['active', 'updating'] }, deletedAt: null }, include: kubeInclude });
    for (const c of clusters) {
      try {
        if (c.nodes.some((n) => n.appliedVersion < c.configVersion && n.server.status === 'active')) await this.pushConfig(c.id);
        await this.refreshOne(c.id);
      } catch (err) {
        this.log.warn(`refresh ${c.id}: ${(err as Error).message}`);
      }
    }
  }

  private async refreshOne(id: string) {
    const c = await this.prisma.kubeCluster.findUnique({ where: { id }, include: kubeInclude });
    if (!c) return;
    const node0 = c.nodes.find((n) => n.role === 'control' && n.index === 0);
    if (!node0) return;
    const st = await this.fetchStatus(c, node0).catch(() => null);
    if (!st) return;
    const data: Prisma.KubeClusterUpdateInput = {};
    if (st.caHash && st.caHash !== c.caHash) data.caHash = st.caHash;
    if (st.kubeconfig) {
      const kc = Buffer.from(st.kubeconfig, 'base64').toString('utf8');
      if (kc !== c.kubeconfig) data.kubeconfig = kc;
    }
    if (Object.keys(data).length) await this.prisma.kubeCluster.update({ where: { id }, data });
    // Node readiness and versions, by node name.
    const byName = new Map((st.nodes ?? []).map((n) => [n.name, n]));
    for (const n of c.nodes) {
      const k = byName.get(n.server.name);
      await this.prisma.kubeNode.update({ where: { id: n.id }, data: { ready: k?.ready ?? false, kubeVersion: k?.version ?? n.kubeVersion, lastSeenAt: k ? new Date() : n.lastSeenAt } });
    }
    // Worker mounts, for the volume controller.
    const mounted = new Set<string>();
    for (const n of c.nodes) {
      if (n.role !== 'worker' || n.server.status !== 'active') continue;
      const ws = await this.fetchStatus(c, n).catch(() => null);
      for (const id of ws?.mounted ?? []) mounted.add(id);
    }
    const changed = await this.reconcileCloud(c, st, mounted);
    if (changed) await this.bump(c.id, null, 'kubernetes.cloud_updated', {});
    if (c.status === 'updating' && c.nodes.every((n) => n.appliedVersion >= c.configVersion)) await this.prisma.kubeCluster.update({ where: { id: c.id }, data: { status: 'active' } });
  }

  /**
   * The cloud controller. Services of type LoadBalancer get a platform load balancer whose
   * targets are the cluster's workers by tag; pending pgcloud-block claims get a volume
   * attached to the node the scheduler picked. Returns true when the config must be pushed.
   */
  private async reconcileCloud(c: KubeRow, st: NodeStatus, mounted: Set<string>) {
    const state = (c.cloudState ?? {}) as CloudState;
    state.services ??= {};
    state.volumes ??= {};
    let changed = false;
    const actor = await this.systemActor(c);

    // ---- load balancers ----
    const seen = new Set<string>();
    for (const svc of st.services ?? []) {
      const key = `${svc.namespace}/${svc.name}`;
      seen.add(key);
      const ports = svc.ports.filter((p) => p.protocol === 'TCP');
      if (!ports.length) continue;
      const sig = ports.map((p) => `${p.port}:${p.nodePort}`).join(',');
      const cur = state.services[key];
      if (!cur) {
        const lb = await this.lbs.create(actor, {
          name: lbName(c, svc.namespace, svc.name), region: c.regionId, project: c.projectId, tag: `k8s-${c.id}`,
          forwardingRules: ports.map((p) => ({ entryProtocol: 'tcp' as const, entryPort: p.port, targetProtocol: 'tcp' as const, targetPort: p.nodePort })),
          healthCheck: { protocol: 'tcp' as const, port: ports[0].nodePort },
        });
        state.services[key] = { lbId: lb.id, ip: null, ports: sig };
        changed = true;
        continue;
      }
      const lb = await this.prisma.loadBalancer.findUnique({ where: { id: cur.lbId }, include: { publicIp: { select: { address: true } } } });
      if (!lb || lb.status === 'deleted') {
        delete state.services[key];
        changed = true;
        continue;
      }
      if (cur.ports !== sig && lb.status === 'active') {
        await this.lbs.update(actor, cur.lbId, { forwardingRules: ports.map((p) => ({ entryProtocol: 'tcp' as const, entryPort: p.port, targetProtocol: 'tcp' as const, targetPort: p.nodePort })), healthCheck: { protocol: 'tcp' as const, port: ports[0].nodePort } }).catch((e) => this.log.warn(`lb update ${cur.lbId}: ${e.message}`));
        cur.ports = sig;
      }
      const ip = lb.publicIp?.address ?? null;
      if (ip && (cur.ip !== ip || svc.ip !== ip)) {
        cur.ip = ip;
        changed = true;
      }
    }
    for (const key of Object.keys(state.services)) {
      if (seen.has(key)) continue;
      await this.lbs.remove(actor, state.services[key].lbId, c.projectId).catch(() => undefined);
      delete state.services[key];
      changed = true;
    }

    // ---- volumes ----
    const claims = new Map((st.pvcs ?? []).map((p) => [`${p.namespace}/${p.name}`, p]));
    for (const [key, pvc] of claims) {
      if (state.volumes[key]) continue;
      if (pvc.phase !== 'Pending' || !pvc.node) continue;
      const node = c.nodes.find((n) => n.server.name === pvc.node);
      if (!node) continue;
      const v = await this.volumes.create(actor, { name: volName(c, pvc.namespace, pvc.name), sizeGb: Math.max(10, pvc.sizeGb), region: c.regionId, project: c.projectId, serverId: node.serverId }).catch((e) => { this.log.warn(`volume for ${key}: ${e.message}`); return null; });
      if (!v) continue;
      state.volumes[key] = { volumeId: v.id, node: pvc.node, sizeGb: Math.max(10, pvc.sizeGb), pvName: `pgcloud-${v.id.slice(-10)}` };
      changed = true;
    }
    for (const [key, vol] of Object.entries(state.volumes)) {
      const claim = claims.get(key);
      if (!claim) {
        // Claim gone: release the PV, detach and delete the volume.
        const v = await this.prisma.volume.findUnique({ where: { id: vol.volumeId } });
        state.deletePvs = [...new Set([...(state.deletePvs ?? []), vol.pvName])];
        if (!v || v.status === 'deleted') {
          delete state.volumes[key];
        } else if (v.status === 'attached') {
          delete (state.volumes[key] as { mounted?: boolean }).mounted;
          if (!mounted.has(vol.volumeId)) await this.volumes.detach(actor, vol.volumeId, c.projectId).catch(() => undefined);
        } else if (v.status === 'available') {
          await this.volumes.remove(actor, vol.volumeId, c.projectId).catch(() => undefined);
        }
        changed = true;
        continue;
      }
      if (!vol.mounted && mounted.has(vol.volumeId)) {
        vol.mounted = true;
        changed = true;
      }
      if (vol.mounted && claim.phase === 'Bound' && !vol.pvCreated) {
        vol.pvCreated = true;
        changed = true;
      }
    }
    if (state.deletePvs?.length && !Object.values(state.volumes).some((v) => state.deletePvs!.includes(v.pvName))) {
      // Names already handed to node 0 in a previous push can be dropped once no volume refers to them.
      if (!changed) state.deletePvs = [];
    }
    await this.prisma.kubeCluster.update({ where: { id: c.id }, data: { cloudState: state as object } });
    return changed;
  }

  private configFor(c: KubeRow & { publicIp: { address: string; block: { cidr: string } } | null }, n: KubeRow['nodes'][number]) {
    const state = (c.cloudState ?? {}) as CloudState;
    const poolOf = new Map(c.pools.map((p) => [p.id, p]));
    const nodes = c.nodes.map((x) => ({
      index: x.index, name: x.server.name, role: x.role, ip: x.server.privateIp ?? x.server.publicIps[0]?.address ?? '127.0.0.1', isSelf: x.id === n.id,
      labels: x.poolId ? { 'pgcloud.dev/pool': poolOf.get(x.poolId)?.name ?? '', ...((poolOf.get(x.poolId)?.labels as Record<string, string>) ?? {}) } : undefined,
      taints: x.poolId ? ((poolOf.get(x.poolId)?.taints as object[]) ?? []) : undefined,
    }));
    const vip = c.publicIp?.address ?? '';
    const cfg = loadConfig();
    const volumesHere = Object.values(state.volumes ?? {}).filter((v) => v.node === n.server.name).map((v) => ({ id: v.volumeId, serial: serial(v.volumeId) }));
    return {
      version: c.configVersion,
      kubeVersion: c.version,
      cluster: { name: `k8s-${c.name}-${c.id.slice(-6)}`, vip, vrrpPass: vrrpPass(c.vmSecret), prefix: c.publicIp ? IpsService.prefixOf(c.publicIp.block.cidr) : 24, vrid: (hash(c.id) % 254) + 1, endpoint: `${vip}:${API_PORT}`, nodes },
      joinToken: c.joinToken, certKey: c.certKey, caHash: c.caHash, podCidr: c.podCidr, serviceCidr: c.serviceCidr,
      services: Object.fromEntries(Object.entries(state.services ?? {}).map(([k, v]) => [k, { ip: v.ip ?? null }])),
      volumes: volumesHere,
      pvs: Object.entries(state.volumes ?? {}).filter(([, v]) => v.mounted).map(([key, v]) => ({ name: v.pvName, volumeId: v.volumeId, pvcNamespace: key.split('/')[0], pvcName: key.split('/')[1], node: v.node, sizeGb: v.sizeGb, path: `/var/lib/pgcloud/volumes/${v.volumeId}` })),
      deletePvs: state.deletePvs ?? [],
      removeNodes: state.removeNodes ?? [],
      backup: c.backupBucket ? { endpoint: cfg.S3_ENDPOINT, region: cfg.S3_REGION, bucket: c.backupBucket, accessKey: c.backupAccessKey, secretKey: c.backupSecretKey } : null,
    };
  }

  private async fetchStatus(c: { vmSecret: string }, n: { server: { id: string; name: string; privateIp: string | null; publicIps: { address: string }[]; status: string } }): Promise<NodeStatus | null> {
    const ip = agentHost(n.server);
    if (!ip || n.server.status !== 'active') return null;
    const r = await fetch(`http://${ip}:9009/status`, { headers: { 'X-Pgcloud-Secret': c.vmSecret }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    return (await r.json()) as NodeStatus;
  }

  /** Bootstrap tokens live 24 hours: nodes added later join with a fresh one from node 0. */
  private async freshJoinToken(c: KubeRow) {
    if (!c.caHash) return; // still bootstrapping: the token from creation is valid
    const node0 = c.nodes.find((n) => n.role === 'control' && n.index === 0);
    const ip = node0 && node0.server.status === 'active' ? agentHost(node0.server) : null;
    if (!ip) throw ApiError.invalidState('The first control plane node is not reachable; try again in a minute');
    const r = await fetch(`http://${ip}:9009/join-token`, { method: 'POST', headers: { 'X-Pgcloud-Secret': c.vmSecret }, signal: AbortSignal.timeout(30_000) }).catch(() => null);
    const token = r?.ok ? ((await r.json()) as { token?: string }).token : undefined;
    if (!token || !/^[a-z0-9]{6}\.[a-z0-9]{16}$/.test(token)) throw ApiError.invalidState('The control plane could not issue a join token; try again in a minute');
    await this.prisma.kubeCluster.update({ where: { id: c.id }, data: { joinToken: token } });
  }

  /** On delete: remove the etcd snapshot bucket and its key. */
  async purgeBackups(clusterId: string) {
    const c = await this.prisma.kubeCluster.findUnique({ where: { id: clusterId } });
    if (!c?.backupBucket) return 0;
    const removed = await emptyAndDeleteBucket(this.storage, PLATFORM_PROJECT, c.backupBucket);
    if (c.backupAccessKey) await this.storage.deleteKey(PLATFORM_PROJECT, c.backupAccessKey).catch(() => undefined);
    await this.prisma.kubeCluster.update({ where: { id: clusterId }, data: { backupBucket: null, backupAccessKey: null, backupSecretKey: null } });
    return removed;
  }

  // ---- helpers ----

  private async addNode(actor: Actor, clusterId: string, n: { name: string; role: 'control' | 'worker'; index: number; poolId?: string; sizeId: string; projectId: string; regionId: string; firewallId: string; version: string; vmSecret: string }) {
    const vip = await this.prisma.kubeCluster.findUnique({ where: { id: clusterId }, select: { publicIp: { select: { address: true } } } });
    // Control plane nodes spread across hosts, and so do the workers of each pool.
    const spreadGroup = n.role === 'control' ? `k8s:${clusterId}:control` : `k8s:${clusterId}:pool:${n.poolId}`;
    const s = await this.servers.create(actor, { name: n.name, size: n.sizeId, image: NODE_IMAGE, project: n.projectId, region: n.regionId, firewalls: [n.firewallId], tags: ['managed-kubernetes', n.role === 'control' ? 'control-plane' : 'worker', `k8s-${clusterId}`], userData: renderKubeCloudInit({ version: n.version, vmSecret: n.vmSecret, vipNetwork: vipNetworkFor(vip?.publicIp?.address) }) }, { spreadGroup });
    await this.prisma.server.update({ where: { id: s.id }, data: { managedBy: `k8s:${clusterId}` } });
    await this.prisma.kubeNode.create({ data: { clusterId, poolId: n.poolId, serverId: s.id, index: n.index, role: n.role } });
  }

  /** Drain through node 0 on the next push, then delete the servers. */
  private async removeNodes(c: KubeRow, nodeIds: string[]) {
    const victims = c.nodes.filter((n) => nodeIds.includes(n.id));
    const state = (c.cloudState ?? {}) as CloudState;
    state.removeNodes = [...new Set([...(state.removeNodes ?? []), ...victims.map((n) => n.server.name)])];
    await this.prisma.kubeCluster.update({ where: { id: c.id }, data: { cloudState: state as object } });
    for (const n of victims) {
      const action = await this.prisma.serverAction.create({ data: { serverId: n.serverId, type: 'delete', requestedBy: 'system:k8s' } });
      await this.prisma.server.update({ where: { id: n.serverId }, data: { status: 'deleting' } });
      await this.temporal.start('deleteServer', [{ serverId: n.serverId, actionId: action.id }], `deleteServer-${action.id}`);
      await this.prisma.kubeNode.delete({ where: { id: n.id } });
    }
  }

  private async bump(id: string, actor: Actor | null, event: string, payload: Record<string, unknown>) {
    const c = await this.prisma.kubeCluster.update({ where: { id }, data: { configVersion: { increment: 1 }, status: 'updating', statusMessage: null }, include: { project: { select: { teamId: true } } } });
    await this.temporal.start('updateKubernetes', [{ clusterId: id }], `updateKubernetes-${id}-${c.configVersion}`);
    await this.events.emit(event, { clusterId: id, ...payload }, actor ? { actor, resource: `kubernetes:${id}` } : { teamId: c.project.teamId, resource: `kubernetes:${id}` });
  }

  private mustBeSettled(c: KubeRow) {
    if (!['active', 'failed'].includes(c.status)) throw ApiError.invalidState(`Cluster is ${c.status}; wait for it to settle`);
  }

  private async poolSizes(pools: { size: string }[]) {
    const sizes = await this.prisma.size.findMany({ where: { id: { in: pools.map((p) => p.size) }, available: true } });
    const map = new Map(sizes.map((s) => [s.id, s]));
    for (const p of pools) {
      const s = map.get(p.size);
      if (!s) throw ApiError.invalid(`Unknown size "${p.size}"`);
      if (s.memoryMb < 2048) throw ApiError.invalid(`Worker nodes need at least 2 GB of memory; "${p.size}" is too small`);
    }
    return map;
  }

  /** Workers count against the project's vCPU and memory quota like ordinary servers. */
  private async checkQuota(projectId: string, add: { count: number; size: { vcpu: number; memoryMb: number } }[]) {
    const [project, usage] = await Promise.all([
      this.prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
      this.prisma.server.aggregate({ where: { projectId, deletedAt: null, status: { notIn: ['deleted', 'failed'] }, OR: [{ managedBy: null }, { managedBy: { startsWith: 'k8s:' } }] }, _sum: { vcpu: true, memoryMb: true } }),
    ]);
    const vcpu = add.reduce((n, a) => n + a.count * a.size.vcpu, 0);
    const mem = add.reduce((n, a) => n + a.count * a.size.memoryMb, 0);
    if ((usage._sum.vcpu ?? 0) + vcpu > project.quotaVcpu) throw ApiError.quota(`Project vCPU quota (${project.quotaVcpu}) reached`);
    if ((usage._sum.memoryMb ?? 0) + mem > project.quotaMemoryMb) throw ApiError.quota(`Project memory quota (${project.quotaMemoryMb} MB) reached`);
  }

  /** The cloud controller acts as the team owner on the cluster's project. */
  private async systemActor(c: KubeRow): Promise<Actor> {
    const owner = await this.prisma.teamMember.findFirst({ where: { team: { projects: { some: { id: c.projectId } } }, role: 'owner' }, orderBy: { userId: 'asc' } });
    const team = await this.prisma.project.findUniqueOrThrow({ where: { id: c.projectId }, select: { teamId: true } });
    return { userId: owner?.userId ?? 'system', teamId: team.teamId, role: 'owner', projectId: c.projectId, scopes: new Set(['*']), isAgent: false, requireApprovalFor: new Set(), locale: 'en' };
  }

  private async own(actor: Actor, id: string, project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    const c = await this.prisma.kubeCluster.findFirst({ where: { id, projectId: p.id, deletedAt: null }, include: kubeInclude });
    if (!c) throw ApiError.notFound('kubernetes cluster', id);
    return c;
  }

  present(c: KubeRow) {
    const state = (c.cloudState ?? {}) as CloudState;
    const host = c.publicIp?.address ?? null;
    const node = (n: KubeRow['nodes'][number]) => ({ id: n.id, name: n.server.name, role: n.role, index: n.index, poolId: n.poolId, status: n.server.status, ready: n.ready, kubeVersion: n.kubeVersion, ip: n.server.publicIps[0]?.address ?? null, privateIp: n.server.privateIp, lastSeenAt: n.lastSeenAt });
    return {
      id: c.id, name: c.name, version: c.version, status: c.status, statusMessage: c.statusMessage, ha: !!c.ha,
      region: c.region, controlSize: c.controlSize, endpoint: host ? `https://${host}:${API_PORT}` : null, host,
      podCidr: c.podCidr, serviceCidr: c.serviceCidr, configVersion: c.configVersion,
      pools: c.pools.map((p) => ({ id: p.id, name: p.name, size: p.size, count: p.count, labels: p.labels, taints: p.taints, nodes: c.nodes.filter((n) => n.poolId === p.id).map(node) })),
      controlPlane: c.nodes.filter((n) => n.role === 'control').map(node),
      cloud: {
        loadBalancers: Object.entries(state.services ?? {}).map(([service, v]) => ({ service, loadBalancerId: v.lbId, ip: v.ip ?? null })),
        volumes: Object.entries(state.volumes ?? {}).map(([claim, v]) => ({ claim, volumeId: v.volumeId, node: v.node, sizeGb: v.sizeGb, mounted: !!v.mounted })),
      },
      workers: c.nodes.filter((n) => n.role === 'worker').length,
      readyNodes: c.nodes.filter((n) => n.ready).length,
      projectId: c.projectId,
      createdAt: c.createdAt,
    };
  }
}

function firewallRules(ha: boolean) {
  const cp = loadConfig().CONTROL_PLANE_CIDR;
  return [
    { direction: 'inbound' as const, protocol: 'tcp' as const, ports: '22', cidrs: [cp], description: 'platform ssh' },
    { direction: 'inbound' as const, protocol: 'tcp' as const, ports: String(API_PORT), cidrs: ['0.0.0.0/0', '::/0'], description: 'kubernetes api' },
    { direction: 'inbound' as const, protocol: 'tcp' as const, ports: String(API_PORT), cidrs: [PRIVATE_NET], description: 'kubernetes api between nodes' },
    { direction: 'inbound' as const, protocol: 'tcp' as const, ports: '30000-32767', cidrs: ['0.0.0.0/0', '::/0'], description: 'node ports' },
    { direction: 'inbound' as const, protocol: 'udp' as const, ports: '30000-32767', cidrs: ['0.0.0.0/0', '::/0'], description: 'node ports' },
    { direction: 'inbound' as const, protocol: 'tcp' as const, ports: '2379-2380', cidrs: [PRIVATE_NET], description: 'etcd' },
    { direction: 'inbound' as const, protocol: 'tcp' as const, ports: '10250-10260', cidrs: [PRIVATE_NET], description: 'kubelet (10250) and controllers between nodes' },
    { direction: 'inbound' as const, protocol: 'udp' as const, ports: '8472', cidrs: [PRIVATE_NET], description: 'flannel vxlan between nodes' },
    { direction: 'inbound' as const, protocol: 'tcp' as const, ports: '9009', cidrs: [cp], description: 'pgcloud node agent' },
    ...(ha ? [{ direction: 'inbound' as const, protocol: 'vrrp' as const, cidrs: [PRIVATE_NET], description: 'keepalived between control plane nodes' }] : []),
    { direction: 'outbound' as const, protocol: 'any' as const, cidrs: ['0.0.0.0/0'] },
  ];
}

/** kubeadm bootstrap token: [a-z0-9]{6}.[a-z0-9]{16}. */
function kubeadmToken() {
  const part = (n: number) => randomBytes(n).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, 'x').slice(0, n);
  return `${part(6)}.${part(16)}`;
}

function lbName(c: { name: string; id: string }, ns: string, name: string) {
  return `k8s-${c.name}-${ns}-${name}`.replace(/[^a-z0-9-]/g, '-').slice(0, 60).replace(/-+$/, '');
}

function volName(c: { name: string }, ns: string, name: string) {
  return `k8s-${c.name}-${ns}-${name}`.replace(/[^a-z0-9-]/g, '-').slice(0, 60).replace(/-+$/, '');
}

/** SCSI serial the guest sees in /dev/disk/by-id (same rule as the volume workflow). */
function serial(volumeId: string) {
  return volumeId.replace(/[^a-zA-Z0-9]/g, '').slice(-20);
}

function hash(s: string) {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}
