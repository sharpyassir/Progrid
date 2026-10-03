import type { AccountStatus, TeamRole } from '@prisma/client';

/**
 * Who is making the request. Both humans (console session) and AI agents (API token)
 * resolve to an Actor; authorisation code never needs to know which.
 */
export interface Actor {
  userId: string;
  teamId: string;
  role: TeamRole;
  /** Restricts the actor to one project (agent tokens). undefined = every project in the team. */
  projectId?: string;
  /** Granted scopes, e.g. "servers:write". Sessions get every scope for their role. */
  scopes: Set<string>;
  tokenId?: string;
  /** Console session row id, when the actor signed in through the console. */
  sessionId?: string;
  isAgent: boolean;
  /** Actions that need a human to approve before they run (phase 2 enforcement). */
  requireApprovalFor: Set<string>;
  locale: string;
  /** The team's account status when the credential was resolved (suspended teams may only use billing). */
  teamStatus?: AccountStatus;
  /** console for console sessions and API tokens, ops for ops console sessions (/ops/v1 only). */
  audience?: 'console' | 'ops';
  /** Version of the legal documents the user last accepted (null: never); console sessions and API tokens. */
  legalVersion?: string | null;
  /** Client address and user agent of the request, written to the audit log. */
  ip?: string;
  userAgent?: string;
}

export const ALL_SCOPES = [
  'servers:read', 'servers:write', 'servers:delete',
  'images:read', 'snapshots:read', 'snapshots:write', 'volumes:read', 'volumes:write', 'dns:read', 'dns:write', 'storage:read', 'storage:write', 'databases:read', 'databases:write', 'kubernetes:read', 'kubernetes:write',
  'network:read', 'network:write',
  'apps:read', 'apps:write',
  'billing:read', 'billing:write',
  'support:read', 'support:write',
  'managed:read', 'managed:write',
  'connect:read', 'connect:write',
  'iam:read', 'iam:write',
  'admin',
] as const;

export type Scope = (typeof ALL_SCOPES)[number];

/** Scopes implied by a team role for console sessions. `admin` is never implied by a role. */
export function scopesForRole(role: TeamRole): Set<string> {
  switch (role) {
    case 'owner':
    case 'admin':
      return new Set(ALL_SCOPES.filter((s) => s !== 'admin'));
    case 'member':
      // Connect: members read agents, runs and logs; owners and admins build, deploy and hold credentials.
      return new Set(ALL_SCOPES.filter((s) => !s.startsWith('billing') && !s.startsWith('iam') && s !== 'admin' && s !== 'connect:write'));
    case 'billing':
      return new Set(['billing:read', 'billing:write', 'servers:read', 'iam:read']);
    case 'readonly':
      return new Set(ALL_SCOPES.filter((s) => s.endsWith(':read')));
  }
}

/**
 * Limited staff roles. `engineer` works managed cloud tickets, logs time, runs maintenance and
 * edits runbooks; `support_lead` can do all of that plus assign tickets, manage on call,
 * contracts, assets and the responsibility matrix. Full staff (no roles) can do everything.
 */
export const STAFF_ROLES = ['support', 'finance', 'ops', 'engineer', 'support_lead'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Back office scopes for a staff user: `admin` for full staff, `admin:<area>` for limited staff. */
export function staffScopes(user: { isStaff: boolean; staffRoles: string[] }): string[] {
  if (!user.isStaff) return [];
  const roles = user.staffRoles.filter((r) => (STAFF_ROLES as readonly string[]).includes(r));
  return roles.length ? roles.map((r) => `admin:${r}`) : ['admin'];
}

export const hasStaffScope = (scopes: Set<string>) => [...scopes].some((s) => s === 'admin' || s.startsWith('admin:'));

/** Full staff or a staff member holding one of `areas`. */
export const hasStaffArea = (scopes: Set<string>, ...areas: StaffRole[]) => scopes.has('admin') || areas.some((a) => scopes.has(`admin:${a}`));
