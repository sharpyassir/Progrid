import { LegalService } from '../legal/legal.service';
import { LEGAL_VERSION } from '../legal/legal';
import { Injectable, Logger } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiError } from '../../common/errors/api-error';
import { loadConfig } from '../../config/config';
import type { Actor } from '../../common/auth/actor';
import { EventsService } from '../events/events.service';
import { IamService, publicUser } from '../iam/iam.service';
import { TokenService } from '../iam/token.service';
import { AccountSecurityService } from '../iam/account-security.service';
import { TeamService } from '../team/team.service';
import { OidcProviders } from './providers';
import { OAuthStore, randomToken, sha256, type Completion, type PendingLogin } from './oauth.store';
import { dropUnprovenIdentities } from './unproven-identities';
import { requestDomain, urlsFor } from '../../common/entities/entities';
import { currentRequest } from '../../common/entities/request-context';
import { isCountryCode } from '../../common/entities/countries';
import { suggestedCountry } from '../../common/geo/signup-country';
import { AttributionService } from '../affiliates/attribution.service';
import { decideLink, PROVIDERS, safeReturnPath, type Intent, type ProviderAccount, type ProviderId, type RefuseCode } from './linking';

export const BROWSER_COOKIE = 'prgd_oauth';
type Meta = { ip?: string; userAgent?: string };

const LABEL: Record<ProviderId, string> = { google: 'Google', microsoft: 'Microsoft' };

/** Social sign in: the authorization code flow with PKCE, state and nonce (docs/social-sign-in.md). */
@Injectable()
export class OAuthService {
  private readonly log = new Logger(OAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: OidcProviders,
    private readonly store: OAuthStore,
    private readonly iam: IamService,
    private readonly tokens: TokenService,
    private readonly security: AccountSecurityService,
    private readonly team: TeamService,
    private readonly events: EventsService,
    private readonly attribution: AttributionService,
    private readonly legal: LegalService,
  ) {}

  listProviders() {
    return { providers: this.providers.configured().map((id) => ({ id, name: LABEL[id] })) };
  }

  // ---- step 1: send the browser to the provider ----

  /**
   * Returns the provider URL to redirect to and the random value for the browser cookie. Any
   * error becomes a redirect back to the console with an error code (the browser navigated here).
   */
  async start(provider: string, q: { intent?: string; return?: string; invite?: string; ticket?: string; locale?: string; country?: string; promo?: string; legal?: string }) {
    // The API host the browser came to (api.progrid.co or api.progrid.sa) decides the callback and the console to return to.
    const domain = requestDomain();
    const s = this.providers.settings(provider);
    if (!s) return { error: this.consoleError('provider_unavailable', provider, undefined, undefined, domain) };
    const intent: Intent = q.intent === 'link' ? 'link' : q.intent === 'signup' ? 'signup' : 'login';
    const returnPath = safeReturnPath(q.return, intent === 'link' ? '/security' : '/servers');

    let linkUserId: string | undefined;
    if (intent === 'link') {
      const t = q.ticket ? await this.store.takeLinkTicket(q.ticket) : null;
      const session = t ? await this.prisma.session.findUnique({ where: { id: t.sessionId } }) : null;
      if (!t || !session || session.revokedAt || session.expiresAt < new Date() || session.userId !== t.userId) {
        return { error: this.consoleError('link_session_invalid', provider, 'link', returnPath, domain) };
      }
      linkUserId = t.userId;
    }

    const state = randomToken();
    const nonce = randomToken();
    const codeVerifier = randomToken(48);
    const browser = randomToken();
    const pending: PendingLogin = {
      provider: s.id,
      intent,
      nonce,
      codeVerifier,
      browserHash: sha256(browser),
      returnPath,
      invite: typeof q.invite === 'string' && q.invite.length <= 200 ? q.invite : undefined,
      locale: q.locale === 'en' || q.locale === 'tr' || q.locale === 'ar' ? q.locale : undefined,
      linkUserId,
      domain,
      country: isCountryCode(q.country?.toUpperCase()) ? q.country!.toUpperCase() : undefined,
      promoCode: typeof q.promo === 'string' && q.promo.length <= 40 ? q.promo : undefined,
      legalAccepted: q.legal === LEGAL_VERSION,
    };
    let url: string;
    try {
      url = await this.providers.authorizationUrl(s, { state, nonce, codeChallenge: createHash('sha256').update(codeVerifier).digest('base64url'), domain });
    } catch (err) {
      this.log.warn(`${provider} discovery failed: ${(err as Error).message}`);
      return { error: this.consoleError('provider_error', provider, intent, returnPath, domain) };
    }
    await this.store.putState(state, pending);
    return { url, browser };
  }

  // ---- step 2: the provider sends the browser back ----

  /** Returns the console URL to redirect to: a one time code on success, an error code otherwise. */
  async callback(provider: string, q: { code?: string; state?: string; error?: string }, browserCookie: string | undefined, meta: Meta): Promise<string> {
    const pending = typeof q.state === 'string' && q.state.length <= 100 ? await this.store.takeState(q.state) : null;
    if (!pending || pending.provider !== provider) return this.consoleError('state_invalid', provider, undefined, undefined, requestDomain());
    // The state must come back to the browser that started the sign in (login CSRF).
    if (!browserCookie || !safeEqual(sha256(browserCookie), pending.browserHash)) return this.consoleError('state_invalid', provider, pending.intent, pending.returnPath, pending.domain);
    const fail = (code: string) => this.consoleError(code, provider, pending.intent, pending.returnPath, pending.domain);
    if (q.error) return fail(q.error === 'access_denied' ? 'cancelled' : 'provider_error');
    const s = this.providers.settings(provider);
    if (!s || typeof q.code !== 'string' || !q.code) return fail('provider_error');

    let account: ProviderAccount;
    try {
      ({ account } = await this.providers.redeem(s, q.code, pending.codeVerifier, pending.nonce, pending.domain));
    } catch (err) {
      this.log.warn(`${provider} sign in refused: ${(err as Error).message}`);
      return fail('token_invalid');
    }

    const identity = await this.prisma.oAuthIdentity.findUnique({ where: { provider_subject: { provider: account.provider, subject: account.subject } } });
    const emailUser = account.email ? await this.prisma.user.findUnique({ where: { email: account.email }, select: { id: true } }) : null;
    const decision = decideLink({ intent: pending.intent, account, linkedUserId: identity?.userId ?? null, emailUserId: emailUser?.id ?? null, currentUserId: pending.linkUserId });

    switch (decision.action) {
      case 'refuse':
        await this.events.emit('user.oauth_refused', { provider, reason: decision.code, email: account.email, intent: pending.intent }, { resource: emailUser ? `user:${emailUser.id}` : undefined });
        return fail(decision.code);

      case 'link':
      case 'already_linked': {
        if (decision.action === 'link') await this.linkIdentity(decision.userId, account, false);
        return `${this.consoleUrl(pending.domain)}/auth/callback?linked=${provider}&return=${encodeURIComponent(pending.returnPath)}`;
      }

      case 'sign_in':
        return this.codeRedirect({ provider: account.provider, userId: decision.userId, identityId: identity!.id, returnPath: pending.returnPath, created: false, invite: pending.invite }, pending.domain);

      case 'link_and_sign_in':
        return this.codeRedirect({ provider: account.provider, userId: decision.userId, link: account, returnPath: pending.returnPath, created: false, invite: pending.invite }, pending.domain);

      case 'create': {
        try {
          const c = await this.createUser(account, pending, meta);
          return this.codeRedirect(c, pending.domain);
        } catch (err) {
          if (err instanceof ApiError) {
            const code = (err.getResponse() as { code?: string }).code;
            if (code === 'email_taken') return fail('account_exists');
            if (code === 'invite_email_mismatch') return fail('invite_email_mismatch');
            if (err.getStatus() === 404 || err.getStatus() === 410 || code === 'invalid_state') return fail('invite_invalid');
          }
          throw err;
        }
      }
    }
  }

  // ---- step 3: the console redeems the one time code ----

  async exchange(code: string, meta: Meta) {
    const c = await this.store.takeCode(code);
    if (!c) throw new ApiError(400, 'code_invalid', 'This sign in link has expired or was already used. Start again.');
    const user = await this.prisma.user.findUnique({ where: { id: c.userId } });
    if (!user) throw new ApiError(400, 'code_invalid', 'This sign in link has expired or was already used. Start again.');
    if (user.totpEnabled) return { totpRequired: true as const, ticket: await this.store.putTotpTicket(c) };
    // Staff always use a second factor for the back office; social sign in does not skip it.
    if (user.isStaff && loadConfig().REQUIRE_TOTP_FOR_STAFF) {
      throw new ApiError(403, 'totp_setup_required', 'Staff accounts need two factor sign in. Sign in with your password, set it up under Security, then use Google or Microsoft.');
    }
    return this.complete(c, meta);
  }

  async totp(ticket: string, code: string, meta: Meta) {
    const c = await this.store.getTotpTicket(ticket);
    if (!c) throw new ApiError(400, 'ticket_invalid', 'This sign in has expired. Start again.');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: c.userId } });
    if (!this.security.checkSecondFactor(user, code)) {
      await this.store.failTotpTicket(ticket, c);
      throw new ApiError(401, 'totp_invalid', 'That code is not valid');
    }
    const taken = await this.store.takeTotpTicket(ticket); // single use, also against two parallel codes
    if (!taken) throw new ApiError(400, 'ticket_invalid', 'This sign in has expired. Start again.');
    return this.complete(taken, meta);
  }

  private async complete(c: Completion, meta: Meta) {
    // External engineers sign in to the ops console only, with a password and a second factor.
    const profile = await this.prisma.engineerProfile.findUnique({ where: { userId: c.userId }, select: { kind: true } });
    if (profile?.kind === 'EXTERNAL') throw new ApiError(403, 'ops_console_only', 'This account signs in to the ops console only');
    if (c.link) {
      if (c.link.emailVerified) await this.proveEmail(c.userId, c.link.provider);
      await this.linkIdentity(c.userId, c.link, true);
    }
    else if (c.identityId) await this.prisma.oAuthIdentity.update({ where: { id: c.identityId }, data: { lastUsedAt: new Date() } }).catch(() => undefined);

    let session = c.session;
    let inviteError: string | undefined;
    if (!session && c.invite) {
      try {
        const r = await this.team.acceptForUser(c.userId, c.invite, meta);
        session = { token: r.session, teamId: r.team.id };
      } catch (err) {
        inviteError = err instanceof Error ? err.message : String(err);
      }
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: c.userId },
      include: { memberships: { include: { team: true }, orderBy: { teamId: 'asc' } } },
    });
    const membership = session ? user.memberships.find((m) => m.teamId === session!.teamId) : user.memberships[0];
    if (!membership) throw ApiError.forbidden('User belongs to no team');
    const token = session?.token ?? (await this.tokens.issueSession(user.id, membership.teamId, meta));
    await this.events.emit('user.signed_in', { userId: user.id, method: 'oauth', provider: c.provider, created: c.created }, { teamId: membership.teamId, resource: `user:${user.id}` });
    return {
      user: publicUser(user),
      team: membership.team,
      teams: user.memberships.map((m) => ({ id: m.team.id, slug: m.team.slug, name: m.team.name, role: m.role })),
      session: token,
      created: c.created,
      returnTo: session && c.invite ? '/team' : c.returnPath,
      ...(inviteError ? { inviteError } : {}),
    };
  }

  // ---- accounts ----

  /** (c) A new person: a user with a new team like signup, or a member of the team that invited them. */
  private async createUser(a: ProviderAccount, p: PendingLogin, meta: Meta): Promise<Completion> {
    const base = { provider: a.provider, returnPath: p.returnPath, created: true };
    if (p.invite) {
      // The emailed invitation link proves the address, the same as accepting with a new password.
      const invited = await this.team.invitationEmail(p.invite);
      if (invited !== a.email) throw new ApiError(403, 'invite_email_mismatch', `This invitation is for ${invited}.`);
      const user = await this.prisma.user.create({ data: { email: a.email!, name: a.name, passwordHash: null, emailVerified: new Date(), ...(p.locale ? { locale: p.locale } : {}) } });
      await this.linkIdentity(user.id, { ...a, emailVerified: true }, true);
      await this.events.emit('user.oauth_signup', { userId: user.id, provider: a.provider, invitation: true }, { resource: `user:${user.id}` });
      const r = await this.team.acceptForUser(user.id, p.invite, meta);
      if (p.legalAccepted) {
        const team = await this.prisma.team.findUniqueOrThrow({ where: { id: r.team.id }, select: { billingEntity: true } });
        await this.legal.accept(user.id, { method: 'oauth_signup', entity: team.billingEntity, ...meta });
      }
      return { ...base, userId: user.id, returnPath: '/team', session: { token: r.session, teamId: r.team.id } };
    }
    const teamName = a.name.length >= 2 ? a.name.slice(0, 60) : `${a.email!.split('@')[0]} team`.slice(0, 60);
    // The billing country from the signup form, else the default of the domain the sign in started on.
    const country = p.country ?? suggestedCountry(currentRequest()?.ip, p.domain).country;
    // A promo code that stopped being valid between the form and the provider does not stop the signup.
    const promoCode = p.promoCode && (await this.attribution.describe(p.promoCode)).valid ? p.promoCode : undefined;
    const { user, team } = await this.iam.createAccount({ email: a.email!, name: a.name, teamName, country, locale: p.locale, emailVerified: a.emailVerified, ip: meta.ip, userAgent: meta.userAgent, promoCode, legal: p.legalAccepted ? 'oauth_signup' : undefined, domain: p.domain });
    await this.linkIdentity(user.id, a, true);
    await this.events.emit('user.oauth_signup', { userId: user.id, provider: a.provider, emailVerified: a.emailVerified }, { teamId: team.id, resource: `user:${user.id}` });
    return { ...base, userId: user.id, returnPath: '/security?welcome=1' };
  }

  /**
   * The provider vouches for the address of an account whose email was never confirmed: drop
   * identities nobody vouched for (see dropUnprovenIdentities), then confirm the email the way the
   * verification link does, which also lifts the owner's teams out of pending_verification.
   */
  private async proveEmail(userId: string, provider: ProviderId) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { emailVerified: true } });
    if (user.emailVerified) return;
    const dropped = await dropUnprovenIdentities(this.prisma, userId);
    await this.prisma.user.update({ where: { id: userId }, data: { emailVerified: new Date() } });
    const owned = await this.prisma.teamMember.findMany({ where: { userId, role: 'owner' } });
    await this.prisma.team.updateMany({ where: { id: { in: owned.map((m) => m.teamId) }, status: 'pending_verification' }, data: { status: 'active' } });
    await this.events.emit('user.email_verified', { userId, via: provider, droppedIdentities: dropped }, { resource: `user:${userId}` });
  }

  private async linkIdentity(userId: string, a: ProviderAccount, automatic: boolean) {
    try {
      const row = await this.prisma.oAuthIdentity.create({
        data: { userId, provider: a.provider, subject: a.subject, email: a.email ?? '', emailVerified: a.emailVerified, tenantId: a.tenantId, lastUsedAt: new Date() },
      });
      await this.events.emit('user.identity_linked', { userId, identityId: row.id, provider: a.provider, email: a.email, automatic }, { resource: `user:${userId}` });
      return row;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const other = await this.prisma.oAuthIdentity.findUnique({ where: { provider_subject: { provider: a.provider, subject: a.subject } } });
        if (other?.userId === userId) return other;
        throw ApiError.conflict('identity_in_use', `This ${LABEL[a.provider]} account is already linked to another Progrid account.`);
      }
      throw err;
    }
  }

  // ---- linking from Security ----

  /** One time ticket that carries the console session through the browser redirect to /start. */
  async linkTicket(actor: Actor) {
    if (!actor.sessionId) throw ApiError.forbidden('Link sign in methods from the console, not with an API token');
    return { ticket: await this.store.putLinkTicket({ userId: actor.userId, sessionId: actor.sessionId }) };
  }

  async identities(actor: Actor) {
    const [rows, user] = await Promise.all([
      this.prisma.oAuthIdentity.findMany({ where: { userId: actor.userId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { passwordHash: true } }),
    ]);
    return {
      data: rows.map((r) => ({ id: r.id, provider: r.provider, email: r.email, emailVerified: r.emailVerified, tenantId: r.tenantId, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt })),
      hasPassword: !!user.passwordHash,
      available: this.providers.configured(),
    };
  }

  /** Unlinking must leave a way to sign in: a password or another linked account. */
  async unlink(actor: Actor, id: string) {
    const row = await this.prisma.oAuthIdentity.findFirst({ where: { id, userId: actor.userId } });
    if (!row) throw ApiError.notFound('identity', id);
    const [user, others] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { passwordHash: true } }),
      this.prisma.oAuthIdentity.count({ where: { userId: actor.userId, id: { not: id } } }),
    ]);
    if (!user.passwordHash && others === 0) {
      throw ApiError.conflict('last_sign_in_method', 'This is your only way to sign in. Set a password or link another account first.');
    }
    await this.prisma.oAuthIdentity.delete({ where: { id } });
    await this.events.emit('user.identity_unlinked', { userId: actor.userId, identityId: id, provider: row.provider, email: row.email }, { actor, resource: `user:${actor.userId}` });
  }

  // ---- helpers ----

  private async codeRedirect(c: Completion, domain?: string) {
    const code = await this.store.putCode(c);
    return `${this.consoleUrl(domain)}/auth/callback?code=${encodeURIComponent(code)}`;
  }

  private consoleError(code: string | RefuseCode, provider: string, intent?: Intent, returnPath?: string, domain?: string) {
    const q = new URLSearchParams({ error: code, provider: PROVIDERS.includes(provider as ProviderId) ? provider : '' });
    if (intent) q.set('intent', intent);
    if (intent === 'link' && returnPath) q.set('return', returnPath);
    return `${this.consoleUrl(domain)}/auth/callback?${q.toString()}`;
  }

  /** The console of the domain the sign in started on (the person's session must land in that origin). */
  private consoleUrl(domain?: string) {
    return urlsFor(domain).consoleUrl;
  }
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
