import { Injectable, Logger } from '@nestjs/common';
import { requestApiBase } from '../../common/entities/entities';
import { ActionType, Prisma, ServerStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TemporalService } from '../../common/temporal/temporal.service';
import { ApiError } from '../../common/errors/api-error';
import { cursorArgs, toPage } from '../../common/pagination';
import type { Actor } from '../../common/auth/actor';
import { loadConfig } from '../../config/config';
import { IamService } from '../iam/iam.service';
import { EventsService } from '../events/events.service';
import { TrustService } from '../trust/trust.service';
import { SpendService } from '../billing/spend.service';
import { MarketplaceService } from '../marketplace/marketplace.service';
import { ApprovalsService } from '../approvals/approvals.service';
import type { Approval } from '@prisma/client';
import { CreateServerDto, ListServersQuery, RestoreServerDto, ServerActionDto, UpdateServerDto } from './compute.dto';
import { randomBytes } from 'node:crypto';
import { recordDiskUsage } from '../monitoring/metrics.service';
import { hasManagedAgent, healthOf, renderManagedInstallScript, withManagedAgent, type ManagedReport } from './managed-agent';
import { openOpt, seal, sealOpt } from '../../common/crypto/secretbox';

/** Transitions allowed from each state. Everything else is `invalid_state`. */
const ALLOWED: Record<ActionType, ServerStatus[]> = {
  create: ['new'],
  start: ['off'],
  stop: ['active'],
  reboot: ['active'],
  resize: ['active', 'off'],
  rebuild: ['active', 'off'],
  snapshot: ['active', 'off'],
  restore: ['active', 'off'],
  delete: ['active', 'off', 'failed', 'new'],
};

const serverInclude = {
  size: true,
  image: { select: { id: true, name: true, kind: true, distribution: true, version: true } },
  publicIps: { select: { id: true, address: true, floating: true, reverseDns: true } },
  firewalls: { select: { firewallId: true } },
  region: { select: { id: true, name: true } },
} satisfies Prisma.ServerInclude;

/**
 * Server lifecycle. Handlers validate, persist intent and start a workflow — they never
 * touch the hypervisor (docs/adr/0003-temporal-workflows.md).
 */
@Injectable()
export class ServersService {
  private readonly log = new Logger(ServersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly temporal: TemporalService,
    private readonly iam: IamService,
    private readonly events: EventsService,
    private readonly trust: TrustService,
    private readonly spend: SpendService,
    private readonly marketplace: MarketplaceService,
    private readonly approvals: ApprovalsService,
  ) {
    // What runs when a person approves a parked request.
    this.approvals.registerExecutor('servers:create', (actor, a) => this.create(actor, a.payload as unknown as CreateServerDto));
    this.approvals.registerExecutor('servers:delete', (actor, a) => this.delete(actor, a.resourceId!));
    this.approvals.registerExecutor('servers:restore', (actor, a) => this.restore(actor, a.resourceId!, a.payload as unknown as RestoreServerDto));
    for (const k of ['servers:stop', 'servers:reboot', 'servers:resize', 'servers:resize-down', 'servers:rebuild', 'servers:snapshot', 'servers:start']) {
      this.approvals.registerExecutor(k, (actor, a) => this.action(actor, a.resourceId!, a.payload as unknown as ServerActionDto));
    }
  }

  async list(actor: Actor, q: ListServersQuery) {
    const project = await this.iam.resolveProject(actor, q.project);
    const rows = await this.prisma.server.findMany({
      where: {
        projectId: project.id,
        deletedAt: null,
        managedBy: null,
        ...(q.status ? { status: q.status as ServerStatus } : {}),
        ...(q.tag ? { tags: { has: q.tag } } : {}),
      },
      include: serverInclude,
      orderBy: { createdAt: 'desc' },
      ...cursorArgs(q),
    });
    return toPage(rows.map(present), q.limit);
  }

  async get(actor: Actor, id: string) {
    const server = await this.prisma.server.findFirst({
      where: { id, deletedAt: null, project: { teamId: actor.teamId, ...(actor.projectId ? { id: actor.projectId } : {}) } },
      include: serverInclude,
    });
    if (!server) throw ApiError.notFound('server', id);
    return present(server);
  }

  /**
   * `opts.spreadGroup` (platform callers only): nodes of one cluster, placed on different hosts where the region allows.
   * `opts.platformImage` (platform callers only, never set from a request): allows images that are not `public`.
   */
  async create(actor: Actor, dto: CreateServerDto, opts: { spreadGroup?: string; platformImage?: boolean } = {}) {
    const cfg = loadConfig();
    const project = await this.iam.resolveProject(actor, dto.project);
    await this.trust.assertCanProvision(actor.teamId);
    if (!dto.image === !dto.snapshotId) throw ApiError.invalid('Pass either image or snapshotId');
    if (this.approvals.needs(actor, 'servers:create')) {
      await this.approvals.request(actor, { kind: 'servers:create', resourceType: 'server', resourceName: dto.name, projectId: project.id, summary: `Create server ${dto.name} (${dto.size}, ${dto.image ?? `snapshot ${dto.snapshotId}`})`, payload: { ...dto, project: project.id } });
    }

    // From a snapshot: the new VM is a full clone of the snapshot, on the host and in the region of its source server.
    const snapshot = dto.snapshotId
      ? await this.prisma.snapshot.findFirst({ where: { id: dto.snapshotId, status: 'available', projectId: project.id, project: { teamId: actor.teamId } }, include: { server: true } })
      : null;
    if (dto.snapshotId && !snapshot) throw ApiError.notFound('snapshot', dto.snapshotId);
    const source = snapshot?.server;
    if (snapshot && (!source || source.deletedAt || !source.hostId)) throw ApiError.invalidState('The server this snapshot was taken from no longer exists, so the snapshot cannot be cloned');
    if (source && dto.region && dto.region !== source.regionId) throw ApiError.invalid(`A server from this snapshot is created in region ${source.regionId}`);

    const [region, size, image] = await Promise.all([
      this.prisma.region.findUnique({ where: { id: source?.regionId ?? dto.region ?? cfg.DEFAULT_REGION } }),
      this.prisma.size.findUnique({ where: { id: dto.size } }),
      source
        ? this.prisma.image.findUnique({ where: { id: source.imageId }, include: { app: true } })
        : this.prisma.image.findFirst({ where: { OR: [{ id: dto.image }, { app: { slug: dto.image } }], deprecated: false }, include: { app: true } }),
    ]);
    if (!region?.available) throw ApiError.invalid(`Unknown or unavailable region "${dto.region}"`);
    if (!size?.available) throw ApiError.invalid(`Unknown size "${dto.size}"`);
    if (!image) throw ApiError.invalid(`Unknown image "${dto.image}"`);
    // Private images are for platform built nodes and staff; a clone keeps its source's image.
    if (!source && !image.public && !opts.platformImage && !actor.scopes.has('admin')) throw ApiError.invalid(`Unknown image "${dto.image}"`);
    if (source && size.diskGb < source.diskGb) throw ApiError.invalid(`The snapshot holds a ${source.diskGb} GB disk; choose a size with at least that much disk`);
    if (image.regionId && image.regionId !== region.id) throw ApiError.invalid('Image is not available in this region');
    if (size.diskGb < image.minDiskGb || size.memoryMb < image.minMemoryMb) {
      throw ApiError.invalid(`Image "${image.id}" needs at least ${image.minDiskGb} GB disk and ${image.minMemoryMb} MB memory`);
    }
    if (image.app && !snapshot && image.app.status !== 'published') throw ApiError.invalid('This marketplace app is not published');
    if (image.app) {
      const minSize = await this.prisma.size.findUniqueOrThrow({ where: { id: image.app.minSizeId } });
      if (size.memoryMb < minSize.memoryMb) throw ApiError.invalid(`"${image.app.name}" needs at least size ${minSize.id}`);
    }

    // Quotas
    // Platform owned nodes (load balancers, databases) do not count against the customer's server quota.
    const usage = await this.prisma.server.aggregate({ where: { projectId: project.id, deletedAt: null, managedBy: null, status: { notIn: ['deleted', 'failed'] } }, _count: true, _sum: { vcpu: true, memoryMb: true } });
    if (usage._count >= project.quotaServers) throw ApiError.quota(`Project server quota (${project.quotaServers}) reached`);
    if ((usage._sum.vcpu ?? 0) + size.vcpu > project.quotaVcpu) throw ApiError.quota(`Project vCPU quota (${project.quotaVcpu}) reached`);
    if ((usage._sum.memoryMb ?? 0) + size.memoryMb > project.quotaMemoryMb) throw ApiError.quota(`Project memory quota (${project.quotaMemoryMb} MB) reached`);

    // Spend controls (team currency)
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: actor.teamId } });
    const planMonthly = await this.spend.monthlyPriceMinor('server', size.id, team.currency);
    const managedMonthly = dto.managed ? await this.spend.monthlyPriceMinor('managed_server', `managed-${size.id}`, team.currency) : 0;
    if (dto.managed && !managedMonthly) throw ApiError.invalid(`The managed tier is not offered on the ${size.name || size.id} plan; choose Standard or larger`);
    // Managed includes daily backups; otherwise backups are a share of the plan.
    const monthly =
      planMonthly +
      managedMonthly +
      (dto.backups && !dto.managed ? Math.round((planMonthly * (await this.spend.monthlyPriceMinor('backup', 'backups_pct', team.currency))) / 100) : 0) +
      (await this.spend.monthlyPriceMinor('public_ip', 'public_ip', team.currency)) +
      (image.app?.priceMonthlyMinor ?? 0);
    await this.spend.assertCanSpend(actor, project.id, monthly);

    // SSH keys must belong to the team
    const sshKeyIds = dto.sshKeys ?? [];
    if (sshKeyIds.length) {
      const owned = await this.prisma.sshKey.count({ where: { id: { in: sshKeyIds }, user: { memberships: { some: { teamId: actor.teamId } } } } });
      if (owned !== sshKeyIds.length) throw ApiError.invalid('One or more SSH keys do not belong to this team');
    }
    if (dto.firewalls?.length) {
      const owned = await this.prisma.firewall.count({ where: { id: { in: dto.firewalls }, projectId: project.id } });
      if (owned !== dto.firewalls.length) throw ApiError.invalid('One or more firewalls do not belong to this project');
    }

    // Managed tier: the care agent rides along as a second cloud-init part, and daily backups are on.
    const managedToken = dto.managed ? randomBytes(24).toString('base64url') : null;
    // A snapshot already holds the installed app, so only the customer's user-data applies.
    const baseUserData = image.app && !snapshot ? this.marketplace.renderCloudInit(image.app, dto.appVariables ?? {}, dto.userData) : dto.userData;
    const userData = managedToken ? withManagedAgent(baseUserData, this.managedScript(managedToken)) : baseUserData;

    const server = await this.prisma.server.create({
      data: {
        projectId: project.id,
        regionId: region.id,
        sizeId: size.id,
        imageId: image.id,
        sourceSnapshotId: snapshot?.id,
        name: dto.name,
        vcpu: size.vcpu,
        memoryMb: size.memoryMb,
        diskGb: size.diskGb,
        // Rendered cloud-init carries secrets (agent secrets, app variables): sealed at rest, opened for the hypervisor.
        userData: sealOpt(userData),
        sshKeyIds,
        tags: dto.tags ?? [],
        backupsEnabled: !!dto.backups || !!dto.managed,
        managed: !!dto.managed,
        managedToken,
        managedHealth: dto.managed ? 'pending' : null,
        firewalls: dto.firewalls?.length ? { create: dto.firewalls.map((firewallId) => ({ firewallId })) } : undefined,
        actions: { create: { type: 'create', params: { avoid: dto.avoid ?? [], ...(opts.spreadGroup ? { spreadGroup: opts.spreadGroup } : {}) }, requestedBy: actor.tokenId ?? actor.userId } },
      },
      include: { ...serverInclude, actions: true },
    });

    await this.startWorkflow(server.actions[0].id, 'createServer', [{ serverId: server.id, actionId: server.actions[0].id, avoid: dto.avoid ?? [] }]);
    await this.events.emit('server.created', { serverId: server.id, name: server.name, size: size.id, image: image.id, region: region.id }, { actor, resource: `server:${server.id}` });
    return present(server);
  }

  /** Managed care status for a server: tier, health, the last report and the install command while the agent is not reporting yet. */
  async managedStatus(actor: Actor, id: string) {
    const server = await this.mustOwn(actor, id);
    const report = (server.managedReport ?? null) as ManagedReport | null;
    const { health, issues } = server.managed ? healthOf(report, server.managedReportedAt) : { health: null, issues: [] as string[] };
    return {
      serverId: server.id,
      managed: server.managed,
      backupsEnabled: server.backupsEnabled,
      health,
      issues,
      reportedAt: server.managedReportedAt,
      report,
      installCommand: server.managed && server.managedToken && (!server.managedReportedAt || health === 'stale') ? `curl -fsSL ${requestApiBase()}/v1/managed/install/${server.managedToken} | sudo sh` : null,
    };
  }

  private managedScript(token: string) {
    return renderManagedInstallScript({ apiUrl: requestApiBase(), token });
  }

  /**
   * Name, tags, the backups switch and the managed switch. Turning either on checks spend for
   * the percent add on. Turning managed on also turns backups on and, for a server that never
   * had the agent, stores the agent in its user-data (used on rebuild) and returns an install
   * command through `managedStatus`.
   */
  async update(actor: Actor, id: string, dto: UpdateServerDto) {
    const server = await this.mustOwn(actor, id);
    if (server.managedBy && dto.managed !== undefined) throw ApiError.invalidState('Platform owned nodes cannot change tier');
    const turningManagedOn = dto.managed === true && !server.managed;
    const turningBackupsOn = (dto.backups === true || turningManagedOn) && !server.backupsEnabled;
    if (dto.backups === false && (dto.managed ?? server.managed)) throw ApiError.invalid('Managed servers keep daily backups on; turn managed off first');
    if (turningBackupsOn || turningManagedOn) {
      const team = await this.prisma.team.findUniqueOrThrow({ where: { id: actor.teamId } });
      const plan = await this.spend.monthlyPriceMinor('server', server.sizeId, team.currency);
      const managedMonthly = turningManagedOn ? await this.spend.monthlyPriceMinor('managed_server', `managed-${server.sizeId}`, team.currency) : 0;
      if (turningManagedOn && !managedMonthly) throw ApiError.invalid('The managed tier is not offered on this plan; resize to Standard or larger first');
      const backupsPct = turningBackupsOn && !turningManagedOn && !server.managed ? await this.spend.monthlyPriceMinor('backup', 'backups_pct', team.currency) : 0;
      await this.spend.assertCanSpend(actor, server.projectId, managedMonthly + Math.round((plan * backupsPct) / 100));
    }
    if (dto.name && dto.name !== server.name && (await this.prisma.server.findFirst({ where: { projectId: server.projectId, name: dto.name, deletedAt: null } }))) throw ApiError.conflict('name_taken', `A server named "${dto.name}" already exists in this project`);
    const managedToken = turningManagedOn ? server.managedToken ?? randomBytes(24).toString('base64url') : undefined;
    const updated = await this.prisma.server.update({
      where: { id },
      data: {
        name: dto.name,
        tags: dto.tags,
        backupsEnabled: turningManagedOn ? true : dto.backups,
        managed: dto.managed,
        managedToken,
        managedHealth: turningManagedOn ? (server.managedReportedAt ? server.managedHealth : 'pending') : dto.managed === false ? null : undefined,
        userData: managedToken && !hasManagedAgent(openOpt(server.userData)) ? seal(withManagedAgent(openOpt(server.userData), this.managedScript(managedToken))) : undefined,
      },
      include: serverInclude,
    });
    if (updated.backupsEnabled !== server.backupsEnabled) await this.events.emit(updated.backupsEnabled ? 'server.backups_enabled' : 'server.backups_disabled', { serverId: id }, { actor, resource: `server:${id}` });
    if (dto.managed !== undefined && dto.managed !== server.managed) await this.events.emit(dto.managed ? 'server.managed_enabled' : 'server.managed_disabled', { serverId: id }, { actor, resource: `server:${id}` });
    if (dto.name && dto.name !== server.name) await this.events.emit('server.renamed', { serverId: id, from: server.name, to: dto.name }, { actor, resource: `server:${id}` });
    return present(updated);
  }

  async action(actor: Actor, id: string, dto: ServerActionDto) {
    const server = await this.mustOwn(actor, id);
    this.assertTransition(server.status, dto.type);
    if (server.managedBy && ['resize', 'rebuild'].includes(dto.type)) throw ApiError.invalidState(`This server is managed by ${server.managedBy.replace('lb:', 'load balancer ')}; change the load balancer instead`);
    if (this.approvals.needs(actor, `servers:${dto.type}`)) {
      await this.approvals.request(actor, { kind: `servers:${dto.type}`, resourceType: 'server', resourceId: server.id, resourceName: server.name, projectId: server.projectId, summary: `${cap(dto.type)} server ${server.name}${dto.size ? ` to ${dto.size}` : ''}${dto.image ? ` with ${dto.image}` : ''}`, payload: { ...dto } });
    }

    const params: Record<string, unknown> = {};
    let nextStatus: ServerStatus = server.status;
    switch (dto.type) {
      case 'start':
        nextStatus = 'provisioning';
        break;
      case 'stop':
        params.force = !!dto.force;
        nextStatus = 'active';
        break;
      case 'reboot':
        nextStatus = 'rebooting';
        break;
      case 'resize': {
        if (!dto.size) throw ApiError.invalid('size is required for resize');
        const size = await this.prisma.size.findUnique({ where: { id: dto.size } });
        if (!size?.available) throw ApiError.invalid(`Unknown size "${dto.size}"`);
        if (size.diskGb < server.diskGb) throw ApiError.invalid('Disk cannot shrink; choose a size with equal or larger disk');
        if (size.memoryMb < server.memoryMb && this.approvals.needs(actor, 'servers:resize-down')) {
          await this.approvals.request(actor, { kind: 'servers:resize-down', resourceType: 'server', resourceId: server.id, resourceName: server.name, projectId: server.projectId, summary: `Resize server ${server.name} down to ${size.id}`, payload: { ...dto } });
        }
        const team = await this.prisma.team.findUniqueOrThrow({ where: { id: actor.teamId } });
        const delta = (await this.spend.monthlyPriceMinor('server', size.id, team.currency)) - (await this.spend.monthlyPriceMinor('server', server.sizeId, team.currency));
        if (delta > 0) await this.spend.assertCanSpend(actor, server.projectId, delta);
        params.sizeId = size.id;
        nextStatus = 'resizing';
        break;
      }
      case 'rebuild': {
        const image = await this.prisma.image.findFirst({ where: { id: dto.image ?? server.imageId, deprecated: false } });
        if (!image) throw ApiError.invalid(`Unknown image "${dto.image}"`);
        // Rebuilding onto the server's own image is always allowed; switching needs a public image (or staff).
        if (image.id !== server.imageId && !image.public && !actor.scopes.has('admin')) throw ApiError.invalid(`Unknown image "${dto.image}"`);
        params.imageId = image.id;
        nextStatus = 'rebuilding';
        break;
      }
      case 'snapshot':
        params.name = dto.name ?? `${server.name}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
        break;
    }

    const action = await this.prisma.$transaction(async (tx) => {
      const a = await tx.serverAction.create({ data: { serverId: server.id, type: dto.type, params: params as Prisma.InputJsonValue, requestedBy: actor.tokenId ?? actor.userId } });
      if (nextStatus !== server.status) await tx.server.update({ where: { id: server.id }, data: { status: nextStatus } });
      return a;
    });

    const workflow = { start: 'powerServer', stop: 'powerServer', reboot: 'powerServer', resize: 'resizeServer', rebuild: 'rebuildServer', snapshot: 'snapshotServer' }[dto.type];
    await this.startWorkflow(action.id, workflow, [{ serverId: server.id, actionId: action.id, ...params, op: dto.type }]);
    await this.events.emit(`server.${dto.type}_requested`, { serverId: server.id, ...params }, { actor, resource: `server:${server.id}` });
    return this.prisma.serverAction.findUniqueOrThrow({ where: { id: action.id } });
  }

  /** Rolls a server back to one of its own snapshots. Data written after the snapshot is lost. */
  async restore(actor: Actor, id: string, dto: RestoreServerDto) {
    const server = await this.mustOwn(actor, id);
    this.assertTransition(server.status, 'restore');
    if (server.managedBy) throw ApiError.invalidState(`This server is managed by ${server.managedBy.replace('lb:', 'load balancer ')}; it cannot be restored directly`);
    const snapshot = await this.prisma.snapshot.findFirst({ where: { id: dto.snapshotId, serverId: id, status: 'available' } });
    if (!snapshot) throw ApiError.notFound('snapshot', dto.snapshotId);
    if (this.approvals.needs(actor, 'servers:restore')) {
      await this.approvals.request(actor, { kind: 'servers:restore', resourceType: 'server', resourceId: server.id, resourceName: server.name, projectId: server.projectId, summary: `Restore server ${server.name} to snapshot ${snapshot.name}`, payload: { ...dto } });
    }

    const action = await this.prisma.$transaction(async (tx) => {
      const a = await tx.serverAction.create({ data: { serverId: server.id, type: 'restore', params: { snapshotId: snapshot.id }, requestedBy: actor.tokenId ?? actor.userId } });
      await tx.server.update({ where: { id: server.id }, data: { status: 'rebuilding' } });
      return a;
    });
    await this.startWorkflow(action.id, 'restoreServer', [{ serverId: server.id, actionId: action.id, snapshotId: snapshot.id }]);
    await this.events.emit('server.restore_requested', { serverId: server.id, snapshotId: snapshot.id }, { actor, resource: `server:${server.id}` });
    return this.prisma.serverAction.findUniqueOrThrow({ where: { id: action.id } });
  }

  async delete(actor: Actor, id: string) {
    const server = await this.mustOwn(actor, id);
    this.assertTransition(server.status, 'delete');
    if (server.managedBy) throw ApiError.invalidState(`This server is managed by ${server.managedBy.replace('lb:', 'load balancer ')}; delete the load balancer instead`);
    if (this.approvals.needs(actor, 'servers:delete')) {
      await this.approvals.request(actor, { kind: 'servers:delete', resourceType: 'server', resourceId: server.id, resourceName: server.name, projectId: server.projectId, summary: `Delete server ${server.name} (${server.sizeId})`, payload: {} });
    }

    const action = await this.prisma.$transaction(async (tx) => {
      const a = await tx.serverAction.create({ data: { serverId: server.id, type: 'delete', requestedBy: actor.tokenId ?? actor.userId } });
      await tx.server.update({ where: { id: server.id }, data: { status: 'deleting' } });
      return a;
    });
    await this.startWorkflow(action.id, 'deleteServer', [{ serverId: server.id, actionId: action.id }]);
    await this.events.emit('server.delete_requested', { serverId: server.id }, { actor, resource: `server:${server.id}` });
    return action;
  }

  async actions(actor: Actor, id: string) {
    await this.mustOwn(actor, id);
    return this.prisma.serverAction.findMany({ where: { serverId: id }, orderBy: { startedAt: 'desc' }, take: 50 });
  }

  // ---- helpers ----

  private async mustOwn(actor: Actor, id: string) {
    const server = await this.prisma.server.findFirst({
      where: { id, deletedAt: null, project: { teamId: actor.teamId, ...(actor.projectId ? { id: actor.projectId } : {}) } },
    });
    if (!server) throw ApiError.notFound('server', id);
    return server;
  }

  private assertTransition(status: ServerStatus, type: ActionType) {
    if (!ALLOWED[type].includes(status)) throw ApiError.invalidState(`Cannot ${type} a server that is ${status}`);
  }

  private async startWorkflow(actionId: string, workflow: string, args: unknown[]) {
    const workflowId = `${workflow}-${actionId}`;
    try {
      await this.temporal.start(workflow, args as never, workflowId);
      await this.prisma.serverAction.update({ where: { id: actionId }, data: { workflowId, status: 'running' } });
    } catch (err) {
      this.log.error(`failed to start ${workflowId}: ${(err as Error).message}`);
      const action = await this.prisma.serverAction.update({ where: { id: actionId }, data: { status: 'failed', error: 'workflow_start_failed', finishedAt: new Date() } });
      // A create that never started must not linger as `new`; other actions leave the server where it was.
      if (action.type === 'create') {
        await this.prisma.server.update({ where: { id: action.serverId }, data: { status: 'failed', statusMessage: 'Provisioning could not be started. Please try again.' } });
      }
      throw new ApiError(503, 'workflow_unavailable', 'Provisioning is temporarily unavailable; please retry');
    }
  }
}

type ServerRow = Prisma.ServerGetPayload<{ include: typeof serverInclude }>;

/** Managed care endpoints that live outside the customer's bearer auth: the agent's report and the install script. */
@Injectable()
export class ManagedCareService {
  private readonly log = new Logger(ManagedCareService.name);
  constructor(private readonly prisma: PrismaService, private readonly events: EventsService) {}

  /** The install script for a managed token, served as text so `curl | sh` works. */
  async installScript(token: string) {
    const server = await this.prisma.server.findFirst({ where: { managedToken: token, managed: true, deletedAt: null }, select: { id: true } });
    if (!server) throw ApiError.unauthorized('Unknown managed token');
    return renderManagedInstallScript({ apiUrl: requestApiBase(), token });
  }

  /** Store a report from the agent; emits a warning event when health goes bad and a recovery when it clears. */
  async report(token: string | undefined, body: ManagedReport) {
    if (!token) throw ApiError.unauthorized('Missing managed token');
    const server = await this.prisma.server.findFirst({ where: { managedToken: token, managed: true, deletedAt: null }, select: { id: true, managedHealth: true, name: true, project: { select: { teamId: true } } } });
    if (!server) throw ApiError.unauthorized('Unknown managed token');
    const report: ManagedReport = {
      agentVersion: num(body.agentVersion), hostname: str(body.hostname), kernel: str(body.kernel), uptimeSec: num(body.uptimeSec), load1: num(body.load1),
      memTotalMb: num(body.memTotalMb), memUsedMb: num(body.memUsedMb), diskTotalGb: num(body.diskTotalGb), diskUsedGb: num(body.diskUsedGb), diskUsedPct: num(body.diskUsedPct),
      pendingUpdates: num(body.pendingUpdates), securityUpdates: num(body.securityUpdates), rebootRequired: !!body.rebootRequired, lastUpgradeAt: str(body.lastUpgradeAt) ?? null,
      failedUnits: Array.isArray(body.failedUnits) ? body.failedUnits.filter((u) => typeof u === 'string').slice(0, 20) : [], sshBanned: num(body.sshBanned), sshPasswordAuth: !!body.sshPasswordAuth,
    };
    const now = new Date();
    const { health, issues } = healthOf(report, now, now);
    await this.prisma.server.update({ where: { id: server.id }, data: { managedReport: report as object, managedReportedAt: now, managedHealth: health } });
    await recordDiskUsage(this.prisma, server.id, report.diskUsedPct, now);
    if (health === 'warn' && server.managedHealth !== 'warn') await this.events.emit('server.managed_warning', { serverId: server.id, name: server.name, issues }, { resource: `server:${server.id}`, teamId: server.project.teamId });
    if (health === 'ok' && server.managedHealth === 'warn') await this.events.emit('server.managed_recovered', { serverId: server.id, name: server.name }, { resource: `server:${server.id}`, teamId: server.project.teamId });
    return { ok: true, health, issues };
  }
}

function num(v: unknown) {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function str(v: unknown) {
  return typeof v === 'string' ? v.slice(0, 200) : undefined;
}

/** Public representation (no driver refs, no host ids). */
export function present(s: ServerRow) {
  return {
    id: s.id,
    name: s.name,
    status: s.status,
    statusMessage: s.statusMessage,
    region: s.region,
    size: { id: s.size.id, name: s.size.name, vcpu: s.size.vcpu, memoryMb: s.size.memoryMb, diskGb: s.size.diskGb, transferTb: s.size.transferTb },
    image: s.image,
    networks: {
      v4: s.publicIps.map((ip) => ({ ipAddress: ip.address, type: 'public', floating: ip.floating, reverseDns: ip.reverseDns })),
      private: s.privateIp ? [{ ipAddress: s.privateIp }] : [],
    },
    firewalls: s.firewalls.map((f) => f.firewallId),
    tags: s.tags,
    backupsEnabled: s.backupsEnabled,
    managed: s.managed,
    managedHealth: s.managed ? s.managedHealth : null,
    projectId: s.projectId,
    createdAt: s.createdAt,
  };
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
