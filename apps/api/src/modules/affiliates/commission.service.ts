import { Injectable, Logger } from '@nestjs/common';
import type { AffiliateCommission } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EventsService } from '../events/events.service';
import { AffiliateSettingsService } from './settings';
import { AttributionService } from './attribution.service';
import { computeCommissions, reversalFor } from './commission-rules';

/** Paid invoices older than this are not looked at by the catch up job. */
const CATCH_UP_DAYS = 90;
/** Reversal rate is only judged once an affiliate has this many commissions. */
const REFUND_FLAG_MIN_COMMISSIONS = 3;
const NON_CASH = ['promo', 'goodwill', 'refund'] as const;

/**
 * The commission engine (docs/affiliates.md).
 *
 *  - earn:    when a referred team's invoice is paid, one row per product category, pending
 *             until the hold period ends. Called right after the payment and by a catch up job.
 *  - approve: a daily job turns pending into approved once the hold is over.
 *  - reverse: refunds, credit notes and chargebacks take back the same share of the commission;
 *             commission already paid out comes back as a negative clawback row that the next
 *             payout deducts.
 */
@Injectable()
export class CommissionService {
  private readonly log = new Logger(CommissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AffiliateSettingsService,
    private readonly events: EventsService,
    private readonly attribution: AttributionService,
  ) {}

  /** Never throws: billing must not fail because of affiliate bookkeeping. The catch up job retries. */
  async onInvoicePaid(invoiceId: string | null | undefined) {
    if (!invoiceId) return;
    try {
      await this.earn(invoiceId);
    } catch (err) {
      this.log.error(`commission for invoice ${invoiceId} failed: ${(err as Error).message}`);
    }
  }

  /** Works out commission for one paid invoice, once. Returns the rows created. */
  async earn(invoiceId: string, now = new Date()): Promise<AffiliateCommission[]> {
    const inv = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        records: { select: { resourceType: true, amountMinor: true } },
        creditApplications: { select: { kind: true, amountMinor: true } },
        payments: { select: { refundedMinor: true } },
        team: { select: { referral: { include: { affiliate: { select: { id: true, userId: true, status: true } } } } } },
      },
    });
    if (!inv || inv.status !== 'paid' || inv.affiliateCheckedAt) return [];
    const ref = inv.team.referral;
    const mark = () => this.prisma.invoice.updateMany({ where: { id: inv.id, affiliateCheckedAt: null }, data: { affiliateCheckedAt: now } });
    // Not referred, blocked, outside the commission months, or the affiliate is not active.
    if (!ref || ref.status !== 'active' || inv.periodStart >= ref.commissionUntil || ref.affiliate.status !== 'approved') {
      await mark();
      return [];
    }
    // The affiliate's own card paying for the customer is self referral.
    if (await this.sameCard(inv.teamId, ref.affiliate.userId)) {
      await this.blockReferral(ref.id, ref.affiliateId, inv.teamId, 'self_referral:same_card');
      await mark();
      return [];
    }

    const s = await this.settings.get();
    // Free credit, credit notes against what was due, and anything refunded before this ran.
    const nonCash = inv.creditApplications.filter((c) => (NON_CASH as readonly string[]).includes(c.kind)).reduce((t, c) => t + c.amountMinor, 0) + inv.creditedMinor + inv.payments.reduce((t, p) => t + p.refundedMinor, 0);
    const lines = computeCommissions({ lines: inv.records, discountMinor: inv.discountMinor, taxMinor: inv.taxMinor, nonCashMinor: nonCash }, s.rates);
    const paidAt = inv.paidAt ?? now;
    const holdUntil = new Date(paidAt.getTime() + s.holdDays * 86_400_000);
    const created = await this.prisma.$transaction(async (tx) => {
      // Claim the invoice first so a concurrent run (payment hook and catch up job) does nothing.
      const claimed = await tx.invoice.updateMany({ where: { id: inv.id, affiliateCheckedAt: null }, data: { affiliateCheckedAt: now } });
      if (!claimed.count) return [];
      return Promise.all(lines.map((l) => tx.affiliateCommission.create({
        data: { affiliateId: ref.affiliateId, referralId: ref.id, invoiceId: inv.id, currency: inv.currency, holdUntil, ...l },
      })));
    });
    if (created.length) {
      await this.events.emit('affiliate.commission_earned', { affiliateId: ref.affiliateId, invoiceId: inv.id, currency: inv.currency, amountMinor: created.reduce((t, c) => t + c.amountMinor, 0) }, { resource: `affiliate:${ref.affiliateId}` });
    }
    return created;
  }

  /** Catch up: paid invoices of referred teams that were not looked at yet (a missed hook, a restart). */
  async earnPending(now = new Date()) {
    const since = new Date(now.getTime() - CATCH_UP_DAYS * 86_400_000);
    const due = await this.prisma.invoice.findMany({
      where: { status: 'paid', affiliateCheckedAt: null, paidAt: { gte: since }, team: { referral: { isNot: null } } },
      select: { id: true },
      take: 500,
    });
    let n = 0;
    for (const { id } of due) {
      try { n += (await this.earn(id, now)).length; } catch (err) { this.log.error(`commission for invoice ${id} failed: ${(err as Error).message}`); }
    }
    return n;
  }

  /** Pending commission whose hold is over becomes approved (payable). Suspended affiliates wait. */
  async approveDue(now = new Date()) {
    const r = await this.prisma.affiliateCommission.updateMany({
      where: { status: 'pending', holdUntil: { lte: now }, affiliate: { status: 'approved' }, invoice: { status: 'paid' } },
      data: { status: 'approved', approvedAt: now },
    });
    if (r.count) this.log.log(`approved ${r.count} affiliate commissions`);
    return r.count;
  }

  /** A card refund on an invoice: the refunded share of the invoice comes off its commission. */
  async onRefund(invoiceId: string | null | undefined, amountMinor: number, reason: string) {
    if (!invoiceId) return;
    await this.safe(() => this.reverseShare(invoiceId, amountMinor, reason), invoiceId);
  }

  /** A credit note on an invoice that already earned commission. */
  async onCreditNote(invoiceId: string, amountMinor: number, reason: string) {
    await this.safe(() => this.reverseShare(invoiceId, amountMinor, reason), invoiceId);
  }

  /** A chargeback or dispute on a payment: all commission of its invoice is reversed and the affiliate flagged. */
  async onChargeback(paymentId: string) {
    const p = await this.prisma.payment.findUnique({ where: { id: paymentId }, select: { invoiceId: true } });
    if (!p?.invoiceId) return 0;
    const invoiceId = p.invoiceId;
    return this.safe(async () => {
      const n = await this.reverse(invoiceId, 1, `chargeback on payment ${paymentId}`);
      const c = await this.prisma.affiliateCommission.findFirst({ where: { invoiceId }, select: { affiliateId: true } });
      if (c) await this.attribution.flag(c.affiliateId, 'chargeback', { invoiceId, paymentId });
      return n;
    }, invoiceId);
  }

  private async safe<T>(fn: () => Promise<T>, invoiceId: string): Promise<T | 0> {
    try { return await fn(); } catch (err) { this.log.error(`commission reversal for invoice ${invoiceId} failed: ${(err as Error).message}`); return 0; }
  }

  private async reverseShare(invoiceId: string, amountMinor: number, reason: string) {
    const inv = await this.prisma.invoice.findUnique({ where: { id: invoiceId }, select: { subtotalMinor: true, taxMinor: true } });
    const gross = inv ? inv.subtotalMinor + inv.taxMinor : 0;
    if (!gross || amountMinor <= 0) return 0;
    return this.reverse(invoiceId, amountMinor / gross, reason);
  }

  /**
   * Takes back `fraction` of each commission on an invoice. Commission not yet paid out is
   * reduced in place (reversed once nothing is left); commission paid out, or already in a
   * payout request, gets a negative clawback row that the next payout deducts.
   */
  async reverse(invoiceId: string, fraction: number, reason: string) {
    const now = new Date();
    const rows = await this.prisma.affiliateCommission.findMany({ where: { invoiceId, status: { not: 'reversed' }, amountMinor: { gt: 0 } } });
    let total = 0;
    for (const c of rows) {
      const take = reversalFor(c, fraction);
      if (take <= 0) continue;
      total += take;
      const fully = c.reversedMinor + take >= c.amountMinor;
      if (c.status === 'paid' || c.payoutId) {
        await this.prisma.$transaction(async (tx) => {
          await tx.affiliateCommission.update({ where: { id: c.id }, data: { reversedMinor: { increment: take }, reversedAt: now, reversalReason: reason } });
          const n = await tx.affiliateCommission.count({ where: { invoiceId, category: { startsWith: `${c.category}:clawback:` } } });
          await tx.affiliateCommission.create({
            data: { affiliateId: c.affiliateId, referralId: c.referralId, invoiceId, category: `${c.category}:clawback:${n + 1}`, currency: c.currency, baseMinor: 0, rateBp: c.rateBp, amountMinor: -take, status: 'approved', holdUntil: now, approvedAt: now, reversalReason: reason },
          });
        });
      } else {
        await this.prisma.affiliateCommission.update({
          where: { id: c.id },
          data: { reversedMinor: { increment: take }, reversedAt: now, reversalReason: reason, ...(fully ? { status: 'reversed' } : {}) },
        });
      }
    }
    if (total > 0 && rows[0]) {
      await this.events.emit('affiliate.commission_reversed', { affiliateId: rows[0].affiliateId, invoiceId, amountMinor: total, currency: rows[0].currency, reason }, { resource: `affiliate:${rows[0].affiliateId}` });
      await this.checkRefundRate(rows[0].affiliateId);
    }
    return total;
  }

  /** Reversed share of everything earned above the configured rate: flag for review. */
  private async checkRefundRate(affiliateId: string) {
    const s = await this.settings.get();
    const rows = await this.prisma.affiliateCommission.findMany({ where: { affiliateId, amountMinor: { gt: 0 } }, select: { amountMinor: true, reversedMinor: true } });
    if (rows.length < REFUND_FLAG_MIN_COMMISSIONS) return;
    const earned = rows.reduce((t, r) => t + r.amountMinor, 0);
    const reversed = rows.reduce((t, r) => t + r.reversedMinor, 0);
    if (!earned || (reversed * 100) / earned < s.flagRefundRatePercent) return;
    const open = await this.prisma.affiliateFlag.findFirst({ where: { affiliateId, kind: 'high_refund_rate', resolvedAt: null } });
    if (!open) await this.attribution.flag(affiliateId, 'high_refund_rate', { reversedPercent: Math.round((reversed * 1000) / earned) / 10 });
  }

  /** Has a card used by the customer team also paid for a team the affiliate belongs to? */
  private async sameCard(teamId: string, affiliateUserId: string) {
    const mine = await this.prisma.payment.findMany({ where: { teamId, cardFingerprint: { not: null } }, select: { cardFingerprint: true }, distinct: ['cardFingerprint'] });
    if (!mine.length) return false;
    const hit = await this.prisma.payment.findFirst({
      where: { cardFingerprint: { in: mine.map((m) => m.cardFingerprint!) }, teamId: { not: teamId }, team: { members: { some: { userId: affiliateUserId } } } },
      select: { id: true },
    });
    return !!hit;
  }

  private async blockReferral(referralId: string, affiliateId: string, teamId: string, reason: string) {
    await this.prisma.referral.update({ where: { id: referralId }, data: { status: 'blocked', blockedReason: reason, discountPercent: 0, discountUntil: null } });
    // Earlier invoices of the same customer lose their commission too.
    const earlier = await this.prisma.affiliateCommission.findMany({ where: { referralId, status: { not: 'reversed' }, amountMinor: { gt: 0 } }, select: { invoiceId: true }, distinct: ['invoiceId'] });
    for (const e of earlier) await this.reverse(e.invoiceId, 1, reason);
    await this.attribution.flag(affiliateId, 'self_referral', { teamId, reason });
    await this.events.emit('affiliate.referral_blocked', { referralId, affiliateId, teamId, reason }, { resource: `referral:${referralId}` });
  }
}

