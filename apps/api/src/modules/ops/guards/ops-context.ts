import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { EngineerProfile } from '@prisma/client';
import type { Actor } from '../../../common/auth/actor';

/**
 * Who is calling the ops console API. Built by EngineerGuard from the ops session.
 *
 * External engineers see only the contracts in `contractIds`; internal engineers (staff with
 * the engineer or support_lead area, or full staff) see every contract (`contractIds` null).
 */
export interface OpsContext {
  userId: string;
  name: string;
  locale: string;
  profile: EngineerProfile | null;
  kind: 'EXTERNAL' | 'INTERNAL';
  external: boolean;
  /** Support lead or full staff: may approve grants and timesheets (never their own). */
  lead: boolean;
  /** Country the residency rules use (the profile's, or SA for staff without a profile). */
  country: string;
  timezone: string;
  /** Contracts an external engineer is assigned to; null means every contract. */
  contractIds: string[] | null;
  sessionId: string;
  ip: string;
  /** Actor for the managed module services and the audit log (no team; staff scopes for internal engineers). */
  actor: Actor;
}

export type OpsRequest = { ops?: OpsContext; actor?: Actor; params: Record<string, string>; body?: unknown; query?: Record<string, unknown> };

export const Ops = createParamDecorator((_: unknown, ctx: ExecutionContext): OpsContext => ctx.switchToHttp().getRequest<OpsRequest>().ops!);

/** Kinds of objects an ops request can reference; each resolves to one contract. */
export type OpsRefKind = 'contract' | 'asset' | 'ticket' | 'alert' | 'task' | 'run' | 'page';

export const OPS_REFS_KEY = 'prgd:ops-refs';
/**
 * Route parameters that name ops objects, e.g. `@OpsRefs({ id: 'ticket' })`. AssignmentGuard
 * checks each one (and the well known body and query fields) against the engineer's contracts.
 */
export const OpsRefs = (refs: Record<string, OpsRefKind>) => SetMetadata(OPS_REFS_KEY, refs);

export const RESIDENCY_KEY = 'prgd:ops-residency';
/** The contracts referenced by this request must allow the engineer's country (access grants, terminal, maintenance). */
export const Residency = () => SetMetadata(RESIDENCY_KEY, true);

export const LEAD_KEY = 'prgd:ops-lead';

/** Body and query fields AssignmentGuard checks on every ops request. */
export const BODY_REFS: Record<string, OpsRefKind> = {
  contractId: 'contract',
  assetId: 'asset',
  ticketId: 'ticket',
  alertId: 'alert',
  taskId: 'task',
  maintenanceRunId: 'run',
  runId: 'run',
};

/** True when the engineer may see objects of `contractId`. */
export function canSee(ctx: Pick<OpsContext, 'contractIds'>, contractId: string | null | undefined) {
  if (!contractId) return false;
  return ctx.contractIds === null || ctx.contractIds.includes(contractId);
}

/** Prisma filter on a contractId column for the engineer's contracts (undefined: no restriction). */
export function contractFilter(ctx: Pick<OpsContext, 'contractIds'>): { in: string[] } | undefined {
  return ctx.contractIds === null ? undefined : { in: ctx.contractIds };
}
