import { Injectable, Logger } from '@nestjs/common';
import { requestApiBase } from '../../common/entities/entities';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiError } from '../../common/errors/api-error';
import type { Actor } from '../../common/auth/actor';
import { IamService } from '../iam/iam.service';
import { EventsService } from '../events/events.service';
import { ServersService } from '../compute/servers.service';
import { FirewallsService } from '../network/firewalls.service';
import { renderDeployCloudInit } from './cloud-init';
import { agentFetch, agentHost } from '../../common/platform-agent';
import { open, seal, sealJson } from '../../common/crypto/secretbox';
import { CreateDeployDto } from './deploy.dto';
import { loadConfig } from '../../config/config';
import { GithubService } from '../github/github.service';
import { Inject, forwardRef } from '@nestjs/common';

/**
 * Git Deploy: "link a repo, get a URL, push to redeploy". Built on a normal server so it
 * inherits quotas, spend checks, metering and the workflow engine — no separate PaaS.
 */
@Injectable()
export class DeployService {
  private readonly log = new Logger(DeployService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly iam: IamService,
    private readonly events: EventsService,
    private readonly servers: ServersService,
    private readonly firewalls: FirewallsService,
    @Inject(forwardRef(() => GithubService)) private readonly github: GithubService,
  ) {}

  async list(actor: Actor, project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    const rows = await this.prisma.deployment.findMany({ where: { projectId: p.id }, include: { server: { include: { publicIps: true } } }, orderBy: { createdAt: 'desc' } });
    return rows.map(present);
  }

  async get(actor: Actor, id: string) {
    const d = await this.prisma.deployment.findFirst({ where: { id, project: { teamId: actor.teamId }, ...(actor.projectId ? { projectId: actor.projectId } : {}) }, include: { server: { include: { publicIps: true } } } });
    if (!d) throw ApiError.notFound('deployment', id);
    return present(d);
  }

  async create(actor: Actor, dto: CreateDeployDto) {
    // GitHub App path: the installation clones the repo with a token we mint and refresh; no PAT needed.
    let installation: { id: string; installationId: number } | null = null;
    let gitToken = dto.gitToken;
    let repoUrl = dto.repoUrl;
    if (dto.installationId && dto.repo) {
      installation = await this.prisma.githubInstallation.findFirst({ where: { id: dto.installationId, teamId: actor.teamId }, select: { id: true, installationId: true } });
      if (!installation) throw ApiError.notFound('github_installation', dto.installationId);
      repoUrl = `https://github.com/${dto.repo}`;
      gitToken = await this.github.installationToken(installation.installationId);
    }
    if (!repoUrl || !/^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/[\w.-]+\/[\w.-]+?(\.git)?$/.test(repoUrl)) {
      throw ApiError.invalid('Give repoUrl (an https GitHub, GitLab or Bitbucket repository URL) or installationId with repo ("owner/name")');
    }
    const project = await this.iam.resolveProject(actor, dto.project);
    const webhookSecret = 'whsec_' + randomBytes(24).toString('base64url');
    const vmSecret = randomBytes(24).toString('base64url');
    const name = dto.name ?? repoUrl.split('/').pop()!.replace(/\.git$/, '').toLowerCase().replace(/[^a-z0-9-]/g, '-');

    // A firewall that also opens the redeploy hook port for the control plane.
    const fw = await this.firewalls.create(actor, project.id, {
      name: `deploy-${name}`,
      rules: [
        { direction: 'inbound', protocol: 'tcp', ports: '22', cidrs: ['0.0.0.0/0'] },
        { direction: 'inbound', protocol: 'tcp', ports: '80', cidrs: ['0.0.0.0/0'] },
        { direction: 'inbound', protocol: 'tcp', ports: '443', cidrs: ['0.0.0.0/0'] },
        { direction: 'inbound', protocol: 'tcp', ports: '9009', cidrs: [loadConfig().CONTROL_PLANE_CIDR], description: 'prgd redeploy hook' },
        { direction: 'outbound', protocol: 'any', cidrs: ['0.0.0.0/0'] },
      ],
    });

    const server = await this.servers.create(actor, {
      name,
      size: dto.size ?? 's-1vcpu-2gb',
      // Plain distribution image: our cloud-init is a complete #cloud-config that installs
      // Docker itself. (Marketplace images wrap user-data as a post-install script instead.)
      image: 'ubuntu-24-04',
      project: project.id,
      sshKeys: dto.sshKeys,
      firewalls: [fw.id],
      tags: ['git-deploy'],
      userData: renderDeployCloudInit({ repoUrl, branch: dto.branch ?? 'main', port: dto.port ?? 3000, vmSecret, envVars: dto.env ?? {}, gitToken }),
    });

    const d = await this.prisma.deployment.create({
      data: { projectId: project.id, serverId: server.id, name, repoUrl, branch: dto.branch ?? 'main', port: dto.port ?? 3000, webhookSecret: seal(webhookSecret), vmSecret: seal(vmSecret), envVars: sealJson(dto.env), installationId: installation?.id, repoFullName: installation ? dto.repo : repoUrl.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '') },
      include: { server: { include: { publicIps: true } } },
    });
    await this.events.emit('deploy.created', { deploymentId: d.id, repoUrl }, { actor, resource: `deployment:${d.id}` });
    // App based deployments redeploy through the app webhook; URL based ones get a per deployment webhook (secret shown once).
    if (installation) return { ...present(d), webhook: null };
    return { ...present(d), webhook: { url: `${requestApiBase()}/v1/deploys/${d.id}/hook`, secret: webhookSecret, contentType: 'application/json', events: ['push'] } };
  }

  /** Manual redeploy from the console / CLI. */
  async redeploy(actor: Actor, id: string) {
    const d = await this.prisma.deployment.findFirst({ where: { id, project: { teamId: actor.teamId }, ...(actor.projectId ? { projectId: actor.projectId } : {}) }, include: { server: { include: { publicIps: true } } } });
    if (!d) throw ApiError.notFound('deployment', id);
    await this.trigger(d);
    await this.events.emit('deploy.triggered', { deploymentId: id, source: 'manual' }, { actor, resource: `deployment:${id}` });
    return { id, status: 'deploying' };
  }

  /** GitHub push webhook (public; authenticated by the HMAC GitHub computes with our secret). */
  async githubHook(id: string, rawBody: Buffer, signature: string | undefined, event: string | undefined) {
    const d = await this.prisma.deployment.findUnique({ where: { id }, include: { server: { include: { publicIps: true } } } });
    if (!d) throw ApiError.notFound('deployment', id);
    const expected = 'sha256=' + createHmac('sha256', open(d.webhookSecret)).update(rawBody).digest('hex');
    if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      throw ApiError.unauthorized('Invalid webhook signature');
    }
    if (event === 'ping') return { ok: true, pong: true };
    if (event !== 'push') return { ok: true, ignored: event };
    const payload = JSON.parse(rawBody.toString('utf8')) as { ref?: string; after?: string };
    if (payload.ref && payload.ref !== `refs/heads/${d.branch}`) return { ok: true, ignored: payload.ref };
    await this.trigger(d, payload.after);
    await this.events.emit('deploy.triggered', { deploymentId: id, source: 'github', commit: payload.after }, { teamId: (await this.prisma.project.findUniqueOrThrow({ where: { id: d.projectId } })).teamId, resource: `deployment:${id}` });
    return { ok: true, deploying: true };
  }

  /** App webhook: a push to a repository the app is installed on. Redeploys every matching deployment. */
  async onAppPush(installationId: number, repoFullName: string, branch: string, commit?: string) {
    const rows = await this.prisma.deployment.findMany({
      where: { repoFullName, branch, installation: { installationId } },
      include: { server: { include: { publicIps: true } }, installation: true, project: { select: { teamId: true } } },
    });
    let n = 0;
    for (const d of rows) {
      try {
        await this.trigger(d, commit);
        await this.events.emit('deploy.triggered', { deploymentId: d.id, source: 'github_app', commit }, { teamId: d.project.teamId, resource: `deployment:${d.id}` });
        n++;
      } catch (err) {
        this.log.warn(`push for ${repoFullName}@${branch}: deployment ${d.id} skipped: ${(err as Error).message}`);
      }
    }
    return n;
  }

  /** Last build log from the server (tail of /var/log/prgd-deploy.log), cached on the row. */
  async logs(actor: Actor, id: string) {
    const d = await this.prisma.deployment.findFirst({ where: { id, project: { teamId: actor.teamId }, ...(actor.projectId ? { projectId: actor.projectId } : {}) }, include: { server: { include: { publicIps: true } } } });
    if (!d) throw ApiError.notFound('deployment', id);
    const ip = agentHost(d.server);
    if (ip && d.server.status === 'active') {
      try {
        const r = await agentFetch(ip, { path: '/logs', secret: open(d.vmSecret), timeoutMs: 5000 }).then((r) => r.json() as Promise<{ status: string; commit: string | null; log: string }>);
        const status = r.status === 'live' ? 'live' : r.status === 'failed' ? 'failed' : 'deploying';
        const log = r.log.slice(-32_000);
        await this.prisma.deployment.update({ where: { id }, data: { status, lastCommit: r.commit ?? undefined, buildLog: log, logUpdatedAt: new Date() } });
        return { id, status, commit: r.commit, log, updatedAt: new Date(), live: true };
      } catch {
        /* fall through to the cached copy */
      }
    }
    return { id, status: d.status, commit: d.lastCommit, log: d.buildLog ?? '', updatedAt: d.logUpdatedAt, live: false };
  }

  /** Polls the VM's status endpoint and mirrors it into the row. */
  async refreshStatus(id: string) {
    const d = await this.prisma.deployment.findUnique({ where: { id }, include: { server: { include: { publicIps: true } } } });
    if (!d) return;
    const ip = agentHost(d.server);
    if (!ip || d.server.status !== 'active') return;
    try {
      const r = await agentFetch(ip, { path: '/status', secret: open(d.vmSecret), timeoutMs: 4000 }).then((r) => r.json() as Promise<{ status: string; commit: string | null }>);
      const status = r.status === 'live' ? 'live' : r.status === 'failed' ? 'failed' : 'deploying';
      await this.prisma.deployment.update({ where: { id }, data: { status, lastCommit: r.commit ?? undefined, ...(status === 'live' ? { lastDeployAt: new Date() } : {}) } });
    } catch {
      /* VM not reachable yet (still booting, or fake driver) — leave status as is */
    }
  }

  private async trigger(d: { id: string; vmSecret: string; installationId?: string | null; server: { id: string; name: string; status: string; privateIp: string | null; publicIps: { address: string }[] } }, commit?: string) {
    const ip = agentHost(d.server);
    if (!ip || d.server.status !== 'active') throw ApiError.invalidState('Server is not active yet');
    await this.prisma.deployment.update({ where: { id: d.id }, data: { status: 'deploying', lastCommit: commit } });
    // App deployments get a fresh one hour token with every redeploy so the clone keeps working.
    let token: string | undefined;
    if (d.installationId) {
      const inst = await this.prisma.githubInstallation.findUnique({ where: { id: d.installationId } });
      if (inst && !inst.suspendedAt) token = await this.github.installationToken(inst.installationId).catch(() => undefined);
    }
    try {
      await agentFetch(ip, { method: 'POST', path: '/redeploy', secret: open(d.vmSecret), body: token ? { token, commit } : { commit }, timeoutMs: 5000 });
    } catch (err) {
      // With the fake driver there is no VM to call; the status poller will keep it 'deploying'.
      this.log.warn(`redeploy hook unreachable for ${d.id}: ${(err as Error).message}`);
    }
  }
}

function present(d: Prisma.DeploymentGetPayload<{ include: { server: { include: { publicIps: true } } } }>) {
  const ip = d.server.publicIps[0]?.address;
  return {
    id: d.id,
    name: d.name,
    repoUrl: d.repoUrl,
    branch: d.branch,
    port: d.port,
    status: d.server.status === 'active' ? d.status : d.server.status === 'failed' ? 'failed' : 'creating',
    url: ip ? `http://${ip}` : null,
    repo: d.repoFullName,
    source: d.installationId ? 'github_app' : 'url',
    serverId: d.serverId,
    serverStatus: d.server.status,
    lastCommit: d.lastCommit,
    lastDeployAt: d.lastDeployAt,
    createdAt: d.createdAt,
  };
}
