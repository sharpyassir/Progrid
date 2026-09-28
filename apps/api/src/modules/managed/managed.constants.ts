import type { ManagedPriority, Prisma, ResponsibilityOwner, TicketPriority, TicketStatus } from '@prisma/client';
import { ApiError } from '../../common/errors/api-error';
import type { Actor } from '../../common/auth/actor';
import { hasStaffArea } from '../../common/auth/actor';

export const MANAGED_PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const satisfies readonly ManagedPriority[];
export type Targets = Record<ManagedPriority, number>;

/** Managed priorities mirrored onto the support ticket priority so the general queue sorts them too. */
export const SUPPORT_PRIORITY: Record<ManagedPriority, TicketPriority> = { P1: 'urgent', P2: 'high', P3: 'normal', P4: 'low' };

/** Onboarding checklist every contract starts with. Completing all items activates the contract. */
export const DEFAULT_ONBOARDING: { key: string; title: string }[] = [
  { key: 'monitoring', title: 'Monitoring agent installed or platform monitoring on for every asset' },
  { key: 'backups', title: 'Backups configured and a restore tested' },
  { key: 'access', title: 'Access granted through the management network' },
  { key: 'documentation', title: 'Documentation and runbook written' },
  { key: 'responsibility_matrix', title: 'Responsibility matrix agreed with the customer' },
];

/** Shared responsibility matrix a new contract starts with; staff adjust it during onboarding. */
export const DEFAULT_RESPONSIBILITIES: { area: string; owner: ResponsibilityOwner; notes?: string }[] = [
  { area: 'Data center, hardware and hypervisor', owner: 'PROGRID', notes: 'Platform servers only. For external servers the hosting provider is responsible.' },
  { area: 'Operating system patching', owner: 'PROGRID', notes: 'Monthly patch window plus urgent security fixes.' },
  { area: 'Monitoring and alerting', owner: 'PROGRID' },
  { area: 'Incident response', owner: 'PROGRID', notes: 'Within the plan response targets.' },
  { area: 'Backups and restore tests', owner: 'PROGRID', notes: 'The customer decides what data must be kept and for how long.' },
  { area: 'Security hardening and firewall rules', owner: 'SHARED', notes: 'Progrid hardens the operating system; the customer approves exposed ports.' },
  { area: 'Capacity planning', owner: 'SHARED', notes: 'Progrid recommends in the monthly report; the customer approves spend.' },
  { area: 'Application code, releases and deployments', owner: 'CUSTOMER' },
  { area: 'Application configuration and data', owner: 'CUSTOMER' },
  { area: 'Application user accounts and credentials', owner: 'CUSTOMER' },
  { area: 'Third party licenses', owner: 'CUSTOMER' },
  { area: 'External cloud accounts and their bills', owner: 'CUSTOMER' },
  { area: 'Compliance evidence (PDPL, NCA ECC)', owner: 'SHARED' },
];

/** Default playbook per maintenance kind (files in MAINTENANCE_PLAYBOOK_DIR). */
export const DEFAULT_PLAYBOOK = { PATCHING: 'patching.yml', BACKUP_TEST: 'backup-test.yml' } as const;

export function parseTargets(value: Prisma.JsonValue, what: string): Targets {
  const v = (value ?? {}) as Record<string, unknown>;
  const out = {} as Targets;
  for (const p of MANAGED_PRIORITIES) {
    const n = Number(v[p]);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${what} is missing a positive ${p} target`);
    out[p] = n;
  }
  return out;
}

/** Team owners only: plans, contracts and reports. */
export function assertOwner(actor: Actor) {
  if (actor.role !== 'owner') throw ApiError.forbidden('Only team owners can manage managed cloud contracts and reports');
}

/** Resolved ticket states. A managed P1 waits in resolved_pending_pm until its postmortem is submitted. */
export const CLOSED_STATUSES: TicketStatus[] = ['closed', 'resolved_pending_pm'];
export const isClosedStatus = (s: TicketStatus | string) => s === 'closed' || s === 'resolved_pending_pm';
/** What customers see: a ticket waiting for its postmortem is resolved (closed) for them. */
export const customerStatus = (s: TicketStatus) => (s === 'resolved_pending_pm' ? 'closed' : s);
/** A customer filter on status: closed covers resolved_pending_pm too. */
export const customerStatusFilter = (s: TicketStatus) => (isClosedStatus(s) ? { in: CLOSED_STATUSES } : s);

/** Support leads and full staff. */
export const isLead = (actor: Actor) => hasStaffArea(actor.scopes, 'support_lead');

export function assertLead(actor: Actor, what = 'do this') {
  if (!isLead(actor)) throw ApiError.forbidden(`Only a support lead can ${what}`);
}

export const dayMs = 86_400_000;

/** "2026-09" for the month containing `d` (UTC). */
export function periodKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function periodBounds(period: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) throw ApiError.invalid('period must look like 2026-09');
  const start = new Date(Date.UTC(+m[1], +m[2] - 1, 1));
  const end = new Date(Date.UTC(+m[1], +m[2], 1));
  return { start, end };
}
