import { Injectable, Logger } from '@nestjs/common';
import type { ManagedContract, ManagedPlan } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { EventsService } from '../../events/events.service';
import { startOfMonth } from '../../billing/pricing';
import { ContractTermsService } from '../contracts/contract-terms.service';

type ContractWithPlan = ManagedContract & { plan: ManagedPlan; team: { id: string; currency: ManagedContract['currency'] } };

interface Interval { from: number; to: number }

/** Seconds of [from, to) that fall inside `period` and outside every suspension. Pure, for tests. */
export function billableFraction(period: { start: Date; end: Date }, active: { from: Date; to: Date | null }, suspensions: { from: Date; to: Date | null }[]) {
  const ps = period.start.getTime();
  const pe = period.end.getTime();
  const clip = (i: Interval): Interval | null => {
    const from = Math.max(ps, i.from);
    const to = Math.min(pe, i.to);
    return to > from ? { from, to } : null;
  };
  const base = clip({ from: active.from.getTime(), to: active.to?.getTime() ?? pe });
  if (!base) return 0;
  // Subtract suspension windows (merged, clipped to the active interval).
  const cuts = suspensions
    .map((s) => ({ from: Math.max(base.from, s.from.getTime()), to: Math.min(base.to, s.to?.getTime() ?? pe) }))
    .filter((s) => s.to > s.from)
    .sort((a, b) => a.from - b.from);
  let billed = base.to - base.from;
  let cursor = base.from;
  for (const c of cuts) {
    const from = Math.max(c.from, cursor);
    if (c.to > from) {
      billed -= c.to - from;
      cursor = c.to;
    }
  }
  return Math.max(0, billed) / (pe - ps);
}

/**
 * Billing hooks. Runs at month end, before the invoice run, and writes usage records the
 * invoice builder picks up like any other usage, on the team's oldest project:
 *
 *   managed_plan     the monthly fee, prorated by the time the contract was ACTIVE in the month:
 *                    from activation (first month), minus suspensions, up to cancellation.
 *   managed_overage  billable engineer minutes beyond the included minutes, at the hourly rate.
 *
 * Both are keyed by (contract, month) so re-running the hook is safe; a month that is already
 * invoiced is never touched. Worklogs counted for a month get `billedPeriod`, and the invoice
 * run then stamps them with `billedInvoiceId`. Amounts are in the contract currency (the
 * team's invoice currency); VAT is added by the invoice.
 */
@Injectable()
export class ManagedBillingService {
  private readonly log = new Logger(ManagedBillingService.name);
  constructor(private readonly prisma: PrismaService, private readonly terms: ContractTermsService, private readonly events: EventsService) {}

  async accruePreviousMonth(now = new Date()) {
    const end = startOfMonth(now);
    const start = startOfMonth(new Date(end.getTime() - 1));
    return this.accrue(start, end);
  }

  async accrue(start: Date, end: Date) {
    const contracts = await this.prisma.managedContract.findMany({
      where: { activatedAt: { lt: end }, OR: [{ cancelledAt: null }, { cancelledAt: { gt: start } }] },
      include: { plan: true, team: { select: { id: true, currency: true } } },
    });
    const out = { contracts: contracts.length, planLines: 0, overageLines: 0, skipped: 0 };
    for (const c of contracts) {
      try {
        const r = await this.accrueContract(c, start, end);
        if (r === 'skipped') out.skipped++;
        else {
          if (r.planMinor > 0) out.planLines++;
          if (r.overageMinor > 0) out.overageLines++;
        }
      } catch (e) {
        this.log.error(`managed billing for contract ${c.id} (${start.toISOString().slice(0, 7)}) failed: ${(e as Error).message}`);
      }
    }
    this.log.log(`managed billing ${start.toISOString().slice(0, 7)}: ${out.planLines} plan lines, ${out.overageLines} overage lines`);
    return out;
  }

  async accrueContract(c: ContractWithPlan, start: Date, end: Date): Promise<'skipped' | { planMinor: number; overageMinor: number; overageMinutes: number; fraction: number }> {
    const project = await this.prisma.project.findFirst({ where: { teamId: c.teamId }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!project) {
      this.log.warn(`contract ${c.id}: the team has no project to bill against`);
      return 'skipped';
    }
    const existing = await this.prisma.usageRecord.findMany({ where: { resourceType: { in: ['managed_plan', 'managed_overage'] }, resourceId: c.id, hourStart: start } });
    if (existing.some((r) => r.invoiceId)) return 'skipped';

    const terms = await this.terms.terms(c, end);
    const currency = c.team.currency;
    const toInvoice = (minor: number) => this.terms.convert(minor, c.currency, currency, end);

    // Plan fee for the time the contract was ACTIVE in the month.
    const suspensions: { from: Date; to: Date | null }[] = ((c.suspensions as { from: string; to: string }[] | null) ?? []).map((s) => ({ from: new Date(s.from), to: new Date(s.to) }));
    if (c.suspendedAt) suspensions.push({ from: c.suspendedAt, to: null });
    const fraction = billableFraction({ start, end }, { from: c.activatedAt!, to: c.cancelledAt }, suspensions);
    const planMinor = terms.monthlyFeeMinor ? await toInvoice(Math.round(terms.monthlyFeeMinor * fraction)) : 0;

    // Overage: billable minutes counted for this month (and late entries for earlier months).
    const logs = await this.prisma.workLog.findMany({ where: { contractId: c.id, billable: true, billedInvoiceId: null, workedAt: { lt: end }, OR: [{ billedPeriod: null }, { billedPeriod: start }] }, select: { id: true, minutes: true } });
    const minutes = logs.reduce((s, l) => s + l.minutes, 0);
    const overageMinutes = Math.max(0, minutes - terms.includedEngineerMinutes);
    const overageMinor = await toInvoice(Math.round((overageMinutes / 60) * terms.hourlyRateMinor));

    await this.prisma.$transaction(async (tx) => {
      const upsert = async (resourceType: 'managed_plan' | 'managed_overage', amountMinor: number, quantity: number, unit: string) => {
        const key = { resourceType_resourceId_hourStart: { resourceType, resourceId: c.id, hourStart: start } };
        if (amountMinor <= 0) {
          await tx.usageRecord.deleteMany({ where: { resourceType, resourceId: c.id, hourStart: start, invoiceId: null } });
          return;
        }
        await tx.usageRecord.upsert({ where: key, create: { projectId: project.id, resourceType, resourceId: c.id, hourStart: start, quantity, unit, amountMinor, currency }, update: { quantity, amountMinor, currency, projectId: project.id } });
      };
      await upsert('managed_plan', planMinor, Math.round(fraction * 10_000) / 10_000, 'month');
      await upsert('managed_overage', overageMinor, Math.round((overageMinutes / 60) * 100) / 100, 'hour');
      if (logs.length) await tx.workLog.updateMany({ where: { id: { in: logs.map((l) => l.id) } }, data: { billedPeriod: start } });
    });
    await this.events.emit('managed.billing_accrued', { contractId: c.id, period: start.toISOString().slice(0, 7), fraction, planMinor, billableMinutes: minutes, includedMinutes: terms.includedEngineerMinutes, overageMinutes, overageMinor, currency }, { teamId: c.teamId, resource: `managed_contract:${c.id}` });
    return { planMinor, overageMinor, overageMinutes, fraction };
  }

  /** Engineer time and the running bill for a month, for the back office and the contract page. */
  async usage(contractId: string, start: Date, end: Date) {
    const c = await this.prisma.managedContract.findUniqueOrThrow({ where: { id: contractId }, include: { plan: true } });
    const terms = await this.terms.terms(c, end);
    const agg = await this.prisma.workLog.groupBy({ by: ['billable'], where: { contractId, workedAt: { gte: start, lt: end } }, _sum: { minutes: true } });
    const billable = agg.find((a) => a.billable)?._sum.minutes ?? 0;
    const overageMinutes = Math.max(0, billable - terms.includedEngineerMinutes);
    const lines = await this.prisma.usageRecord.findMany({ where: { resourceType: { in: ['managed_plan', 'managed_overage'] }, resourceId: contractId, hourStart: start }, select: { resourceType: true, amountMinor: true, currency: true, quantity: true, invoiceId: true } });
    return {
      period: start.toISOString().slice(0, 7), currency: terms.currency, monthlyFeeMinor: terms.monthlyFeeMinor, hourlyRateMinor: terms.hourlyRateMinor,
      includedMinutes: terms.includedEngineerMinutes, billableMinutes: billable, nonBillableMinutes: agg.find((a) => !a.billable)?._sum.minutes ?? 0,
      overageMinutes, estimatedOverageMinor: Math.round((overageMinutes / 60) * terms.hourlyRateMinor), lines,
    };
  }
}
