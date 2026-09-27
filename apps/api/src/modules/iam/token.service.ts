import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Actor, scopesForRole } from '../../common/auth/actor';
import { loadConfig } from '../../config/config';

const TOKEN_PREFIX = 'pgc_';

export interface IssuedToken {
  id: string;
  /** Shown exactly once. */
  token: string;
  prefix: string;
}

/** Issues and resolves API tokens (humans + agents) and console session JWTs. */
@Injectable()
export class TokenService {
  private readonly jwtKey = new TextEncoder().encode(loadConfig().JWT_SECRET);

  constructor(private readonly prisma: PrismaService) {}

  // ---- API tokens ----

  async issueApiToken(input: {
    teamId: string;
    userId: string;
    projectId?: string;
    name: string;
    scopes: string[];
    isAgent?: boolean;
    spendCapMinor?: number;
    requireApprovalFor?: string[];
    expiresAt?: Date;
  }): Promise<IssuedToken> {
    const raw = TOKEN_PREFIX + randomBytes(32).toString('base64url');
    const row = await this.prisma.apiToken.create({
      data: {
        teamId: input.teamId,
        userId: input.userId,
        projectId: input.projectId,
        name: input.name,
        prefix: raw.slice(0, 12),
        hash: hash(raw),
        scopes: input.scopes,
        isAgent: !!input.isAgent,
        spendCapMinor: input.spendCapMinor,
        requireApprovalFor: input.requireApprovalFor ?? [],
        expiresAt: input.expiresAt,
      },
    });
    return { id: row.id, token: raw, prefix: row.prefix };
  }

  async revoke(teamId: string, id: string) {
    await this.prisma.apiToken.updateMany({ where: { id, teamId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  // ---- Console sessions ----

  async issueSession(userId: string, teamId: string): Promise<string> {
    const { SESSION_TTL_SECONDS } = loadConfig();
    return new SignJWT({ tid: teamId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
      .sign(this.jwtKey);
  }

  // ---- Resolution ----

  async resolveBearer(credential: string): Promise<Actor | null> {
    return credential.startsWith(TOKEN_PREFIX) ? this.resolveApiToken(credential) : this.resolveSession(credential);
  }

  private async resolveApiToken(raw: string): Promise<Actor | null> {
    const token = await this.prisma.apiToken.findUnique({
      where: { hash: hash(raw) },
      include: { user: { select: { locale: true, isStaff: true } }, team: { select: { status: true, members: true } } },
    });
    if (!token || token.revokedAt) return null;
    if (token.expiresAt && token.expiresAt < new Date()) return null;
    if (token.team.status === 'closed') return null;
    const membership = token.team.members.find((m) => m.userId === token.userId);
    if (!membership) return null;

    void this.prisma.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);

    // A token can never exceed what its owner is allowed to do; `admin` needs a staff user.
    const roleScopes = scopesForRole(membership.role);
    if (token.user.isStaff) roleScopes.add('admin');
    return {
      userId: token.userId,
      teamId: token.teamId,
      role: membership.role,
      projectId: token.projectId ?? undefined,
      scopes: new Set(token.scopes.filter((s) => roleScopes.has(s))),
      tokenId: token.id,
      isAgent: token.isAgent,
      requireApprovalFor: new Set(token.requireApprovalFor),
      locale: token.user.locale,
      teamStatus: token.team.status,
    };
  }

  private async resolveSession(jwt: string): Promise<Actor | null> {
    let sub: string | undefined;
    let tid: string | undefined;
    try {
      const { payload } = await jwtVerify(jwt, this.jwtKey);
      sub = payload.sub;
      tid = payload.tid as string;
    } catch {
      return null;
    }
    if (!sub || !tid) return null;
    const membership = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: tid, userId: sub } },
      include: { user: { select: { locale: true, isStaff: true } }, team: { select: { status: true } } },
    });
    if (!membership || membership.team.status === 'closed') return null;
    const scopes = scopesForRole(membership.role);
    if (membership.user.isStaff) scopes.add('admin'); // back office pages in the console
    return {
      userId: sub,
      teamId: tid,
      role: membership.role,
      scopes,
      isAgent: false,
      requireApprovalFor: new Set(),
      locale: membership.user.locale,
      teamStatus: membership.team.status,
    };
  }
}

function hash(raw: string) {
  return createHash('sha256').update(raw).digest('hex');
}
