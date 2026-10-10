import { Injectable, Logger } from '@nestjs/common';
import { nextDocumentNumber } from './sequences';
import { Prisma, type BillingEntity, type CreditKind, type Currency } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { startOfMonth } from './pricing';
import { MailService } from '../../common/mail/mail.service';
import { BILLING_ENTITY, entityInvoiceNumber, entityProfile, vatFor } from '../../common/entities/entities';
import { linkManagedWorkLogs } from '../managed/billing-hooks/link-worklogs';
import { billingAt, type TeamBilling } from './entity-change';
import { CommissionService } from '../affiliates/commission.service';
import { discountFor } from '../affiliates/commission-rules';
import { FxService } from './fx.service';
import { sarFigures } from './sar';

/**
 * Monthly invoicing by Progrid Arabia (common/entities/entities.ts), in the PRGD-SA series, every
 * invoice handed to the ZATCA (Fatoora) e-invoicing provider. The team's billing country decides
 * currency and VAT: Saudi Arabia pays SAR with 15% VAT; everyone else USD at 0%, a zero-rated
 * export of services with the note on the invoice (to be confirmed by the tax advisor). Every
 * invoice also carries its subtotal, VAT and total in SAR with the exchange rate used.
 */
@Injectable()
export class InvoicesService {
  private readonly log = new Logger(InvoicesService.name);

  constructor(private readonly prisma: PrismaService, private readonly events: EventsService, private readonly mail: MailService, private readonly commissions: CommissionService, private readonly fx: FxService) {}

  /**
   * Generates invoices for the month that just ended. Idempotent per team and period: the
   * unique index on (teamId, periodStart, periodEnd) rejects a second invoice. Each invoice is
   * numbered, charged against credit and linked to its usage in one transaction, and a
   * failure for one team is logged and does not stop the others.
   */
  async issueForPreviousMonth(now = new Date()) {
    const periodEnd = startOfMonth(now);
    const periodStart = startOfMonth(new Date(periodEnd.getTime() - 1));
    // Teams closed during the period still get their final invoice.
    const teams = await this.prisma.team.findMany({ where: { OR: [{ status: { not: 'closed' } }, { closedAt: { gte: periodStart } }] }, include: { projects: { select: { id: true } } } });
    let issued = 0;
    let failed = 0;
    for (const team of teams) {
      try {
        const invoice = await this.issueForTeam(team, periodStart, periodEnd, now);
        if (!invoice) continue;
        issued++;
        await this.events.emit('invoice.issued', { invoiceId: invoice.id, number: invoice.number, totalMinor: invoice.totalMinor, currency: invoice.currency, billingEntity: invoice.billingEntity }, { teamId: team.id });
        this.notify(team.id, invoice.number, invoice.totalMinor, invoice.currency, invoice.status === 'paid', invoice.billingEntity).catch((e) => this.log.warn(`invoice mail failed: ${e.message}`));
        // Settled in full from prepaid credit at issue: affiliate commission is earned now.
        if (invoice.status === 'paid') await this.commissions.onInvoicePaid(invoice.id);
      } catch (err) {
        failed++;
        this.log.error(`invoice for team ${team.id} (${periodStart.toISOString().slice(0, 7)}) failed: ${(err as Error).message}`);
      }
    }
    this.log.log(`issued ${issued} invoices for ${periodStart.toISOString().slice(0, 7)}${failed ? `, ${failed} failed` : ''}`);
    // Currency changes due for the period that starts now: the old period is invoiced above.
    await this.applyDueEntityChanges(now);
    return issued;
  }

  /**
   * Folds scheduled billing country and currency changes whose date has come into the team row
   * (the name is kept from the two company era). Usage was already rated in the new currency from
   * that date (billingAt), so this only makes the row say so.
   */
  async applyDueEntityChanges(now = new Date()) {
    const due = await this.prisma.team.findMany({ where: { billingChangeAt: { lte: now }, OR: [{ pendingCurrency: { not: null } }, { pendingCountry: { not: null } }] } });
    for (const t of due) {
      const next = billingAt(t, now);
      const r = await this.prisma.team.updateMany({
        where: { id: t.id, billingChangeAt: t.billingChangeAt },
        data: { country: next.country, billingEntity: next.entity, currency: next.currency, pendingCountry: null, pendingCurrency: null, billingChangeAt: null },
      });
      if (r.count) await this.events.emit('team.billing_currency_changed', { from: { country: t.country, currency: t.currency }, to: { country: next.country, currency: next.currency }, effectiveAt: t.billingChangeAt }, { teamId: t.id, resource: `team:${t.id}` });
    }
    return due.length;
  }

  /** One team's invoice for one period, or null when there is nothing to bill or it already exists. */
  private async issueForTeam(team: TeamBilling & { id: string; projects: { id: string }[] }, periodStart: Date, periodEnd: Date, now: Date) {
    // The country and currency in force for this period (a change scheduled later starts after it).
    const billing = billingAt(team, periodStart);
    const entity = entityProfile(BILLING_ENTITY);
    const vat = vatFor(billing.country);
    const existing = await this.prisma.invoice.findUnique({ where: { teamId_periodStart_periodEnd: { teamId: team.id, periodStart, periodEnd } } });
    if (existing) return null;
    // SAR per unit of the invoice currency at issue (ZATCA: the VAT amount in SAR on foreign currency invoices).
    const fxRateSar = billing.currency === 'SAR' ? 1 : await this.fx.rate('SAR', now);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const records = await tx.usageRecord.findMany({
          where: { projectId: { in: team.projects.map((p) => p.id) }, hourStart: { gte: periodStart, lt: periodEnd }, invoiceId: null },
          select: { id: true, amountMinor: true, currency: true },
        });
        // One invoice is one currency. Usage rated in another one means the team's billing changed
        // without the period boundary rule; a person must look before anything is issued.
        const foreign = records.find((r) => r.currency !== billing.currency);
        if (foreign) throw new Error(`usage in ${foreign.currency} for a ${billing.currency} invoice; fix the team's billing currency first`);
        const usage = records.reduce((s, r) => s + r.amountMinor, 0);
        if (usage <= 0) return null;
        // A partner promo code takes a percentage off the usage before tax, for its first months (docs/affiliates.md).
        const discount = discountFor(usage, await tx.referral.findUnique({ where: { teamId: team.id }, select: { status: true, discountPercent: true, discountUntil: true } }), periodStart);
        const subtotal = usage - discount;

        const tax = Math.round(subtotal * vat.rate);
        const uses = await this.consumeCredits(tx, team.id, billing.currency, subtotal + tax, now);
        const credit = uses.reduce((s, u) => s + u.amountMinor, 0);
        const total = subtotal + tax - credit;
        // The sequence name comes from the fixed entity profile, never from input.
        const seq = await nextDocumentNumber(tx, entity.invoiceSequence);

        const invoice = await tx.invoice.create({
          data: {
            teamId: team.id,
            number: entityInvoiceNumber(BILLING_ENTITY, now.getUTCFullYear(), seq),
            billingEntity: BILLING_ENTITY,
            currency: billing.currency,
            periodStart,
            periodEnd,
            subtotalMinor: subtotal,
            discountMinor: discount,
            taxMinor: tax,
            creditMinor: credit,
            totalMinor: total,
            status: total === 0 ? 'paid' : 'open',
            // Every invoice goes to the ZATCA (Fatoora) e-invoicing provider.
            eInvoiceType: entity.eInvoicing,
            vatCategory: vat.category,
            taxNote: vat.note,
            ...sarFigures(fxRateSar, { subtotalMinor: subtotal, taxMinor: tax, totalMinor: total }),
            dueAt: new Date(periodEnd.getTime() + 14 * 86_400_000),
            paidAt: total === 0 ? now : null,
          },
        });
        // Only records nobody else has claimed; a mismatch means a concurrent run, so roll back.
        const linked = await tx.usageRecord.updateMany({ where: { id: { in: records.map((r) => r.id) }, invoiceId: null }, data: { invoiceId: invoice.id } });
        if (linked.count !== records.length) throw new Error(`usage records changed while invoicing (${linked.count} of ${records.length} linked)`);
        // Which credit paid what: affiliate commission counts prepaid credit but not promo, goodwill or refund credit.
        if (uses.length) await tx.creditApplication.createMany({ data: uses.map((u) => ({ ...u, invoiceId: invoice.id, currency: billing.currency })) });
        // Managed cloud: the worklogs counted for the managed lines on this invoice point at it.
        await linkManagedWorkLogs(tx, invoice.id);
        return invoice;
      }, { timeout: 60_000 });
    } catch (err) {
      // Another run issued this period first.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
      throw err;
    }
  }

  /** Applies promo/prepaid credits oldest-expiry first inside the invoice transaction; returns what each credit gave. */
  private async consumeCredits(tx: Prisma.TransactionClient, teamId: string, currency: Currency, amountMinor: number, now: Date) {
    // Credit in another currency (from before a billing entity change) is not spent here.
    const credits = await tx.credit.findMany({
      where: { teamId, currency, remainingMinor: { gt: 0 }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
    });
    let left = amountMinor;
    const uses: { creditId: string; kind: CreditKind; amountMinor: number }[] = [];
    for (const c of credits) {
      if (left <= 0) break;
      const use = Math.min(c.remainingMinor, left);
      // Guarded decrement: if the balance moved under us, fail the whole invoice rather than overdraw.
      const r = await tx.credit.updateMany({ where: { id: c.id, remainingMinor: { gte: use } }, data: { remainingMinor: { decrement: use } } });
      if (r.count !== 1) throw new Error(`credit ${c.id} changed while invoicing`);
      left -= use;
      uses.push({ creditId: c.id, kind: c.kind, amountMinor: use });
    }
    return uses;
  }

  list(teamId: string) {
    return this.prisma.invoice.findMany({ where: { teamId }, orderBy: { periodStart: 'desc' }, include: { creditNotes: { select: { id: true, number: true, amountMinor: true, reason: true, createdAt: true } } } });
  }

  async get(teamId: string, id: string) {
    return this.prisma.invoice.findFirst({ where: { id, teamId }, include: { records: true, payments: true, creditNotes: true } });
  }

  /** Full row for the PDF renderer. */
  getForPdf(teamId: string, id: string) {
    return this.prisma.invoice.findFirst({ where: { id, teamId }, include: { team: true, records: true } });
  }

  private async notify(teamId: string, number: string, totalMinor: number, currency: string, paid: boolean, billingEntity: BillingEntity) {
    const owners = await this.prisma.teamMember.findMany({ where: { teamId, role: { in: ['owner', 'billing'] } }, include: { user: { select: { email: true, name: true } } } });
    const team = await this.prisma.team.findUnique({ where: { id: teamId }, select: { billingEmail: true } });
    if (team?.billingEmail && !owners.some((m) => m.user.email === team.billingEmail)) owners.push({ user: { email: team.billingEmail, name: 'there' } } as (typeof owners)[number]);
    const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(totalMinor / 100);
    const url = `${entityProfile(billingEntity).consoleUrl}/billing`;
    await Promise.all(owners.map((m) => this.mail.send({
      to: m.user.email,
      entity: billingEntity,
      subject: paid ? `Invoice ${number}: ${amount}, settled from credit` : `Invoice ${number}: ${amount} due in 14 days`,
      text: `Hi ${m.user.name},\n\nYour invoice ${number} for last month is ready: ${amount}.\n${paid ? 'It was settled from your prepaid credit; nothing to do.' : 'Pay it by card or add credit here:'}\n${url}\n\nThe PDF is available on the same page.`,
    })));
  }
}
