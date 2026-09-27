import { Injectable, Logger } from '@nestjs/common';
import { X509Certificate, randomBytes } from 'node:crypto';
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
import { renderHaproxyConfig, renderKeepalivedConfig } from './haproxy';
import { renderLbCloudInit } from './cloud-init';
import { agentHost, vrrpPass } from '../../common/platform-agent';
import { CreateCertificateDto, CreateLoadBalancerDto, TargetsDto, UpdateLoadBalancerDto } from './lb.dto';
import { DEFAULT_HEALTH_CHECK, ForwardingRule, HealthCheck, StickySessions } from './lb.types';

const NODE_SIZE = 's-1vcpu-2gb';
const NODE_IMAGE = 'ubuntu-24-04';
/** Project networks; VRRP between the nodes runs over it. */

const lbInclude = {
  publicIp: { select: { address: true } },
  nodeServers: { include: { server: { select: { id: true, name: true, status: true, privateIp: true, publicIps: { select: { address: true } } } } }, orderBy: { index: 'asc' as const } },
  targets: { include: { server: { select: { id: true, name: true, status: true, privateIp: true, publicIps: { select: { address: true } }, tags: true } } } },
} satisfies Prisma.LoadBalancerInclude;
type LbRow = Prisma.LoadBalancerGetPayload<{ include: typeof lbInclude }>;

/**
 * Managed load balancers. A load balancer is a VIP plus one to three HAProxy node VMs we own
 * (Server rows with managedBy = "lb:<id>"). The service validates and stores the desired
 * state; workflows create the nodes and push config; a minute job reads health back.
 */
@Injectable()
export class LoadBalancersService {
  private readonly log = new Logger(LoadBalancersService.name);

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
  ) {}

  /** Cluster traffic (replication, etcd, VRRP) is allowed from the project's own private network only, never other tenants. */
  private async projectNet(projectId: string, regionId: string) {
    return (await this.privateNetworks.ensureNetwork(projectId, regionId)).cidr;
  }

  async list(actor: Actor, project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    const rows = await this.prisma.loadBalancer.findMany({ where: { projectId: p.id, deletedAt: null }, include: lbInclude, orderBy: { createdAt: 'desc' } });
    return { data: rows.map(present) };
  }

  async get(actor: Actor, id: string, project?: string) {
    return present(await this.own(actor, id, project));
  }

  async create(actor: Actor, dto: CreateLoadBalancerDto) {
    const project = await this.iam.resolveProject(actor, dto.project);
    await this.trust.assertCanProvision(actor.teamId);
    const region = await this.prisma.region.findUnique({ where: { id: dto.region ?? loadConfig().DEFAULT_REGION } });
    if (!region?.available) throw ApiError.invalid(`Unknown or unavailable region "${dto.region}"`);
    if (await this.prisma.loadBalancer.findFirst({ where: { projectId: project.id, name: dto.name, deletedAt: null } })) throw ApiError.conflict('name_taken', `A load balancer named "${dto.name}" already exists in this project`);
    const rules = await this.validateRules(project.id, dto.forwardingRules);
    const healthCheck = { ...DEFAULT_HEALTH_CHECK(rules), ...strip(dto.healthCheck) };
    const sticky = dto.stickySessions && dto.stickySessions.type !== 'none' ? (dto.stickySessions as StickySessions) : null;
    const nodes = dto.nodes ?? 1;
    const targets = dto.serverIds?.length ? await this.ownedServers(project.id, region.id, dto.serverIds) : [];

    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: actor.teamId } });
    await this.spend.assertCanSpend(actor, project.id, (await this.spend.monthlyPriceMinor('load_balancer', 'lb_node', team.currency)) * nodes);

    const vip = await this.ips.reserve(region.id, project.id);
    const fw = await this.firewalls.create(actor, project.id, { name: `lb-${dto.name}`, rules: firewallRules(rules, nodes, await this.projectNet(project.id, region.id)) });
    const lb = await this.prisma.loadBalancer.create({
      data: {
        projectId: project.id, regionId: region.id, name: dto.name, nodes, algorithm: dto.algorithm ?? 'round_robin',
        forwardingRules: rules as unknown as Prisma.InputJsonValue, healthCheck: healthCheck as unknown as Prisma.InputJsonValue, stickySessions: (sticky ?? undefined) as Prisma.InputJsonValue | undefined,
        redirectHttpToHttps: !!dto.redirectHttpToHttps, proxyProtocol: !!dto.proxyProtocol, tag: dto.tag || null,
        publicIpId: vip.id, firewallId: fw.id, vmSecret: randomBytes(24).toString('base64url'),
        targets: { create: targets.map((s) => ({ serverId: s.id })) },
      },
      include: { publicIp: { include: { block: true } } },
    });

    // Node VMs go through the normal server path (placement, VM, IP, firewall, metering exclusion by managedBy).
    for (let i = 0; i < nodes; i++) {
      const s = await this.servers.create(actor, {
        name: `lb-${dto.name}-${i}`, size: NODE_SIZE, image: NODE_IMAGE, project: project.id, region: region.id, firewalls: [fw.id], tags: ['load-balancer'],
        userData: renderLbCloudInit({ vmSecret: lb.vmSecret, vipNetwork: 'public' }),
      }, { spreadGroup: `lb:${lb.id}` });
      await this.prisma.server.update({ where: { id: s.id }, data: { managedBy: `lb:${lb.id}` } });
      await this.prisma.loadBalancerNode.create({ data: { loadBalancerId: lb.id, serverId: s.id, index: i } });
    }
    await this.temporal.start('createLoadBalancer', [{ lbId: lb.id }], `createLoadBalancer-${lb.id}`);
    await this.events.emit('load_balancer.create_requested', { loadBalancerId: lb.id, name: lb.name, nodes, region: region.id }, { actor, resource: `load_balancer:${lb.id}` });
    return present(await this.prisma.loadBalancer.findUniqueOrThrow({ where: { id: lb.id }, include: lbInclude }));
  }

  async update(actor: Actor, id: string, dto: UpdateLoadBalancerDto, project?: string) {
    const lb = await this.own(actor, id, project);
    if (!['active', 'failed'].includes(lb.status)) throw ApiError.invalidState(`Load balancer is ${lb.status}; wait for it to settle`);
    const rules = dto.forwardingRules ? await this.validateRules(lb.projectId, dto.forwardingRules) : (lb.forwardingRules as unknown as ForwardingRule[]);
    const healthCheck = { ...(lb.healthCheck as unknown as HealthCheck), ...strip(dto.healthCheck) };
    if (dto.name && dto.name !== lb.name && (await this.prisma.loadBalancer.findFirst({ where: { projectId: lb.projectId, name: dto.name, deletedAt: null } }))) throw ApiError.conflict('name_taken', `A load balancer named "${dto.name}" already exists`);
    const sticky = dto.stickySessions === undefined ? undefined : dto.stickySessions.type === 'none' ? null : dto.stickySessions;
    await this.prisma.loadBalancer.update({
      where: { id },
      data: {
        name: dto.name, algorithm: dto.algorithm, forwardingRules: rules as unknown as Prisma.InputJsonValue, healthCheck: healthCheck as unknown as Prisma.InputJsonValue,
        ...(sticky === undefined ? {} : { stickySessions: sticky === null ? Prisma.DbNull : (sticky as unknown as Prisma.InputJsonValue) }),
        redirectHttpToHttps: dto.redirectHttpToHttps, proxyProtocol: dto.proxyProtocol, ...(dto.tag === undefined ? {} : { tag: dto.tag || null }),
        status: 'updating', statusMessage: null, configVersion: { increment: 1 },
      },
    });
    if (dto.forwardingRules && lb.firewallId) await this.firewalls.replaceRules(actor, lb.projectId, lb.firewallId, firewallRules(rules, lb.nodes, await this.projectNet(lb.projectId, lb.regionId))).catch((err) => this.log.warn(`firewall update for ${id} failed: ${(err as Error).message}`));
    await this.pushLater(id, actor);
    return present(await this.prisma.loadBalancer.findUniqueOrThrow({ where: { id }, include: lbInclude }));
  }

  async addTargets(actor: Actor, id: string, dto: TargetsDto, project?: string) {
    const lb = await this.own(actor, id, project);
    const servers = await this.ownedServers(lb.projectId, lb.regionId, dto.serverIds);
    await this.prisma.loadBalancerTarget.createMany({ data: servers.map((s) => ({ loadBalancerId: id, serverId: s.id })), skipDuplicates: true });
    await this.bump(id, actor);
    return present(await this.prisma.loadBalancer.findUniqueOrThrow({ where: { id }, include: lbInclude }));
  }

  async removeTarget(actor: Actor, id: string, serverId: string, project?: string) {
    await this.own(actor, id, project);
    await this.prisma.loadBalancerTarget.deleteMany({ where: { loadBalancerId: id, serverId } });
    await this.bump(id, actor);
    return present(await this.prisma.loadBalancer.findUniqueOrThrow({ where: { id }, include: lbInclude }));
  }

  async remove(actor: Actor, id: string, project?: string) {
    const lb = await this.own(actor, id, project);
    if (lb.status === 'deleting') return { id, status: 'deleting' };
    await this.prisma.loadBalancer.update({ where: { id }, data: { status: 'deleting', statusMessage: null } });
    await this.temporal.start('deleteLoadBalancer', [{ lbId: id }], `deleteLoadBalancer-${id}`);
    await this.events.emit('load_balancer.delete_requested', { loadBalancerId: id }, { actor, resource: `load_balancer:${id}` });
    return { id, status: 'deleting' };
  }

  // ---- certificates ----

  async listCertificates(actor: Actor, project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    const data = await this.prisma.certificate.findMany({ where: { projectId: p.id, deletedAt: null }, select: { id: true, name: true, type: true, domains: true, notAfter: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
    return { data };
  }

  async createCertificate(actor: Actor, dto: CreateCertificateDto) {
    const p = await this.iam.resolveProject(actor, dto.project);
    let notAfter: Date | undefined;
    let domains = dto.domains ?? [];
    if (dto.type === 'custom') {
      if (!dto.certPem || !dto.keyPem) throw ApiError.invalid('certPem and keyPem are required for a custom certificate');
      try {
        const x = new X509Certificate(dto.certPem);
        notAfter = new Date(x.validTo);
        if (!domains.length) domains = (x.subjectAltName ?? '').split(',').map((s) => s.trim().replace(/^DNS:/, '')).filter(Boolean);
      } catch {
        throw ApiError.invalid('certPem is not a valid PEM certificate');
      }
      if (!/-----BEGIN (RSA |EC )?PRIVATE KEY-----/.test(dto.keyPem)) throw ApiError.invalid('keyPem is not a PEM private key');
    } else {
      if (!domains.length) throw ApiError.invalid('domains are required for a Let\'s Encrypt certificate');
      for (const d of domains) if (!/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(d)) throw ApiError.invalid(`"${d}" is not a valid domain`);
    }
    const c = await this.prisma.certificate.create({ data: { projectId: p.id, name: dto.name, type: dto.type, domains, certPem: dto.certPem, keyPem: dto.keyPem, notAfter }, select: { id: true, name: true, type: true, domains: true, notAfter: true, createdAt: true } });
    await this.events.emit('certificate.created', { certificateId: c.id, name: c.name, type: c.type }, { actor, resource: `certificate:${c.id}` });
    return c;
  }

  async deleteCertificate(actor: Actor, id: string, project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    const c = await this.prisma.certificate.findFirst({ where: { id, projectId: p.id, deletedAt: null } });
    if (!c) throw ApiError.notFound('certificate', id);
    const inUse = await this.prisma.loadBalancer.findMany({ where: { projectId: p.id, deletedAt: null }, select: { name: true, forwardingRules: true } });
    const user = inUse.find((lb) => (lb.forwardingRules as unknown as ForwardingRule[]).some((r) => r.certificateId === id));
    if (user) throw ApiError.invalidState(`Certificate is used by load balancer ${user.name}`);
    await this.prisma.certificate.update({ where: { id }, data: { deletedAt: new Date() } });
    return { id, deleted: true };
  }

  // ---- used by workflows and jobs ----

  /** Renders and POSTs the config to every node. Returns how many nodes accepted it. */
  async pushConfig(id: string): Promise<{ applied: number; nodes: number; version: number }> {
    const lb = await this.prisma.loadBalancer.findUnique({ where: { id }, include: { ...lbInclude, publicIp: { select: { address: true, block: { select: { cidr: true } } } } } });
    if (!lb || lb.deletedAt) return { applied: 0, nodes: 0, version: 0 };
    const targets = await this.effectiveTargets(lb);
    const rules = lb.forwardingRules as unknown as ForwardingRule[];
    const haproxyCfg = renderHaproxyConfig({
      id: lb.id, algorithm: lb.algorithm, rules, healthCheck: lb.healthCheck as unknown as HealthCheck, sticky: (lb.stickySessions as unknown as StickySessions | null) ?? null,
      redirectHttpToHttps: lb.redirectHttpToHttps, proxyProtocol: lb.proxyProtocol,
      targets: targets.map((t) => ({ serverId: t.id, name: t.name, address: t.privateIp ?? t.publicIps[0]?.address ?? '127.0.0.1' })),
    });
    const certIds = [...new Set(rules.map((r) => r.certificateId).filter((x): x is string => !!x))];
    const certs = certIds.length ? await this.prisma.certificate.findMany({ where: { id: { in: certIds } } }) : [];
    const body = {
      version: lb.configVersion,
      haproxyCfg,
      certs: Object.fromEntries(certs.filter((c) => c.type === 'custom').map((c) => [c.id, `${c.certPem}\n${c.keyPem}`])),
      letsencrypt: certs.filter((c) => c.type === 'letsencrypt').map((c) => ({ id: c.id, domains: c.domains })),
    };
    let applied = 0;
    for (const n of lb.nodeServers) {
      const ip = agentHost(n.server);
      if (!ip || n.server.status !== 'active') continue;
      // keepalived per node: its priority and the other nodes' private addresses for unicast VRRP.
      const peers = lb.nodeServers.filter((o) => o.id !== n.id && o.server.privateIp).map((o) => o.server.privateIp!);
      const keepalived = lb.publicIp ? renderKeepalivedConfig({ lbId: lb.id, index: n.index, vip: lb.publicIp.address, prefix: IpsService.prefixOf(lb.publicIp.block.cidr), authPass: vrrpPass(lb.vmSecret), peers }) : undefined;
      try {
        const r = await fetch(`http://${ip}:9009/config`, { method: 'POST', headers: { 'X-Pgcloud-Secret': lb.vmSecret, 'content-type': 'application/json' }, body: JSON.stringify({ ...body, keepalived }), signal: AbortSignal.timeout(8000) });
        if (r.ok) {
          applied++;
          await this.prisma.loadBalancerNode.update({ where: { id: n.id }, data: { appliedVersion: lb.configVersion, lastSeenAt: new Date() } });
        } else {
          const detail = await r.text().catch(() => '');
          this.log.warn(`node ${n.server.name} rejected config v${lb.configVersion}: ${r.status} ${detail.slice(0, 300)}`);
          if (r.status === 422) throw ApiError.invalid(`HAProxy rejected the configuration: ${detail.slice(0, 300)}`);
        }
      } catch (err) {
        if (err instanceof ApiError) throw err;
        // Node still booting, or no VM at all with the fake driver. The minute job retries.
        this.log.debug(`node ${n.server.name} unreachable: ${(err as Error).message}`);
      }
    }
    return { applied, nodes: lb.nodeServers.length, version: lb.configVersion };
  }

  /** Minute job: read health from the nodes, retry unapplied config. */
  async refreshAll() {
    const lbs = await this.prisma.loadBalancer.findMany({ where: { status: { in: ['active', 'updating'] }, deletedAt: null }, include: lbInclude });
    for (const lb of lbs) {
      const stale = lb.nodeServers.some((n) => n.appliedVersion < lb.configVersion && n.server.status === 'active');
      if (stale) await this.pushConfig(lb.id).catch((err) => this.log.warn(`push for ${lb.id}: ${(err as Error).message}`));
      const health = new Map<string, boolean>();
      for (const n of lb.nodeServers) {
        const ip = agentHost(n.server);
        if (!ip || n.server.status !== 'active') continue;
        try {
          const r = await fetch(`http://${ip}:9009/status`, { headers: { 'X-Pgcloud-Secret': lb.vmSecret }, signal: AbortSignal.timeout(4000) }).then((x) => x.json() as Promise<{ version: number; backends: Record<string, Record<string, string>> }>);
          await this.prisma.loadBalancerNode.update({ where: { id: n.id }, data: { lastSeenAt: new Date(), appliedVersion: r.version } });
          for (const servers of Object.values(r.backends ?? {})) for (const [name, status] of Object.entries(servers)) {
            const sid = name.replace(/^srv_/, '');
            health.set(sid, (health.get(sid) ?? false) || status.startsWith('UP'));
          }
        } catch {
          /* unreachable: keep last known state */
        }
      }
      if (health.size) {
        for (const t of lb.targets) {
          const now = health.get(t.serverId);
          if (now === undefined) continue;
          if (t.healthy !== now) {
            await this.events.emit(now ? 'load_balancer.target_healthy' : 'load_balancer.target_unhealthy', { loadBalancerId: lb.id, name: lb.name, serverId: t.serverId, serverName: t.server.name }, { teamId: (await this.prisma.project.findUnique({ where: { id: lb.projectId }, select: { teamId: true } }))?.teamId, resource: `load_balancer:${lb.id}` });
          }
          await this.prisma.loadBalancerTarget.update({ where: { id: t.id }, data: { healthy: now, lastCheckedAt: new Date() } });
        }
      }
      if (lb.status === 'updating' && lb.nodeServers.every((n) => n.appliedVersion >= lb.configVersion)) {
        await this.prisma.loadBalancer.update({ where: { id: lb.id }, data: { status: 'active' } });
      }
      // Tag based targets: keep the target set in sync with the servers carrying the tag.
      if (lb.tag) {
        const tagged = await this.prisma.server.findMany({ where: { projectId: lb.projectId, regionId: lb.regionId, deletedAt: null, OR: [{ managedBy: null }, { managedBy: { startsWith: 'k8s:' } }], tags: { has: lb.tag } }, select: { id: true } });
        const want = new Set(tagged.map((s) => s.id));
        const have = new Set(lb.targets.map((t) => t.serverId));
        const add = [...want].filter((x) => !have.has(x));
        if (add.length) {
          await this.prisma.loadBalancerTarget.createMany({ data: add.map((serverId) => ({ loadBalancerId: lb.id, serverId })), skipDuplicates: true });
          await this.prisma.loadBalancer.update({ where: { id: lb.id }, data: { configVersion: { increment: 1 } } });
        }
      }
    }
  }

  // ---- helpers ----

  private async own(actor: Actor, id: string, project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    const lb = await this.prisma.loadBalancer.findFirst({ where: { id, projectId: p.id, deletedAt: null }, include: lbInclude });
    if (!lb) throw ApiError.notFound('load_balancer', id);
    return lb;
  }

  private async bump(id: string, actor: Actor) {
    await this.prisma.loadBalancer.update({ where: { id }, data: { configVersion: { increment: 1 }, status: 'updating' } });
    await this.pushLater(id, actor);
  }

  private async pushLater(id: string, actor: Actor) {
    await this.temporal.start('updateLoadBalancer', [{ lbId: id }], `updateLoadBalancer-${id}-${Date.now()}`);
    await this.events.emit('load_balancer.update_requested', { loadBalancerId: id }, { actor, resource: `load_balancer:${id}` });
  }

  private async validateRules(projectId: string, rules: ForwardingRule[]) {
    const ports = new Set<number>();
    for (const r of rules) {
      if (ports.has(r.entryPort)) throw ApiError.invalid(`Entry port ${r.entryPort} is used by two rules`);
      ports.add(r.entryPort);
      if (r.entryPort === 9009) throw ApiError.invalid('Entry port 9009 is reserved');
      if (r.entryProtocol === 'https') {
        if (!r.certificateId) throw ApiError.invalid(`Rule on port ${r.entryPort}: https needs a certificateId`);
        const c = await this.prisma.certificate.findFirst({ where: { id: r.certificateId, projectId, deletedAt: null } });
        if (!c) throw ApiError.invalid(`Certificate ${r.certificateId} not found in this project`);
      } else if (r.certificateId) throw ApiError.invalid('certificateId only applies to https rules');
      if (r.entryProtocol === 'tcp' && r.targetProtocol !== 'tcp') throw ApiError.invalid('A tcp entry must target tcp');
    }
    return rules.map((r) => ({ entryProtocol: r.entryProtocol, entryPort: r.entryPort, targetProtocol: r.targetProtocol, targetPort: r.targetPort, ...(r.certificateId ? { certificateId: r.certificateId } : {}) }));
  }

  private async ownedServers(projectId: string, regionId: string, ids: string[]) {
    const servers = await this.prisma.server.findMany({ where: { id: { in: ids }, projectId, deletedAt: null, managedBy: null }, select: { id: true, regionId: true } });
    if (servers.length !== new Set(ids).size) throw ApiError.invalid('One or more servers do not belong to this project');
    if (servers.some((s) => s.regionId !== regionId)) throw ApiError.invalid('Targets must be in the load balancer region');
    return servers;
  }

  private async effectiveTargets(lb: LbRow) {
    const explicit = lb.targets.map((t) => t.server);
    if (!lb.tag) return explicit.filter((s) => s.status !== 'deleted');
    const tagged = await this.prisma.server.findMany({ where: { projectId: lb.projectId, regionId: lb.regionId, deletedAt: null, OR: [{ managedBy: null }, { managedBy: { startsWith: 'k8s:' } }], tags: { has: lb.tag } }, select: { id: true, name: true, status: true, privateIp: true, publicIps: { select: { address: true } }, tags: true } });
    const seen = new Set(explicit.map((s) => s.id));
    return [...explicit, ...tagged.filter((s) => !seen.has(s.id))].filter((s) => s.status !== 'deleted');
  }
}

function firewallRules(rules: ForwardingRule[], nodes: number, privateNet: string) {
  const cp = loadConfig().CONTROL_PLANE_CIDR;
  return [
    { direction: 'inbound' as const, protocol: 'tcp' as const, ports: '22', cidrs: [cp], description: 'platform ssh' },
    ...rules.map((r) => ({ direction: 'inbound' as const, protocol: 'tcp' as const, ports: String(r.entryPort), cidrs: ['0.0.0.0/0', '::/0'] })),
    { direction: 'inbound' as const, protocol: 'tcp' as const, ports: '9009', cidrs: [cp], description: 'pgcloud load balancer agent' },
    ...(nodes > 1 ? [{ direction: 'inbound' as const, protocol: 'vrrp' as const, cidrs: [privateNet], description: 'keepalived between load balancer nodes' }] : []),
    { direction: 'outbound' as const, protocol: 'any' as const, cidrs: ['0.0.0.0/0'] },
  ];
}

function strip<T extends object>(o: T | undefined): Partial<T> {
  if (!o) return {};
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function present(lb: LbRow) {
  return {
    id: lb.id,
    name: lb.name,
    status: lb.status,
    statusMessage: lb.statusMessage,
    ip: lb.publicIp?.address ?? null,
    regionId: lb.regionId,
    projectId: lb.projectId,
    algorithm: lb.algorithm,
    nodes: lb.nodes,
    forwardingRules: lb.forwardingRules,
    healthCheck: lb.healthCheck,
    stickySessions: lb.stickySessions,
    redirectHttpToHttps: lb.redirectHttpToHttps,
    proxyProtocol: lb.proxyProtocol,
    tag: lb.tag,
    configVersion: lb.configVersion,
    nodeStatus: lb.nodeServers.map((n) => ({ index: n.index, status: n.server.status, appliedVersion: n.appliedVersion, lastSeenAt: n.lastSeenAt })),
    targets: lb.targets.map((t) => ({ serverId: t.serverId, name: t.server.name, status: t.server.status, healthy: t.healthy, lastCheckedAt: t.lastCheckedAt })),
    createdAt: lb.createdAt,
  };
}
