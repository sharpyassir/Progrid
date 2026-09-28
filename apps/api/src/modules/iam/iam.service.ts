import { Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiError } from '../../common/errors/api-error';
import { TokenService } from './token.service';
import { CreateProjectDto, CreateSshKeyDto, CreateTokenDto, LoginDto, SignupDto } from './iam.dto';
import { AccountSecurityService } from './account-security.service';
import { EventsService } from '../events/events.service';
import type { Actor } from '../../common/auth/actor';
import { passwordNotSet } from '../oauth/password-not-set';

@Injectable()
export class IamService {
  private readonly log = new Logger(IamService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly events: EventsService,
    private readonly security: AccountSecurityService,
  ) {}

  async signup(dto: SignupDto, meta: { ip?: string; userAgent?: string } = {}) {
    const { user, team } = await this.createAccount(dto);
    return { user: publicUser(user), team, session: await this.tokens.issueSession(user.id, team.id, meta) };
  }

  /**
   * A new user with a new team, the way signup makes them. Social sign up passes no password
   * and `emailVerified` when the provider vouches for the address, so no confirmation mail goes out.
   */
  async createAccount(dto: Omit<SignupDto, 'password'> & { password?: string; emailVerified?: boolean }) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (existing) throw ApiError.conflict('email_taken', 'An account with this email already exists');

    const country = dto.country ?? 'SA';
    const slug = await this.uniqueSlug(dto.teamName);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash: dto.password ? await argon2.hash(dto.password) : null,
        emailVerified: dto.emailVerified ? new Date() : undefined,
        name: dto.name,
        locale: dto.locale ?? (country === 'SA' ? 'ar' : country === 'TR' ? 'tr' : 'en'),
        memberships: {
          create: {
            role: 'owner',
            team: {
              create: {
                name: dto.teamName,
                slug,
                country,
                currency: country === 'SA' ? 'SAR' : 'USD',
                ...(dto.emailVerified ? { status: 'active' as const } : {}),
                projects: { create: { name: 'Default', slug: 'default' } },
              },
            },
          },
        },
      },
      include: { memberships: { include: { team: true } } },
    });
    const team = user.memberships[0].team;
    await this.events.emit('team.created', { teamId: team.id, userId: user.id }, { teamId: team.id });
    this.security.sendVerification(user.id).catch((e) => this.log.warn(`verification mail failed: ${e.message}`));
    return { user, team };
  }

  async login(dto: LoginDto, meta: { ip?: string; userAgent?: string } = {}) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      include: { memberships: { include: { team: true }, orderBy: { teamId: 'asc' } } },
    });
    if (user && !user.passwordHash) throw await passwordNotSet(this.prisma, user.id);
    if (!user || !(await argon2.verify(user.passwordHash!, dto.password))) throw ApiError.unauthorized('Wrong email or password');
    if (user.totpEnabled) {
      if (!dto.totp) throw new ApiError(401, 'totp_required', 'Enter the code from your authenticator app');
      if (!this.security.checkSecondFactor(user, dto.totp)) throw new ApiError(401, 'totp_invalid', 'That code is not valid');
    }
    const membership = user.memberships[0];
    if (!membership) throw ApiError.forbidden('User belongs to no team');
    return {
      user: publicUser(user),
      team: membership.team,
      teams: user.memberships.map((m) => ({ id: m.team.id, slug: m.team.slug, name: m.team.name, role: m.role })),
      session: await this.tokens.issueSession(user.id, membership.teamId, meta),
    };
  }

  async me(actor: Actor) {
    const [user, team] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } }),
      this.prisma.team.findUniqueOrThrow({ where: { id: actor.teamId }, include: { projects: true } }),
    ]);
    return { user: publicUser(user), team, role: actor.role, scopes: [...actor.scopes], isAgent: actor.isAgent, isStaff: user.isStaff, staffRoles: user.isStaff ? user.staffRoles : [] };
  }

  // ---- Projects ----

  listProjects(actor: Actor) {
    return this.prisma.project.findMany({
      where: { teamId: actor.teamId, ...(actor.projectId ? { id: actor.projectId } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createProject(actor: Actor, dto: CreateProjectDto) {
    if (actor.projectId) throw ApiError.forbidden('This token is scoped to a single project');
    const exists = await this.prisma.project.findUnique({ where: { teamId_slug: { teamId: actor.teamId, slug: dto.slug } } });
    if (exists) throw ApiError.conflict('slug_taken', `Project slug "${dto.slug}" already exists`);
    return this.prisma.project.create({ data: { teamId: actor.teamId, name: dto.name, slug: dto.slug, spendLimitMinor: dto.spendLimitMinor } });
  }

  /** Resolves a project by id or slug and checks the actor may use it. */
  async resolveProject(actor: Actor, idOrSlug: string | undefined) {
    const project = await this.prisma.project.findFirst({
      where: { teamId: actor.teamId, OR: [{ id: idOrSlug ?? 'default' }, { slug: idOrSlug ?? 'default' }] },
    });
    if (!project) throw ApiError.notFound('project', idOrSlug ?? 'default');
    if (actor.projectId && actor.projectId !== project.id) throw ApiError.forbidden('Token is not allowed to use this project');
    return project;
  }

  // ---- API tokens ----

  listTokens(actor: Actor) {
    return this.prisma.apiToken.findMany({
      where: { teamId: actor.teamId, revokedAt: null },
      select: { id: true, name: true, prefix: true, scopes: true, isAgent: true, projectId: true, spendCapMinor: true, spentThisMonthMinor: true, requireApprovalFor: true, expiresAt: true, lastUsedAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createToken(actor: Actor, dto: CreateTokenDto) {
    if (actor.isAgent) throw ApiError.forbidden('Agent tokens cannot create tokens');
    // Tokens cannot escalate beyond the creator.
    const disallowed = dto.scopes.filter((s) => !actor.scopes.has(s));
    if (disallowed.length) throw ApiError.forbidden(`You cannot grant scopes you do not have: ${disallowed.join(', ')}`);
    if (dto.projectId) await this.resolveProject(actor, dto.projectId);
    const issued = await this.tokens.issueApiToken({
      teamId: actor.teamId,
      userId: actor.userId,
      projectId: dto.projectId,
      name: dto.name,
      scopes: dto.scopes,
      isAgent: dto.isAgent,
      spendCapMinor: dto.spendCapMinor,
      requireApprovalFor: dto.requireApprovalFor,
      expiresAt: dto.expiresInDays ? new Date(Date.now() + dto.expiresInDays * 86_400_000) : undefined,
    });
    await this.events.emit('token.created', { tokenId: issued.id, isAgent: !!dto.isAgent }, { teamId: actor.teamId, actor });
    return issued;
  }

  async revokeToken(actor: Actor, id: string) {
    await this.tokens.revoke(actor.teamId, id);
    await this.events.emit('token.revoked', { tokenId: id }, { teamId: actor.teamId, actor });
  }

  // ---- SSH keys ----

  listSshKeys(actor: Actor) {
    return this.prisma.sshKey.findMany({ where: { user: { memberships: { some: { teamId: actor.teamId } } } }, orderBy: { createdAt: 'desc' } });
  }

  async createSshKey(actor: Actor, dto: CreateSshKeyDto) {
    const fingerprint = fingerprintOf(dto.publicKey);
    const dup = await this.prisma.sshKey.findUnique({ where: { fingerprint } });
    if (dup) throw ApiError.conflict('ssh_key_exists', 'This SSH key is already registered');
    return this.prisma.sshKey.create({ data: { userId: actor.userId, name: dto.name, publicKey: dto.publicKey.trim(), fingerprint } });
  }

  async deleteSshKey(actor: Actor, id: string) {
    const key = await this.prisma.sshKey.findFirst({ where: { id, user: { memberships: { some: { teamId: actor.teamId } } } } });
    if (!key) throw ApiError.notFound('ssh_key', id);
    await this.prisma.sshKey.delete({ where: { id } });
  }

  private async uniqueSlug(name: string) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) || 'team';
    for (let i = 0; ; i++) {
      const slug = i === 0 ? base : `${base}-${i}`;
      if (!(await this.prisma.team.findUnique({ where: { slug } }))) return slug;
    }
  }
}

export function publicUser(u: { id: string; email: string; name: string; locale: string; totpEnabled: boolean; emailVerified: Date | null; createdAt: Date }) {
  return { id: u.id, email: u.email, name: u.name, locale: u.locale, totpEnabled: u.totpEnabled, emailVerified: !!u.emailVerified, createdAt: u.createdAt };
}

/** SHA256 fingerprint in OpenSSH format. */
function fingerprintOf(publicKey: string) {
  const b64 = publicKey.trim().split(/\s+/)[1];
  return 'SHA256:' + createHash('sha256').update(Buffer.from(b64, 'base64')).digest('base64').replace(/=+$/, '');
}
