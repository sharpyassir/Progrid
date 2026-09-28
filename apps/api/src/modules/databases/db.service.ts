import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TemporalService } from '../../common/temporal/temporal.service';
import type { Actor } from '../../common/auth/actor';
import { ApiError } from '../../common/errors/api-error';
import { loadConfig } from '../../config/config';
import { IamService } from '../iam/iam.service';
import { TrustService } from '../trust/trust.service';
import { EventsService } from '../events/events.service';
import { SpendService } from '../billing/spend.service';
import { ServersService } from '../compute/servers.service';
import { FirewallsService } from '../network/firewalls.service';
import { IpsService } from '../network/ips.service';
import { PrivateNetworksService } from '../network/private-networks.service';
import { OBJECT_STORAGE_PROVIDER, ObjectStorageProvider, emptyAndDeleteBucket } from '../storage/objects/objects.provider';
import { renderDbCloudInit } from './cloud-init';
import { recordDiskUsage } from '../monitoring/metrics.service';
import { agentFetch, agentHost, vipNetworkFor, vrrpPass } from '../../common/platform-agent';
import { CreateDatabaseDto, DbNameDto, ENGINE_PORTS, ENGINE_VERSIONS, RestoreDatabaseDto, UpdateDatabaseDto } from './db.dto';

const NODE_IMAGE = 'ubuntu-24-04';
/** Owner of backup buckets: not a customer project, so they are neither listed nor billed. */
const PLATFORM_PROJECT = 'platform';

/** What GET /status on a node reports. */
interface NodeReport {
  version: number;
  role: string;
  lagBytes: number | null;
  diskUsedPercent?: number;
  backups: { id: string; status: string; sizeBytes?: number; completedAt?: number; error?: string | null; ref?: string }[];
  restore?: { id: string; status: 'running' | 'completed' | 'failed'; error?: string } | null;
}

const dbInclude = {
  size: true,
  publicIp: { select: { address: true } },
  nodeServers: { include: { server: { select: { id: true, name: true, status: true, privateIp: true, publicIps: { select: { address: true } } } } }, orderBy: { index: 'asc' as const } },
  users: { orderBy: { createdAt: 'asc' as const } },
  databases: { orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.DbClusterInclude;
type DbRow = Prisma.DbClusterGetPayload<{ include: typeof dbInclude }>;

/**
 * Managed databases. A cluster is one or three platform owned node VMs (Server rows with
 * managedBy = "db:<id>") plus a VIP that keepalived keeps on the primary. The service owns
 * the desired state; workflows create the nodes and push config; a minute job reads roles,
 * lag and backups back from the nodes. Postgres runs Patroni with etcd on the nodes,
 * pgBouncer in front and pgBackRest to a platform bucket for nightly backups.
 */
@Injectable()
export class DatabasesService {
  private readonly log = new Logger(DatabasesService.name);
  /** Nodes already reported as unreachable, so the event goes out once per outage. */
  private readonly unreachable = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly iam: IamService,
    private readonly trust: TrustService,
    private readonly temporal: TemporalService,
    private readonly events: EventsService,
    private readonly spend: SpendService,
    private readonly servers: ServersService,
    private readonly firewalls: FirewallsService,
    private readonly ips: IpsService,
    private readonly privateNetworks: PrivateNetworksService,
    @Inject(OBJECT_STORAGE_PROVIDER) private readonly storage: ObjectStorageProvider,
  ) {}

  /** Cluster traffic (replication, etcd, VRRP) is allowed from the project's own private network only, never other tenants. */
  private async projectNet(projectId: string, regionId: string) {
    return (await this.privateNetworks.ensureNetwork(projectId, regionId)).cidr;
  }

  async list(actor: Actor, project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    const rows = await this.prisma.dbCluster.findMany({ where: { projectId: p.id, deletedAt: null }, include: dbInclude, orderBy: { createdAt: 'desc' } });
    return { data: rows.map((c) => this.present(c, false)) };
  }

  async get(actor: Actor, id: string, project?: string) {
    return this.present(await this.own(actor, id, project), true);
  }

  async create(actor: Actor, dto: CreateDatabaseDto) {
    const project = await this.iam.resolveProject(actor, dto.project);
    await this.trust.assertCanProvision(actor.teamId);
    const region = await this.prisma.region.findUnique({ where: { id: dto.region ?? loadConfig().DEFAULT_REGION } });
    if (!region?.available) throw ApiError.invalid(`Unknown or unavailable region "${dto.region}"`);
    const version = dto.version ?? ENGINE_VERSIONS[dto.engine][0];
    if (!ENGINE_VERSIONS[dto.engine].includes(version)) throw ApiError.invalid(`Unknown ${dto.engine} version "${version}"; available: ${ENGINE_VERSIONS[dto.engine].join(', ')}`);
    const size = await this.prisma.size.findUnique({ where: { id: dto.size } });
    if (!size?.available || size.memoryMb < 1024) throw ApiError.invalid(`Unknown size "${dto.size}" or too small for a database (1 GB of memory at least)`);
    if (await this.prisma.dbCluster.findFirst({ where: { projectId: project.id, name: dto.name, deletedAt: null } })) throw ApiError.conflict('name_taken', `A database named "${dto.name}" already exists in this project`);
    const trusted = validateCidrs(dto.trustedSources ?? []);
    const nodes = dto.nodes ?? 1;

    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: actor.teamId } });
    await this.spend.assertCanSpend(actor, project.id, (await this.spend.monthlyPriceMinor('database', `db-${size.id}`, team.currency)) * nodes);

    // Everything below allocates resources, so check capacity first: free IPs for the VIP and the nodes.
    const freeIps = await this.prisma.publicIp.count({ where: { regionId: region.id, status: 'free' } });
    if (freeIps < nodes + 1) throw ApiError.quota('Not enough public addresses in the region for this cluster right now');

    const vip = await this.ips.reserve(region.id, project.id);
    const port = ENGINE_PORTS[dto.engine];
    const fw = await this.firewalls.create(actor, project.id, { name: `db-${dto.name}`, rules: firewallRules(dto.engine, port, trusted, nodes, await this.projectNet(project.id, region.id)) });
    const vmSecret = randomBytes(24).toString('base64url');
    const cluster = await this.prisma.dbCluster.create({
      data: {
        projectId: project.id, regionId: region.id, name: dto.name, engine: dto.engine, version, nodes, sizeId: size.id, port,
        adminUser: 'prgd_admin', adminPassword: password(), trustedSources: trusted, publicIpId: vip.id, firewallId: fw.id, vmSecret, backupHourUtc: dto.backupHourUtc ?? 2,
        databases: dto.engine === 'valkey' ? undefined : { create: { name: 'defaultdb' } },
        users: { create: { name: 'app', password: password() } },
      },
    });
    // Backups go to a platform owned bucket with a key of their own.
    try {
      await this.storage.ensureUser(PLATFORM_PROJECT);
      const bucket = `prgd-db-${cluster.id.toLowerCase()}`;
      await this.storage.createBucket(PLATFORM_PROJECT, bucket);
      const key = await this.storage.createKey(PLATFORM_PROJECT);
      await this.prisma.dbCluster.update({ where: { id: cluster.id }, data: { backupBucket: bucket, backupAccessKey: key.accessKey, backupSecretKey: key.secretKey } });
    } catch (err) {
      this.log.warn(`backup bucket for ${cluster.id} not ready: ${(err as Error).message}`);
    }
    for (let i = 0; i < nodes; i++) {
      const s = await this.servers.create(actor, { name: `db-${dto.name}-${i}`, size: size.id, image: NODE_IMAGE, project: project.id, region: region.id, firewalls: [fw.id], tags: ['managed-database'], userData: renderDbCloudInit({ engine: dto.engine, vmSecret, vipNetwork: vipNetworkFor(vip.address) }) }, { spreadGroup: `db:${cluster.id}` });
      await this.prisma.server.update({ where: { id: s.id }, data: { managedBy: `db:${cluster.id}` } });
      await this.prisma.dbNode.create({ data: { clusterId: cluster.id, serverId: s.id, index: i } });
    }
    await this.temporal.start('createDatabase', [{ clusterId: cluster.id }], `createDatabase-${cluster.id}`);
    await this.events.emit('database.create_requested', { databaseId: cluster.id, name: dto.name, engine: dto.engine, nodes, size: size.id }, { actor, resource: `database:${cluster.id}` });
    return this.get(actor, cluster.id, dto.project);
  }

  async update(actor: Actor, id: string, dto: UpdateDatabaseDto, project?: string) {
    const c = await this.own(actor, id, project);
    if (!['active', 'updating', 'failed'].includes(c.status)) throw ApiError.invalidState(`Database is ${c.status}; wait for it to settle`);
    const trusted = dto.trustedSources !== undefined ? validateCidrs(dto.trustedSources) : undefined;
    await this.prisma.dbCluster.update({ where: { id }, data: { trustedSources: trusted, backupHourUtc: dto.backupHourUtc, status: 'updating', statusMessage: null, configVersion: { increment: 1 } } });
    if (trusted && c.firewallId) await this.firewalls.replaceRules(actor, c.projectId, c.firewallId, firewallRules(c.engine, c.port, trusted, c.nodes, await this.projectNet(c.projectId, c.regionId))).catch((err) => this.log.warn(`firewall update for ${id}: ${(err as Error).message}`));
    await this.pushLater(id, actor);
    return this.get(actor, id, project);
  }

  async remove(actor: Actor, id: string, project?: string) {
    const c = await this.own(actor, id, project);
    if (c.status === 'deleting') return { id, status: 'deleting' };
    await this.prisma.dbCluster.update({ where: { id }, data: { status: 'deleting', statusMessage: null } });
    await this.temporal.start('deleteDatabase', [{ clusterId: id }], `deleteDatabase-${id}`);
    await this.events.emit('database.delete_requested', { databaseId: id }, { actor, resource: `database:${id}` });
    return { id, status: 'deleting' };
  }

  // ---- users and databases ----

  async addUser(actor: Actor, id: string, dto: DbNameDto, project?: string) {
    const c = await this.own(actor, id, project);
    if (['postgres', 'prgd_admin', 'replicator', 'root', 'mysql', 'default'].includes(dto.name)) throw ApiError.invalid('That user name is reserved');
    if (c.users.some((u) => u.name === dto.name)) throw ApiError.conflict('name_taken', `User ${dto.name} already exists`);
    if (c.users.length >= 50) throw ApiError.quota('User limit (50) reached');
    const u = await this.prisma.dbUser.create({ data: { clusterId: id, name: dto.name, password: password() } });
    await this.bump(id, actor);
    return { id: u.id, name: u.name, password: u.password, createdAt: u.createdAt };
  }

  async resetUserPassword(actor: Actor, id: string, userId: string, project?: string) {
    const c = await this.own(actor, id, project);
    const u = c.users.find((x) => x.id === userId);
    if (!u) throw ApiError.notFound('user', userId);
    const updated = await this.prisma.dbUser.update({ where: { id: userId }, data: { password: password() } });
    await this.bump(id, actor);
    return { id: updated.id, name: updated.name, password: updated.password };
  }

  async deleteUser(actor: Actor, id: string, userId: string, project?: string) {
    const c = await this.own(actor, id, project);
    if (!c.users.some((x) => x.id === userId)) throw ApiError.notFound('user', userId);
    await this.prisma.dbUser.delete({ where: { id: userId } });
    await this.bump(id, actor);
    return { id: userId, deleted: true };
  }

  async addDatabase(actor: Actor, id: string, dto: DbNameDto, project?: string) {
    const c = await this.own(actor, id, project);
    if (c.engine === 'valkey') throw ApiError.invalid('Valkey has no named databases; use key prefixes or ACL selectors');
    if (['postgres', 'template0', 'template1', 'mysql', 'sys', 'information_schema', 'performance_schema'].includes(dto.name)) throw ApiError.invalid('That database name is reserved');
    if (c.databases.some((d) => d.name === dto.name)) throw ApiError.conflict('name_taken', `Database ${dto.name} already exists`);
    if (c.databases.length >= 100) throw ApiError.quota('Database limit (100) reached');
    const d = await this.prisma.dbDatabase.create({ data: { clusterId: id, name: dto.name } });
    await this.bump(id, actor);
    return { id: d.id, name: d.name, createdAt: d.createdAt };
  }

  async deleteDatabase(actor: Actor, id: string, dbId: string, project?: string) {
    const c = await this.own(actor, id, project);
    if (!c.databases.some((x) => x.id === dbId)) throw ApiError.notFound('database', dbId);
    // The record goes; the data stays on the cluster until the customer drops it, so a slip is recoverable.
    await this.prisma.dbDatabase.delete({ where: { id: dbId } });
    await this.bump(id, actor);
    return { id: dbId, deleted: true };
  }

  // ---- backups ----

  async listBackups(actor: Actor, id: string, project?: string) {
    await this.own(actor, id, project);
    const data = await this.prisma.dbBackup.findMany({ where: { clusterId: id }, orderBy: { startedAt: 'desc' }, take: 30 });
    return { data: data.map((b) => ({ ...b, sizeBytes: b.sizeBytes == null ? null : Number(b.sizeBytes) })) };
  }

  async startBackup(actor: Actor | null, id: string, kind: 'manual' | 'scheduled', project?: string) {
    const c = actor ? await this.own(actor, id, project) : await this.prisma.dbCluster.findUniqueOrThrow({ where: { id }, include: dbInclude });
    if (!['active', 'updating'].includes(c.status)) throw ApiError.invalidState(`Database is ${c.status}`);
    if (await this.prisma.dbBackup.findFirst({ where: { clusterId: id, status: 'running', startedAt: { gt: new Date(Date.now() - 6 * 3600_000) } } })) throw ApiError.invalidState('A backup is already running');
    const b = await this.prisma.dbBackup.create({ data: { clusterId: id, kind, label: `${kind}-${new Date().toISOString().slice(0, 16)}` } });
    const primary = c.nodeServers.find((n) => n.role === 'primary') ?? c.nodeServers[0];
    const ip = primary ? agentHost(primary.server) : null;
    if (!ip) return { id: b.id, status: 'running' };
    try {
      const r = await agentFetch(ip, { method: 'POST', path: '/backup', secret: c.vmSecret, body: { id: b.id }, timeoutMs: 8000 });
      if (!r.ok) throw new Error(`node answered ${r.status}`);
    } catch (err) {
      // Nodes unreachable (or fake): the minute job will not find a result and marks it failed after six hours.
      this.log.debug(`backup ${b.id} not accepted yet: ${(err as Error).message}`);
    }
    if (actor) await this.events.emit('database.backup_requested', { databaseId: id, backupId: b.id }, { actor, resource: `database:${id}` });
    return { id: b.id, status: 'running' };
  }

  // ---- restore ----

  /** Restore a completed backup over the cluster. What each engine does is in docs/databases (Restore). */
  async restore(actor: Actor, id: string, dto: RestoreDatabaseDto, project?: string) {
    const c = await this.own(actor, id, project);
    if (c.status !== 'active') throw ApiError.invalidState(`Database is ${c.status}; a restore needs an active cluster`);
    const b = await this.prisma.dbBackup.findFirst({ where: { id: dto.backupId, clusterId: id } });
    if (!b) throw ApiError.notFound('backup', dto.backupId);
    if (b.status !== 'completed') throw ApiError.invalidState(`Backup ${b.id} is ${b.status}; only completed backups can be restored`);
    if (c.engine === 'postgres' && !b.ref) throw ApiError.invalidState('This backup has no pgBackRest label recorded; take a new backup and restore that one');
    await this.prisma.dbCluster.update({ where: { id }, data: { status: 'restoring', statusMessage: `restoring backup ${b.label ?? b.id}` } });
    await this.temporal.start('restoreDatabase', [{ clusterId: id, backupId: b.id }], `restoreDatabase-${id}-${Date.now()}`);
    await this.events.emit('database.restore_requested', { databaseId: id, backupId: b.id }, { actor, resource: `database:${id}` });
    return this.get(actor, id, project);
  }

  /**
   * Workflow side of a restore. Postgres and Valkey restore on the primary and the replicas
   * copy from it; MySQL restores every node from the same backup, primary first, so GTID auto
   * positioning lines up. Afterwards the config version moves on so users and databases made
   * after the backup come back with the next push.
   */
  async runRestore(clusterId: string, backupId: string, heartbeat: () => void = () => undefined) {
    const c = await this.prisma.dbCluster.findUniqueOrThrow({ where: { id: clusterId }, include: dbInclude });
    const b = await this.prisma.dbBackup.findUniqueOrThrow({ where: { id: backupId } });
    const active = c.nodeServers.filter((n) => n.server.status === 'active');
    const primary = active.find((n) => n.role === 'primary') ?? active[0];
    if (!primary) throw new Error('no active node to restore on');
    const primaryIp = nodeList(c).find((m) => m.index === primary.index)!.ip;
    const order = c.engine === 'mysql' ? [primary, ...active.filter((n) => n.id !== primary.id)] : [primary];
    for (const n of order) {
      const ip = agentHost(n.server);
      if (!ip) throw new Error(`node ${n.index} has no address`);
      const rid = `${backupId}-${n.index}-${Date.now()}`;
      const post = await agentFetch(ip, { method: 'POST', path: '/restore', secret: c.vmSecret, body: { id: rid, backupId, ref: b.ref, primary: n.id === primary.id, primaryIp }, timeoutMs: 10_000 });
      if (!post.ok) throw new Error(`node ${n.index} refused the restore: ${post.status} ${(await post.text().catch(() => '')).slice(0, 200)}`);
      const deadline = Date.now() + 3 * 3600_000;
      for (;;) {
        heartbeat();
        await new Promise((r) => setTimeout(r, 10_000));
        const st = await this.nodeStatus(c.vmSecret, ip).catch(() => null);
        const r = st?.restore;
        if (r?.id === rid && r.status === 'completed') break;
        if (r?.id === rid && r.status === 'failed') throw new Error(`node ${n.index}: ${r.error ?? 'restore failed'}`);
        if (Date.now() > deadline) throw new Error(`node ${n.index} did not finish the restore in three hours`);
      }
    }
    await this.prisma.dbCluster.update({ where: { id: clusterId }, data: { configVersion: { increment: 1 } } });
  }

  /**
   * Push until every node has applied the current config. Throws with the node's own error
   * when one fails to apply, or with what the nodes were waiting for at the deadline.
   */
  async waitApplied(clusterId: string, timeoutMs: number, heartbeat: () => void = () => undefined) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      heartbeat();
      const r = await this.pushConfig(clusterId);
      if (r.errors.length) throw new Error(r.errors.join('; '));
      if (r.applied === r.nodes) return r;
      if (Date.now() > deadline) throw new Error(`only ${r.applied} of ${r.nodes} nodes applied the configuration${r.waiting.length ? `: ${r.waiting.join('; ')}` : ''}`);
      await new Promise((res) => setTimeout(res, 15_000));
    }
  }

  /** On delete: empty the backup bucket, then remove it and its key. */
  async purgeBackups(clusterId: string) {
    const c = await this.prisma.dbCluster.findUnique({ where: { id: clusterId } });
    if (!c?.backupBucket) return 0;
    const removed = await emptyAndDeleteBucket(this.storage, PLATFORM_PROJECT, c.backupBucket);
    if (c.backupAccessKey) await this.storage.deleteKey(PLATFORM_PROJECT, c.backupAccessKey).catch(() => undefined);
    return removed;
  }

  private async nodeStatus(secret: string, ip: string): Promise<NodeReport> {
    const r = await agentFetch(ip, { path: '/status', secret, timeoutMs: 6000 });
    if (!r.ok) throw new Error(`status answered ${r.status}`);
    return (await r.json()) as NodeReport;
  }

  // ---- called by workflows and jobs ----

  /**
   * Renders the node configuration and POSTs it to every node that does not have it yet.
   * A node counts as applied only when it answered 200, which the agent sends once users and
   * databases exist on it. `waiting` holds nodes that answered 409 (waiting for a primary or
   * for replication), `errors` nodes that failed to apply.
   */
  async pushConfig(id: string): Promise<{ applied: number; nodes: number; waiting: string[]; errors: string[] }> {
    const c = await this.prisma.dbCluster.findUnique({ where: { id }, include: { ...dbInclude, publicIp: { include: { block: true } } } });
    if (!c || c.deletedAt) return { applied: 0, nodes: 0, waiting: [], errors: [] };
    const cfg = loadConfig();
    const nodes = nodeList(c);
    let applied = 0;
    const waiting: string[] = [];
    const errors: string[] = [];
    for (const n of c.nodeServers) {
      if (n.appliedVersion >= c.configVersion) {
        applied++;
        continue;
      }
      const ip = agentHost(n.server);
      if (!ip || n.server.status !== 'active') continue;
      const body = {
        version: c.configVersion,
        engine: c.engine,
        cluster: { name: `db-${c.name}-${c.id.slice(-6)}`, vrid: (hash(c.id) % 254) + 1, vrrpPass: vrrpPass(c.vmSecret), vip: c.publicIp?.address, prefix: c.publicIp ? IpsService.prefixOf(c.publicIp.block.cidr) : 24, nodes: nodes.map((x) => ({ ...x, isSelf: x.index === n.index })) },
        admin: { user: c.adminUser, password: c.adminPassword },
        replicationPassword: c.vmSecret,
        users: c.users.map((u) => ({ name: u.name, password: u.password })),
        databases: c.databases.map((d) => d.name),
        trustedSources: c.trustedSources.length ? c.trustedSources : undefined,
        backup: c.backupBucket ? { endpoint: cfg.S3_ENDPOINT, region: cfg.S3_REGION, bucket: c.backupBucket, accessKey: c.backupAccessKey, secretKey: c.backupSecretKey } : null,
        params: {},
      };
      try {
        const r = await agentFetch(ip, { method: 'POST', path: '/config', secret: c.vmSecret, body, timeoutMs: 120_000 });
        if (r.ok) {
          applied++;
          await this.prisma.dbNode.update({ where: { id: n.id }, data: { appliedVersion: c.configVersion, lastSeenAt: new Date() } });
        } else {
          const text = await r.text().catch(() => '');
          const detail = (() => {
            try {
              return String((JSON.parse(text) as { detail?: string }).detail ?? text);
            } catch {
              return text;
            }
          })().slice(0, 300);
          if (r.status === 409) waiting.push(`node ${n.index}: ${detail}`);
          else errors.push(`node ${n.index}: ${detail || `answered ${r.status}`}`);
          this.log.warn(`node ${n.server.name} did not apply config v${c.configVersion}: ${r.status} ${detail}`);
        }
      } catch (err) {
        waiting.push(`node ${n.index}: unreachable`);
        this.log.debug(`node ${n.server.name} unreachable: ${(err as Error).message}`);
      }
    }
    return { applied, nodes: c.nodeServers.length, waiting, errors };
  }

  /** Minute job: roles, lag and backup results from the nodes; retry unapplied config. */
  async refreshAll() {
    const clusters = await this.prisma.dbCluster.findMany({ where: { status: { in: ['active', 'updating'] }, deletedAt: null }, include: dbInclude });
    for (const c of clusters) {
      if (c.nodeServers.some((n) => n.appliedVersion < c.configVersion && n.server.status === 'active')) {
        const r = await this.pushConfig(c.id).catch((err) => {
          this.log.warn(`push for ${c.id}: ${(err as Error).message}`);
          return null;
        });
        if (r?.errors.length && c.status === 'updating') {
          await this.prisma.dbCluster.update({ where: { id: c.id }, data: { status: 'failed', statusMessage: `update failed: ${r.errors.join('; ')}` } });
          continue;
        }
      }
      const previousPrimary = c.nodeServers.find((n) => n.role === 'primary')?.index;
      let newPrimary: number | undefined;
      const reportedPrimary: number[] = [];
      for (const n of c.nodeServers) {
        const ip = agentHost(n.server);
        if (!ip || n.server.status !== 'active') continue;
        try {
          const r = await agentFetch(ip, { path: '/status', secret: c.vmSecret, timeoutMs: 4000 }).then((x) => {
            if (!x.ok) throw new Error(`status answered ${x.status}`);
            return x.json() as Promise<NodeReport>;
          });
          await this.prisma.dbNode.update({ where: { id: n.id }, data: { role: r.role, lagBytes: r.lagBytes ?? null, lastSeenAt: new Date(), appliedVersion: r.version } });
          await recordDiskUsage(this.prisma, n.serverId, r.diskUsedPercent);
          if (this.unreachable.delete(n.id)) await this.emit('database.node_recovered', c, { node: n.index, serverId: n.serverId });
          if (r.role === 'primary') {
            newPrimary = n.index;
            reportedPrimary.push(n.index);
          }
          for (const b of r.backups ?? []) {
            if (b.status === 'running') continue;
            const row = await this.prisma.dbBackup.findUnique({ where: { id: b.id } });
            if (!row || row.status !== 'running') continue;
            await this.prisma.dbBackup.update({ where: { id: b.id }, data: { status: b.status === 'completed' ? 'completed' : 'failed', sizeBytes: b.sizeBytes ?? null, completedAt: b.completedAt ? new Date(b.completedAt * 1000) : new Date(), error: b.error ?? null, ref: b.ref ?? null } });
            await this.emit(b.status === 'completed' ? 'database.backup_completed' : 'database.backup_failed', c, { backupId: b.id, sizeBytes: b.sizeBytes ?? null });
          }
        } catch {
          // Unreachable: keep the last known state, and say so once it lasts more than five minutes.
          const since = n.lastSeenAt ?? c.createdAt;
          if (Date.now() - since.getTime() > 5 * 60_000 && !this.unreachable.has(n.id)) {
            this.unreachable.add(n.id);
            await this.emit('database.node_unreachable', c, { node: n.index, serverId: n.serverId, serverName: n.server.name, lastSeenAt: n.lastSeenAt });
          }
        }
      }
      // A primary that did not answer this pass is not the primary any more once another node is:
      // keep only the ones that said so, or connection details and backups keep going to the old one.
      if (reportedPrimary.length) await this.prisma.dbNode.updateMany({ where: { clusterId: c.id, role: 'primary', index: { notIn: reportedPrimary } }, data: { role: 'unknown' } });
      if (newPrimary !== undefined && previousPrimary !== undefined && newPrimary !== previousPrimary) await this.emit('database.failover', c, { from: previousPrimary, to: newPrimary });
      if (c.status === 'updating' && c.nodeServers.every((n) => n.appliedVersion >= c.configVersion)) await this.prisma.dbCluster.update({ where: { id: c.id }, data: { status: 'active' } });
      // Backups that never reported within six hours count as failed.
      await this.prisma.dbBackup.updateMany({ where: { clusterId: c.id, status: 'running', startedAt: { lt: new Date(Date.now() - 6 * 3600_000) } }, data: { status: 'failed', error: 'no result from the node', completedAt: new Date() } });
    }
  }

  /** Hourly job: start the scheduled backup for clusters whose hour it is. */
  async scheduledBackups(now = new Date()) {
    const hour = now.getUTCHours();
    const clusters = await this.prisma.dbCluster.findMany({ where: { status: 'active', deletedAt: null, backupHourUtc: hour }, select: { id: true } });
    let started = 0;
    for (const c of clusters) {
      const recent = await this.prisma.dbBackup.findFirst({ where: { clusterId: c.id, kind: 'scheduled', startedAt: { gt: new Date(now.getTime() - 20 * 3600_000) } } });
      if (recent) continue;
      await this.startBackup(null, c.id, 'scheduled').then(() => started++).catch((err) => this.log.warn(`scheduled backup for ${c.id}: ${(err as Error).message}`));
    }
    return started;
  }

  // ---- helpers ----

  private async own(actor: Actor, id: string, project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    const c = await this.prisma.dbCluster.findFirst({ where: { id, projectId: p.id, deletedAt: null }, include: dbInclude });
    if (!c) throw ApiError.notFound('database', id);
    return c;
  }

  private async bump(id: string, actor: Actor) {
    await this.prisma.dbCluster.update({ where: { id }, data: { configVersion: { increment: 1 }, status: 'updating' } });
    await this.pushLater(id, actor);
  }

  private async pushLater(id: string, actor: Actor) {
    await this.temporal.start('updateDatabase', [{ clusterId: id }], `updateDatabase-${id}-${Date.now()}`);
    await this.events.emit('database.update_requested', { databaseId: id }, { actor, resource: `database:${id}` });
  }

  private async emit(name: string, c: { id: string; name: string; projectId: string }, payload: Record<string, unknown>) {
    const teamId = (await this.prisma.project.findUnique({ where: { id: c.projectId }, select: { teamId: true } }))?.teamId;
    await this.events.emit(name, { databaseId: c.id, name: c.name, ...payload }, { teamId, resource: `database:${c.id}` });
  }

  present(c: DbRow, withSecrets: boolean) {
    const host = c.publicIp?.address ?? null;
    const primary = c.nodeServers.find((n) => n.role === 'primary') ?? c.nodeServers[0];
    const privateHost = primary?.server.privateIp ?? null;
    const app = c.users[0];
    const db = c.databases[0]?.name ?? 'defaultdb';
    const uri = (h: string | null, user: string, pw: string) => {
      if (!h) return null;
      if (c.engine === 'valkey') return `rediss://${user}:${pw}@${h}:6380`;
      if (c.engine === 'mysql') return `mysql://${user}:${pw}@${h}:${c.port}/${db}?ssl-mode=REQUIRED`;
      return `postgresql://${user}:${pw}@${h}:${c.port}/${db}?sslmode=require`;
    };
    return {
      id: c.id, name: c.name, engine: c.engine, version: c.version, status: c.status, statusMessage: c.statusMessage, regionId: c.regionId, projectId: c.projectId,
      nodes: c.nodes, size: { id: c.size.id, vcpu: c.size.vcpu, memoryMb: c.size.memoryMb, diskGb: c.size.diskGb }, port: c.port, poolerPort: c.engine === 'postgres' ? 6432 : null, tlsPort: c.engine === 'valkey' ? 6380 : null,
      trustedSources: c.trustedSources, backupHourUtc: c.backupHourUtc, configVersion: c.configVersion,
      connection: withSecrets ? { host, privateHost, port: c.port, database: c.engine === 'valkey' ? null : db, user: c.engine === 'valkey' ? 'default' : c.adminUser, password: c.adminPassword, ssl: true, uri: uri(host, c.engine === 'valkey' ? 'default' : c.adminUser, c.adminPassword), privateUri: uri(privateHost, c.engine === 'valkey' ? 'default' : c.adminUser, c.adminPassword), appUri: app ? uri(host, app.name, app.password) : null } : { host, privateHost, port: c.port, database: db },
      users: c.users.map((u) => ({ id: u.id, name: u.name, ...(withSecrets ? { password: u.password } : {}), createdAt: u.createdAt })),
      databases: c.databases.map((d) => ({ id: d.id, name: d.name, createdAt: d.createdAt })),
      nodeStatus: c.nodeServers.map((n) => ({ index: n.index, status: n.server.status, role: n.role, appliedVersion: n.appliedVersion, lagBytes: n.lagBytes == null ? null : Number(n.lagBytes), lastSeenAt: n.lastSeenAt })),
      createdAt: c.createdAt,
    };
  }
}

function firewallRules(engine: 'postgres' | 'valkey' | 'mysql', port: number, trusted: string[], nodes: number, privateNet: string) {
  const cidrs = trusted.length ? trusted : ['0.0.0.0/0', '::/0'];
  const cp = loadConfig().CONTROL_PLANE_CIDR;
  const internal: Record<string, [string, string][]> = { postgres: [['2379-2380', 'cluster consensus'], ['8008', 'cluster api'], ['6432', 'pooler']], valkey: [['26379', 'sentinel'], ['6380', 'tls replication']], mysql: [] };
  return [
    { direction: 'inbound' as const, protocol: 'tcp' as const, ports: '22', cidrs: [cp], description: 'platform ssh' },
    { direction: 'inbound' as const, protocol: 'tcp' as const, ports: String(port), cidrs },
    ...(engine === 'postgres' ? [{ direction: 'inbound' as const, protocol: 'tcp' as const, ports: '6432', cidrs, description: 'connection pooler' }] : []),
    ...(engine === 'valkey' ? [{ direction: 'inbound' as const, protocol: 'tcp' as const, ports: '6380', cidrs, description: 'tls port' }] : []),
    ...internal[engine].map(([ports, description]) => ({ direction: 'inbound' as const, protocol: 'tcp' as const, ports, cidrs: [privateNet], description })),
    { direction: 'inbound' as const, protocol: 'tcp' as const, ports: String(port), cidrs: [privateNet], description: 'replication' },
    { direction: 'inbound' as const, protocol: 'tcp' as const, ports: '9009', cidrs: [cp], description: 'prgd database agent' },
    ...(nodes > 1 ? [{ direction: 'inbound' as const, protocol: 'vrrp' as const, cidrs: [privateNet], description: 'keepalived between database nodes' }] : []),
    { direction: 'outbound' as const, protocol: 'any' as const, cidrs: ['0.0.0.0/0'] },
  ];
}

/** Cluster members as the agents see them: Patroni member name and the address peers use. */
function nodeList(c: { name: string; nodeServers: { index: number; server: { privateIp: string | null; publicIps: { address: string }[] } }[] }) {
  return c.nodeServers.map((n) => ({ index: n.index, name: `${c.name}-${n.index}`, ip: n.server.privateIp ?? n.server.publicIps[0]?.address ?? '127.0.0.1' }));
}

function validateCidrs(list: string[]) {
  const out: string[] = [];
  for (const raw of list) {
    const v = raw.trim();
    const [ip, prefix] = v.split('/');
    const fam = isIP(ip);
    if (!fam) throw ApiError.invalid(`"${raw}" is not an IP or CIDR`);
    const max = fam === 4 ? 32 : 128;
    const p = prefix === undefined ? max : Number(prefix);
    if (!Number.isInteger(p) || p < 0 || p > max) throw ApiError.invalid(`"${raw}" has an invalid prefix length`);
    out.push(`${ip}/${p}`);
  }
  return [...new Set(out)];
}

function password() {
  return randomBytes(18).toString('base64url');
}

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
}
