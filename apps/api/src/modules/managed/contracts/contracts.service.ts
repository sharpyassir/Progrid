import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type ManagedContract, type ManagedPlan } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ApiError } from '../../../common/errors/api-error';
import { cursorArgs, toPage } from '../../../common/pagination';
import type { Actor } from '../../../common/auth/actor';
import { loadConfig } from '../../../config/config';
import { EventsService } from '../../events/events.service';
import { assertOwner, dayMs } from '../managed.constants';
import { ManagedWorkflows } from '../managed-workflows.service';
import { ManagedNotify } from '../managed-notify.service';
import { presentPlan } from '../plans/plans.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { ResponsibilityService } from '../responsibility/responsibility.service';
import { ContractTermsService } from './contract-terms.service';
import { ManagedAccessService } from './access.service';
import { OpsSettingsService } from '../../ops/settings/ops-settings.service';
import type { ActivateContractDto, AdminListContractsQuery, RequestContractDto, StaffCreateContractDto, UpdateContractDto } from './contracts.dto';

type ContractWithPlan = ManagedContract & { plan: ManagedPlan };

/**
 * Contract lifecycle: DRAFT (requested) to ONBOARDING (signed and activated by a support lead)
 * to ACTIVE (checklist complete, billing starts), then SUSPENDED (monitoring continues, no
 * support, no fee) and CANCELLED (access revoked, handover document sent). Every change emits
 * an event, which writes the audit log.
 */
@Injectable()
export class ContractsService {
  private readonly log = new Logger(ContractsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly workflows: ManagedWorkflows,
    private readonly notify: ManagedNotify,
    private readonly terms: ContractTermsService,
    private readonly onboarding: OnboardingService,
    private readonly responsibility: ResponsibilityService,
    private readonly access: ManagedAccessService,
    private readonly opsSettings: OpsSettingsService,
  ) {}

  // ---- customer ----

  async request(actor: Actor, dto: RequestContractDto) {
    assertOwner(actor);
    const pending = await this.prisma.managedContract.findFirst({ where: { teamId: actor.teamId, status: 'DRAFT' } });
    if (pending) throw ApiError.conflict('request_pending', 'Your team already has a managed cloud request waiting for review');
    const c = await this.createDraft(actor, actor.teamId, dto, {});
    await this.notify.toStaff({ subject: `Managed cloud request: ${c.plan.name}`, text: `A team asked for the ${c.plan.name} plan.\n\n${dto.notes ?? ''}\n\n${loadConfig().CONSOLE_URL}/admin/managed/contracts/${c.id}` });
    return this.present(c, { detail: true });
  }

  async listForTeam(actor: Actor) {
    assertOwner(actor);
    const rows = await this.prisma.managedContract.findMany({ where: { teamId: actor.teamId }, include: { plan: true, _count: { select: { assets: { where: { removedAt: null } } } } }, orderBy: { createdAt: 'desc' } });
    return { data: await Promise.all(rows.map((c) => this.present(c, { assetCount: c._count.assets }))) };
  }

  async getForTeam(actor: Actor, id: string) {
    assertOwner(actor);
    return this.present(await this.owned(actor, id), { detail: true });
  }

  /** A contract of the actor's team; any role (members may use it to scope tickets and assets). */
  async owned(actor: Actor, id: string) {
    const c = await this.prisma.managedContract.findFirst({ where: { id, teamId: actor.teamId }, include: { plan: true } });
    if (!c) throw ApiError.notFound('managed contract', id);
    return c;
  }

  // ---- staff ----

  async createForTeam(actor: Actor, dto: StaffCreateContractDto) {
    const team = await this.prisma.team.findUnique({ where: { id: dto.teamId } });
    if (!team) throw ApiError.notFound('team', dto.teamId);
    const c = await this.createDraft(actor, team.id, dto, { priceOverrideMinor: dto.priceOverrideMinor, includedMinutesOverride: dto.includedMinutesOverride, maxAssetsOverride: dto.maxAssetsOverride, termMonths: dto.termMonths });
    return this.present(c, { detail: true, staff: true });
  }

  async adminList(q: AdminListContractsQuery) {
    const rows = await this.prisma.managedContract.findMany({
      where: { ...(q.status ? { status: q.status } : {}), ...(q.teamId ? { teamId: q.teamId } : {}) },
      include: { plan: true, team: { select: { id: true, name: true, slug: true } }, _count: { select: { assets: { where: { removedAt: null } } } } },
      orderBy: { createdAt: 'desc' },
      ...cursorArgs(q),
    });
    const data = await Promise.all(rows.map(async (c) => ({ ...(await this.present(c, { staff: true, assetCount: c._count.assets })), team: c.team })));
    return toPage(data, q.limit);
  }

  async adminGet(id: string) {
    const c = await this.load(id);
    const team = await this.prisma.team.findUnique({ where: { id: c.teamId }, select: { id: true, name: true, slug: true, country: true, currency: true, status: true } });
    return { ...(await this.present(c, { detail: true, staff: true })), team };
  }

  async update(actor: Actor, id: string, dto: UpdateContractDto) {
    const c = await this.load(id);
    if (c.status === 'CANCELLED') throw ApiError.invalidState('A cancelled contract cannot change');
    const updated = await this.prisma.managedContract.update({ where: { id }, data: dto, include: { plan: true } });
    await this.events.emit('managed.contract_updated', { contractId: id, changes: dto as Record<string, unknown> }, { teamId: c.teamId, actor, resource: `managed_contract:${id}` });
    return this.present(updated, { detail: true, staff: true });
  }

  /**
   * DRAFT to ONBOARDING: records the signature and liability cap, creates the checklist and
   * starts the onboarding workflow. A 24/7 plan needs at least two distinct people on call in
   * the next 14 days unless `overrideOnCallRule` is set (recorded in the audit log).
   */
  async activate(actor: Actor, id: string, dto: ActivateContractDto) {
    const c = await this.load(id);
    if (c.status !== 'DRAFT') throw ApiError.invalidState(`Only a DRAFT contract can be activated (this one is ${c.status})`);
    const terms = await this.terms.terms(c);
    if (terms.monthlyFeeMinor === null) throw ApiError.invalid(`The ${c.plan.name} plan has a custom price: set priceOverrideMinor on the contract before activating it`);
    let onCallPeople: number | undefined;
    if (c.plan.coverage === 'TWENTY_FOUR_SEVEN') {
      onCallPeople = await this.onCallPeople(14);
      if (onCallPeople < 2 && !dto.overrideOnCallRule) {
        throw new ApiError(409, 'on_call_rule', `24/7 plans need at least 2 different people on call in the next 14 days; ${onCallPeople} ${onCallPeople === 1 ? 'is' : 'are'} scheduled. Add shifts under On call, or pass overrideOnCallRule: true to activate anyway (recorded in the audit log).`, { onCallPeople, required: 2 });
      }
    }
    const now = new Date();
    const moved = await this.prisma.managedContract.updateMany({
      where: { id, status: 'DRAFT' },
      data: {
        status: 'ONBOARDING',
        liabilityCapMinor: dto.liabilityCapMinor,
        signedByName: dto.signedByName.trim(),
        signedAt: dto.signedAt ?? now,
        signedById: actor.userId,
        onboardingStartedAt: now,
        onCallOverride: !!(dto.overrideOnCallRule && onCallPeople !== undefined && onCallPeople < 2),
      },
    });
    if (moved.count !== 1) throw ApiError.invalidState('The contract changed while activating; reload and try again');
    await this.onboarding.ensureChecklist(id);
    await this.responsibility.ensureDefaults(id);
    const overridden = !!dto.overrideOnCallRule && onCallPeople !== undefined && onCallPeople < 2;
    await this.events.emit('managed.contract_onboarding', { contractId: id, plan: c.plan.code, liabilityCapMinor: dto.liabilityCapMinor, signedByName: dto.signedByName, ...(onCallPeople !== undefined ? { onCallPeople } : {}), ...(overridden ? { onCallOverride: true } : {}) }, { teamId: c.teamId, actor, resource: `managed_contract:${id}` });
    if (overridden) await this.events.emit('managed.on_call_rule_overridden', { contractId: id, plan: c.plan.code, onCallPeople }, { teamId: c.teamId, actor, resource: `managed_contract:${id}` });
    await this.workflows.start('managedOnboarding', [{ contractId: id }], ManagedWorkflows.onboardingId(id));
    await this.notify.toOwners(c.teamId, {
      subject: `Onboarding started for your ${c.plan.name} managed cloud contract`,
      text: `Thank you for signing. Our engineers are onboarding your assets now: monitoring, backups, access through the management network, documentation and the shared responsibility matrix. The contract becomes active, and billing starts, once onboarding is complete.\n\n${loadConfig().CONSOLE_URL}/managed`,
    });
    return this.present(await this.load(id), { detail: true, staff: true });
  }

  async suspend(actor: Actor | null, id: string, reason?: string) {
    const c = await this.load(id);
    if (c.status !== 'ACTIVE' && c.status !== 'ONBOARDING') throw ApiError.invalidState(`Only an ACTIVE or ONBOARDING contract can be suspended (this one is ${c.status})`);
    const now = new Date();
    await this.prisma.managedContract.update({ where: { id }, data: { status: 'SUSPENDED', suspendedAt: now } });
    await this.events.emit('managed.contract_suspended', { contractId: id, reason: reason ?? null, from: c.status }, { teamId: c.teamId, actor: actor ?? undefined, resource: `managed_contract:${id}` });
    await this.notify.toOwners(c.teamId, { subject: `Your ${c.plan.name} managed cloud contract is suspended`, text: `Your managed cloud contract is suspended${reason ? `: ${reason}` : ''}. We keep monitoring your assets, but engineers do not work tickets or maintenance until it is resumed, and no monthly fee accrues while it is suspended.\n\n${loadConfig().CONSOLE_URL}/billing` });
    return this.present(await this.load(id), { detail: true, staff: true });
  }

  /** SUSPENDED back to ACTIVE (or ONBOARDING when it was never activated). */
  async resume(actor: Actor | null, id: string) {
    const c = await this.load(id);
    if (c.status !== 'SUSPENDED') throw ApiError.invalidState(`Only a SUSPENDED contract can be resumed (this one is ${c.status})`);
    const now = new Date();
    const suspensions = [...((c.suspensions as { from: string; to: string }[] | null) ?? []), { from: (c.suspendedAt ?? now).toISOString(), to: now.toISOString() }];
    const status = c.activatedAt ? 'ACTIVE' : 'ONBOARDING';
    await this.prisma.managedContract.update({ where: { id }, data: { status, suspendedAt: null, suspensions } });
    await this.events.emit('managed.contract_resumed', { contractId: id, status }, { teamId: c.teamId, actor: actor ?? undefined, resource: `managed_contract:${id}` });
    if (status === 'ONBOARDING') await this.workflows.signal(ManagedWorkflows.onboardingId(id), 'checklistUpdated');
    return this.present(await this.load(id), { detail: true, staff: true });
  }

  /** Cancels a contract: billing stops today, access is revoked and a handover document is emailed to the owners. */
  async cancel(actor: Actor, id: string, reason?: string) {
    const c = await this.load(id);
    if (c.status === 'CANCELLED') throw ApiError.invalidState('The contract is already cancelled');
    const now = new Date();
    await this.prisma.managedContract.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: now, cancelReason: reason ?? null } });
    const revoked = await this.access.revoke(id, c.teamId);
    await this.events.emit('managed.contract_cancelled', { contractId: id, reason: reason ?? null, from: c.status, assetsRevoked: revoked }, { teamId: c.teamId, actor, resource: `managed_contract:${id}` });
    await this.workflows.signal(ManagedWorkflows.onboardingId(id), 'checklistUpdated');
    const handover = await this.handoverDocument(id);
    await this.notify.toOwners(c.teamId, { subject: `Handover: your ${c.plan.name} managed cloud contract ended`, text: handover });
    return this.present(await this.load(id), { detail: true, staff: true });
  }

  /** Extends the term from its current end (or today, when it already ended). */
  async renew(actor: Actor, id: string, termMonths?: number) {
    const c = await this.load(id);
    if (c.status !== 'ACTIVE' && c.status !== 'SUSPENDED') throw ApiError.invalidState(`Only an ACTIVE or SUSPENDED contract can be renewed (this one is ${c.status})`);
    const months = termMonths ?? c.termMonths;
    const now = new Date();
    const from = c.termEndsAt && c.termEndsAt > now ? new Date(c.termEndsAt) : now;
    from.setUTCMonth(from.getUTCMonth() + months);
    await this.prisma.managedContract.update({ where: { id }, data: { termEndsAt: from, renewedAt: now, termMonths: months } });
    await this.events.emit('managed.contract_renewed', { contractId: id, termMonths: months, termEndsAt: from.toISOString() }, { teamId: c.teamId, actor, resource: `managed_contract:${id}` });
    return this.present(await this.load(id), { detail: true, staff: true });
  }

  /**
   * A failed payment suspends the team (dunning); its managed contracts follow: suspended while
   * the team is suspended for billing, resumed once it is reinstated. Run by a periodic job.
   */
  async syncWithTeamStatus() {
    const toSuspend = await this.prisma.managedContract.findMany({ where: { status: { in: ['ACTIVE', 'ONBOARDING'] }, team: { status: 'suspended' } }, select: { id: true } });
    for (const c of toSuspend) await this.suspend(null, c.id, 'the team account is suspended for an unpaid invoice').catch((e) => this.log.warn(`suspend ${c.id}: ${(e as Error).message}`));
    const toResume = await this.prisma.managedContract.findMany({ where: { status: 'SUSPENDED', team: { status: 'active' } }, select: { id: true, teamId: true } });
    let resumed = 0;
    for (const c of toResume) {
      // Only contracts this job suspended come back on their own.
      const last = await this.prisma.auditLog.findFirst({ where: { resource: `managed_contract:${c.id}`, action: 'managed.contract_suspended' }, orderBy: { at: 'desc' } });
      if (last && !last.userId) {
        await this.resume(null, c.id).catch((e) => this.log.warn(`resume ${c.id}: ${(e as Error).message}`));
        resumed++;
      }
    }
    return { suspended: toSuspend.length, resumed };
  }

  /** Distinct staff users with an on call shift overlapping the next `days` days. */
  async onCallPeople(days: number) {
    const now = new Date();
    const rows = await this.prisma.onCallShift.findMany({ where: { startsAt: { lt: new Date(now.getTime() + days * dayMs) }, endsAt: { gt: now } }, select: { userId: true }, distinct: ['userId'] });
    return rows.length;
  }

  // ---- helpers ----

  private async createDraft(actor: Actor, teamId: string, dto: RequestContractDto, extra: Partial<Prisma.ManagedContractUncheckedCreateInput>) {
    const plan = await this.prisma.managedPlan.findFirst({ where: { code: dto.plan.toUpperCase(), active: true } });
    if (!plan) throw ApiError.invalid(`Unknown or inactive plan "${dto.plan}"`);
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: teamId } });
    const accessPolicy = (await this.opsSettings.get()).defaultAccessPolicy;
    const c = await this.prisma.$transaction(async (tx) => {
      const created = await tx.managedContract.create({
        data: { teamId, planId: plan.id, status: 'DRAFT', calendar: dto.calendar ?? (team.country === 'TR' ? 'TR' : 'SA'), currency: team.currency, notes: dto.notes ?? null, requestedById: actor.userId, accessPolicy, ...extra },
        include: { plan: true },
      });
      await this.responsibility.ensureDefaults(created.id, tx);
      return created;
    });
    await this.events.emit('managed.contract_requested', { contractId: c.id, plan: plan.code, byStaff: teamId !== actor.teamId }, { teamId, actor, resource: `managed_contract:${c.id}` });
    return c;
  }

  private async load(id: string) {
    const c = await this.prisma.managedContract.findUnique({ where: { id }, include: { plan: true } });
    if (!c) throw ApiError.notFound('managed contract', id);
    return c;
  }

  /** Plain text handover document: what we managed, how, and what the team must take over. */
  async handoverDocument(id: string) {
    const c = await this.prisma.managedContract.findUniqueOrThrow({
      where: { id },
      include: { plan: true, team: true, assets: { where: { removedAt: null } }, responsibilities: { orderBy: { sortOrder: 'asc' } }, maintenanceTasks: true, reports: { orderBy: { period: 'desc' }, take: 1 } },
    });
    const open = await this.prisma.ticket.count({ where: { contractId: id, status: { notIn: ['closed', 'resolved_pending_pm'] } } });
    const lines = [
      `Handover for ${c.team.name}: ${c.plan.name} managed cloud contract`,
      `Ended: ${(c.cancelledAt ?? new Date()).toISOString().slice(0, 10)}${c.cancelReason ? ` (${c.cancelReason})` : ''}`,
      '',
      'From today Progrid no longer monitors, patches or backs up the assets below, and our access through the management network has been removed.',
      '',
      'Assets',
      ...(c.assets.length ? c.assets.map((a) => `  ${a.name} (${a.kind.toLowerCase().replace(/_/g, ' ')})${a.address ? `, ${a.address}` : ''}${a.provider ? `, ${a.provider}` : ''}${a.os ? `, ${a.os}` : ''}. Backups were ${a.backupEnabled ? 'on' : 'off'}.`) : ['  none']),
      '',
      'Maintenance we ran (now stopped)',
      ...(c.maintenanceTasks.length ? c.maintenanceTasks.map((t) => `  ${t.name}: ${t.kind.toLowerCase().replace(/_/g, ' ')}, schedule "${t.cron}" (${t.timezone})`) : ['  none']),
      '',
      'Responsibilities that are now yours',
      ...c.responsibilities.filter((r) => r.owner !== 'CUSTOMER').map((r) => `  ${r.area}`),
      '',
      `Open tickets: ${open}. They stay readable in the console.`,
      c.reports[0] ? `Last monthly report: ${c.reports[0].period}, available in the console.` : '',
      '',
      'Before you continue on your own, we recommend that you:',
      '  1. Rotate every password, SSH key and API key that Progrid engineers could use.',
      '  2. Confirm your own backups run and restore a test file.',
      '  3. Point your monitoring and alerting to your own team.',
      '  4. Schedule operating system updates.',
      '',
      `Questions about the handover: reply to this email or open a ticket at ${loadConfig().CONSOLE_URL}/support within 30 days.`,
    ];
    return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
  }

  async present(c: ContractWithPlan, opts: { detail?: boolean; staff?: boolean; assetCount?: number } = {}) {
    const terms = await this.terms.terms(c);
    const base = {
      id: c.id,
      teamId: c.teamId,
      status: c.status,
      plan: presentPlan(c.plan),
      calendar: c.calendar,
      currency: c.currency,
      monthlyFeeMinor: terms.monthlyFeeMinor,
      hourlyRateMinor: terms.hourlyRateMinor,
      includedEngineerMinutes: terms.includedEngineerMinutes,
      maxAssets: terms.maxAssets,
      liabilityCapMinor: c.liabilityCapMinor,
      signedByName: c.signedByName,
      signedAt: c.signedAt,
      termMonths: c.termMonths,
      termEndsAt: c.termEndsAt,
      renewedAt: c.renewedAt,
      notes: c.notes,
      onboardingStartedAt: c.onboardingStartedAt,
      activatedAt: c.activatedAt,
      suspendedAt: c.suspendedAt,
      cancelledAt: c.cancelledAt,
      cancelReason: c.cancelReason,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      sla: this.terms.sla(c),
      ...(opts.assetCount !== undefined ? { assetCount: opts.assetCount } : {}),
      ...(opts.staff ? { priceOverrideMinor: c.priceOverrideMinor, includedMinutesOverride: c.includedMinutesOverride, maxAssetsOverride: c.maxAssetsOverride, signedById: c.signedById, requestedById: c.requestedById, onCallOverride: c.onCallOverride, suspensions: c.suspensions } : {}),
    };
    if (!opts.detail) return base;
    const [onboarding, responsibilities, assets, usage] = await Promise.all([
      this.onboarding.list(c.id),
      this.responsibility.list(c.id),
      this.prisma.managedAsset.groupBy({ by: ['status'], where: { contractId: c.id, removedAt: null }, _count: { _all: true } }),
      this.usageThisMonth(c.id, terms.includedEngineerMinutes),
    ]);
    return {
      ...base,
      onboarding: { done: onboarding.done, total: onboarding.total, items: onboarding.data },
      responsibilities: responsibilities.data,
      assets: Object.fromEntries(assets.map((a) => [a.status, a._count._all])) as Record<string, number>,
      usage,
    };
  }

  /** Engineer time this calendar month (UTC) against the included minutes. */
  private async usageThisMonth(contractId: string, includedMinutes: number) {
    const now = new Date();
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const agg = await this.prisma.workLog.groupBy({ by: ['billable'], where: { contractId, workedAt: { gte: periodStart }, status: { in: ['APPROVED', 'PAID'] } }, _sum: { minutes: true } });
    const billable = agg.find((a) => a.billable)?._sum.minutes ?? 0;
    const nonBillable = agg.find((a) => !a.billable)?._sum.minutes ?? 0;
    return { periodStart, billableMinutes: billable, nonBillableMinutes: nonBillable, includedMinutes, overageMinutes: Math.max(0, billable - includedMinutes) };
  }
}
