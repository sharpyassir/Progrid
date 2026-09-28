import { open, seal } from '../../common/crypto/secretbox';
import { Injectable, Logger } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailService } from '../../common/mail/mail.service';
import { ApiError } from '../../common/errors/api-error';
import { EventsService } from '../events/events.service';
import { loadConfig } from '../../config/config';
import { generateRecoveryCodes, generateSecret, otpauthUrl, verifyTotp } from '../../common/auth/totp';
import type { Actor } from '../../common/auth/actor';
import { dropUnprovenIdentities } from '../oauth/unproven-identities';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

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
    const url = `${loadConfig().CONSOLE_URL}/verify?token=${token}`;
    await this.mail.send({
      to: user.email,
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
    const url = `${loadConfig().CONSOLE_URL}/reset-password?token=${token}`;
    await this.mail.send({
      to: user.email,
      subject: 'Reset your prgd password',
      text: `Hi ${user.name},\n\nSomeone asked to reset the password for this account. If that was you, choose a new password here:\n${url}\n\nThe link is valid for one hour. If you did not ask for this, you can ignore it; your password has not changed.`,
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
    if (!this.checkSecondFactor(user, code)) throw new ApiError(401, 'totp_invalid', 'That code is not valid.');
    await this.prisma.user.update({ where: { id: user.id }, data: { totpEnabled: false, totpSecret: null, totpRecoveryHashes: [] } });
    await this.events.emit('user.totp_disabled', { userId: user.id }, { actor });
    return { enabled: false };
  }

  /** TOTP code or an unused recovery code. Recovery codes burn on use. */
  checkSecondFactor(user: { id: string; totpSecret: string | null; totpRecoveryHashes: string[] }, code: string): boolean {
    if (user.totpSecret && verifyTotp(open(user.totpSecret), code)) return true;
    const h = hash(code.trim().toLowerCase());
    if (user.totpRecoveryHashes.includes(h)) {
      void this.prisma.user.update({ where: { id: user.id }, data: { totpRecoveryHashes: user.totpRecoveryHashes.filter((x) => x !== h) } }).catch(() => undefined);
      this.log.warn(`recovery code used by user ${user.id}`);
      return true;
    }
    return false;
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
