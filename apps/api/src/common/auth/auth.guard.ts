import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { returnConsoleUrl } from '../entities/entities';
import { clientIpOf } from '../net/client-ip';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApiError } from '../errors/api-error';
import { TokenService } from '../../modules/iam/token.service';
import { PUBLIC_KEY, SCOPES_KEY, STAFF_AREA_KEY, type StaffArea } from './decorators';
import { hasStaffScope, type Actor } from './actor';
import { loadConfig } from '../../config/config';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Resolves `Authorization: Bearer …` into an Actor and enforces `@RequireScopes`.
 * Accepts API tokens (`prgd_…`) and console session JWTs everywhere except /ops/, and only
 * ops console sessions on /ops/ (see resolveOps). A token never crosses between the two.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly tokens: TokenService, private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request & { actor?: Actor }>();
    if (req.path.startsWith('/ops/')) return this.resolveOps(req);
    const header = req.headers.authorization ?? '';
    const [scheme, credential] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !credential) throw ApiError.unauthorized();

    const actor = await this.tokens.resolveBearer(credential);
    if (!actor) throw ApiError.unauthorized();
    Object.assign(actor, clientOf(req));
    req.actor = actor;

    // Owners must have two factor sign in when the policy is on. API tokens are exempt (they are scoped and revocable).
    if (loadConfig().REQUIRE_TOTP_FOR_OWNERS && !actor.tokenId && actor.role === 'owner' && !/^\/v1\/(auth\/totp|account)/.test(req.path)) {
      const u = await this.prisma.user.findUnique({ where: { id: actor.userId }, select: { totpEnabled: true } });
      if (!u?.totpEnabled) throw new ApiError(403, 'totp_setup_required', 'Team owners must enable two factor sign in. Go to Security to set it up.');
    }

    let required = this.reflector.getAllAndOverride<string[]>(SCOPES_KEY, [ctx.getHandler(), ctx.getClass()]) ?? [];
    const staffRoute = required.includes('admin');
    if (staffRoute) {
      // Full staff hold `admin`. Limited staff pass when the route is tagged with one of their areas.
      if (!actor.scopes.has('admin')) {
        const areas = this.reflector.getAllAndOverride<StaffArea[]>(STAFF_AREA_KEY, [ctx.getHandler(), ctx.getClass()]) ?? [];
        const allowed = areas.some((a) => (a === 'any' ? hasStaffScope(actor.scopes) : actor.scopes.has(`admin:${a}`)));
        if (!allowed) throw ApiError.forbidden(hasStaffScope(actor.scopes) ? 'Your staff role does not cover this part of the back office' : 'Token is missing required scope(s): admin');
      }
      required = required.filter((s) => s !== 'admin');
      if (loadConfig().REQUIRE_TOTP_FOR_STAFF) {
        const u = await this.prisma.user.findUnique({ where: { id: actor.userId }, select: { totpEnabled: true } });
        if (!u?.totpEnabled) throw new ApiError(403, 'totp_setup_required', 'Staff must enable two factor sign in before using the back office. Go to Security to set it up.');
      }
    }
    // Staff keep the back office even if their own team is suspended.
    const staffCall = req.path.startsWith('/admin/') && hasStaffScope(actor.scopes);
    if (actor.teamStatus === 'suspended' && !staffCall && !allowedWhileSuspended(req.method, req.path, required)) {
      throw new ApiError(403, 'account_suspended', `This account is suspended. Only billing is available: pay any overdue invoice at ${returnConsoleUrl()}/billing, or contact support.`);
    }
    const missing = required.filter((s) => !actor.scopes.has(s));
    if (missing.length) {
      throw ApiError.forbidden(`Token is missing required scope(s): ${missing.join(', ')}`);
    }
    return true;
  }

  /**
   * The ops console API (/ops/v1) takes only ops console sessions: a Bearer token, or on GET
   * requests (Server Sent Events and downloads, where the browser cannot set a header) the
   * HttpOnly `prgd_ops_session` cookie. The engineer context, IP allowlist, assignment and
   * residency checks run in the ops guards (modules/ops/guards).
   */
  private async resolveOps(req: Request & { actor?: Actor }): Promise<boolean> {
    const header = req.headers.authorization ?? '';
    const [scheme, bearer] = header.split(' ');
    let credential = scheme?.toLowerCase() === 'bearer' ? bearer : undefined;
    if (!credential && (req.method === 'GET' || req.method === 'HEAD')) credential = readCookie(req.headers.cookie, OPS_SESSION_COOKIE);
    if (!credential) throw ApiError.unauthorized();
    const session = await this.tokens.resolveOpsSession(credential);
    if (!session) throw ApiError.unauthorized('Sign in to the ops console again');
    req.actor = {
      userId: session.userId, teamId: '', role: 'member', scopes: new Set(), sessionId: session.sessionId, isAgent: false,
      requireApprovalFor: new Set(), locale: 'en', audience: 'ops', ...clientOf(req),
    };
    return true;
  }
}

export const OPS_SESSION_COOKIE = 'prgd_ops_session';

/** Client address (Caddy sets X-Forwarded-For) and user agent of a request. */
export function clientOf(req: Request) {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin.slice(0, 200) : undefined;
  return { ip: clientIpOf(req).slice(0, 64), userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300), origin };
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/**
 * What a suspended team can still do: read billing, pay (top up or pay an invoice), load its
 * own account so the console can show the billing page, and accept an invitation to another
 * team. Everything else is refused.
 */
export function allowedWhileSuspended(method: string, path: string, required: string[]): boolean {
  if (method === 'GET' && path === '/v1/account') return true;
  if (method === 'POST' && path === '/v1/invitations/accept') return true; // joining another team
  if (method === 'GET' && required.length > 0 && required.every((s) => s === 'billing:read')) return true;
  if (method === 'POST' && (path === '/v1/billing/topup' || /^\/v1\/billing\/invoices\/[^/]+\/pay$/.test(path))) return true;
  return false;
}
