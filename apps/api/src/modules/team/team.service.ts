import { Inject, Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import type { TeamRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TemporalService } from '../../common/temporal/temporal.service';
import { MailService } from '../../common/mail/mail.service';
import { ApiError } from '../../common/errors/api-error';
import { scopesForRole, type Actor } from '../../common/auth/actor';
import { loadConfig } from '../../config/config';
import { EventsService } from '../events/events.service';
import { TokenService } from '../iam/token.service';
import { ServersService } from '../compute/servers.service';
import { DatabasesService } from '../databases/db.service';
import { KubernetesService } from '../kubernetes/k8s.service';
import { AppPlatformService } from '../app-platform/app.service';
import { LoadBalancersService } from '../lb/lb.service';
import { VolumesService } from '../storage/volumes.service';
import { ObjectsService } from '../storage/objects/objects.service';
import { OBJECT_STORAGE_PROVIDER, ObjectStorageProvider } from '../storage/objects/objects.provider';
import { DnsService } from '../dns/dns.service';
import { FirewallsService } from '../network/firewalls.service';
import { IpsService } from '../network/ips.service';
import { AlertsService } from '../monitoring/alerts.service';

const INVITE_TTL_MS = 7 * 86_400_000;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

export interface TeamProfileInput { name?: string; billingEmail?: string | null; taxId?: string | null; billingAddress?: string | null; country?: string }

/** Members, invitations, the billing profile printed on invoices, and closing the account. */
@Injectable()
export class TeamService {
  private readonly log = new Logger(TeamService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly temporal: TemporalService,
    private readonly mail: MailService,
    private readonly events: EventsService,
    private readonly tokens: TokenService,
    private readonly servers: ServersService,
    private readonly databases: DatabasesService,
    private readonly kubernetes: KubernetesService,
    private readonly apps: AppPlatformService,
    private readonly lbs: LoadBalancersService,
    private readonly volumes: VolumesService,
    private readonly buckets: ObjectsService,
    @Inject(OBJECT_STORAGE_PROVIDER) private readonly storage: ObjectStorageProvider,
    private readonly dns: DnsService,
    private readonly firewalls: FirewallsService,
    private readonly ips: IpsService,
    private readonly alerts: AlertsService,
  ) {}

  // ---- team and members ----

  async get(actor: Actor) {
    if (actor.tokenId && !actor.scopes.has('iam:read')) throw ApiError.forbidden('Token is missing required scope(s): iam:read');
    const team = await this.prisma.team.findUniqueOrThrow({
      where: { id: actor.teamId },
      select: { id: true, name: true, slug: true, country: true, currency: true, status: true, taxId: true, billingEmail: true, billingAddress: true, createdAt: true },
    });
    const [members, invitations] = await Promise.all([
      this.prisma.teamMember.findMany({ where: { teamId: actor.teamId }, include: { user: { select: { id: true, email: true, name: true, totpEnabled: true, createdAt: true } } } }),
      this.prisma.invitation.findMany({
        where: { teamId: actor.teamId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return {
      team,
      role: actor.role,
      members: members.map((m) => ({ userId: m.userId, role: m.role, email: m.user.email, name: m.user.name, totpEnabled: m.user.totpEnabled, you: m.userId === actor.userId })),
      invitations,
    };
  }

  async updateProfile(actor: Actor, dto: TeamProfileInput) {
    this.human(actor);
    const data = {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.billingEmail !== undefined ? { billingEmail: dto.billingEmail?.trim().toLowerCase() || null } : {}),
      ...(dto.taxId !== undefined ? { taxId: dto.taxId?.trim() || null } : {}),
      ...(dto.billingAddress !== undefined ? { billingAddress: dto.billingAddress?.trim() || null } : {}),
      ...(dto.country !== undefined ? { country: dto.country } : {}),
    };
    const team = await this.prisma.team.update({ where: { id: actor.teamId }, data });
    await this.events.emit('team.updated', { fields: Object.keys(data) }, { actor, resource: `team:${team.id}` });
    return this.get(actor);
  }

  async changeRole(actor: Actor, userId: string, role: TeamRole) {
    this.human(actor);
    if (actor.role !== 'owner') throw ApiError.forbidden('Only a team owner can change roles');
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`team-owners:${actor.teamId}`}))`;
      const m = await tx.teamMember.findUnique({ where: { teamId_userId: { teamId: actor.teamId, userId } } });
      if (!m) throw ApiError.notFound('member', userId);
      if (m.role === 'owner' && role !== 'owner' && (await tx.teamMember.count({ where: { teamId: actor.teamId, role: 'owner' } })) <= 1) {
        throw ApiError.invalidState('A team needs at least one owner. Make someone else an owner first.');
      }
      await tx.teamMember.update({ where: { teamId_userId: { teamId: actor.teamId, userId } }, data: { role } });
    });
    await this.events.emit('team.member_role_changed', { userId, role }, { actor, resource: `user:${userId}` });
    return this.get(actor);
  }

  /** Removes a member (or lets a member leave) and revokes the API tokens they issued for this team. */
  async removeMember(actor: Actor, userId: string) {
    this.human(actor);
    const self = userId === actor.userId;
    if (!self && !['owner', 'admin'].includes(actor.role)) throw ApiError.forbidden('Only owners and admins can remove members');
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`team-owners:${actor.teamId}`}))`;
      const m = await tx.teamMember.findUnique({ where: { teamId_userId: { teamId: actor.teamId, userId } } });
      if (!m) throw ApiError.notFound('member', userId);
      if (m.role === 'owner' && !self && actor.role !== 'owner') throw ApiError.forbidden('Only an owner can remove another owner');
      if (m.role === 'owner' && (await tx.teamMember.count({ where: { teamId: actor.teamId, role: 'owner' } })) <= 1) {
        throw ApiError.invalidState('A team needs at least one owner. Make someone else an owner first, or close the account.');
      }
      await tx.teamMember.delete({ where: { teamId_userId: { teamId: actor.teamId, userId } } });
      await tx.apiToken.updateMany({ where: { teamId: actor.teamId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
    });
    await this.events.emit('team.member_removed', { userId }, { actor, resource: `user:${userId}` });
  }

  // ---- invitations ----

  async invite(actor: Actor, email: string, role: TeamRole) {
    this.human(actor);
    if (role === 'owner' && actor.role !== 'owner') throw ApiError.forbidden('Only an owner can invite another owner');
    const addr = email.trim().toLowerCase();
    const existing = await this.prisma.teamMember.findFirst({ where: { teamId: actor.teamId, user: { email: addr } } });
    if (existing) throw ApiError.conflict('already_member', `${addr} is already a member of this team`);
    const pending = await this.prisma.invitation.count({ where: { teamId: actor.teamId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
    if (pending >= 50) throw ApiError.quota('Too many open invitations (50). Revoke some first.');
    // A new invitation to the same address replaces the old one.
    await this.prisma.invitation.updateMany({ where: { teamId: actor.teamId, email: addr, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });

    const token = randomBytes(32).toString('base64url');
    const inv = await this.prisma.invitation.create({ data: { teamId: actor.teamId, email: addr, role, tokenHash: hash(token), invitedBy: actor.userId, expiresAt: new Date(Date.now() + INVITE_TTL_MS) } });
    const [team, inviter] = await Promise.all([
      this.prisma.team.findUniqueOrThrow({ where: { id: actor.teamId }, select: { name: true } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { name: true } }),
    ]);
    const url = `${loadConfig().CONSOLE_URL}/invite?token=${token}`;
    await this.mail.send({
      to: addr,
      subject: `${inviter.name} invited you to ${team.name} on Progrid`,
      text: `Hi,\n\n${inviter.name} invited you to join the team ${team.name} on Progrid as ${role}.\n\nAccept the invitation here:\n${url}\n\nThe link is valid for 7 days. If you already have an account, sign in with this email address first. If you did not expect this, you can ignore it.`,
    }).catch((e) => this.log.warn(`invitation mail to ${addr} failed: ${(e as Error).message}`));
    await this.events.emit('team.member_invited', { invitationId: inv.id, email: addr, role }, { actor, resource: `invitation:${inv.id}` });
    return { id: inv.id, email: inv.email, role: inv.role, expiresAt: inv.expiresAt, createdAt: inv.createdAt };
  }

  async revokeInvitation(actor: Actor, id: string) {
    const r = await this.prisma.invitation.updateMany({ where: { id, teamId: actor.teamId, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!r.count) throw ApiError.notFound('invitation', id);
    await this.events.emit('team.invitation_revoked', { invitationId: id }, { actor, resource: `invitation:${id}` });
  }

  /** What the accept page shows before anyone signs in. */
  async describeInvitation(token: string) {
    const inv = await this.findUsable(token);
    const [team, user] = await Promise.all([
      this.prisma.team.findUniqueOrThrow({ where: { id: inv.teamId }, select: { name: true } }),
      this.prisma.user.findUnique({ where: { email: inv.email }, select: { id: true } }),
    ]);
    return { teamName: team.name, email: inv.email, role: inv.role, expiresAt: inv.expiresAt, hasAccount: !!user };
  }

  /** A signed in person accepts. The invitation must be for their email address. */
  async accept(actor: Actor, token: string) {
    this.human(actor);
    const inv = await this.findUsable(token);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (user.email !== inv.email) throw ApiError.forbidden(`This invitation is for ${inv.email}. Sign in with that address to accept it.`);
    return this.join(inv, user.id);
  }

  /** Someone without an account accepts by choosing a name and password. The link proves the email. */
  async acceptWithSignup(token: string, name: string, password: string) {
    const inv = await this.findUsable(token);
    if (await this.prisma.user.findUnique({ where: { email: inv.email } })) throw ApiError.conflict('email_taken', 'An account with this email already exists. Sign in and accept the invitation.');
    const user = await this.prisma.user.create({ data: { email: inv.email, name, passwordHash: await argon2.hash(password), emailVerified: new Date() } });
    return this.join(inv, user.id);
  }

  private async join(inv: { id: string; teamId: string; role: TeamRole }, userId: string) {
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.invitation.updateMany({ where: { id: inv.id, acceptedAt: null, revokedAt: null }, data: { acceptedAt: new Date(), acceptedBy: userId } });
      if (!r.count) throw ApiError.invalidState('This invitation was already used or revoked');
      await tx.teamMember.upsert({ where: { teamId_userId: { teamId: inv.teamId, userId } }, create: { teamId: inv.teamId, userId, role: inv.role }, update: {} });
    });
    await this.events.emit('team.member_joined', { userId, role: inv.role, invitationId: inv.id }, { teamId: inv.teamId, resource: `user:${userId}` });
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: inv.teamId }, select: { id: true, name: true, slug: true } });
    return { team, session: await this.tokens.issueSession(userId, inv.teamId) };
  }

  private async findUsable(token: string) {
    const inv = await this.prisma.invitation.findUnique({ where: { tokenHash: hash(token ?? '') }, include: { team: { select: { status: true } } } });
    if (!inv || inv.revokedAt || inv.acceptedAt) throw ApiError.notFound('invitation', 'link');
    if (inv.expiresAt < new Date()) throw new ApiError(410, 'invitation_expired', 'This invitation has expired. Ask for a new one.');
    if (inv.team.status === 'closed') throw ApiError.invalidState('This team no longer exists');
    return inv;
  }

  // ---- closing the account ----

  /**
   * Closes the account: owner only, nothing unpaid. Every resource is deleted through its
   * normal delete path (the hourly sweep finishes what has to wait, such as volumes that are
   * still attached), the team is marked closed and every API token is revoked. Usage up to now
   * is still invoiced by the next monthly run.
   */
  async close(actor: Actor, confirmSlug: string) {
    this.human(actor);
    if (actor.role !== 'owner') throw ApiError.forbidden('Only a team owner can close the account');
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: actor.teamId } });
    if (team.status === 'closed') throw ApiError.invalidState('This account is already closed');
    if (confirmSlug !== team.slug) throw ApiError.invalid(`Type the team slug "${team.slug}" to confirm`);
    const unpaid = await this.prisma.invoice.count({ where: { teamId: team.id, status: { in: ['open', 'uncollectible'] } } });
    if (unpaid) throw new ApiError(402, 'unpaid_invoices', `Pay the ${unpaid} unpaid ${unpaid === 1 ? 'invoice' : 'invoices'} on the billing page before closing the account`);

    const remaining = await this.sweep(team.id, actor);
    await this.prisma.$transaction([
      this.prisma.team.update({ where: { id: team.id }, data: { status: 'closed', closedAt: new Date() } }),
      this.prisma.apiToken.updateMany({ where: { teamId: team.id, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.invitation.updateMany({ where: { teamId: team.id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.webhook.updateMany({ where: { teamId: team.id }, data: { active: false } }),
    ]);
    await this.events.emit('team.closed', { remaining }, { actor, resource: `team:${team.id}` });
    return { closed: true, pendingDeletions: remaining };
  }

  /** Hourly: keeps deleting what is left of closed teams (resources that were busy at close time). */
  async sweepClosed() {
    const teams = await this.prisma.team.findMany({ where: { status: 'closed', closedAt: { not: null } }, select: { id: true } });
    let left = 0;
    for (const t of teams) {
      const owner = await this.prisma.teamMember.findFirst({ where: { teamId: t.id, role: 'owner' }, include: { user: { select: { locale: true } } } });
      if (!owner) continue;
      const actor: Actor = { userId: owner.userId, teamId: t.id, role: 'owner', scopes: scopesForRole('owner'), isAgent: false, requireApprovalFor: new Set(), locale: owner.user.locale };
      left += await this.sweep(t.id, actor).catch((e) => { this.log.error(`closing sweep for team ${t.id} failed: ${(e as Error).message}`); return 0; });
    }
    return left;
  }

  /** Starts deletion of everything the team still has; returns how many resources could not be started yet. */
  private async sweep(teamId: string, actor: Actor) {
    const projects = (await this.prisma.project.findMany({ where: { teamId }, select: { id: true } })).map((p) => p.id);
    const inProjects = { projectId: { in: projects }, deletedAt: null };
    let blocked = 0;
    const attempt = async (what: string, fn: () => Promise<unknown>) => {
      try { await fn(); } catch (err) { blocked++; this.log.warn(`closing team ${teamId}: ${what} not deleted yet: ${(err as Error).message}`); }
    };
    const busy = { notIn: ['deleting', 'deleted'] as never[] };

    // Platform products first: they own servers, load balancers and volumes of their own.
    for (const c of await this.prisma.kubeCluster.findMany({ where: { ...inProjects, status: busy }, select: { id: true, projectId: true } })) await attempt(`kubernetes ${c.id}`, () => this.kubernetes.remove(actor, c.id, c.projectId));
    for (const a of await this.prisma.platformApp.findMany({ where: { ...inProjects, status: busy }, select: { id: true, projectId: true } })) await attempt(`app ${a.id}`, () => this.apps.remove(actor, a.id, a.projectId));
    for (const d of await this.prisma.dbCluster.findMany({ where: { ...inProjects, status: busy }, select: { id: true, projectId: true } })) await attempt(`database ${d.id}`, () => this.databases.remove(actor, d.id, d.projectId));
    for (const l of await this.prisma.loadBalancer.findMany({ where: { ...inProjects, status: busy }, select: { id: true, projectId: true } })) await attempt(`load balancer ${l.id}`, () => this.lbs.remove(actor, l.id, l.projectId));
    for (const s of await this.prisma.server.findMany({ where: { ...inProjects, managedBy: null, status: { notIn: ['deleting', 'deleted'] } }, select: { id: true } })) await attempt(`server ${s.id}`, () => this.servers.delete(actor, s.id));
    for (const v of await this.prisma.volume.findMany({ where: { ...inProjects, status: busy }, select: { id: true, projectId: true } })) await attempt(`volume ${v.id}`, () => this.volumes.remove(actor, v.id, v.projectId));
    for (const b of await this.prisma.bucket.findMany({ where: { ...inProjects, status: busy }, select: { name: true, projectId: true } })) {
      await attempt(`bucket ${b.name}`, async () => { await this.emptyBucket(b.projectId, b.name); await this.buckets.remove(actor, b.name, b.projectId); });
    }
    for (const sn of await this.prisma.snapshot.findMany({ where: { ...inProjects, status: 'available' }, select: { id: true } })) {
      await attempt(`snapshot ${sn.id}`, () => this.temporal.start('deleteSnapshot', [{ snapshotId: sn.id }] as never, `deleteSnapshot-${sn.id}`));
    }
    for (const z of await this.prisma.dnsZone.findMany({ where: { ...inProjects, status: busy }, select: { name: true, projectId: true } })) await attempt(`zone ${z.name}`, () => this.dns.remove(actor, z.name, z.projectId));
    for (const ip of await this.prisma.publicIp.findMany({ where: { projectId: { in: projects }, serverId: null, loadBalancer: null, dbCluster: null }, select: { id: true } })) await attempt(`ip ${ip.id}`, () => this.ips.release(ip.id));
    for (const f of await this.prisma.firewall.findMany({ where: { projectId: { in: projects } }, select: { id: true, projectId: true, servers: { select: { serverId: true } } } })) {
      if (!f.servers.length) await attempt(`firewall ${f.id}`, () => this.firewalls.remove(actor, f.projectId, f.id));
    }
    for (const a of await this.prisma.alertPolicy.findMany({ where: { teamId }, select: { id: true } })) await attempt(`alert ${a.id}`, () => this.alerts.remove(actor, a.id));
    return blocked;
  }

  /** Deletes every object, walking each prefix level the listing returns. */
  private async emptyBucket(projectId: string, name: string) {
    const walk = async (prefix: string): Promise<void> => {
      let token: string | undefined;
      do {
        const page = await this.storage.listObjects(projectId, name, prefix, token);
        for (const o of page.objects) await this.storage.deleteObject(projectId, name, o.key);
        for (const p of page.prefixes) if (p !== prefix) await walk(p);
        token = page.nextToken;
      } while (token);
    };
    await walk('');
  }

  private human(actor: Actor) {
    if (actor.isAgent) throw ApiError.forbidden('Agents cannot manage the team. A person must do this in the console.');
  }
}
