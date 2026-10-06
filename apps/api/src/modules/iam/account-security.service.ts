import { open, seal } from '../../common/crypto/secretbox';
import { Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailService } from '../../common/mail/mail.service';
import { ApiError } from '../../common/errors/api-error';
import { EventsService } from '../events/events.service';
import { loadConfig } from '../../config/config';
import { returnConsoleUrl } from '../../common/entities/entities';
import { userEntity } from '../../common/entities/lookup';
import { generateRecoveryCodes, generateSecret, otpauthUrl, totpStep, verifyTotp } from '../../common/auth/totp';
import type { Actor } from '../../common/auth/actor';
import { dropUnprovenIdentities } from '../oauth/unproven-identities';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

/** Consecutive failed sign in attempts (password or second factor) that lock an account. */
export const MAX_SIGNIN_FAILURES = 5;
/** First lockout; each further one (without a success in between) doubles, up to a day. */
const LOCKOUT_MINUTES = 15;
const MAX_LOCKOUT_MINUTES = 24 * 60;

/** Email verification, password reset and two factor sign in. */
@Injectable()
export class AccountSecurityService {
  private readonly log = new Logger(AccountSecurityService.name);

  constructor(private readonly prisma: PrismaService, private readonly mail: MailService, private readonly events: EventsService) {}

  // ---- email verification ----

  async sendVerification(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerified) return;
    const token = await this.issueToken(userId, 'verify', 24 * 3600);
    // The console the person signed up on, else their company's console; sent by that company.
    const entity = await userEntity(this.prisma, userId);
    const url = `${returnConsoleUrl(entity)}/verify?token=${token}`;
    await this.mail.send({
      to: user.email,
      entity,
      subject: 'Confirm your email for prgd',
      text: `Hi ${user.name},\n\nConfirm your email address to start creating servers:\n${url}\n\nThe link is valid for 24 hours. If you did not create a prgd account, ignore this message.`,
    });
  }

  async verifyEmail(token: string) {
    const row = await this.consumeToken(token, 'verify');
    await this.prisma.user.update({ where: { id: row.userId }, data: { emailVerified: new Date() } });
    // Verified email lifts a fresh team out of pending_verification (phone or ID raise kycLevel later).
    const memberships = await this.prisma.teamMember.findMany({ where: { userId: row.userId, role: 'owner' } });
    await this.prisma.team.updateMany({ where: { id: { in: memberships.map((m) => m.teamId) }, status: 'pending_verification' }, data: { status: 'active' } });
    await this.events.emit('user.email_verified', { userId: row.userId });
    return { verified: true };
  }

  // ---- password reset ----

  /** Always succeeds from the caller's view so email addresses cannot be probed. */
  async forgotPassword(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return;
    const token = await this.issueToken(user.id, 'reset', 3600);
    const entity = await userEntity(this.prisma, user.id);
    const url = `${returnConsoleUrl(entity)}/reset-password?token=${token}`;
    await this.mail.send({
      to: user.email,
      entity,
      subject: 'Reset your prgd password',
      text: `Hi ${user.name},\n\nSomeone asked to reset the password for this account. If that was you, choose a new password here:\n${url}\n\nThe link is valid for one hour. If you did not ask for this, you can ignore it; your password has not changed.`,
    });
  }

  /**
   * Ops console password link: a welcome mail for a new engineer account (valid seven days)
   * or a reset (one hour). The link opens the ops console, which calls
   * POST /ops/v1/auth/password/reset with the token.
   */
  async sendOpsPasswordLink(userId: string, kind: 'welcome' | 'reset') {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const token = await this.issueToken(userId, 'reset', kind === 'welcome' ? 7 * 86_400 : 3600);
    const url = `${loadConfig().PRGD_OPS_URL}/set-password?token=${token}`;
    await this.mail.send({
      to: user.email,
      subject: kind === 'welcome' ? 'Your Progrid ops console account' : 'Reset your Progrid ops console password',
      text: kind === 'welcome'
        ? `Hi ${user.name},\n\nAn account was created for you on the Progrid ops console. Choose a password here, then set up two factor sign in:\n${url}\n\nThe link is valid for seven days.`
        : `Hi ${user.name},\n\nSomeone asked to reset your ops console password. If that was you, choose a new password here:\n${url}\n\nThe link is valid for one hour. If you did not ask for this, tell your support lead.`,
    });
  }

  async resetPassword(token: string, password: string) {
    const row = await this.consumeToken(token, 'reset');
    await dropUnprovenIdentities(this.prisma, row.userId); // the reset link proved the mailbox
    await this.prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await argon2.hash(password) } });
    // Every other reset link for this user is now useless.
    await this.prisma.emailToken.updateMany({ where: { userId: row.userId, kind: 'reset', usedAt: null }, data: { usedAt: new Date() } });
    // A reset usually means the password leaked: sign the user out everywhere.
    await this.prisma.session.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.events.emit('user.password_reset', { userId: row.userId });
    return { reset: true };
  }

  // ---- two factor (TOTP) ----

  /** Step 1: generate a secret. It is stored as pending until `enable` confirms a code. */
  async totpSetup(actor: Actor) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (user.totpEnabled) throw ApiError.conflict('totp_enabled', 'Two factor sign in is already enabled. Disable it first to set up a new device.');
    const secret = generateSecret();
    await this.prisma.user.update({ where: { id: user.id }, data: { totpSecret: seal(secret) } });
    return { secret, otpauthUrl: otpauthUrl(secret, user.email) };
  }

  /** Step 2: prove the device works; returns recovery codes exactly once. */
  async totpEnable(actor: Actor, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (!user.totpSecret) throw ApiError.invalid('Run setup first');
    if (!verifyTotp(open(user.totpSecret), code)) throw new ApiError(401, 'totp_invalid', 'That code is not valid. Check the time on your device and try again.');
    const codes = generateRecoveryCodes();
    await this.prisma.user.update({ where: { id: user.id }, data: { totpEnabled: true, totpRecoveryHashes: codes.map(hash) } });
    await this.events.emit('user.totp_enabled', { userId: user.id }, { actor });
    return { enabled: true, recoveryCodes: codes };
  }

  async totpDisable(actor: Actor, code: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (!user.totpEnabled || !user.totpSecret) return { enabled: false };
    if (!(await this.checkSecondFactor(user, code))) throw new ApiError(401, 'totp_invalid', 'That code is not valid.');
    await this.prisma.user.update({ where: { id: user.id }, data: { totpEnabled: false, totpSecret: null, totpRecoveryHashes: [] } });
    await this.events.emit('user.totp_disabled', { userId: user.id }, { actor });
    return { enabled: false };
  }

  /**
   * TOTP code or an unused recovery code. A TOTP code is accepted once: its time step must be
   * after the last accepted one (RFC 6238 section 5.2), checked and stored in one conditional
   * update so two parallel requests cannot both use it. A recovery code burns the same way.
   */
  async checkSecondFactor(user: { id: string; totpSecret: string | null; totpRecoveryHashes: string[] }, code: string): Promise<boolean> {
    const step = user.totpSecret ? totpStep(open(user.totpSecret), code) : null;
    if (step !== null) {
      const { count } = await this.prisma.user.updateMany({ where: { id: user.id, OR: [{ lastTotpStep: null }, { lastTotpStep: { lt: step } }] }, data: { lastTotpStep: step } });
      if (!count) this.log.warn(`replayed TOTP code refused for user ${user.id}`);
      return count === 1;
    }
    const h = hash(code.trim().toLowerCase());
    if (!user.totpRecoveryHashes.includes(h)) return false;
    const burned = await this.prisma.$executeRaw`UPDATE "prgd_users" SET "totpRecoveryHashes" = array_remove("totpRecoveryHashes", ${h}) WHERE "id" = ${user.id} AND ${h} = ANY("totpRecoveryHashes")`;
    if (burned !== 1) return false;
    this.log.warn(`recovery code used by user ${user.id}`);
    return true;
  }

  // ---- sign in lockout ----

  isLocked(user: { lockedUntil: Date | null }) {
    return !!user.lockedUntil && user.lockedUntil > new Date();
  }

  /**
   * Counts a failed password or second factor. The fifth in a row locks the account for 15
   * minutes, doubling per repeated lockout up to 24 hours, and mails the owner. Returns true
   * when this failure locked the account.
   */
  async recordSigninFailure(userId: string, meta: { ip?: string; userAgent?: string; teamId?: string } = {}): Promise<boolean> {
    const row = await this.prisma.user.update({ where: { id: userId }, data: { failedLoginCount: { increment: 1 } }, select: { failedLoginCount: true, lockoutCount: true, email: true, name: true } });
    if (row.failedLoginCount < MAX_SIGNIN_FAILURES) return false;
    const minutes = Math.min(LOCKOUT_MINUTES * 2 ** row.lockoutCount, MAX_LOCKOUT_MINUTES);
    const lockedUntil = new Date(Date.now() + minutes * 60_000);
    // Only the request that crosses the threshold locks and mails, even when several fail at once.
    const { count } = await this.prisma.user.updateMany({ where: { id: userId, failedLoginCount: { gte: MAX_SIGNIN_FAILURES } }, data: { failedLoginCount: 0, lockoutCount: { increment: 1 }, lockedUntil } });
    if (!count) return false;
    await this.events.emit('user.locked', { userId, minutes, lockedUntil: lockedUntil.toISOString() }, { teamId: meta.teamId, actor: userActor(userId, meta), resource: `user:${userId}` });
    const entity = await userEntity(this.prisma, userId).catch(() => undefined);
    this.mail.send({
      to: row.email,
      entity,
      subject: 'Sign in to your prgd account was paused',
      text: `Hi ${row.name},\n\nThere were ${MAX_SIGNIN_FAILURES} failed sign in attempts on your account in a row, so sign in is paused for ${minutes} minutes (last attempt from ${meta.ip || 'an unknown address'}).\n\nIf this was not you, someone may know or be guessing your password: reset it at ${returnConsoleUrl(entity)}/forgot-password and turn on two factor sign in.`,
    }).catch((e) => this.log.warn(`lockout mail for ${userId} failed: ${(e as Error).message}`));
    return true;
  }

  /** A successful sign in clears the failure count and the lockout history. */
  async clearSigninFailures(user: { id: string; failedLoginCount: number; lockoutCount: number; lockedUntil: Date | null }) {
    if (!user.failedLoginCount && !user.lockoutCount && !user.lockedUntil) return;
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockoutCount: 0, lockedUntil: null } });
  }

  // ---- helpers ----

  private async issueToken(userId: string, kind: 'verify' | 'reset', ttlSec: number) {
    const raw = randomBytes(32).toString('base64url');
    await this.prisma.emailToken.create({ data: { userId, kind, tokenHash: hash(raw), expiresAt: new Date(Date.now() + ttlSec * 1000) } });
    return raw;
  }

  private async consumeToken(raw: string, kind: 'verify' | 'reset') {
    const row = await this.prisma.emailToken.findUnique({ where: { tokenHash: hash(raw) } });
    if (!row || row.kind !== kind || row.usedAt || row.expiresAt < new Date()) throw new ApiError(400, 'token_invalid', 'This link is invalid or has expired. Request a new one.');
    await this.prisma.emailToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    return row;
  }
}

/** Audit actor for sign in events, before a session exists. */
export function userActor(userId: string, meta: { ip?: string; userAgent?: string; teamId?: string } = {}): Actor {
  return { userId, teamId: meta.teamId ?? '', role: 'member', scopes: new Set(), isAgent: false, requireApprovalFor: new Set(), locale: 'en', ip: meta.ip, userAgent: meta.userAgent };
}
