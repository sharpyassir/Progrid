import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiError } from '../../common/errors/api-error';
import type { Actor } from '../../common/auth/actor';
import { EventsService } from '../events/events.service';
import { AccountSecurityService } from '../iam/account-security.service';

/** Accounts without a password (Google or Microsoft only) confirm with a session this recent. */
export const RECENT_SIGN_IN_MS = 15 * 60_000;

export interface DeleteAccountInput {
  password?: string;
  totp?: string;
}

/**
 * Privacy and data lifecycle (ISO 27001 A.5.34, PDPL): deleting one's own account. The user row
 * stays (invoices, audit records and tickets refer to it) but everything that identifies the
 * person is removed: email, name, phone, second factor, sign in methods, SSH keys, sessions and
 * API tokens. Audit rows keep the opaque user id only.
 */
@Injectable()
export class PrivacyService {
  constructor(private readonly prisma: PrismaService, private readonly events: EventsService, private readonly security: AccountSecurityService) {}

  async deleteAccount(actor: Actor, input: DeleteAccountInput) {
    if (actor.isAgent || actor.tokenId || !actor.sessionId) throw ApiError.forbidden('Delete the account from a console session, not with an API token.');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
    if (user.isStaff) throw ApiError.conflict('staff_account', 'Staff accounts are removed by an administrator (offboarding).');

    // Reauthentication: the password, or for social sign in accounts a fresh session.
    if (user.passwordHash) {
      if (!input.password || !(await argon2.verify(user.passwordHash, input.password).catch(() => false))) throw new ApiError(401, 'password_invalid', 'Enter your current password to delete the account');
    } else {
      const session = await this.prisma.session.findUnique({ where: { id: actor.sessionId } });
      if (!session || Date.now() - session.createdAt.getTime() > RECENT_SIGN_IN_MS) throw new ApiError(401, 'reauthentication_required', 'Sign in again, then delete the account within 15 minutes');
    }
    if (user.totpEnabled) {
      if (!input.totp) throw new ApiError(401, 'totp_required', 'Enter the code from your authenticator app');
      if (!this.security.checkSecondFactor(user, input.totp)) throw new ApiError(401, 'totp_invalid', 'That code is not valid');
    }

    // A team must not be left without an owner while it still has people or resources.
    const memberships = await this.prisma.teamMember.findMany({ where: { userId: user.id }, include: { team: { select: { id: true, slug: true, status: true } } } });
    const closeTeams: string[] = [];
    for (const m of memberships) {
      if (m.role !== 'owner' || m.team.status === 'closed') continue;
      const otherOwners = await this.prisma.teamMember.count({ where: { teamId: m.teamId, role: 'owner', userId: { not: user.id } } });
      if (otherOwners) continue;
      const otherMembers = await this.prisma.teamMember.count({ where: { teamId: m.teamId, userId: { not: user.id } } });
      const resources = await this.activeResources(m.teamId);
      if (otherMembers || resources) {
        throw ApiError.conflict('sole_owner', `You are the only owner of team "${m.team.slug}"${resources ? ` and it still has ${resources} resources` : ''}. Make someone else an owner, or close the team first.`);
      }
      closeTeams.push(m.teamId);
    }

    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          email: `deleted+${user.id}@invalid`, name: '', passwordHash: null, totpSecret: null, totpEnabled: false, totpRecoveryHashes: [],
          phone: null, phoneVerified: null, pagingChannel: null, signupIp: null, emailVerified: null,
        },
      }),
      this.prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } }),
      this.prisma.apiToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } }),
      this.prisma.sshKey.deleteMany({ where: { userId: user.id } }),
      this.prisma.oAuthIdentity.deleteMany({ where: { userId: user.id } }),
      this.prisma.webAuthnCredential.deleteMany({ where: { userId: user.id } }),
      this.prisma.emailToken.deleteMany({ where: { userId: user.id } }),
      this.prisma.invitation.updateMany({ where: { email: user.email, acceptedAt: null, revokedAt: null }, data: { revokedAt: now } }),
      // Memberships of teams that go on without the person; empty teams they owned are closed and keep theirs.
      this.prisma.teamMember.deleteMany({ where: { userId: user.id, teamId: { notIn: closeTeams } } }),
      this.prisma.team.updateMany({ where: { id: { in: closeTeams } }, data: { status: 'closed', closedAt: now } }),
    ]);
    await this.events.emit('user.deleted', { userId: user.id, closedTeams: closeTeams }, { actor, resource: `user:${user.id}` });
    return { deleted: true, closedTeams: closeTeams };
  }

  /** Resources that still run (and bill) in a team's projects. */
  async activeResources(teamId: string) {
    const live = { project: { teamId }, deletedAt: null };
    const counts = await Promise.all([
      this.prisma.server.count({ where: { ...live, status: { notIn: ['deleting', 'deleted'] } } }),
      this.prisma.dbCluster.count({ where: live }),
      this.prisma.kubeCluster.count({ where: live }),
      this.prisma.platformApp.count({ where: live }),
      this.prisma.loadBalancer.count({ where: live }),
      this.prisma.volume.count({ where: live }),
      this.prisma.bucket.count({ where: live }),
      this.prisma.dnsZone.count({ where: live }),
    ]);
    return counts.reduce((a, b) => a + b, 0);
  }
}
