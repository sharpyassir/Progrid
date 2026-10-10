import { LegalService } from '../legal/legal.service';
import { LEGAL_VERSION, type LegalMethod } from '../legal/legal';
import { Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiError } from '../../common/errors/api-error';
import { ADMIN_TOKEN_MAX_MS, TokenService } from './token.service';
import { CreateProjectDto, CreateSshKeyDto, CreateTokenDto, LoginDto, SignupDto } from './iam.dto';
import { AccountSecurityService, userActor } from './account-security.service';
import { verifyPassword } from '../../common/auth/password';
import { EventsService } from '../events/events.service';
import { isFullStaff, type Actor } from '../../common/auth/actor';
import { passwordNotSet } from '../oauth/password-not-set';
import { BILLING_ENTITY, currencyForCountry } from '../../common/entities/entities';
import { defaultSignupCountry } from '../../common/geo/signup-country';
import { AttributionService } from '../affiliates/attribution.service';

@Injectable()
export class IamService {
  private readonly log = new Logger(IamService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly events: EventsService,
    private readonly security: AccountSecurityService,
    private readonly attribution: AttributionService,
    private readonly legal: LegalService,
  ) {}

  async signup(dto: SignupDto, meta: { ip?: string; userAgent?: string } = {}) {
    const { acceptTerms: _accepted, ...rest } = dto;
    const { user, team } = await this.createAccount({ ...rest, ip: meta.ip, userAgent: meta.userAgent, legal: 'signup' });
    return { user: publicUser(user), team, session: await this.tokens.issueSession(user.id, team.id, meta) };
  }

  /**
   * A new user with a new team, the way signup makes them. Social sign up passes no password
   * and `emailVerified` when the provider vouches for the address, so no confirmation mail goes out.
   */
  async createAccount(dto: Omit<SignupDto, 'password' | 'acceptTerms'> & { password?: string; emailVerified?: boolean; ip?: string; userAgent?: string; legal?: LegalMethod }) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (existing) throw ApiError.conflict('email_taken', 'An account with this email already exists');
    // A mistyped promo code is reported before anything is created.
    await this.attribution.assertPromo(dto.promoCode);

    const country = dto.country ?? defaultSignupCountry();
    // Progrid Arabia bills every account, whatever the domain; the billing country decides the
    // currency (SA: SAR, else USD) and the VAT (docs/domains-and-entities.md).
    const billingEntity = BILLING_ENTITY;
    const slug = await this.uniqueSlug(dto.teamName);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash: dto.password ? await argon2.hash(dto.password) : null,
        emailVerified: dto.emailVerified ? new Date() : undefined,
        name: dto.name,
        signupIp: dto.ip ?? null,
        locale: dto.locale ?? (country === 'SA' ? 'ar' : country === 'TR' ? 'tr' : 'en'),
        memberships: {
          create: {
            role: 'owner',
            team: {
              create: {
                name: dto.teamName,
                slug,
                country,
                billingEntity,
                currency: currencyForCountry(country),
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
    // The clickwrap record; an account made without the checkbox is asked to accept before first use.
    if (dto.legal) await this.legal.accept(user.id, { method: dto.legal, entity: billingEntity, ip: dto.ip, userAgent: dto.userAgent });
    await this.events.emit('team.created', { teamId: team.id, userId: user.id }, { teamId: team.id });
    await this.attribution.attributeSignup({ teamId: team.id, userId: user.id, email: user.email, ip: dto.ip, promoCode: dto.promoCode });
    this.security.sendVerification(user.id).catch((e) => this.log.warn(`verification mail failed: ${e.message}`));
    return { user, team };
  }

  /**
   * Password sign in. Every outcome is audited (user.signed_in, user.signin_failed with the
   * reason). An unknown email, a wrong password and a locked account give the same answer
   * and take the same time (an argon2 verify runs in every case).
   */
  async login(dto: LoginDto, meta: { ip?: string; userAgent?: string } = {}) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      include: { memberships: { include: { team: true }, orderBy: { teamId: 'asc' } } , engineerProfile: { select: { kind: true } } },
    });
    if (user && !user.passwordHash) throw await passwordNotSet(this.prisma, user.id);
    const passwordOk = await verifyPassword(user?.passwordHash, dto.password);
    const teamId = user?.memberships[0]?.teamId;
    const fail = async (reason: 'bad_password' | 'totp_required' | 'totp_invalid' | 'unknown_user' | 'locked', countIt: boolean) => {
      // Unknown emails have no user or team; the row still records the attempt and the address (the email is hashed).
      await this.events.emit('user.signin_failed', { method: 'password', reason, ...(user ? { userId: user.id } : { emailHash: emailHash(dto.email) }) }, {
        teamId, actor: user ? userActor(user.id, { ...meta, teamId }) : undefined, ip: meta.ip, resource: user ? `user:${user.id}` : undefined,
      });
      if (user && countIt) await this.security.recordSigninFailure(user.id, { ...meta, teamId });
    };
    if (!user) {
      await fail('unknown_user', false);
      throw ApiError.unauthorized('Wrong email or password');
    }
    // A locked account answers like a wrong password, and attempts during the lockout do not extend it.
    if (this.security.isLocked(user)) {
      await fail('locked', false);
      throw ApiError.unauthorized('Wrong email or password');
    }
    if (!passwordOk) {
      await fail('bad_password', true);
      throw ApiError.unauthorized('Wrong email or password');
    }
    // External engineers sign in to the ops console only (POST /ops/v1/auth/login).
    if (user.engineerProfile?.kind === 'EXTERNAL') throw new ApiError(403, 'ops_console_only', 'This account signs in to the ops console only');
    if (user.totpEnabled) {
      // Not a failed attempt: the console first posts without a code to learn that one is needed.
      if (!dto.totp) {
        await fail('totp_required', false);
        throw new ApiError(401, 'totp_required', 'Enter the code from your authenticator app');
      }
      if (!(await this.security.checkSecondFactor(user, dto.totp))) {
        await fail('totp_invalid', true);
        throw new ApiError(401, 'totp_invalid', 'That code is not valid');
      }
    }
    const membership = user.memberships[0];
    if (!membership) throw ApiError.forbidden('User belongs to no team');
    await this.security.clearSigninFailures(user);
    const session = await this.tokens.issueSession(user.id, membership.teamId, meta);
    await this.events.emit('user.signed_in', { method: user.totpEnabled ? 'password+totp' : 'password', userId: user.id }, { teamId: membership.teamId, actor: userActor(user.id, { ...meta, teamId: membership.teamId }), resource: `user:${user.id}` });
    return {
      user: publicUser(user),
      team: membership.team,
      teams: user.memberships.map((m) => ({ id: m.team.id, slug: m.team.slug, name: m.team.name, role: m.role })),
      session,
    };
  }

  async me(actor: Actor) {
    const [user, team] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } }),
      this.prisma.team.findUniqueOrThrow({ where: { id: actor.teamId }, include: { projects: true } }),
    ]);
    const legal = { ...this.legal.summary(team.billingEntity), accepted: user.legalVersion, acceptedAt: user.legalAcceptedAt, required: user.legalVersion !== LEGAL_VERSION };
    return { user: publicUser(user), team, role: actor.role, scopes: [...actor.scopes], isAgent: actor.isAgent, isStaff: user.isStaff, staffRoles: user.isStaff ? user.staffRoles : [], legal };
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
    let expiresAt = dto.expiresInDays ? new Date(Date.now() + dto.expiresInDays * 86_400_000) : undefined;
    // Back office tokens: only full staff with two factor sign in, made from a console session, for at most a day.
    if (dto.scopes.includes('admin')) {
      const u = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { isStaff: true, staffRoles: true, totpEnabled: true } });
      if (actor.tokenId || !isFullStaff(u) || !u.totpEnabled) throw ApiError.forbidden('Tokens with the admin scope need full staff with two factor sign in, from a console session');
      if (dto.expiresInDays && dto.expiresInDays > 1) throw ApiError.invalid('Tokens with the admin scope expire within one day (expiresInDays: 1)');
      expiresAt = new Date(Date.now() + ADMIN_TOKEN_MAX_MS);
    }
    const issued = await this.tokens.issueApiToken({
      teamId: actor.teamId,
      userId: actor.userId,
      projectId: dto.projectId,
      name: dto.name,
      scopes: dto.scopes,
      isAgent: dto.isAgent,
      spendCapMinor: dto.spendCapMinor,
      requireApprovalFor: dto.requireApprovalFor,
      expiresAt,
    });
    await this.events.emit('token.created', { tokenId: issued.id, isAgent: !!dto.isAgent, scopes: dto.scopes, expiresAt: expiresAt?.toISOString() ?? null }, { teamId: actor.teamId, actor });
    return issued;
  }

  async revokeToken(actor: Actor, id: string) {
    await this.tokens.revoke(actor.teamId, id);
    await this.events.emit('token.revoked', { tokenId: id }, { teamId: actor.teamId, actor });
  }

  // ---- SSH keys ----

  /**
   * SSH keys belong to a user, not a team. Everyone sees and manages their own keys; owners and
   * admins also see (and may remove) the keys of the team's members.
   */
  private sshKeyScope(actor: Actor) {
    return ['owner', 'admin'].includes(actor.role) ? { user: { memberships: { some: { teamId: actor.teamId } } } } : { userId: actor.userId };
  }

  listSshKeys(actor: Actor) {
    return this.prisma.sshKey.findMany({ where: this.sshKeyScope(actor), orderBy: { createdAt: 'desc' } });
  }

  async createSshKey(actor: Actor, dto: CreateSshKeyDto) {
    if (actor.isAgent) throw ApiError.forbidden('Agent tokens cannot add SSH keys');
    const fingerprint = fingerprintOf(dto.publicKey);
    const dup = await this.prisma.sshKey.findUnique({ where: { fingerprint } });
    if (dup) throw ApiError.conflict('ssh_key_exists', 'This SSH key is already registered');
    return this.prisma.sshKey.create({ data: { userId: actor.userId, name: dto.name, publicKey: dto.publicKey.trim(), fingerprint } });
  }

  async deleteSshKey(actor: Actor, id: string) {
    if (actor.isAgent) throw ApiError.forbidden('Agent tokens cannot delete SSH keys');
    const key = await this.prisma.sshKey.findFirst({ where: { id, ...this.sshKeyScope(actor) } });
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

/** Audit rows for unknown emails carry a hash, not the address someone typed (which may be a password). */
function emailHash(email: string) {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
}

/** SHA256 fingerprint in OpenSSH format. */
function fingerprintOf(publicKey: string) {
  const b64 = publicKey.trim().split(/\s+/)[1];
  return 'SHA256:' + createHash('sha256').update(Buffer.from(b64, 'base64')).digest('base64').replace(/=+$/, '');
}
