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
import { CUSTOMER_CANCEL_REASON, NOT_RENEWED_REASON, endOfCurrentMonth, termDecision } from './renewal';
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

  /**
   * What every team member may know about the team's managed cloud contract: whether there is
   * one, its plan, status, coverage and SLA targets, and how many tickets are open. No prices,
   * overrides or liability terms (those stay on the owner only contract endpoints).
   */
  async summaryForTeam(actor: Actor) {
    const rows = await this.prisma.managedContract.findMany({ where: { teamId: actor.teamId }, include: { plan: true }, orderBy: { createdAt: 'desc' } });
    const current = rows.find((c) => c.status !== 'CANCELLED') ?? null;
    const cancelled = rows.find((c) => c.status === 'CANCELLED') ?? null;
    const openTickets = await this.prisma.ticket.count({ where: { teamId: actor.teamId, contractId: { not: null }, status: { notIn: ['closed', 'resolved_pending_pm'] } } });
    let contract = null;
    if (current) {
      const onboarding = current.status === 'ONBOARDING' ? await this.onboarding.list(current.id) : null;
      contract = {
        id: current.id,
        status: current.status,
        planName: current.plan.name,
        planCode: current.plan.code,
        coverage: current.plan.coverage,
        calendar: current.calendar,
        sla: this.terms.sla(current),
        onboarding: onboarding ? { done: onboarding.done, total: onboarding.total } : null,
        createdAt: current.createdAt,
        activatedAt: current.activatedAt,
        termMonths: current.termMonths,
        termEndsAt: current.termEndsAt,
        autoRenew: current.autoRenew,
        cancelAt: current.cancelAt,
      };
    }
    return {
      hasContract: !!current,
      contract,
      openTickets,
      previous: !current && cancelled ? { planName: cancelled.plan.name, cancelledAt: cancelled.cancelledAt } : null,
    };
  }

  /** Owner: turns automatic renewal at the end of the term on or off. */
  async setAutoRenew(actor: Actor, id: string, autoRenew: boolean) {
    assertOwner(actor);
    const c = await this.owned(actor, id);
    if (c.status === 'CANCELLED') throw ApiError.invalidState('A cancelled contract cannot change');
    if (c.autoRenew !== autoRenew) {
      await this.prisma.managedContract.update({ where: { id }, data: { autoRenew } });
      await this.events.emit(autoRenew ? 'managed.contract_auto_renew_on' : 'managed.contract_auto_renew_off', { contractId: id, autoRenew, termEndsAt: c.termEndsAt?.toISOString() ?? null }, { teamId: c.teamId, actor, resource: `managed_contract:${id}` });
    }
    return this.present(await this.load(id), { detail: true });
  }

  /**
   * Owner: cancel at any time. A billed contract (ACTIVE or SUSPENDED) ends at the start of next
   * month so the handover can happen, and the fee is prorated up to then; the renewal job
   * cancels it at that moment. A contract that was never billed (DRAFT or ONBOARDING) ends now.
   */
  async cancelForTeam(actor: Actor, id: string, reason?: string) {
    assertOwner(actor);
    const c = await this.owned(actor, id);
    if (c.status === 'CANCELLED') throw ApiError.invalidState('The contract is already cancelled');
    const why = reason?.trim() || CUSTOMER_CANCEL_REASON;
    if (c.status === 'DRAFT' || c.status === 'ONBOARDING') {
      await this.endContract(actor, c, { at: new Date(), reason: why, via: 'customer' });
      return this.present(await this.load(id), { detail: true });
    }
    if (c.cancelAt) return this.present(c, { detail: true });
    const cancelAt = endOfCurrentMonth(new Date());
    const moved = await this.prisma.managedContract.updateMany({ where: { id, status: { in: ['ACTIVE', 'SUSPENDED'] }, cancelAt: null }, data: { cancelAt, cancelReason: why } });
    if (moved.count === 1) {
      await this.events.emit('managed.contract_cancel_scheduled', { contractId: id, cancelAt: cancelAt.toISOString(), reason: why }, { teamId: c.teamId, actor, resource: `managed_contract:${id}` });
      await this.notify.toOwners(c.teamId, {
        subject: `Your ${c.plan.name} managed cloud contract ends on ${day(cancelAt)}`,
        text: `We received your cancellation. Your ${c.plan.name} contract ends on ${day(cancelAt)}. Until then our engineers keep working as usual, and the monthly fee is billed only up to that day.\n\nOn that day we remove our access and email you a handover document. Changed your mind? Undo the cancellation in the console before then.\n\n${loadConfig().CONSOLE_URL}/managed/contract`,
      });
    }
    return this.present(await this.load(id), { detail: true });
  }

  /** Owner: withdraws a scheduled cancellation before it takes effect. */
  async undoCancelForTeam(actor: Actor, id: string) {
    assertOwner(actor);
    const c = await this.owned(actor, id);
    if (c.status === 'CANCELLED') throw ApiError.invalidState('The contract is already cancelled');
    if (!c.cancelAt) throw ApiError.invalidState('No cancellation is scheduled for this contract');
    const moved = await this.prisma.managedContract.updateMany({ where: { id, status: { in: ['ACTIVE', 'SUSPENDED'] }, cancelAt: { gt: new Date() } }, data: { cancelAt: null, cancelReason: null } });
    if (moved.count !== 1) throw ApiError.invalidState('The cancellation already took effect');
    await this.events.emit('managed.contract_cancel_undone', { contractId: id, cancelAt: c.cancelAt.toISOString() }, { teamId: c.teamId, actor, resource: `managed_contract:${id}` });
    return this.present(await this.load(id), { detail: true });
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

  /** Teams matching `q` for the create contract form: id, name, slug, country and owner name only. */
  async searchTeams(q: string) {
    const term = q.trim();
    const rows = await this.prisma.team.findMany({
      where: term
        ? {
            OR: [
              { id: term },
              { name: { contains: term, mode: 'insensitive' } },
              { slug: { contains: term, mode: 'insensitive' } },
              { members: { some: { role: 'owner', user: { OR: [{ name: { contains: term, mode: 'insensitive' } }, { email: { contains: term, mode: 'insensitive' } }] } } } },
            ],
          }
        : {},
      select: { id: true, name: true, slug: true, country: true, members: { where: { role: 'owner' }, select: { user: { select: { name: true } } }, take: 1 } },
      orderBy: { name: 'asc' },
      take: 20,
    });
    return { data: rows.map((t) => ({ id: t.id, name: t.name, slug: t.slug, country: t.country, ownerName: t.members[0]?.user.name ?? null })) };
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

  /** Staff: cancels a contract now. Billing stops today, access is revoked and a handover document is emailed to the owners. */
  async cancel(actor: Actor, id: string, reason?: string) {
    const c = await this.load(id);
    if (c.status === 'CANCELLED') throw ApiError.invalidState('The contract is already cancelled');
    if (!(await this.endContract(actor, c, { at: new Date(), reason: reason ?? null, via: 'staff' }))) throw ApiError.invalidState('The contract is already cancelled');
    return this.present(await this.load(id), { detail: true, staff: true });
  }

  /**
   * The one cancel path: CANCELLED with cancelledAt = `at` (billing proration stops there),
   * access revoked, onboarding workflow woken, handover document emailed to the owners.
   * Returns false when the contract was already cancelled (safe to call twice).
   */
  private async endContract(actor: Actor | null, c: ContractWithPlan, opts: { at: Date; reason: string | null; via: 'staff' | 'customer' | 'scheduled' | 'not_renewed' }) {
    const moved = await this.prisma.managedContract.updateMany({ where: { id: c.id, status: { not: 'CANCELLED' } }, data: { status: 'CANCELLED', cancelledAt: opts.at, cancelReason: opts.reason } });
    if (moved.count !== 1) return false;
    const revoked = await this.access.revoke(c.id, c.teamId);
    await this.events.emit('managed.contract_cancelled', { contractId: c.id, reason: opts.reason, from: c.status, assetsRevoked: revoked, via: opts.via, cancelledAt: opts.at.toISOString() }, { teamId: c.teamId, actor: actor ?? undefined, resource: `managed_contract:${c.id}` });
    await this.workflows.signal(ManagedWorkflows.onboardingId(c.id), 'checklistUpdated');
    const handover = await this.handoverDocument(c.id);
    await this.notify.toOwners(c.teamId, { subject: `Handover: your ${c.plan.name} managed cloud contract ended`, text: handover });
    return true;
  }

  /** Staff: extends the term from its current end (or today, when it already ended). */
  async renew(actor: Actor, id: string, termMonths?: number) {
    const c = await this.load(id);
    if (c.status !== 'ACTIVE' && c.status !== 'SUSPENDED') throw ApiError.invalidState(`Only an ACTIVE or SUSPENDED contract can be renewed (this one is ${c.status})`);
    const months = termMonths ?? c.termMonths;
    const now = new Date();
    const from = c.termEndsAt && c.termEndsAt > now ? new Date(c.termEndsAt) : now;
    from.setUTCMonth(from.getUTCMonth() + months);
    if (!(await this.extendTerm(actor, c, { termEndsAt: from, termMonths: months, auto: false }))) throw ApiError.invalidState('The contract changed while renewing; reload and try again');
    return this.present(await this.load(id), { detail: true, staff: true });
  }

  /**
   * Moves the term end to `termEndsAt`, stamps renewedAt and clears the reminder for the new
   * term. Only applies when the term end is still the one read, so a second run is a no-op.
   */
  private async extendTerm(actor: Actor | null, c: ContractWithPlan, next: { termEndsAt: Date; termMonths: number; auto: boolean }) {
    const now = new Date();
    const moved = await this.prisma.managedContract.updateMany({
      where: { id: c.id, status: { in: ['ACTIVE', 'SUSPENDED'] }, termEndsAt: c.termEndsAt },
      data: { termEndsAt: next.termEndsAt, renewedAt: now, termMonths: next.termMonths, renewalNoticeAt: null },
    });
    if (moved.count !== 1) return false;
    await this.events.emit('managed.contract_renewed', { contractId: c.id, termMonths: next.termMonths, termEndsAt: next.termEndsAt.toISOString(), auto: next.auto }, { teamId: c.teamId, actor: actor ?? undefined, resource: `managed_contract:${c.id}` });
    return true;
  }

  /**
   * Daily: renews contracts whose term ended (auto renewal on), cancels those that end (auto
   * renewal off, at the term end) or reached a scheduled cancellation (at cancelAt), and emails
   * the reminder 30 days before the term ends. Every step is idempotent. See termDecision.
   */
  async runRenewals(now = new Date()) {
    const out = { renewed: 0, cancelled: 0, notices: 0 };
    const due = await this.prisma.managedContract.findMany({
      where: { status: { in: ['ACTIVE', 'SUSPENDED'] }, OR: [{ termEndsAt: { lte: new Date(now.getTime() + 31 * dayMs) } }, { cancelAt: { lte: now } }] },
      include: { plan: true },
    });
    for (const c of due) {
      const d = termDecision(c, now);
      try {
        if (d.kind === 'renew') {
          if (await this.extendTerm(null, c, { termEndsAt: d.termEndsAt, termMonths: c.termMonths, auto: true })) out.renewed++;
        } else if (d.kind === 'cancel') {
          const reason = d.why === 'not_renewed' ? NOT_RENEWED_REASON : c.cancelReason ?? CUSTOMER_CANCEL_REASON;
          if (await this.endContract(null, c, { at: d.at, reason, via: d.why })) out.cancelled++;
        } else if (d.kind === 'notice') {
          if (await this.sendRenewalNotice(c, now)) out.notices++;
        }
      } catch (e) {
        this.log.error(`renewal job for contract ${c.id} (${d.kind}) failed: ${(e as Error).message}`);
      }
    }
    if (out.renewed || out.cancelled || out.notices) this.log.log(`managed renewals: ${out.renewed} renewed, ${out.cancelled} cancelled, ${out.notices} reminders`);
    return out;
  }

  /** The reminder 30 days before the term ends, sent once per term (renewalNoticeAt). */
  private async sendRenewalNotice(c: ContractWithPlan, now: Date) {
    const marked = await this.prisma.managedContract.updateMany({ where: { id: c.id, renewalNoticeAt: null, termEndsAt: c.termEndsAt }, data: { renewalNoticeAt: now } });
    if (marked.count !== 1 || !c.termEndsAt) return false;
    const terms = await this.terms.terms(c);
    const url = `${loadConfig().CONSOLE_URL}/managed/contract`;
    const on = day(c.termEndsAt);
    const mail = c.autoRenew
      ? {
          subject: `Your ${c.plan.name} managed cloud contract renews on ${on}`,
          text: `Your ${c.plan.name} managed cloud contract renews on ${on} for another ${c.termMonths} ${c.termMonths === 1 ? 'month' : 'months'}. The monthly fee is ${money(terms.monthlyFeeMinor, c.currency)}, excluding VAT. You do not need to do anything.\n\nIf you do not want to renew, turn off auto renewal in the console before ${on}. You can also cancel at any time. The contract then ends at the end of that month.\n\n${url}`,
        }
      : {
          subject: `Your ${c.plan.name} managed cloud contract ends on ${on}`,
          text: `Auto renewal is off, so your ${c.plan.name} managed cloud contract ends on ${on}. On that day we remove our access and email you a handover document. No fee is billed after that day.\n\nWant to keep the service? Turn auto renewal back on in the console before ${on}.\n\n${url}`,
        };
    await this.notify.toOwners(c.teamId, mail);
    await this.events.emit('managed.contract_renewal_notice', { contractId: c.id, termEndsAt: c.termEndsAt.toISOString(), autoRenew: c.autoRenew }, { teamId: c.teamId, resource: `managed_contract:${c.id}` });
    return true;
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
      autoRenew: c.autoRenew,
      cancelAt: c.cancelAt,
      renewalNoticeAt: c.renewalNoticeAt,
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

/** A date as the mails write it, e.g. October 1, 2026 (UTC). */
function day(d: Date) {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function money(minor: number | null, currency: string) {
  if (minor === null) return 'as agreed in your contract';
  return `${currency} ${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
