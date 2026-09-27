import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { resolveCname, resolveTxt } from 'node:dns/promises';
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
import { FirewallsService } from '../network/firewalls.service';
import { GithubService } from '../github/github.service';
import { renderAppHostCloudInit } from './cloud-init';
import { agentFetch, agentHost } from '../../common/platform-agent';
import { APP_SIZES, AppSizeId, CreateAppDto, DomainDto, MAX_DOMAINS, UpdateAppDto } from './app.dto';

const HOST_MANAGED = 'apps:host';
const PLATFORM_TEAM = 'platform';
const PLATFORM_PROJECT = 'platform';
const NODE_IMAGE = 'ubuntu-24-04';
/** Memory kept for the host itself: Docker, Caddy, builds. */
const HOST_RESERVE_MB = 1536;

const appInclude = {
  region: { select: { id: true, name: true } },
  host: { include: { server: { select: { id: true, name: true, status: true, privateIp: true, publicIps: { select: { address: true } } } } } },
  deploys: { orderBy: { startedAt: 'desc' as const }, take: 10, select: { id: true, status: true, trigger: true, commit: true, startedAt: true, finishedAt: true } },
} satisfies Prisma.PlatformAppInclude;
type AppRow = Prisma.PlatformAppGetPayload<{ include: typeof appInclude }>;
type HostRow = Prisma.AppHostGetPayload<{ include: { server: { select: { id: true; name: true; status: true; privateIp: true; publicIps: { select: { address: true } } } }; apps: { include: { deploys: { orderBy: { startedAt: 'desc' }; take: 1 }; installation: true } } } }>;

/** Ownership check of one custom domain (PlatformApp.domainChecks). */
interface DomainCheck {
  token: string;
  verifiedAt: string | null;
}
type DomainChecks = Record<string, DomainCheck>;

/** A host that has not reported Docker and Caddy running for this long counts as failed. */
const HOST_DOWN_MS = 5 * 60_000;

interface HostStatus {
  version: number;
  docker?: boolean;
  caddy?: boolean;
  ready?: boolean;
  apps: Record<string, { deployId?: string; state?: 'building' | 'live' | 'failed'; commit?: string | null; error?: string | null; running?: number; logTail?: string }>;
}

/**
 * App Platform: push code, get a URL. Customer containers run on shared, platform owned
 * hosts behind Caddy. Each host runs an agent that builds from the repository, runs the
 * instances with memory and CPU limits, and serves every hostname with TLS. The control
 * plane places apps on hosts by free memory, provisions a new host when a region is full,
 * pushes the desired state, and pulls build results every minute.
 */
@Injectable()
export class AppPlatformService {
  private readonly log = new Logger(AppPlatformService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly temporal: TemporalService,
    private readonly iam: IamService,
    private readonly trust: TrustService,
    private readonly events: EventsService,
    private readonly spend: SpendService,
    private readonly firewalls: FirewallsService,
    @Inject(forwardRef(() => GithubService)) private readonly github: GithubService,
  ) {}

  sizes() {
    return { data: Object.entries(APP_SIZES).map(([id, s]) => ({ id, memoryMb: s.memoryMb, cpus: s.cpus })) };
  }

  async list(actor: Actor, project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    const rows = await this.prisma.platformApp.findMany({ where: { projectId: p.id, deletedAt: null }, include: appInclude, orderBy: { createdAt: 'desc' } });
    return { data: rows.map((a) => this.present(a)) };
  }

  async get(actor: Actor, id: string, project?: string) {
    return this.present(await this.own(actor, id, project));
  }

  async create(actor: Actor, dto: CreateAppDto) {
    const project = await this.iam.resolveProject(actor, dto.project);
    await this.trust.assertCanProvision(actor.teamId);
    const [region, team] = await Promise.all([this.prisma.region.findUnique({ where: { id: dto.region ?? 'sa1' } }), this.prisma.team.findUniqueOrThrow({ where: { id: actor.teamId } })]);
    if (!region?.available) throw ApiError.invalid(`Unknown or unavailable region "${dto.region}"`);
    if (await this.prisma.platformApp.findUnique({ where: { slug: dto.name } })) throw ApiError.conflict('name_taken', `The name "${dto.name}" is taken; app names are unique across the platform`);
    // Source: GitHub App installation, or a repository URL.
    let repoUrl = dto.repoUrl;
    let installation: { id: string } | null = null;
    if (dto.installationId && dto.repo) {
      installation = await this.prisma.githubInstallation.findFirst({ where: { id: dto.installationId, teamId: actor.teamId }, select: { id: true } });
      if (!installation) throw ApiError.notFound('github_installation', dto.installationId);
      repoUrl = `https://github.com/${dto.repo}`;
    }
    if (!repoUrl) throw ApiError.invalid('Give repoUrl (an https repository URL) or installationId with repo ("owner/name")');
    const size = dto.size ?? 'app-xs';
    const instances = dto.instances ?? 1;
    await this.spend.assertCanSpend(actor, project.id, (await this.spend.monthlyPriceMinor('app_instance', size, team.currency)) * instances);
    const app = await this.prisma.platformApp.create({
      data: {
        projectId: project.id, regionId: region.id, slug: dto.name, name: dto.name, repoUrl, branch: dto.branch ?? 'main',
        repoFullName: repoUrl.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/^https:\/\/[^/]+\//, ''),
        installationId: installation?.id, gitToken: dto.gitToken, port: dto.port ?? 3000, envVars: (dto.env ?? {}) as Prisma.InputJsonValue,
        size, instances, healthPath: dto.healthPath,
        deploys: { create: { trigger: 'create', status: 'queued' } },
      },
      include: { deploys: true },
    });
    await this.temporal.start('createPlatformApp', [{ appId: app.id, deployId: app.deploys[0].id }], `createPlatformApp-${app.id}`);
    await this.events.emit('app.create_requested', { appId: app.id, name: app.slug, repo: repoUrl, branch: app.branch }, { actor, resource: `app:${app.id}` });
    return this.present(await this.prisma.platformApp.findUniqueOrThrow({ where: { id: app.id }, include: appInclude }));
  }

  /** Branch, port, size, instances, variables or health path. Any change deploys again. */
  async update(actor: Actor, id: string, dto: UpdateAppDto, project?: string) {
    const app = await this.own(actor, id, project);
    this.mustBeSettled(app);
    const size = dto.size ?? (app.size as AppSizeId);
    const instances = dto.instances ?? app.instances;
    if (size !== app.size || instances > app.instances) {
      const team = await this.prisma.team.findUniqueOrThrow({ where: { id: actor.teamId } });
      const before = (await this.spend.monthlyPriceMinor('app_instance', app.size, team.currency)) * app.instances;
      const after = (await this.spend.monthlyPriceMinor('app_instance', size, team.currency)) * instances;
      await this.spend.assertCanSpend(actor, app.projectId, Math.max(0, after - before));
      if (app.hostId) await this.checkHostRoom(app.hostId, APP_SIZES[size].memoryMb * instances - APP_SIZES[app.size as AppSizeId].memoryMb * app.instances);
    }
    await this.prisma.platformApp.update({ where: { id }, data: { branch: dto.branch, port: dto.port, size, instances, envVars: dto.env === undefined ? undefined : (dto.env as Prisma.InputJsonValue), healthPath: dto.healthPath, gitToken: dto.gitToken } });
    return this.redeploy(actor, id, 'config', project);
  }

  async redeploy(actor: Actor | null, id: string, trigger: string, project?: string, commit?: string) {
    const app = actor ? await this.own(actor, id, project) : await this.prisma.platformApp.findUniqueOrThrow({ where: { id }, include: appInclude });
    if (['deleting', 'deleted'].includes(app.status)) throw ApiError.invalidState('App is being deleted');
    const deploy = await this.prisma.appDeploy.create({ data: { appId: id, trigger, status: 'queued', commit } });
    await this.prisma.platformApp.update({ where: { id }, data: { status: app.status === 'stopped' ? 'stopped' : 'building', statusMessage: null } });
    await this.temporal.start('deployPlatformApp', [{ appId: id, deployId: deploy.id }], `deployPlatformApp-${deploy.id}`);
    await this.events.emit('app.deploy_triggered', { appId: id, deployId: deploy.id, trigger, commit }, actor ? { actor, resource: `app:${id}` } : { teamId: (await this.prisma.project.findUniqueOrThrow({ where: { id: app.projectId } })).teamId, resource: `app:${id}` });
    return this.present(await this.prisma.platformApp.findUniqueOrThrow({ where: { id }, include: appInclude }));
  }

  async stop(actor: Actor, id: string, project?: string) {
    const app = await this.own(actor, id, project);
    if (app.status === 'stopped') return this.present(app);
    this.mustBeSettled(app);
    await this.prisma.platformApp.update({ where: { id }, data: { status: 'stopped', statusMessage: null, meteredSince: null } });
    if (app.hostId) await this.pushHost(app.hostId).catch((e) => this.log.warn(`stop push: ${e.message}`));
    await this.events.emit('app.stopped', { appId: id }, { actor, resource: `app:${id}` });
    return this.present(await this.own(actor, id, project));
  }

  async start(actor: Actor, id: string, project?: string) {
    const app = await this.own(actor, id, project);
    if (app.status !== 'stopped') return this.present(app);
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: actor.teamId } });
    await this.spend.assertCanSpend(actor, app.projectId, (await this.spend.monthlyPriceMinor('app_instance', app.size, team.currency)) * app.instances);
    await this.prisma.platformApp.update({ where: { id }, data: { status: 'live', meteredSince: new Date() } });
    if (app.hostId) await this.pushHost(app.hostId).catch((e) => this.log.warn(`start push: ${e.message}`));
    await this.events.emit('app.started', { appId: id }, { actor, resource: `app:${id}` });
    return this.present(await this.own(actor, id, project));
  }

  async remove(actor: Actor, id: string, project?: string) {
    const app = await this.own(actor, id, project);
    if (app.status === 'deleting') return { id, status: 'deleting' };
    await this.prisma.platformApp.update({ where: { id }, data: { status: 'deleting', statusMessage: null, meteredSince: null } });
    await this.temporal.start('deletePlatformApp', [{ appId: id }], `deletePlatformApp-${id}`);
    await this.events.emit('app.delete_requested', { appId: id }, { actor, resource: `app:${id}` });
    return { id, status: 'deleting' };
  }

  async deploys(actor: Actor, id: string, project?: string) {
    await this.own(actor, id, project);
    const rows = await this.prisma.appDeploy.findMany({ where: { appId: id }, orderBy: { startedAt: 'desc' }, take: 50 });
    return { data: rows.map((d) => ({ id: d.id, status: d.status, trigger: d.trigger, commit: d.commit, startedAt: d.startedAt, finishedAt: d.finishedAt, log: d.log })) };
  }

  /** Build log (from the host, cached on the app) or the runtime log of the first instance. */
  async logs(actor: Actor, id: string, type: 'build' | 'runtime' = 'build', project?: string) {
    const app = await this.own(actor, id, project);
    const ip = app.host ? agentHost(app.host.server) : null;
    if (ip && app.host?.server.status === 'active') {
      try {
        const r = await agentFetch(ip, { path: `/logs?app=${app.id}&type=${type}`, secret: app.host.vmSecret, timeoutMs: 6000 }).then((x) => x.json() as Promise<{ log: string }>);
        const log = (r.log ?? '').slice(-32_000);
        if (type === 'build') await this.prisma.platformApp.update({ where: { id }, data: { buildLog: log } });
        return { id, type, log, live: true, updatedAt: new Date() };
      } catch {
        /* fall through to the cached copy */
      }
    }
    return { id, type, log: type === 'build' ? app.buildLog ?? '' : '', live: false, updatedAt: app.updatedAt };
  }

  async addDomain(actor: Actor, id: string, dto: DomainDto, project?: string) {
    const app = await this.own(actor, id, project);
    const domain = dto.domain.toLowerCase();
    if (domain.endsWith(`.${loadConfig().APPS_DOMAIN}`)) throw ApiError.invalid('That name is under the apps domain; every app already has one');
    if (app.customDomains.includes(domain)) return this.present(app);
    if (app.customDomains.length >= MAX_DOMAINS) throw ApiError.quota(`An app can have at most ${MAX_DOMAINS} custom domains`);
    if (await this.prisma.platformApp.findFirst({ where: { customDomains: { has: domain }, deletedAt: null } })) throw ApiError.conflict('domain_taken', `${domain} is already attached to another app`);
    // Served only once verified: a TXT record with the token, or a CNAME to the app's own hostname.
    const checks: DomainChecks = { ...((app.domainChecks ?? {}) as unknown as DomainChecks), [domain]: { token: `progrid-${randomBytes(16).toString('hex')}`, verifiedAt: null } };
    await this.prisma.platformApp.update({ where: { id }, data: { customDomains: { push: domain }, domainChecks: checks as unknown as Prisma.InputJsonValue } });
    await this.events.emit('app.domain_added', { appId: id, domain }, { actor, resource: `app:${id}` });
    await this.checkDomains(id).catch((e) => this.log.warn(`domain check for ${id}: ${(e as Error).message}`));
    return this.present(await this.own(actor, id, project));
  }

  async verifyDomain(actor: Actor, id: string, domain: string, project?: string) {
    const app = await this.own(actor, id, project);
    const name = domain.toLowerCase();
    if (!app.customDomains.includes(name)) throw ApiError.notFound('domain', name);
    const verified = await this.checkDomains(id);
    const out = this.present(await this.own(actor, id, project));
    if (!verified.includes(name) && !(out.domains.find((d) => d.domain === name)?.verified)) {
      throw ApiError.invalidState(`No ownership record found for ${name} yet. Add a TXT record at _progrid-verify.${name} with the token shown for the domain, or a CNAME from ${name} to ${out.hostname}, then try again; DNS changes can take a few minutes.`);
    }
    return out;
  }

  /**
   * Looks up every unverified domain of an app; marks the ones that pass and pushes the host
   * when any did. Returns the newly verified domains.
   */
  async checkDomains(appId: string): Promise<string[]> {
    const app = await this.prisma.platformApp.findUnique({ where: { id: appId } });
    if (!app) return [];
    const checks = (app.domainChecks ?? {}) as unknown as DomainChecks;
    const target = `${app.slug}.${loadConfig().APPS_DOMAIN}`.toLowerCase();
    const verified: string[] = [];
    for (const domain of app.customDomains) {
      const check = checks[domain];
      if (!check || check.verifiedAt) continue;
      const txt = await resolveTxt(`_progrid-verify.${domain}`).catch(() => [] as string[][]);
      const cname = await resolveCname(domain).catch(() => [] as string[]);
      if (txt.some((parts) => parts.join('').trim() === check.token) || cname.some((c) => c.replace(/\.$/, '').toLowerCase() === target)) {
        check.verifiedAt = new Date().toISOString();
        verified.push(domain);
      }
    }
    if (!verified.length) return [];
    await this.prisma.platformApp.update({ where: { id: appId }, data: { domainChecks: checks as unknown as Prisma.InputJsonValue } });
    for (const domain of verified) await this.emit('app.domain_verified', appId, { domain });
    if (app.hostId) await this.pushHost(app.hostId).catch((e) => this.log.warn(`domain push: ${e.message}`));
    return verified;
  }

  async removeDomain(actor: Actor, id: string, domain: string, project?: string) {
    const app = await this.own(actor, id, project);
    const checks = { ...((app.domainChecks ?? {}) as unknown as DomainChecks) };
    delete checks[domain.toLowerCase()];
    await this.prisma.platformApp.update({ where: { id }, data: { customDomains: app.customDomains.filter((d) => d !== domain.toLowerCase()), domainChecks: checks as unknown as Prisma.InputJsonValue } });
    if (app.hostId) await this.pushHost(app.hostId).catch((e) => this.log.warn(`domain push: ${e.message}`));
    return this.present(await this.own(actor, id, project));
  }

  /** GitHub App push: deploy every app on that repository and branch. */
  async onPush(installationId: number, repoFullName: string, branch: string, commit?: string) {
    const apps = await this.prisma.platformApp.findMany({ where: { repoFullName, branch, deletedAt: null, status: { notIn: ['deleting', 'deleted', 'creating'] }, installation: { installationId } }, select: { id: true } });
    for (const a of apps) await this.redeploy(null, a.id, 'push', undefined, commit).catch((e) => this.log.warn(`push deploy ${a.id}: ${e.message}`));
    return apps.length;
  }

  // ---- hosts ----

  async adminHosts() {
    const hosts = await this.prisma.appHost.findMany({ include: { server: { select: { name: true, status: true, publicIps: { select: { address: true } }, memoryMb: true } }, apps: { where: { deletedAt: null }, select: { id: true, slug: true, size: true, instances: true, status: true } } }, orderBy: { createdAt: 'asc' } });
    return { data: hosts.map((h) => ({ id: h.id, region: h.regionId, status: h.status, server: h.server.name, serverStatus: h.server.status, ip: h.server.publicIps[0]?.address ?? null, capacityMb: h.capacityMb, usedMb: h.apps.reduce((n, a) => n + APP_SIZES[a.size as AppSizeId].memoryMb * a.instances, 0), apps: h.apps, configVersion: h.configVersion, createdAt: h.createdAt })) };
  }

  /** Create a host: a platform owned server in the platform project, no quota or spend checks. */
  async provisionHost(regionId: string, sizeId?: string) {
    const cfg = loadConfig();
    const project = await this.ensurePlatformProject();
    const [region, size, image] = await Promise.all([
      this.prisma.region.findUniqueOrThrow({ where: { id: regionId } }),
      this.prisma.size.findUniqueOrThrow({ where: { id: sizeId ?? cfg.APP_HOST_SIZE } }),
      this.prisma.image.findUniqueOrThrow({ where: { id: NODE_IMAGE } }),
    ]);
    const fw = await this.prisma.firewall.findFirst({ where: { projectId: project.id, name: 'app-hosts' } }) ?? (await this.firewalls.create(await this.platformActor(), project.id, {
      name: 'app-hosts',
      rules: [
        { direction: 'inbound', protocol: 'tcp', ports: '22', cidrs: [cfg.CONTROL_PLANE_CIDR], description: 'platform ssh' },
        { direction: 'inbound', protocol: 'tcp', ports: '80', cidrs: ['0.0.0.0/0', '::/0'], description: 'http' },
        { direction: 'inbound', protocol: 'tcp', ports: '443', cidrs: ['0.0.0.0/0', '::/0'], description: 'https' },
        { direction: 'inbound', protocol: 'udp', ports: '443', cidrs: ['0.0.0.0/0', '::/0'], description: 'http3' },
        { direction: 'inbound', protocol: 'tcp', ports: '9009', cidrs: [cfg.CONTROL_PLANE_CIDR], description: 'pgcloud app agent' },
        { direction: 'outbound', protocol: 'any', cidrs: ['0.0.0.0/0'] },
      ],
    }));
    const vmSecret = randomBytes(24).toString('base64url');
    const count = await this.prisma.appHost.count({ where: { regionId } });
    const server = await this.prisma.server.create({
      data: {
        projectId: project.id, regionId: region.id, sizeId: size.id, imageId: image.id, name: `app-host-${region.id}-${count + 1}`,
        vcpu: size.vcpu, memoryMb: size.memoryMb, diskGb: size.diskGb, userData: renderAppHostCloudInit({ vmSecret, acmeEmail: cfg.ACME_EMAIL }),
        tags: ['app-host'], managedBy: HOST_MANAGED, firewalls: { create: [{ firewallId: fw.id }] },
        actions: { create: { type: 'create', params: {}, requestedBy: 'system:apps' } },
      },
      include: { actions: true },
    });
    const host = await this.prisma.appHost.create({ data: { regionId: region.id, serverId: server.id, capacityMb: Math.max(512, size.memoryMb - HOST_RESERVE_MB), vmSecret } });
    await this.temporal.start('createServer', [{ serverId: server.id, actionId: server.actions[0].id, avoid: [] }], `createServer-${server.actions[0].id}`);
    await this.prisma.serverAction.update({ where: { id: server.actions[0].id }, data: { status: 'running', workflowId: `createServer-${server.actions[0].id}` } });
    this.log.log(`provisioning app host ${host.id} (${server.name})`);
    return host;
  }

  /** Pick the host with the most free memory that fits the app; start a new host when none does. */
  async placeApp(appId: string): Promise<string> {
    const app = await this.prisma.platformApp.findUniqueOrThrow({ where: { id: appId } });
    if (app.hostId) return app.hostId;
    const need = APP_SIZES[app.size as AppSizeId].memoryMb * app.instances;
    // Failed and draining hosts are never used. An active host must have reported Docker and
    // Caddy running recently, and is asked again before it gets the app; a provisioning host is
    // fine because the workflow waits for it to become ready.
    const hosts = await this.prisma.appHost.findMany({ where: { regionId: app.regionId, status: { in: ['active', 'provisioning'] } }, include: { server: { select: { id: true, name: true, status: true, privateIp: true, publicIps: { select: { address: true } } } }, apps: { where: { deletedAt: null }, select: { size: true, instances: true } } } });
    const free = (h: (typeof hosts)[number]) => h.capacityMb - h.apps.reduce((n, a) => n + APP_SIZES[a.size as AppSizeId].memoryMb * a.instances, 0);
    const fresh = (h: (typeof hosts)[number]) => h.status === 'provisioning' || (!!h.readyAt && Date.now() - h.readyAt.getTime() < HOST_DOWN_MS);
    const candidates = hosts.filter((h) => free(h) >= need && fresh(h)).sort((a, b) => (a.status === b.status ? free(b) - free(a) : a.status === 'active' ? -1 : 1));
    let host: { id: string } | undefined;
    for (const h of candidates) {
      if (h.status === 'provisioning' || hostReady(await this.hostStatus(h).catch(() => null))) {
        host = h;
        break;
      }
    }
    host ??= await this.provisionHost(app.regionId);
    await this.prisma.platformApp.update({ where: { id: appId }, data: { hostId: host.id } });
    return host.id;
  }

  /** Push the desired state of every app on a host to its agent. */
  async pushHost(hostId: string) {
    const host = await this.prisma.appHost.findUnique({ where: { id: hostId }, include: { server: { select: { id: true, name: true, status: true, privateIp: true, publicIps: { select: { address: true } } } }, apps: { where: { deletedAt: null, status: { notIn: ['deleted'] } }, include: { deploys: { orderBy: { startedAt: 'desc' }, take: 1 }, installation: true } } } });
    if (!host) return { ok: false };
    const ip = agentHost(host.server);
    if (!ip || host.server.status !== 'active') throw ApiError.invalidState('App host is not active yet');
    const cfg = loadConfig();
    const apps = [] as Record<string, unknown>[];
    for (const a of host.apps) {
      if (a.status === 'deleting') continue;
      let token: string | undefined = a.gitToken ?? undefined;
      if (a.installation && !a.installation.suspendedAt) token = await this.github.installationToken(a.installation.installationId).catch(() => undefined);
      const size = APP_SIZES[a.size as AppSizeId];
      apps.push({
        id: a.id, slug: a.slug, hostnames: [`${a.slug}.${cfg.APPS_DOMAIN}`, ...verifiedDomains(a)], repo: a.repoUrl, branch: a.branch, token, commit: a.deploys[0]?.commit ?? null,
        port: a.port, env: a.envVars, memoryMb: size.memoryMb, cpus: size.cpus, instances: a.instances, deployId: a.deploys[0]?.id ?? 'none', healthPath: a.healthPath, stopped: a.status === 'stopped',
      });
    }
    const version = (await this.prisma.appHost.update({ where: { id: hostId }, data: { configVersion: { increment: 1 } } })).configVersion;
    const r = await agentFetch(ip, { method: 'POST', path: '/config', secret: host.vmSecret, body: { version, apps }, timeoutMs: 60_000 });
    if (!r.ok) throw ApiError.invalid(`App host rejected the configuration: ${r.status} ${(await r.text().catch(() => '')).slice(0, 300)}`);
    return { ok: true, version };
  }

  /** Every minute: hosts that finished booting, build results, and runtime state. */
  async refreshAll() {
    const provisioning = await this.prisma.appHost.findMany({ where: { status: 'provisioning' }, include: { server: { select: { id: true, name: true, status: true, statusMessage: true, privateIp: true, publicIps: { select: { address: true } } } } } });
    for (const h of provisioning) {
      // Usable only once the agent reports Docker and Caddy running, not merely when the VM is up.
      if (h.server.status === 'active' && hostReady(await this.hostStatus(h).catch(() => null))) await this.prisma.appHost.update({ where: { id: h.id }, data: { status: 'active', readyAt: new Date() } });
      else if (h.server.status === 'failed') await this.prisma.appHost.update({ where: { id: h.id }, data: { status: 'failed' } });
    }
    const hosts = await this.prisma.appHost.findMany({ where: { status: 'active' }, include: { server: { select: { id: true, name: true, status: true, privateIp: true, publicIps: { select: { address: true } } } }, apps: { where: { deletedAt: null }, include: { deploys: { orderBy: { startedAt: 'desc' }, take: 1 } } } } });
    for (const h of hosts) {
      const st = await this.hostStatus(h).catch(() => null);
      if (hostReady(st)) await this.prisma.appHost.update({ where: { id: h.id }, data: { readyAt: new Date() } });
      else if (h.server.status === 'failed' || Date.now() - (h.readyAt ?? h.createdAt).getTime() > HOST_DOWN_MS) {
        await this.failHost(h.id, st ? `docker ${st.docker ? 'up' : 'down'}, caddy ${st.caddy ? 'up' : 'down'}` : 'agent unreachable');
        continue;
      }
      if (!st) continue;
      for (const a of h.apps) await this.applyReport(a, st.apps[a.id]);
    }
    // Pending custom domains are looked up again every five minutes for a week after they were added.
    if (new Date().getUTCMinutes() % 5 === 0) {
      const pending = await this.prisma.platformApp.findMany({ where: { deletedAt: null, customDomains: { isEmpty: false }, updatedAt: { gt: new Date(Date.now() - 7 * 86_400_000) } }, select: { id: true, domainChecks: true } });
      for (const a of pending) {
        if (Object.values((a.domainChecks ?? {}) as unknown as DomainChecks).some((c) => !c.verifiedAt)) await this.checkDomains(a.id).catch(() => undefined);
      }
    }
  }

  /** A failed host gets no new apps; its apps are placed on a healthy host, redeployed there, and DNS follows. */
  async failHost(hostId: string, reason: string) {
    const h = await this.prisma.appHost.update({ where: { id: hostId }, data: { status: 'failed' }, include: { server: { select: { name: true } } } });
    const apps = await this.prisma.platformApp.findMany({ where: { hostId, deletedAt: null, status: { notIn: ['deleting', 'deleted'] } }, select: { id: true } });
    this.log.warn(`app host ${h.server.name} failed (${reason}); moving ${apps.length} apps`);
    for (const a of apps) {
      await this.prisma.platformApp.update({ where: { id: a.id }, data: { hostId: null } });
      await this.redeploy(null, a.id, 'host_failed').catch((e) => this.log.warn(`move app ${a.id}: ${(e as Error).message}`));
    }
    return apps.length;
  }

  async hostStatus(h: { vmSecret: string; server: { id: string; name: string; status: string; privateIp: string | null; publicIps: { address: string }[] } }): Promise<HostStatus | null> {
    const ip = agentHost(h.server);
    if (!ip || h.server.status !== 'active') return null;
    const r = await agentFetch(ip, { path: '/status', secret: h.vmSecret, timeoutMs: 8000 });
    if (!r.ok) return null;
    return (await r.json()) as HostStatus;
  }

  /** Fold one app's report from the host into the app and its latest deploy. */
  async applyReport(a: { id: string; status: string; deploys: { id: string; status: string }[] }, rep: HostStatus['apps'][string] | undefined) {
    if (!rep) return;
    const deploy = a.deploys[0];
    if (deploy && rep.deployId === deploy.id && rep.state && rep.state !== 'building' && deploy.status !== rep.state) {
      await this.prisma.appDeploy.update({ where: { id: deploy.id }, data: { status: rep.state, commit: rep.commit ?? undefined, finishedAt: new Date(), log: rep.logTail?.slice(-4000) } });
      if (!['stopped', 'deleting', 'deleted'].includes(a.status)) {
        const data: Prisma.PlatformAppUpdateInput = rep.state === 'live'
          ? { status: 'live', statusMessage: null, lastCommit: rep.commit ?? undefined, lastDeployAt: new Date(), meteredSince: new Date() }
          : { status: a.status === 'creating' ? 'failed' : (a.status as 'live' | 'failed' | 'building'), statusMessage: `deploy failed: ${rep.error ?? 'see the build log'}` };
        if (rep.state === 'failed' && a.status !== 'creating' && a.status !== 'building') data.status = a.status as 'live';
        if (rep.state === 'failed' && a.status === 'building') data.status = 'failed';
        await this.prisma.platformApp.update({ where: { id: a.id }, data });
        await this.emit(rep.state === 'live' ? 'app.deployed' : 'app.deploy_failed', a.id, { deployId: deploy.id, commit: rep.commit ?? null, error: rep.error ?? null });
      }
    }
  }

  // ---- DNS ----

  /** A record under the apps zone, when the platform hosts that zone. Silent when it does not (dev). */
  async upsertDns(appId: string) {
    const app = await this.prisma.platformApp.findUnique({ where: { id: appId }, include: { host: { include: { server: { select: { publicIps: { select: { address: true } } } } } } } });
    const ip = app?.host?.server.publicIps[0]?.address;
    const zone = await this.prisma.dnsZone.findFirst({ where: { name: loadConfig().APPS_DOMAIN } });
    if (!app || !ip || !zone) return false;
    const existing = await this.prisma.dnsRecord.findFirst({ where: { zoneId: zone.id, name: app.slug, type: 'A' } });
    if (existing?.content === ip) return true;
    if (existing) await this.prisma.dnsRecord.update({ where: { id: existing.id }, data: { content: ip } });
    else await this.prisma.dnsRecord.create({ data: { zoneId: zone.id, name: app.slug, type: 'A', content: ip, ttl: 60 } });
    await this.prisma.dnsZone.update({ where: { id: zone.id }, data: { serial: { increment: 1 } } });
    return true;
  }

  async removeDns(slug: string) {
    const zone = await this.prisma.dnsZone.findFirst({ where: { name: loadConfig().APPS_DOMAIN } });
    if (!zone) return;
    const n = await this.prisma.dnsRecord.deleteMany({ where: { zoneId: zone.id, name: slug, type: 'A' } });
    if (n.count) await this.prisma.dnsZone.update({ where: { id: zone.id }, data: { serial: { increment: 1 } } });
  }

  async emit(name: string, appId: string, payload: Record<string, unknown>) {
    const a = await this.prisma.platformApp.findUnique({ where: { id: appId }, include: { project: { select: { teamId: true } } } });
    await this.events.emit(name, { appId, name: a?.slug, status: a?.status, url: a ? `https://${a.slug}.${loadConfig().APPS_DOMAIN}` : null, ...payload }, { teamId: a?.project.teamId, resource: `app:${appId}` });
  }

  // ---- helpers ----

  private async checkHostRoom(hostId: string, extraMb: number) {
    if (extraMb <= 0) return;
    const h = await this.prisma.appHost.findUniqueOrThrow({ where: { id: hostId }, include: { apps: { where: { deletedAt: null }, select: { size: true, instances: true } } } });
    const used = h.apps.reduce((n, a) => n + APP_SIZES[a.size as AppSizeId].memoryMb * a.instances, 0);
    if (used + extraMb > h.capacityMb) throw ApiError.quota('The app\'s host has no room for that size; create a new app with the larger size and move traffic over');
  }

  private mustBeSettled(a: AppRow) {
    if (!['live', 'failed', 'stopped'].includes(a.status)) throw ApiError.invalidState(`App is ${a.status}; wait for it to settle`);
  }

  private async own(actor: Actor, id: string, project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    const a = await this.prisma.platformApp.findFirst({ where: { id, projectId: p.id, deletedAt: null }, include: appInclude });
    if (!a) throw ApiError.notFound('app', id);
    return a;
  }

  private async ensurePlatformProject() {
    const team = await this.prisma.team.upsert({ where: { slug: PLATFORM_TEAM }, update: {}, create: { slug: PLATFORM_TEAM, name: 'pgcloud platform', status: 'active', country: 'SA', currency: 'USD' } });
    return this.prisma.project.upsert({ where: { id: PLATFORM_PROJECT }, update: {}, create: { id: PLATFORM_PROJECT, teamId: team.id, slug: PLATFORM_PROJECT, name: 'Platform', quotaServers: 10_000, quotaVcpu: 1_000_000, quotaMemoryMb: 1_000_000_000 } });
  }

  private async platformActor(): Promise<Actor> {
    const project = await this.ensurePlatformProject();
    return { userId: 'system', teamId: project.teamId, role: 'owner', scopes: new Set(['*']), isAgent: false, requireApprovalFor: new Set(), locale: 'en' };
  }

  present(a: AppRow) {
    const cfg = loadConfig();
    const size = APP_SIZES[a.size as AppSizeId];
    return {
      id: a.id, name: a.slug, status: a.status, statusMessage: a.statusMessage,
      url: `https://${a.slug}.${cfg.APPS_DOMAIN}`, hostname: `${a.slug}.${cfg.APPS_DOMAIN}`, customDomains: a.customDomains,
      domains: a.customDomains.map((d) => {
        const check = ((a.domainChecks ?? {}) as unknown as DomainChecks)[d];
        return { domain: d, verified: !!check?.verifiedAt, verifiedAt: check?.verifiedAt ?? null, verification: check && !check.verifiedAt ? { txt: { name: `_progrid-verify.${d}`, value: check.token }, cname: { name: d, value: `${a.slug}.${cfg.APPS_DOMAIN}` } } : null };
      }),
      region: a.region, repoUrl: a.repoUrl, repo: a.repoFullName, source: a.installationId ? 'github_app' : 'url', branch: a.branch, port: a.port,
      size: { id: a.size, memoryMb: size.memoryMb, cpus: size.cpus }, instances: a.instances, healthPath: a.healthPath, env: a.envVars as Record<string, string>,
      hostIp: a.host?.server.publicIps[0]?.address ?? null, lastCommit: a.lastCommit, lastDeployAt: a.lastDeployAt,
      deploys: a.deploys, projectId: a.projectId, createdAt: a.createdAt,
    };
  }
}

/** Docker and Caddy both running. Agents from before the readiness report count as ready when they answer. */
export function hostReady(st: HostStatus | null | undefined): boolean {
  return !!st && (st.ready ?? true);
}

/** Custom domains that passed the ownership check; the only ones written into the Caddyfile. */
function verifiedDomains(a: { customDomains: string[]; domainChecks: Prisma.JsonValue }) {
  const checks = (a.domainChecks ?? {}) as unknown as DomainChecks;
  return a.customDomains.filter((d) => !!checks[d]?.verifiedAt);
}

export { HOST_MANAGED as APP_HOST_MANAGED };
