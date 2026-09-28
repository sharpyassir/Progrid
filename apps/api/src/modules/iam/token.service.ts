import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Actor, scopesForRole, staffScopes } from '../../common/auth/actor';
import { loadConfig } from '../../config/config';

const TOKEN_PREFIX = 'prgd_';
export const OPS_AUDIENCE = 'ops';
const OPS_CHALLENGE_AUDIENCE = 'ops-signin';

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

  /** Issues a console session backed by a Session row, so it can be listed and revoked. */
  async issueSession(userId: string, teamId: string, meta: { ip?: string; userAgent?: string } = {}): Promise<string> {
    const { SESSION_TTL_SECONDS } = loadConfig();
    const row = await this.prisma.session.create({
      data: { userId, teamId, ip: meta.ip?.slice(0, 64), userAgent: meta.userAgent?.slice(0, 300), expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000) },
    });
    return new SignJWT({ tid: teamId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setJti(row.id)
      .setIssuedAt()
      .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
      .sign(this.jwtKey);
  }

  async listSessions(userId: string, currentId?: string) {
    const rows = await this.prisma.session.findMany({ where: { userId, audience: 'console', revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: 'desc' } });
    return { data: rows.map((r) => ({ id: r.id, createdAt: r.createdAt, lastSeenAt: r.lastSeenAt, expiresAt: r.expiresAt, ip: r.ip, userAgent: r.userAgent, current: r.id === currentId })) };
  }

  async revokeSession(userId: string, id: string) {
    await this.prisma.session.updateMany({ where: { id, userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** Ends every session of a user, optionally keeping one (the caller's own). */
  async revokeAllSessions(userId: string, exceptId?: string) {
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) }, data: { revokedAt: new Date() } });
  }

  // ---- Ops console sessions (apps/ops, /ops/v1 only) ----

  /**
   * Issues an ops console session after password and second factor. The JWT carries the `ops`
   * audience and the row has audience `ops`, so it never works outside /ops/v1 and a console
   * session never works on /ops/v1.
   */
  async issueOpsSession(userId: string, meta: { ip?: string; userAgent?: string; secondFactor: 'totp' | 'webauthn'; ttlSeconds: number }) {
    const expiresAt = new Date(Date.now() + meta.ttlSeconds * 1000);
    const row = await this.prisma.session.create({
      data: { userId, teamId: null, audience: 'ops', secondFactor: meta.secondFactor, ip: meta.ip?.slice(0, 64), userAgent: meta.userAgent?.slice(0, 300), expiresAt },
    });
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setAudience(OPS_AUDIENCE)
      .setJti(row.id)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.jwtKey);
    return { token, sessionId: row.id, expiresAt };
  }

  /** The ops session behind a token, or null. API tokens and console sessions are refused. */
  async resolveOpsSession(jwt: string): Promise<{ userId: string; sessionId: string; expiresAt: Date } | null> {
    if (jwt.startsWith(TOKEN_PREFIX)) return null;
    let sub: string | undefined;
    let jti: string | undefined;
    try {
      const { payload } = await jwtVerify(jwt, this.jwtKey, { audience: OPS_AUDIENCE });
      sub = payload.sub;
      jti = payload.jti;
    } catch {
      return null;
    }
    if (!sub || !jti) return null;
    const session = await this.prisma.session.findUnique({ where: { id: jti } });
    if (!session || session.audience !== 'ops' || session.revokedAt || session.expiresAt < new Date() || session.userId !== sub) return null;
    if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
      void this.prisma.session.update({ where: { id: jti }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
    }
    return { userId: sub, sessionId: jti, expiresAt: session.expiresAt };
  }

  /** Short lived token for the steps between password and second factor at ops sign in. */
  async issueOpsChallenge(userId: string, ttlSeconds = 300) {
    const jti = randomBytes(16).toString('hex');
    const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setAudience(OPS_CHALLENGE_AUDIENCE).setJti(jti).setIssuedAt().setExpirationTime(`${ttlSeconds}s`).sign(this.jwtKey);
    return { token, jti, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
  }

  async verifyOpsChallenge(token: string): Promise<{ userId: string; jti: string } | null> {
    try {
      const { payload } = await jwtVerify(token, this.jwtKey, { audience: OPS_CHALLENGE_AUDIENCE });
      return payload.sub && payload.jti ? { userId: payload.sub, jti: payload.jti } : null;
    } catch {
      return null;
    }
  }

  // ---- Resolution ----

  async resolveBearer(credential: string): Promise<Actor | null> {
    return credential.startsWith(TOKEN_PREFIX) ? this.resolveApiToken(credential) : this.resolveSession(credential);
  }

  private async resolveApiToken(raw: string): Promise<Actor | null> {
    const token = await this.prisma.apiToken.findUnique({
      where: { hash: hash(raw) },
      include: { user: { select: { locale: true, isStaff: true, staffRoles: true } }, team: { select: { status: true, members: true } } },
    });
    if (!token || token.revokedAt) return null;
    if (token.expiresAt && token.expiresAt < new Date()) return null;
    if (token.team.status === 'closed') return null;
    const membership = token.team.members.find((m) => m.userId === token.userId);
    if (!membership) return null;

    void this.prisma.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);

    // A token can never exceed what its owner is allowed to do; `admin` needs a staff user.
    const roleScopes = scopesForRole(membership.role);
    for (const sc of staffScopes(token.user)) roleScopes.add(sc);
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
    let jti: string | undefined;
    try {
      const { payload } = await jwtVerify(jwt, this.jwtKey);
      // Ops console and sign in challenge tokens carry an audience; console sessions never do.
      if (payload.aud !== undefined) return null;
      sub = payload.sub;
      tid = payload.tid as string;
      jti = payload.jti;
    } catch {
      return null;
    }
    if (!sub || !tid || !jti) return null;
    // The row is the source of truth: a revoked or expired row ends the session even if the JWT is valid.
    const session = await this.prisma.session.findUnique({ where: { id: jti } });
    if (!session || session.audience !== 'console' || session.revokedAt || session.expiresAt < new Date() || session.userId !== sub) return null;
    if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
      void this.prisma.session.update({ where: { id: jti }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
    }
    const membership = await this.prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: tid, userId: sub } },
      include: { user: { select: { locale: true, isStaff: true, staffRoles: true } }, team: { select: { status: true } } },
    });
    if (!membership || membership.team.status === 'closed') return null;
    const scopes = scopesForRole(membership.role);
    for (const sc of staffScopes(membership.user)) scopes.add(sc); // back office pages in the console
    return {
      userId: sub,
      teamId: tid,
      role: membership.role,
      scopes,
      sessionId: jti,
      isAgent: false,
      requireApprovalFor: new Set(),
      locale: membership.user.locale,
      teamStatus: membership.team.status,
      audience: 'console',
    };
  }
}

function hash(raw: string) {
  return createHash('sha256').update(raw).digest('hex');
}
