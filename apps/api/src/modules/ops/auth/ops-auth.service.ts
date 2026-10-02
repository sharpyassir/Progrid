import { Injectable, Logger } from '@nestjs/common';
import { opsRelyingParty } from '../../../common/entities/entities';
import * as argon2 from 'argon2';
import { createHash } from 'node:crypto';
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type AuthenticatorTransportFuture, type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { ApiError } from '../../../common/errors/api-error';
import { open, seal } from '../../../common/crypto/secretbox';
import { generateRecoveryCodes, generateSecret, otpauthUrl, verifyTotp } from '../../../common/auth/totp';
import { loadConfig } from '../../../config/config';
import type { Actor } from '../../../common/auth/actor';
import { TokenService } from '../../iam/token.service';
import { AccountSecurityService } from '../../iam/account-security.service';
import { OnCallService } from '../../managed/oncall/oncall.service';
import { PagingService } from '../../managed/oncall/paging.service';
import { ManagedNotify } from '../../managed/managed-notify.service';
import { OpsAudit } from '../ops-audit.service';
import { isInternalEngineerStaff } from '../guards/residency';
import { ipAllowed } from '../guards/ip-allowlist';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

export interface ClientMeta {
  ip: string;
  userAgent: string;
  /** Browser Origin; picks the ops console (ops.progrid.co or ops.progrid.sa) and its WebAuthn relying party. */
  origin?: string;
}

type SignInUser = {
  id: string; email: string; name: string; locale: string; passwordHash: string | null; isStaff: boolean; staffRoles: string[];
  totpEnabled: boolean; totpSecret: string | null; totpRecoveryHashes: string[];
  engineerProfile: { id: string; kind: string; status: string; country: string; timezone: string; ipAllowlist: string[] } | null;
  webAuthnCredentials: { id: string; credentialId: string; transports: string[] }[];
};

const userSelect = {
  id: true, email: true, name: true, locale: true, passwordHash: true, isStaff: true, staffRoles: true, totpEnabled: true, totpSecret: true, totpRecoveryHashes: true,
  engineerProfile: { select: { id: true, kind: true, status: true, country: true, timezone: true, ipAllowlist: true } },
  webAuthnCredentials: { select: { id: true, credentialId: true, transports: true } },
} as const;

/**
 * Ops console sign in (docs/devops-console.md, "Signing in"). A password alone never opens a
 * session: it returns a five minute challenge token, and the session comes from a TOTP code or
 * a WebAuthn assertion bound to that challenge. An engineer without a second factor must enroll
 * one (TOTP or WebAuthn) with the challenge before the first session. Sessions last
 * PRGD_OPS_SESSION_TTL_SECONDS (twelve hours) and work on /ops/v1 only. A sign in from a new
 * user agent and address pair emails and pages the support lead.
 */
@Injectable()
export class OpsAuthService {
  private readonly log = new Logger(OpsAuthService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tokens: TokenService,
    private readonly security: AccountSecurityService,
    private readonly oncall: OnCallService,
    private readonly paging: PagingService,
    private readonly notify: ManagedNotify,
    private readonly audit: OpsAudit,
  ) {}

  // ---- password step ----

  async login(email: string, password: string, meta: ClientMeta) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() }, select: userSelect });
    // The ops console always needs a password plus a second factor; social sign in is for the customer console only.
    if (!user || !user.passwordHash || !(await argon2.verify(user.passwordHash, password))) throw ApiError.unauthorized('Wrong email or password');
    this.assertEngineer(user, meta);
    const challenge = await this.tokens.issueOpsChallenge(user.id);
    const methods = [...(user.totpEnabled ? ['totp'] : []), ...(user.webAuthnCredentials.length ? ['webauthn'] : [])];
    await this.audit.emit('ops.signin_password_ok', signInActor(user.id, meta), { methods }, `user:${user.id}`);
    return { challenge: challenge.token, expiresAt: challenge.expiresAt, methods, enroll: methods.length === 0 };
  }

  // ---- TOTP ----

  async loginTotp(challenge: string, code: string, meta: ClientMeta) {
    const { user, jti } = await this.challengeUser(challenge, meta);
    if (!user.totpEnabled || !user.totpSecret) throw ApiError.invalid('TOTP is not set up for this account');
    if (!this.security.checkSecondFactor(user, code)) throw new ApiError(401, 'totp_invalid', 'That code is not valid');
    await this.consume(jti);
    return this.openSession(user, 'totp', meta);
  }

  /** Starts TOTP enrollment: with the sign in challenge (first sign in, no second factor yet) or from an ops session. */
  async totpSetup(who: { challenge?: string; userId?: string }, meta: ClientMeta) {
    const user = await this.enrollUser(who, meta);
    if (user.totpEnabled) throw ApiError.conflict('totp_enabled', 'Two factor sign in is already enabled');
    const secret = generateSecret();
    await this.prisma.user.update({ where: { id: user.id }, data: { totpSecret: seal(secret) } });
    return { secret, otpauthUrl: otpauthUrl(secret, user.name, 'Progrid Ops') };
  }

  /** Confirms TOTP enrollment. With a challenge it also opens the first session. */
  async totpEnable(who: { challenge?: string; userId?: string }, code: string, meta: ClientMeta) {
    const user = await this.enrollUser(who, meta);
    if (user.totpEnabled) throw ApiError.conflict('totp_enabled', 'Two factor sign in is already enabled');
    if (!user.totpSecret || !verifyTotp(open(user.totpSecret), code)) throw new ApiError(401, 'totp_invalid', 'That code is not valid. Check the time on your device and try again.');
    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true, totpRecoveryHashes: recoveryCodes.map(hash) } });
    await this.audit.emit('ops.totp_enabled', signInActor(user.id, meta), {}, `user:${user.id}`);
    if (!who.challenge) return { enabled: true, recoveryCodes };
    await this.consume((await this.tokens.verifyOpsChallenge(who.challenge))!.jti);
    return { enabled: true, recoveryCodes, ...(await this.openSession(user, 'totp', meta)) };
  }

  // ---- WebAuthn ----

  async webauthnRegisterOptions(who: { challenge?: string; userId?: string }, meta: ClientMeta) {
    const user = await this.enrollUser(who, meta);
    const c = loadConfig();
    const rp = opsRelyingParty(meta.origin);
    const options = await generateRegistrationOptions({
      rpName: c.PRGD_OPS_RP_NAME,
      rpID: rp.rpId,
      userName: user.name,
      userID: new TextEncoder().encode(user.id),
      userDisplayName: user.name,
      attestationType: 'none',
      excludeCredentials: user.webAuthnCredentials.map((w) => ({ id: w.credentialId, transports: w.transports as AuthenticatorTransportFuture[] })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    });
    await this.remember(`ops:webauthn:reg:${user.id}`, options.challenge);
    return options;
  }

  async webauthnRegisterVerify(who: { challenge?: string; userId?: string }, response: RegistrationResponseJSON, name: string, meta: ClientMeta) {
    const user = await this.enrollUser(who, meta);
    const expected = await this.recall(`ops:webauthn:reg:${user.id}`);
    if (!expected) throw ApiError.invalid('Registration expired; start again');
    const rp = opsRelyingParty(meta.origin);
    let result;
    try {
      result = await verifyRegistrationResponse({ response, expectedChallenge: expected, expectedOrigin: rp.origin, expectedRPID: rp.rpId, requireUserVerification: false });
    } catch (e) {
      throw new ApiError(401, 'webauthn_invalid', `The security key response was not accepted: ${(e as Error).message}`);
    }
    if (!result.verified) throw new ApiError(401, 'webauthn_invalid', 'The security key response was not accepted');
    const info = result.registrationInfo;
    const cred = await this.prisma.webAuthnCredential.create({
      data: { userId: user.id, credentialId: info.credential.id, publicKey: Buffer.from(info.credential.publicKey), counter: info.credential.counter, transports: info.credential.transports ?? [], deviceType: info.credentialDeviceType, backedUp: info.credentialBackedUp, name: name.slice(0, 80) },
    });
    await this.audit.emit('ops.webauthn_registered', signInActor(user.id, meta), { credentialId: cred.id }, `user:${user.id}`);
    const out = { credential: presentCredential(cred) };
    if (!who.challenge) return out;
    await this.consume((await this.tokens.verifyOpsChallenge(who.challenge))!.jti);
    return { ...out, ...(await this.openSession(user, 'webauthn', meta)) };
  }

  async webauthnAuthOptions(challenge: string, meta: ClientMeta) {
    const { user, jti } = await this.challengeUser(challenge, meta);
    if (!user.webAuthnCredentials.length) throw ApiError.invalid('No security key is registered for this account');
    const options = await generateAuthenticationOptions({
      rpID: opsRelyingParty(meta.origin).rpId,
      allowCredentials: user.webAuthnCredentials.map((w) => ({ id: w.credentialId, transports: w.transports as AuthenticatorTransportFuture[] })),
      userVerification: 'preferred',
    });
    await this.remember(`ops:webauthn:auth:${jti}`, options.challenge);
    return options;
  }

  async webauthnAuthVerify(challenge: string, response: AuthenticationResponseJSON, meta: ClientMeta) {
    const { user, jti } = await this.challengeUser(challenge, meta);
    const expected = await this.recall(`ops:webauthn:auth:${jti}`);
    if (!expected) throw ApiError.invalid('Sign in expired; start again');
    const cred = await this.prisma.webAuthnCredential.findUnique({ where: { credentialId: response.id } });
    if (!cred || cred.userId !== user.id) throw new ApiError(401, 'webauthn_invalid', 'Unknown security key');
    const rp = opsRelyingParty(meta.origin);
    let result;
    try {
      result = await verifyAuthenticationResponse({
        response, expectedChallenge: expected, expectedOrigin: rp.origin, expectedRPID: rp.rpId, requireUserVerification: false,
        credential: { id: cred.credentialId, publicKey: new Uint8Array(cred.publicKey), counter: cred.counter, transports: cred.transports as AuthenticatorTransportFuture[] },
      });
    } catch (e) {
      throw new ApiError(401, 'webauthn_invalid', `The security key response was not accepted: ${(e as Error).message}`);
    }
    if (!result.verified) throw new ApiError(401, 'webauthn_invalid', 'The security key response was not accepted');
    await this.prisma.webAuthnCredential.update({ where: { id: cred.id }, data: { counter: result.authenticationInfo.newCounter, lastUsedAt: new Date() } });
    await this.consume(jti);
    return this.openSession(user, 'webauthn', meta);
  }

  async credentials(userId: string) {
    const [user, creds] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { totpEnabled: true } }),
      this.prisma.webAuthnCredential.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
    ]);
    return { totp: user.totpEnabled, webauthn: creds.map(presentCredential) };
  }

  /** Removes a security key; the last second factor cannot be removed. */
  async removeCredential(userId: string, id: string, meta: ClientMeta) {
    const cred = await this.prisma.webAuthnCredential.findFirst({ where: { id, userId } });
    if (!cred) throw ApiError.notFound('credential', id);
    const [user, count] = await Promise.all([this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { totpEnabled: true } }), this.prisma.webAuthnCredential.count({ where: { userId } })]);
    if (!user.totpEnabled && count <= 1) throw ApiError.invalidState('This is your only second factor; add another before removing it');
    await this.prisma.webAuthnCredential.delete({ where: { id } });
    await this.audit.emit('ops.webauthn_removed', signInActor(userId, meta), { credentialId: id }, `user:${userId}`);
    return { deleted: true };
  }

  async logout(userId: string, sessionId: string) {
    await this.tokens.revokeSession(userId, sessionId);
  }

  /** Always succeeds from the caller's view; only engineers get the mail. */
  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() }, select: { id: true, isStaff: true, staffRoles: true, engineerProfile: { select: { status: true } } } });
    if (!user) return { sent: true };
    if (user.engineerProfile?.status === 'ACTIVE' || (!user.engineerProfile && isInternalEngineerStaff(user))) await this.security.sendOpsPasswordLink(user.id, 'reset');
    return { sent: true };
  }

  // ---- helpers ----

  private assertEngineer(user: SignInUser, meta: ClientMeta) {
    const p = user.engineerProfile;
    if (p && p.status !== 'ACTIVE') throw new ApiError(403, 'engineer_inactive', `Your engineer account is ${p.status.toLowerCase()}`);
    const external = p?.kind === 'EXTERNAL';
    if (!external && !isInternalEngineerStaff(user)) throw new ApiError(403, 'not_engineer', 'The ops console is for engineers');
    if (p?.ipAllowlist.length && !ipAllowed(meta.ip, p.ipAllowlist)) throw new ApiError(403, 'ip_not_allowed', 'The ops console is not allowed from this address');
  }

  private async challengeUser(challenge: string, meta: ClientMeta) {
    const claims = await this.tokens.verifyOpsChallenge(challenge);
    if (!claims) throw new ApiError(401, 'challenge_invalid', 'Sign in again: the sign in step expired');
    if (await this.used(claims.jti)) throw new ApiError(401, 'challenge_invalid', 'Sign in again: this sign in step was already used');
    const user = await this.prisma.user.findUnique({ where: { id: claims.userId }, select: userSelect });
    if (!user) throw ApiError.unauthorized();
    this.assertEngineer(user, meta);
    return { user, jti: claims.jti };
  }

  /** Enrollment runs from an ops session, or from a sign in challenge while the account has no second factor at all. */
  private async enrollUser(who: { challenge?: string; userId?: string }, meta: ClientMeta) {
    if (who.userId) {
      const user = await this.prisma.user.findUnique({ where: { id: who.userId }, select: userSelect });
      if (!user) throw ApiError.unauthorized();
      return user;
    }
    if (!who.challenge) throw ApiError.unauthorized();
    const { user } = await this.challengeUser(who.challenge, meta);
    if (user.totpEnabled || user.webAuthnCredentials.length) throw ApiError.forbidden('This account already has a second factor; sign in with it and add more from the ops console');
    return user;
  }

  private async openSession(user: SignInUser, secondFactor: 'totp' | 'webauthn', meta: ClientMeta) {
    const ttlSeconds = loadConfig().PRGD_OPS_SESSION_TTL_SECONDS;
    const known = await this.prisma.session.count({ where: { userId: user.id, audience: 'ops', ip: meta.ip.slice(0, 64), userAgent: meta.userAgent.slice(0, 300) } });
    const s = await this.tokens.issueOpsSession(user.id, { ip: meta.ip, userAgent: meta.userAgent, secondFactor, ttlSeconds });
    await this.audit.emit('ops.signed_in', signInActor(user.id, meta, s.sessionId), { secondFactor, newDevice: known === 0 }, `user:${user.id}`);
    if (known === 0) await this.newDeviceAlert(user, meta).catch((e) => this.log.warn(`new device alert for ${user.id} failed: ${(e as Error).message}`));
    const p = user.engineerProfile;
    return {
      session: s.token,
      expiresAt: s.expiresAt,
      user: { id: user.id, name: user.name, locale: user.locale },
      engineer: { kind: p?.kind ?? 'INTERNAL', country: p?.country ?? null, timezone: p?.timezone ?? 'Asia/Riyadh' },
    };
  }

  /** A sign in from a user agent and address pair this engineer never used: email and page the support lead. */
  private async newDeviceAlert(user: SignInUser, meta: ClientMeta) {
    const lead = await this.oncall.supportLead(user.id);
    const subject = `Ops console sign in from a new device: ${user.name}`;
    const message = `${user.name} signed in to the ops console from ${meta.ip || 'an unknown address'} (${meta.userAgent || 'unknown browser'}). If this is unexpected, suspend the engineer in the back office.`;
    if (!lead) return this.notify.toStaff({ subject, text: message });
    await this.notify.send({ to: lead.email, subject, text: message });
    await this.paging.page({ userId: lead.id, urgency: 'low', subject, message });
  }

  private async remember(key: string, value: string) {
    try {
      await this.redis.client.set(key, value, 'EX', 300);
    } catch {
      throw new ApiError(503, 'unavailable', 'Security key sign in is unavailable right now; use your authenticator app');
    }
  }

  private async recall(key: string) {
    try {
      const v = await this.redis.client.get(key);
      if (v) await this.redis.client.del(key);
      return v;
    } catch {
      return null;
    }
  }

  /** A challenge token opens at most one session. Without Redis the five minute expiry is the only limit. */
  private async consume(jti: string) {
    await this.redis.client.set(`ops:challenge-used:${jti}`, '1', 'EX', 600).catch(() => undefined);
  }

  private async used(jti: string) {
    return (await this.redis.client.exists(`ops:challenge-used:${jti}`).catch(() => 0)) === 1;
  }
}

/** Audit actor for the sign in steps, before an ops session exists. */
export function signInActor(userId: string, meta: ClientMeta, sessionId?: string): Actor {
  return { userId, teamId: '', role: 'member', scopes: new Set(), sessionId, isAgent: false, requireApprovalFor: new Set(), locale: 'en', audience: 'ops', ip: meta.ip, userAgent: meta.userAgent };
}

function presentCredential(c: { id: string; name: string; deviceType: string | null; backedUp: boolean; createdAt: Date; lastUsedAt: Date | null }) {
  return { id: c.id, name: c.name, deviceType: c.deviceType, backedUp: c.backedUp, createdAt: c.createdAt, lastUsedAt: c.lastUsedAt };
}
