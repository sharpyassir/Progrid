import { Injectable, Logger } from '@nestjs/common';
import type { ContractorPayout, ContractorPayoutStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ApiError } from '../../../common/errors/api-error';
import type { Actor } from '../../../common/auth/actor';
import { loadConfig } from '../../../config/config';
import { periodBounds, periodKey } from '../../managed/managed.constants';
import { ManagedNotify } from '../../managed/managed-notify.service';
import { ManagedWorkflows } from '../../managed/managed-workflows.service';
import { OpsAudit } from '../ops-audit.service';
import { OpsSettingsService } from '../settings/ops-settings.service';
import type { OpsContext } from '../guards/ops-context';
import { computePayout } from './payout-math';
import { renderPayoutPdf, type StatementData } from './payout-pdf';

export const payoutWorkflowId = (period: string) => `ops-payout-${period}`;
const zoneOf = (calendar: string) => (calendar === 'TR' ? 'Europe/Istanbul' : 'Asia/Riyadh');

export function presentPayout(p: ContractorPayout & { engineer?: { user: { id: string; name: string } } }, staff = false) {
  return {
    id: p.id, engineerId: p.engineerId, userId: p.userId, engineer: p.engineer ? { id: p.engineer.user.id, name: p.engineer.user.name } : undefined, period: p.period, currency: p.currency,
    hourlyRateMinor: p.hourlyRateMinor, standbyFeeMinor: p.standbyFeeMinor, nightMultiplier: p.nightMultiplier, standbyShifts: p.standbyShifts, standbyMinor: p.standbyMinor,
    workedMinutes: p.workedMinutes, nightMinutes: p.nightMinutes, workMinor: p.workMinor, totalMinor: p.totalMinor, lines: p.lines, status: p.status,
    issuedAt: p.issuedAt, paidAt: p.paidAt, paidReference: p.paidReference, ...(staff ? { paidById: p.paidById } : {}), hasStatement: !!p.statement, generatedAt: p.generatedAt,
  };
}

/**
 * Monthly contractor payouts (spec 5.4). For each external engineer with a rate: APPROVED
 * worklogs not yet paid (the same rows customer overage is billed from) and completed shifts
 * (started and ended with a handover) of the month, the night window in each contract's local
 * time, a PDF statement. `opsPayoutRun` generates and issues them on the 3rd for the previous
 * month; full staff can regenerate drafts, issue, and mark them PAID with the transfer reference,
 * which marks the included worklogs PAID. Engineers see only their own issued and paid payouts.
 */
@Injectable()
export class PayoutsService {
  private readonly log = new Logger(PayoutsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: ManagedNotify,
    private readonly workflows: ManagedWorkflows,
    private readonly audit: OpsAudit,
    private readonly settings: OpsSettingsService,
  ) {}

  /** Generates (or regenerates) the DRAFT payouts of a month. Issued and paid payouts are never touched. */
  async generate(actor: Actor | null, period: string, engineerId?: string) {
    const { end } = periodBounds(period);
    const engineers = await this.prisma.engineerProfile.findMany({
      where: { kind: 'EXTERNAL', ...(engineerId ? { id: engineerId } : {}), OR: [{ hourlyRateMinor: { not: null } }, { standbyFeeMinor: { not: null } }] },
      include: { user: { select: { id: true, name: true } } },
    });
    const out: ReturnType<typeof presentPayout>[] = [];
    for (const e of engineers) {
      const p = await this.generateOne(e, period, end).catch((err) => {
        this.log.error(`payout for engineer ${e.id} (${period}): ${(err as Error).message}`);
        return null;
      });
      if (p) out.push(presentPayout(p, true));
    }
    await this.audit.emit('ops.payouts_generated', actor, { period, payouts: out.map((p) => p.id), engineers: out.length }, `payouts:${period}`);
    return { period, data: out };
  }

  private async generateOne(e: { id: string; userId: string; currency: 'USD' | 'SAR'; hourlyRateMinor: number | null; standbyFeeMinor: number | null; nightMultiplier: number; country: string; user: { id: string; name: string } }, period: string, end: Date) {
    const existing = await this.prisma.contractorPayout.findUnique({ where: { engineerId_period: { engineerId: e.id, period } } });
    if (existing && existing.status !== 'DRAFT') return existing;
    const s = await this.settings.get();
    return this.prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.workLog.updateMany({ where: { payoutId: existing.id }, data: { payoutId: null } });
        await tx.onCallShift.updateMany({ where: { payoutId: existing.id }, data: { payoutId: null } });
      }
      // Approved time up to the end of the month that no payout has included yet (late approvals roll into the next run).
      const logs = await tx.workLog.findMany({
        where: { userId: e.userId, status: 'APPROVED', payoutId: null, workedAt: { lt: end } },
        include: { contract: { select: { calendar: true, team: { select: { name: true } } } }, ticket: { select: { number: true } } },
        orderBy: { workedAt: 'asc' },
      });
      const shifts = await tx.onCallShift.findMany({ where: { userId: e.userId, startedAt: { not: null }, endedAt: { not: null }, payoutId: null, startsAt: { lt: end } }, orderBy: { startsAt: 'asc' } });
      if (!logs.length && !shifts.length) {
        if (existing) await tx.contractorPayout.delete({ where: { id: existing.id } });
        return null;
      }
      const rates = { hourlyRateMinor: e.hourlyRateMinor ?? 0, standbyFeeMinor: e.standbyFeeMinor ?? 0, nightMultiplier: e.nightMultiplier, nightStartHour: s.nightStartHour, nightEndHour: s.nightEndHour };
      const pay = computePayout(logs.map((l) => ({ id: l.id, startedAt: l.startedAt ?? l.workedAt, minutes: l.minutes, timeZone: zoneOf(l.contract.calendar) })), shifts.length, rates);
      const lines = {
        workLogs: pay.lines.map((l) => {
          const w = logs.find((x) => x.id === l.workLogId)!;
          return { workLogId: l.workLogId, contractId: w.contractId, customer: w.contract.team.name, ticketNumber: w.ticket?.number ?? null, maintenanceRunId: w.maintenanceRunId, startedAt: l.startedAt.toISOString(), minutes: l.minutes, nightMinutes: l.nightMinutes, amountMinor: l.amountMinor };
        }),
        shifts: shifts.map((x) => ({ shiftId: x.id, role: x.role, startsAt: x.startsAt.toISOString(), endsAt: (x.endedAt ?? x.endsAt).toISOString() })),
      };
      const data = {
        userId: e.userId, currency: e.currency, hourlyRateMinor: rates.hourlyRateMinor, standbyFeeMinor: rates.standbyFeeMinor, nightMultiplier: e.nightMultiplier,
        standbyShifts: pay.standbyShifts, standbyMinor: pay.standbyMinor, workedMinutes: pay.workedMinutes, nightMinutes: pay.nightMinutes, workMinor: pay.workMinor, totalMinor: pay.totalMinor,
        lines: lines as Prisma.InputJsonValue, generatedAt: new Date(),
      };
      const payout = existing
        ? await tx.contractorPayout.update({ where: { id: existing.id }, data })
        : await tx.contractorPayout.create({ data: { ...data, engineerId: e.id, period } });
      await tx.workLog.updateMany({ where: { id: { in: logs.map((l) => l.id) } }, data: { payoutId: payout.id } });
      await tx.onCallShift.updateMany({ where: { id: { in: shifts.map((x) => x.id) } }, data: { payoutId: payout.id } });
      const statement = await renderPayoutPdf(this.statementData(payout, e.user.name, e.country), new Date());
      return tx.contractorPayout.update({ where: { id: payout.id }, data: { statement: new Uint8Array(statement) } });
    }, { timeout: 60_000 });
  }

  /** The workflow's step on the 3rd: generate last month's drafts, issue them and mail the engineers. */
  async runMonthly(period: string) {
    const r = await this.generate(null, period);
    let issued = 0;
    for (const p of r.data) {
      if (p.status !== 'DRAFT') continue;
      await this.setStatus(null, p.id, { status: 'ISSUED' });
      issued++;
    }
    return { period, payouts: r.data.length, issued };
  }

  /** Starts the monthly run for the previous month (the job on the 3rd). */
  async startMonthly(now = new Date()) {
    const period = periodKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)));
    await this.workflows.start('opsPayoutRun', [{ period }], payoutWorkflowId(period));
    return period;
  }

  async adminList(q: { period?: string; status?: ContractorPayoutStatus; engineerId?: string }) {
    const rows = await this.prisma.contractorPayout.findMany({ where: { ...(q.period ? { period: q.period } : {}), ...(q.status ? { status: q.status } : {}), ...(q.engineerId ? { engineerId: q.engineerId } : {}) }, include: { engineer: { include: { user: { select: { id: true, name: true } } } } }, orderBy: [{ period: 'desc' }, { createdAt: 'asc' }] });
    return { data: rows.map((p) => presentPayout(p, true)) };
  }

  async adminGet(id: string) {
    return presentPayout(await this.load(id), true);
  }

  /** ISSUED sends the statement to the engineer; PAID needs the transfer reference and marks the included worklogs PAID. */
  async setStatus(actor: Actor | null, id: string, dto: { status: 'ISSUED' | 'PAID'; paidReference?: string; paidAt?: Date }) {
    const p = await this.load(id);
    const now = new Date();
    if (dto.status === 'ISSUED') {
      if (p.status !== 'DRAFT') throw ApiError.invalidState(`The payout is ${p.status.toLowerCase()}`);
      await this.prisma.contractorPayout.update({ where: { id }, data: { status: 'ISSUED', issuedAt: now } });
      const u = await this.prisma.user.findUnique({ where: { id: p.userId }, select: { email: true } });
      if (u) await this.notify.send({ to: u.email, subject: `Your Progrid statement for ${p.period}`, text: `Your statement for ${p.period} is ready: ${(p.totalMinor / 100).toFixed(2)} ${p.currency}.\n${loadConfig().PRGD_OPS_URL}/payouts` });
    } else {
      if (p.status === 'PAID') throw ApiError.invalidState('The payout is already paid');
      if (!dto.paidReference?.trim()) throw ApiError.invalid('paidReference (the bank transfer reference) is required');
      await this.prisma.$transaction([
        this.prisma.contractorPayout.update({ where: { id }, data: { status: 'PAID', issuedAt: p.issuedAt ?? now, paidAt: dto.paidAt ?? now, paidReference: dto.paidReference.trim(), paidById: actor?.userId ?? null } }),
        this.prisma.workLog.updateMany({ where: { payoutId: id, status: 'APPROVED' }, data: { status: 'PAID' } }),
      ]);
      const statement = await renderPayoutPdf(this.statementData({ ...p, status: 'PAID', paidReference: dto.paidReference.trim() }, p.engineer.user.name, p.engineer.country), now);
      await this.prisma.contractorPayout.update({ where: { id }, data: { statement: new Uint8Array(statement) } });
    }
    await this.audit.emit(dto.status === 'ISSUED' ? 'ops.payout_issued' : 'ops.payout_paid', actor, { payoutId: id, engineerId: p.engineerId, period: p.period, totalMinor: p.totalMinor, currency: p.currency, paidReference: dto.paidReference ?? null }, `contractor_payout:${id}`);
    return this.adminGet(id);
  }

  async statement(id: string) {
    const p = await this.prisma.contractorPayout.findUnique({ where: { id }, select: { statement: true, period: true, userId: true, status: true } });
    if (!p?.statement) throw ApiError.notFound('statement', id);
    return p;
  }

  // ---- engineer ----

  async mine(ops: OpsContext) {
    const rows = await this.prisma.contractorPayout.findMany({ where: { userId: ops.userId, status: { in: ['ISSUED', 'PAID'] } }, orderBy: { period: 'desc' } });
    return { data: rows.map((p) => presentPayout(p)) };
  }

  async myStatement(ops: OpsContext, id: string) {
    const p = await this.statement(id).catch(() => null);
    if (!p || p.userId !== ops.userId || p.status === 'DRAFT') throw ApiError.notFound('payout', id);
    return p;
  }

  // ---- helpers ----

  private async load(id: string) {
    const p = await this.prisma.contractorPayout.findUnique({ where: { id }, include: { engineer: { include: { user: { select: { id: true, name: true } } } } } });
    if (!p) throw ApiError.notFound('payout', id);
    return p;
  }

  private statementData(p: ContractorPayout, name: string, country: string): StatementData {
    const lines = (p.lines ?? {}) as { workLogs?: { customer: string; ticketNumber: number | null; maintenanceRunId: string | null; startedAt: string; minutes: number; nightMinutes: number; amountMinor: number }[]; shifts?: { startsAt: string; endsAt: string; role: string }[] };
    return {
      id: p.id, period: p.period, engineer: { name, country }, currency: p.currency, hourlyRateMinor: p.hourlyRateMinor, standbyFeeMinor: p.standbyFeeMinor, nightMultiplier: p.nightMultiplier,
      lines: (lines.workLogs ?? []).map((l) => ({ customer: l.customer, ticket: l.ticketNumber ? `#${l.ticketNumber}` : 'maintenance', startedAt: l.startedAt, minutes: l.minutes, nightMinutes: l.nightMinutes, amountMinor: l.amountMinor })),
      shifts: lines.shifts ?? [], standbyMinor: p.standbyMinor, workedMinutes: p.workedMinutes, nightMinutes: p.nightMinutes, workMinor: p.workMinor, totalMinor: p.totalMinor, status: p.status, paidReference: p.paidReference,
    };
  }
}
