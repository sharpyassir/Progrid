import type { ContractAccessPolicy, EngineerKind, EngineerStatus, PrismaClient } from '@prisma/client';

/**
 * Residency and eligibility rules, shared by the ops guards and the managed module (ticket
 * assignment and on call paging). Pure functions plus one loader, no Nest dependencies, so the
 * managed module can use them without importing the ops module.
 */

/** Country an internal staff member without an engineer profile is counted in. */
export const STAFF_DEFAULT_COUNTRY = 'SA';

/** Whether an engineer working from `country` (ISO 3166-1 alpha-2) may work on a contract with `policy`. */
export function residencyAllows(policy: ContractAccessPolicy | string, country: string | null | undefined): boolean {
  const c = (country ?? '').trim().toUpperCase();
  switch (policy) {
    case 'ANY':
      return true;
    case 'SAUDI_ONLY':
      return c === 'SA';
    case 'TURKIYE_ONLY':
      return c === 'TR';
    default:
      return false;
  }
}

/** Staff areas that make a staff member an internal engineer in the ops console. */
export function isInternalEngineerStaff(user: { isStaff: boolean; staffRoles: string[] }) {
  if (!user.isStaff) return false;
  return ['full_admin', 'engineer', 'support_lead'].some((r) => user.staffRoles.includes(r));
}

/** Support leads and full staff (full_admin) approve grants and timesheets. */
export function isLeadStaff(user: { isStaff: boolean; staffRoles: string[] }) {
  return user.isStaff && (user.staffRoles.includes('full_admin') || user.staffRoles.includes('support_lead'));
}

export interface EngineerFacts {
  userId: string;
  isStaff: boolean;
  staffRoles: string[];
  profile: { id: string; kind: EngineerKind; status: EngineerStatus; country: string } | null;
  /** The engineer holds an EngineerAssignment for the contract in question. */
  assigned: boolean;
}

export type Eligibility = { ok: true; internal: boolean; country: string } | { ok: false; reason: 'not_engineer' | 'inactive' | 'not_assigned' | 'residency'; message: string };

/**
 * Whether a person may be assigned, paged or granted access on a contract:
 *   an active engineer profile, or an internal engineer (staff: engineer, support_lead or full staff);
 *   the engineer's country must satisfy the contract's accessPolicy;
 *   external engineers must be assigned to the contract.
 */
export function eligibility(f: EngineerFacts, policy: ContractAccessPolicy | string): Eligibility {
  if (f.profile && f.profile.status !== 'ACTIVE') return { ok: false, reason: 'inactive', message: `The engineer is ${f.profile.status.toLowerCase()}` };
  const internal = f.profile?.kind !== 'EXTERNAL' && isInternalEngineerStaff(f);
  const external = f.profile?.kind === 'EXTERNAL';
  if (!internal && !external) return { ok: false, reason: 'not_engineer', message: 'Not an engineer' };
  const country = f.profile?.country ?? STAFF_DEFAULT_COUNTRY;
  if (!residencyAllows(policy, country)) return { ok: false, reason: 'residency', message: `The contract's access policy (${policy}) does not allow engineers working from ${country}` };
  if (external && !f.assigned) return { ok: false, reason: 'not_assigned', message: 'The engineer is not assigned to this contract' };
  return { ok: true, internal, country };
}

type Db = Pick<PrismaClient, 'user' | 'engineerAssignment'>;

export async function engineerFacts(prisma: Db, userId: string, contractId: string | null): Promise<EngineerFacts | null> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, isStaff: true, staffRoles: true, engineerProfile: { select: { id: true, kind: true, status: true, country: true } } } });
  if (!u) return null;
  const assigned = !!(u.engineerProfile && contractId && (await prisma.engineerAssignment.findUnique({ where: { engineerId_contractId: { engineerId: u.engineerProfile.id, contractId } }, select: { id: true } })));
  return { userId: u.id, isStaff: u.isStaff, staffRoles: u.staffRoles, profile: u.engineerProfile, assigned };
}

/** Eligibility of one person for one contract, loaded from the database. */
export async function checkEligibility(prisma: Db & Pick<PrismaClient, 'managedContract'>, userId: string, contractId: string): Promise<Eligibility> {
  const c = await prisma.managedContract.findUnique({ where: { id: contractId }, select: { accessPolicy: true } });
  const f = await engineerFacts(prisma, userId, contractId);
  if (!c || !f) return { ok: false, reason: 'not_engineer', message: 'Unknown engineer or contract' };
  return eligibility(f, c.accessPolicy);
}
