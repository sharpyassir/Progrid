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
  isAgent: boolean;
  /** Actions that need a human to approve before they run (phase 2 enforcement). */
  requireApprovalFor: Set<string>;
  locale: string;
  /** The team's account status when the credential was resolved (suspended teams may only use billing). */
  teamStatus?: AccountStatus;
}

export const ALL_SCOPES = [
  'servers:read', 'servers:write', 'servers:delete',
  'images:read', 'snapshots:read', 'snapshots:write', 'volumes:read', 'volumes:write', 'dns:read', 'dns:write', 'storage:read', 'storage:write', 'databases:read', 'databases:write', 'kubernetes:read', 'kubernetes:write',
  'network:read', 'network:write',
  'apps:read', 'apps:write',
  'billing:read', 'billing:write',
  'support:read', 'support:write',
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
      return new Set(ALL_SCOPES.filter((s) => !s.startsWith('billing') && !s.startsWith('iam') && s !== 'admin'));
    case 'billing':
      return new Set(['billing:read', 'billing:write', 'servers:read', 'iam:read']);
    case 'readonly':
      return new Set(ALL_SCOPES.filter((s) => s.endsWith(':read')));
  }
}
