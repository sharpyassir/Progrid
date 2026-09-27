import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Currency } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { invoiceNumber, startOfMonth, taxRateFor } from './pricing';
import { MailService } from '../../common/mail/mail.service';
import { loadConfig } from '../../config/config';

/**
 * Monthly invoicing. SAR invoices for Saudi teams (ZATCA Fatoora e-invoicing handed off to a
 * licensed provider — integration point: `EInvoiceProvider`), USD for the rest.
 */
@Injectable()
export class InvoicesService {
  private readonly log = new Logger(InvoicesService.name);

  constructor(private readonly prisma: PrismaService, private readonly events: EventsService, private readonly mail: MailService) {}

  /**
   * Generates invoices for the month that just ended. Idempotent per team and period: the
   * unique index on (teamId, periodStart, periodEnd) rejects a second invoice. Each invoice is
   * numbered, charged against credit and linked to its usage in one transaction, and a
   * failure for one team is logged and does not stop the others.
   */
  async issueForPreviousMonth(now = new Date()) {
    const periodEnd = startOfMonth(now);
    const periodStart = startOfMonth(new Date(periodEnd.getTime() - 1));
    const teams = await this.prisma.team.findMany({ where: { status: { not: 'closed' } }, include: { projects: { select: { id: true } } } });
    let issued = 0;
    let failed = 0;
    for (const team of teams) {
      try {
        const invoice = await this.issueForTeam(team, periodStart, periodEnd, now);
        if (!invoice) continue;
        issued++;
        await this.events.emit('invoice.issued', { invoiceId: invoice.id, number: invoice.number, totalMinor: invoice.totalMinor, currency: team.currency }, { teamId: team.id });
        this.notify(team.id, invoice.number, invoice.totalMinor, team.currency, invoice.status === 'paid').catch((e) => this.log.warn(`invoice mail failed: ${e.message}`));
      } catch (err) {
        failed++;
        this.log.error(`invoice for team ${team.id} (${periodStart.toISOString().slice(0, 7)}) failed: ${(err as Error).message}`);
      }
    }
    this.log.log(`issued ${issued} invoices for ${periodStart.toISOString().slice(0, 7)}${failed ? `, ${failed} failed` : ''}`);
    return issued;
  }

  /** One team's invoice for one period, or null when there is nothing to bill or it already exists. */
  private async issueForTeam(team: { id: string; currency: Currency; country: string; projects: { id: string }[] }, periodStart: Date, periodEnd: Date, now: Date) {
    const existing = await this.prisma.invoice.findUnique({ where: { teamId_periodStart_periodEnd: { teamId: team.id, periodStart, periodEnd } } });
    if (existing) return null;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const records = await tx.usageRecord.findMany({
          where: { projectId: { in: team.projects.map((p) => p.id) }, hourStart: { gte: periodStart, lt: periodEnd }, invoiceId: null },
          select: { id: true, amountMinor: true },
        });
        const subtotal = records.reduce((s, r) => s + r.amountMinor, 0);
        if (subtotal <= 0) return null;

        const tax = Math.round(subtotal * taxRateFor(team.currency, team.country));
        const credit = await this.consumeCredits(tx, team.id, subtotal + tax, now);
        const total = subtotal + tax - credit;
        const [{ seq }] = await tx.$queryRaw<{ seq: bigint }[]>`SELECT nextval('invoice_number_seq') AS seq`;

        const invoice = await tx.invoice.create({
          data: {
            teamId: team.id,
            number: invoiceNumber(now.getUTCFullYear(), seq),
            currency: team.currency,
            periodStart,
            periodEnd,
            subtotalMinor: subtotal,
            taxMinor: tax,
            creditMinor: credit,
            totalMinor: total,
            status: total === 0 ? 'paid' : 'open',
            eInvoiceType: team.country === 'SA' ? 'zatca' : null,
            dueAt: new Date(periodEnd.getTime() + 14 * 86_400_000),
            paidAt: total === 0 ? now : null,
          },
        });
        // Only records nobody else has claimed; a mismatch means a concurrent run, so roll back.
        const linked = await tx.usageRecord.updateMany({ where: { id: { in: records.map((r) => r.id) }, invoiceId: null }, data: { invoiceId: invoice.id } });
        if (linked.count !== records.length) throw new Error(`usage records changed while invoicing (${linked.count} of ${records.length} linked)`);
        return invoice;
      }, { timeout: 60_000 });
    } catch (err) {
      // Another run issued this period first.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
      throw err;
    }
  }

  /** Applies promo/prepaid credits oldest-expiry first inside the invoice transaction; returns the amount consumed. */
  private async consumeCredits(tx: Prisma.TransactionClient, teamId: string, amountMinor: number, now: Date) {
    const credits = await tx.credit.findMany({
      where: { teamId, remainingMinor: { gt: 0 }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
    });
    let left = amountMinor;
    for (const c of credits) {
      if (left <= 0) break;
      const use = Math.min(c.remainingMinor, left);
      // Guarded decrement: if the balance moved under us, fail the whole invoice rather than overdraw.
      const r = await tx.credit.updateMany({ where: { id: c.id, remainingMinor: { gte: use } }, data: { remainingMinor: { decrement: use } } });
      if (r.count !== 1) throw new Error(`credit ${c.id} changed while invoicing`);
      left -= use;
    }
    return amountMinor - left;
  }

  list(teamId: string) {
    return this.prisma.invoice.findMany({ where: { teamId }, orderBy: { periodStart: 'desc' } });
  }

  async get(teamId: string, id: string) {
    return this.prisma.invoice.findFirst({ where: { id, teamId }, include: { records: true, payments: true } });
  }

  /** Full row for the PDF renderer. */
  getForPdf(teamId: string, id: string) {
    return this.prisma.invoice.findFirst({ where: { id, teamId }, include: { team: true, records: true } });
  }

  private async notify(teamId: string, number: string, totalMinor: number, currency: string, paid: boolean) {
    const owners = await this.prisma.teamMember.findMany({ where: { teamId, role: { in: ['owner', 'billing'] } }, include: { user: { select: { email: true, name: true } } } });
    const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(totalMinor / 100);
    const url = `${loadConfig().CONSOLE_URL}/billing`;
    await Promise.all(owners.map((m) => this.mail.send({
      to: m.user.email,
      subject: paid ? `Invoice ${number}: ${amount}, settled from credit` : `Invoice ${number}: ${amount} due in 14 days`,
      text: `Hi ${m.user.name},\n\nYour invoice ${number} for last month is ready: ${amount}.\n${paid ? 'It was settled from your prepaid credit; nothing to do.' : 'Pay it by card or add credit here:'}\n${url}\n\nThe PDF is available on the same page.`,
    })));
  }
}
