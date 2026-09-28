import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ApiError } from '../../../common/errors/api-error';
import { staffScopes } from '../../../common/auth/actor';
import { BODY_REFS, OPS_REFS_KEY, RESIDENCY_KEY, canSee, type OpsContext, type OpsRefKind, type OpsRequest } from './ops-context';
import { STAFF_DEFAULT_COUNTRY, isInternalEngineerStaff, isLeadStaff, residencyAllows } from './residency';
import { ipAllowed } from './ip-allowlist';

/** Resolves which contract an ops object belongs to (null when it does not exist). */
@Injectable()
export class OpsScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async contractOf(kind: OpsRefKind, id: string): Promise<string | null> {
    if (!id || typeof id !== 'string') return null;
    switch (kind) {
      case 'contract':
        return (await this.prisma.managedContract.findUnique({ where: { id }, select: { id: true } }))?.id ?? null;
      case 'asset':
        return (await this.prisma.managedAsset.findFirst({ where: { id, removedAt: null }, select: { contractId: true } }))?.contractId ?? null;
      case 'ticket':
        return (await this.prisma.ticket.findUnique({ where: { id }, select: { contractId: true } }))?.contractId ?? null;
      case 'alert':
        return (await this.prisma.alert.findUnique({ where: { id }, select: { contractId: true } }))?.contractId ?? null;
      case 'task':
        return (await this.prisma.maintenanceTask.findUnique({ where: { id }, select: { contractId: true } }))?.contractId ?? null;
      case 'run':
        return (await this.prisma.maintenanceRun.findUnique({ where: { id }, select: { task: { select: { contractId: true } } } }))?.task.contractId ?? null;
      case 'page': {
        const p = await this.prisma.page.findUnique({ where: { id }, select: { alert: { select: { contractId: true } }, ticket: { select: { contractId: true } } } });
        return p?.alert?.contractId ?? p?.ticket?.contractId ?? null;
      }
    }
  }

  /** Every (kind, id) the request names in its route parameters, body and query. */
  refs(req: OpsRequest, paramRefs: Record<string, OpsRefKind>): { kind: OpsRefKind; id: string; field: string }[] {
    const out: { kind: OpsRefKind; id: string; field: string }[] = [];
    for (const [param, kind] of Object.entries(paramRefs)) if (req.params?.[param]) out.push({ kind, id: req.params[param], field: param });
    for (const source of [req.body, req.query]) {
      if (!source || typeof source !== 'object') continue;
      for (const [field, kind] of Object.entries(BODY_REFS)) {
        const v = (source as Record<string, unknown>)[field];
        if (typeof v === 'string' && v) out.push({ kind, id: v, field });
      }
    }
    return out;
  }
}

/**
 * First guard on every /ops/v1 endpoint (except sign in). The caller must hold an ops session
 * (AuthGuard) and be an engineer: an ACTIVE engineer profile, or internal engineer staff
 * (engineer, support_lead or full staff) whose profile, if any, is ACTIVE. External engineers
 * are never staff. The per engineer IP allowlist is checked on every request.
 */
@Injectable()
export class EngineerGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<OpsRequest>();
    const actor = req.actor;
    if (!actor || actor.audience !== 'ops' || !actor.sessionId) throw ApiError.unauthorized('An ops console session is required');
    const user = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      select: { id: true, name: true, locale: true, isStaff: true, staffRoles: true, engineerProfile: { include: { assignments: { select: { contractId: true } } } } },
    });
    if (!user) throw ApiError.unauthorized();
    const profile = user.engineerProfile;
    if (profile && profile.status !== 'ACTIVE') throw new ApiError(403, 'engineer_inactive', `Your engineer account is ${profile.status.toLowerCase()}`);
    const external = profile?.kind === 'EXTERNAL';
    const internal = !external && isInternalEngineerStaff(user);
    if (!external && !internal) throw new ApiError(403, 'not_engineer', 'The ops console is for engineers');
    if (profile && profile.ipAllowlist.length && !ipAllowed(actor.ip ?? '', profile.ipAllowlist)) {
      throw new ApiError(403, 'ip_not_allowed', 'The ops console is not allowed from this address');
    }
    actor.scopes = new Set(external ? [] : staffScopes(user));
    actor.locale = user.locale;
    const { assignments, ...profileRow } = profile ?? { assignments: [] };
    req.ops = {
      userId: user.id,
      name: user.name,
      locale: user.locale,
      profile: profile ? (profileRow as OpsContext['profile']) : null,
      kind: external ? 'EXTERNAL' : 'INTERNAL',
      external,
      lead: !external && isLeadStaff(user),
      country: profile?.country ?? STAFF_DEFAULT_COUNTRY,
      timezone: profile?.timezone ?? 'Asia/Riyadh',
      contractIds: external ? assignments.map((a) => a.contractId) : null,
      sessionId: actor.sessionId,
      ip: actor.ip ?? '',
      actor,
    } satisfies OpsContext;
    return true;
  }
}

/**
 * Every contract, asset, ticket, alert, maintenance task and run, grant, session, page and
 * postmortem a request names (route parameters listed with @OpsRefs, and the well known body
 * and query fields) must belong to a contract the engineer may see. Unknown and invisible
 * objects both answer 404, so an external engineer cannot probe other customers.
 */
@Injectable()
export class AssignmentGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly scope: OpsScopeService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<OpsRequest & { opsContracts?: string[] }>();
    const ops = req.ops;
    if (!ops) throw ApiError.unauthorized();
    const paramRefs = this.reflector.getAllAndOverride<Record<string, OpsRefKind>>(OPS_REFS_KEY, [ctx.getHandler(), ctx.getClass()]) ?? {};
    const contracts = new Set<string>();
    for (const ref of this.scope.refs(req, paramRefs)) {
      const contractId = await this.scope.contractOf(ref.kind, ref.id);
      if (!contractId || !canSee(ops, contractId)) throw ApiError.notFound(ref.kind, ref.id);
      contracts.add(contractId);
    }
    req.opsContracts = [...contracts];
    return true;
  }
}

/**
 * On routes marked @Residency(): every contract the request touches must allow the engineer's
 * country (contract accessPolicy ANY, SAUDI_ONLY or TURKIYE_ONLY). Runs after AssignmentGuard.
 */
@Injectable()
export class ResidencyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (!this.reflector.getAllAndOverride<boolean>(RESIDENCY_KEY, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<OpsRequest & { opsContracts?: string[] }>();
    const ops = req.ops!;
    const ids = req.opsContracts ?? [];
    if (!ids.length) return true;
    const rows = await this.prisma.managedContract.findMany({ where: { id: { in: ids } }, select: { id: true, accessPolicy: true } });
    for (const c of rows) {
      if (!residencyAllows(c.accessPolicy, ops.country)) {
        throw new ApiError(403, 'residency_blocked', `This contract's access policy (${c.accessPolicy}) does not allow engineers working from ${ops.country}`);
      }
    }
    return true;
  }
}

/** Support leads and full staff only (ops routes that approve or review). */
export function assertOpsLead(ops: OpsContext, what = 'do this') {
  if (!ops.lead) throw ApiError.forbidden(`Only a support lead can ${what}`);
}
