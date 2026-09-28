import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import type { ContractAccessPolicy, EngineerProfile, Prisma, User } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ApiError } from '../../../common/errors/api-error';
import { hasStaffArea, type Actor } from '../../../common/auth/actor';
import { AccountSecurityService } from '../../iam/account-security.service';
import { OpsAudit } from '../ops-audit.service';
import { OpsSettingsService } from '../settings/ops-settings.service';
import { eligibility, engineerFacts, isInternalEngineerStaff, residencyAllows } from '../guards/residency';
import { isCidr } from '../guards/ip-allowlist';
import type { CreateEngineerDto, ListEngineersQuery, UpdateEngineerDto } from './engineers.dto';

type ProfileRow = EngineerProfile & { user: Pick<User, 'id' | 'name' | 'email' | 'phone' | 'pagingChannel' | 'isStaff' | 'staffRoles' | 'totpEnabled'>; assignments: { contractId: string; createdAt: Date }[] };

const include = {
  user: { select: { id: true, name: true, email: true, phone: true, pagingChannel: true, isStaff: true, staffRoles: true, totpEnabled: true } },
  assignments: { select: { contractId: true, createdAt: true }, orderBy: { createdAt: 'asc' as const } },
} satisfies Prisma.EngineerProfileInclude;

/** Back office view of an engineer (staff only; contains contact details and rates). */
export function presentEngineer(p: ProfileRow) {
  return {
    id: p.id, userId: p.userId, name: p.user.name, email: p.user.email, phone: p.user.phone, pagingChannel: p.user.pagingChannel,
    kind: p.kind, status: p.status, statusReason: p.statusReason, country: p.country, timezone: p.timezone,
    hourlyRateMinor: p.hourlyRateMinor, standbyFeeMinor: p.standbyFeeMinor, currency: p.currency, nightMultiplier: p.nightMultiplier,
    ipAllowlist: p.ipAllowlist, twoFactor: p.user.totpEnabled, staff: p.user.isStaff, staffRoles: p.user.staffRoles,
    contractIds: p.assignments.map((a) => a.contractId), suspendedAt: p.suspendedAt, offboardedAt: p.offboardedAt, createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

const isFullStaff = (actor: Actor) => actor.scopes.has('admin');

/** Engineer profiles, contract assignments and contract residency policies (back office, /admin/ops). */
@Injectable()
export class EngineersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: OpsAudit,
    private readonly security: AccountSecurityService,
    private readonly settings: OpsSettingsService,
  ) {}

  async list(q: ListEngineersQuery) {
    const rows = await this.prisma.engineerProfile.findMany({
      where: { ...(q.status ? { status: q.status } : {}), ...(q.kind ? { kind: q.kind } : {}), ...(q.contractId ? { assignments: { some: { contractId: q.contractId } } } : {}) },
      include,
      orderBy: { createdAt: 'asc' },
    });
    return { data: rows.map(presentEngineer) };
  }

  async get(id: string) {
    return presentEngineer(await this.load(id));
  }

  async create(actor: Actor, dto: CreateEngineerDto) {
    this.checkRates(actor, dto);
    this.checkZone(dto.timezone);
    this.checkAllowlist(dto.ipAllowlist);
    const country = dto.country.toUpperCase();
    let userId = dto.userId;
    let created = false;
    if (userId) {
      const u = await this.prisma.user.findUnique({ where: { id: userId }, include: { engineerProfile: { select: { id: true } } } });
      if (!u) throw ApiError.notFound('user', userId);
      if (u.engineerProfile) throw ApiError.conflict('already_engineer', 'This user already has an engineer profile');
      if (dto.kind === 'EXTERNAL' && u.isStaff) throw ApiError.invalid('Staff cannot be external engineers; use kind INTERNAL');
      if (dto.kind === 'INTERNAL' && !isInternalEngineerStaff(u)) throw ApiError.invalid('An internal engineer must be staff with the engineer or support_lead role');
    } else {
      if (dto.kind === 'INTERNAL') throw ApiError.invalid('Internal engineers are existing staff users: pass userId');
      if (!dto.email || !dto.name) throw ApiError.invalid('Pass userId, or email and name for a new account');
      const email = dto.email.toLowerCase();
      if (await this.prisma.user.findUnique({ where: { email } })) throw ApiError.conflict('email_taken', 'An account with this email already exists; pass its userId instead');
      const u = await this.prisma.user.create({ data: { email, name: dto.name, passwordHash: await argon2.hash(randomBytes(32).toString('base64url')), locale: 'en', emailVerified: new Date() } });
      userId = u.id;
      created = true;
    }
    const s = await this.settings.get();
    const profile = await this.prisma.engineerProfile.create({
      data: {
        userId, kind: dto.kind, country, timezone: dto.timezone ?? 'Asia/Riyadh', hourlyRateMinor: dto.hourlyRateMinor ?? null, standbyFeeMinor: dto.standbyFeeMinor ?? null,
        currency: dto.currency ?? 'USD', nightMultiplier: dto.nightMultiplier ?? s.defaultNightMultiplier, ipAllowlist: dto.ipAllowlist ?? [], createdById: actor.userId,
      },
    });
    if (dto.phone !== undefined || dto.pagingChannel !== undefined) await this.prisma.user.update({ where: { id: userId }, data: { phone: dto.phone, pagingChannel: dto.pagingChannel } });
    await this.audit.emit('ops.engineer_created', actor, { engineerId: profile.id, userId, kind: profile.kind, country, newAccount: created }, `engineer:${profile.id}`);
    for (const contractId of dto.contractIds ?? []) await this.assign(actor, profile.id, contractId);
    if (created) await this.security.sendOpsPasswordLink(userId, 'welcome');
    return this.get(profile.id);
  }

  async update(actor: Actor, id: string, dto: UpdateEngineerDto, onStatus?: (p: EngineerProfile, from: string) => Promise<unknown>) {
    const cur = await this.load(id);
    this.checkRates(actor, dto);
    this.checkZone(dto.timezone);
    this.checkAllowlist(dto.ipAllowlist);
    const statusChange = dto.status && dto.status !== cur.status ? dto.status : undefined;
    if (cur.status === 'OFFBOARDED' && statusChange) throw ApiError.invalidState('An offboarded engineer cannot be reactivated; create a new profile');
    const now = new Date();
    const updated = await this.prisma.engineerProfile.update({
      where: { id },
      data: {
        country: dto.country?.toUpperCase(), timezone: dto.timezone, hourlyRateMinor: dto.hourlyRateMinor, standbyFeeMinor: dto.standbyFeeMinor, currency: dto.currency,
        nightMultiplier: dto.nightMultiplier, ipAllowlist: dto.ipAllowlist,
        ...(statusChange ? { status: statusChange, statusReason: dto.statusReason ?? null, ...(statusChange === 'SUSPENDED' ? { suspendedAt: now } : statusChange === 'OFFBOARDED' ? { offboardedAt: now } : { suspendedAt: null }) } : {}),
      },
    });
    if (dto.phone !== undefined || dto.pagingChannel !== undefined) await this.prisma.user.update({ where: { id: cur.userId }, data: { phone: dto.phone, pagingChannel: dto.pagingChannel } });
    const changes = Object.fromEntries(Object.entries(dto).filter(([k, v]) => v !== undefined && k !== 'phone'));
    await this.audit.emit(statusChange ? `ops.engineer_${statusChange.toLowerCase()}` : 'ops.engineer_updated', actor, { engineerId: id, userId: cur.userId, changes }, `engineer:${id}`);
    if (statusChange && statusChange !== 'ACTIVE') {
      // Signed in ops sessions end at once; the offboarding flow does the rest.
      await this.prisma.session.updateMany({ where: { userId: cur.userId, audience: 'ops', revokedAt: null }, data: { revokedAt: now } });
      if (onStatus) await onStatus(updated, cur.status);
    }
    return this.get(id);
  }

  // ---- assignments ----

  async assignments(id: string) {
    const p = await this.load(id);
    const contracts = await this.prisma.managedContract.findMany({ where: { id: { in: p.assignments.map((a) => a.contractId) } }, include: { team: { select: { name: true } }, plan: { select: { code: true, name: true } } } });
    return { data: contracts.map((c) => ({ contractId: c.id, customer: c.team.name, plan: c.plan.code, status: c.status, accessPolicy: c.accessPolicy, assignedAt: p.assignments.find((a) => a.contractId === c.id)?.createdAt })) };
  }

  /** Assigns a contract. Residency is enforced here: the contract's policy must allow the engineer's country. */
  async assign(actor: Actor, id: string, contractId: string) {
    const p = await this.load(id);
    if (p.status !== 'ACTIVE') throw ApiError.invalidState(`The engineer is ${p.status.toLowerCase()}`);
    const c = await this.prisma.managedContract.findUnique({ where: { id: contractId }, select: { id: true, accessPolicy: true, status: true } });
    if (!c) throw ApiError.notFound('managed contract', contractId);
    if (c.status === 'CANCELLED') throw ApiError.invalidState('The contract is cancelled');
    const facts = await engineerFacts(this.prisma, p.userId, contractId);
    const ok = eligibility({ ...facts!, assigned: true }, c.accessPolicy);
    if (!ok.ok) throw new ApiError(403, ok.reason === 'residency' ? 'residency_blocked' : 'forbidden', ok.message);
    const existing = await this.prisma.engineerAssignment.findUnique({ where: { engineerId_contractId: { engineerId: id, contractId } } });
    if (!existing) {
      await this.prisma.engineerAssignment.create({ data: { engineerId: id, contractId, createdById: actor.userId } });
      await this.audit.emit('ops.engineer_assigned', actor, { contractId, engineerId: id, userId: p.userId }, `engineer:${id}`);
    }
    return this.assignments(id);
  }

  async unassign(actor: Actor, id: string, contractId: string, onUnassign?: (userId: string, contractId: string) => Promise<void>) {
    const p = await this.load(id);
    const r = await this.prisma.engineerAssignment.deleteMany({ where: { engineerId: id, contractId } });
    if (r.count) {
      await this.audit.emit('ops.engineer_unassigned', actor, { contractId, engineerId: id, userId: p.userId }, `engineer:${id}`);
      if (onUnassign) await onUnassign(p.userId, contractId);
    }
    return this.assignments(id);
  }

  /**
   * Changes a contract's residency policy (full staff). Engineers the new policy excludes lose
   * the assignment at once; the caller revokes their grants.
   */
  async setAccessPolicy(actor: Actor, contractId: string, accessPolicy: ContractAccessPolicy) {
    const c = await this.prisma.managedContract.findUnique({ where: { id: contractId } });
    if (!c) throw ApiError.notFound('managed contract', contractId);
    await this.prisma.managedContract.update({ where: { id: contractId }, data: { accessPolicy } });
    const assigned = await this.prisma.engineerAssignment.findMany({ where: { contractId }, include: { engineer: { select: { id: true, userId: true, country: true } } } });
    const removed = assigned.filter((a) => !residencyAllows(accessPolicy, a.engineer.country));
    if (removed.length) await this.prisma.engineerAssignment.deleteMany({ where: { id: { in: removed.map((a) => a.id) } } });
    await this.audit.emit('ops.contract_access_policy_changed', actor, { contractId, from: c.accessPolicy, to: accessPolicy, removedEngineers: removed.map((a) => a.engineer.id) }, `managed_contract:${contractId}`);
    return { contractId, accessPolicy, removedAssignments: removed.map((a) => ({ engineerId: a.engineer.id, userId: a.engineer.userId, country: a.engineer.country })) };
  }

  // ---- helpers ----

  async load(id: string): Promise<ProfileRow> {
    const p = await this.prisma.engineerProfile.findFirst({ where: { OR: [{ id }, { userId: id }] }, include });
    if (!p) throw ApiError.notFound('engineer', id);
    return p;
  }

  /** Rates and the night multiplier are set by full staff only. */
  private checkRates(actor: Actor, dto: { hourlyRateMinor?: number | null; standbyFeeMinor?: number | null; nightMultiplier?: number; currency?: string }) {
    const touches = dto.hourlyRateMinor !== undefined || dto.standbyFeeMinor !== undefined || dto.nightMultiplier !== undefined || dto.currency !== undefined;
    if (touches && !isFullStaff(actor)) throw ApiError.forbidden('Only full staff can set engineer rates');
    if (!hasStaffArea(actor.scopes, 'support_lead')) throw ApiError.forbidden('Only a support lead can manage engineers');
  }

  private checkZone(tz?: string) {
    if (!tz) return;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
    } catch {
      throw ApiError.invalid(`Unknown time zone ${tz}`);
    }
  }

  private checkAllowlist(list?: string[]) {
    const bad = (list ?? []).filter((e) => !isCidr(e));
    if (bad.length) throw ApiError.invalid(`Not an address or CIDR: ${bad.join(', ')}`);
  }
}
