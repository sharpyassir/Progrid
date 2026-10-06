import { Injectable, Logger } from '@nestjs/common';
import { nextDocumentNumber } from './sequences';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiError } from '../../common/errors/api-error';
import type { Actor } from '../../common/auth/actor';
import { EventsService } from '../events/events.service';
import { PaymentsService } from './payments/payments.service';
import { entityCreditNoteNumber, entityProfile } from '../../common/entities/entities';
import { CommissionService } from '../affiliates/commission.service';

/**
 * Back office money operations: card refunds, credit notes, void, payments received outside
 * the card flow (bank transfer or manual) and writing an invoice off as uncollectible.
 */
@Injectable()
export class BillingAdminService {
  private readonly log = new Logger(BillingAdminService.name);

  constructor(private readonly prisma: PrismaService, private readonly events: EventsService, private readonly payments: PaymentsService, private readonly commissions: CommissionService) {}

  listInvoices(status?: string, billingEntity?: string) {
    return this.prisma.invoice.findMany({
      where: { ...(status ? { status: status as never } : {}), ...(billingEntity === 'progrid_arabia' || billingEntity === 'progrid_llc' ? { billingEntity } : {}) },
      include: {
        team: { select: { id: true, name: true, slug: true, country: true, billingEntity: true } },
        payments: { select: { id: true, provider: true, providerRef: true, status: true, amountMinor: true, refundedMinor: true, currency: true, paidAt: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
        creditNotes: { select: { id: true, number: true, amountMinor: true, reason: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /**
   * Refunds a captured card payment, in full when no amount is given. A refunded top up takes
   * the same amount back out of the team's unused prepaid credit, so it cannot be spent twice.
   */
  async refund(actor: Actor, paymentId: string, amountMinor: number | undefined, reason: string | undefined) {
    const p = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!p) throw ApiError.notFound('payment', paymentId);
    if (p.status !== 'succeeded') throw ApiError.invalidState(`Payment is ${p.status}; only succeeded payments can be refunded`);
    const provider = this.payments.providerByName(p.provider);
    if (!provider || !p.providerRef) throw ApiError.invalidState(`A ${p.provider} payment has no card to refund; issue a credit note or pay it back by transfer`);
    const left = p.amountMinor - p.refundedMinor;
    const amount = amountMinor ?? left;
    if (!Number.isInteger(amount) || amount <= 0 || amount > left) throw ApiError.invalid(`Refund must be between 1 and ${left} minor units`, { refundableMinor: left });
    if (!p.invoiceId) {
      const unused = await this.prepaidBalance(this.prisma, p.teamId);
      if (unused < amount) throw ApiError.invalidState(`Only ${unused} of this top up is unused credit; refund at most that`);
    }

    const r = await provider.refund(p.providerRef, amount);
    try {
      await this.prisma.$transaction(async (tx) => {
        const done = await tx.payment.updateMany({
          where: { id: p.id, refundedMinor: p.refundedMinor },
          data: { refundedMinor: { increment: amount }, refundRef: r.refundRef, refundedAt: new Date(), ...(amount === left ? { status: 'refunded' as const } : {}) },
        });
        if (!done.count) throw new Error('payment changed during the refund');
        if (!p.invoiceId) await this.takeBackPrepaid(tx, p.teamId, amount);
      });
    } catch (err) {
      // The card was refunded; make sure a person reconciles the record.
      this.log.error(`payment ${p.id}: provider refunded ${amount} (${r.refundRef}) but the record was not updated: ${(err as Error).message}`);
      throw err;
    }
    await this.events.emit('payment.refunded', { paymentId: p.id, invoiceId: p.invoiceId, amountMinor: amount, currency: p.currency, refundRef: r.refundRef, reason }, { actor, teamId: p.teamId, resource: `payment:${p.id}` });
    await this.commissions.onRefund(p.invoiceId, amount, `refund: ${reason ?? 'card refund'}`);
    return this.prisma.payment.findUniqueOrThrow({ where: { id: p.id } });
  }

  /**
   * Issues a credit note against an invoice. On an open invoice it first reduces what is still
   * due; anything beyond that, and everything on a paid invoice, becomes team credit of kind
   * refund. The invoice becomes credited when the notes cover it in full.
   */
  async creditNote(actor: Actor, invoiceId: string, amountMinor: number, reason: string) {
    const out = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${invoiceId}`}))`;
      const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { creditNotes: { select: { amountMinor: true } } } });
      if (!inv) throw ApiError.notFound('invoice', invoiceId);
      if (!['open', 'paid'].includes(inv.status)) throw ApiError.invalidState(`Invoice ${inv.number} is ${inv.status}`);
      const gross = inv.subtotalMinor + inv.taxMinor;
      const already = inv.creditNotes.reduce((s, n) => s + n.amountMinor, 0);
      if (!Number.isInteger(amountMinor) || amountMinor <= 0 || already + amountMinor > gross) throw ApiError.invalid(`Credit notes on ${inv.number} can total at most ${gross}; ${already} is already credited`, { creditableMinor: gross - already });

      const due = inv.status === 'open' ? inv.totalMinor - inv.creditedMinor : 0;
      const toDue = Math.min(due, amountMinor);
      const toCredit = amountMinor - toDue;
      const credit = toCredit > 0
        ? await tx.credit.create({ data: { teamId: inv.teamId, kind: 'refund', currency: inv.currency, amountMinor: toCredit, remainingMinor: toCredit, reason: `Credit note on invoice ${inv.number}: ${reason}` } })
        : null;
      // A credit note is issued by the company that issued the invoice, in its own series.
      const seq = await nextDocumentNumber(tx, entityProfile(inv.billingEntity).creditNoteSequence);
      const note = await tx.creditNote.create({
        data: { number: entityCreditNoteNumber(inv.billingEntity, new Date().getUTCFullYear(), seq), billingEntity: inv.billingEntity, teamId: inv.teamId, invoiceId: inv.id, currency: inv.currency, amountMinor, appliedToDueMinor: toDue, creditId: credit?.id, reason, createdBy: actor.userId },
      });
      const fully = already + amountMinor >= gross || (inv.status === 'open' && toDue === due);
      await tx.invoice.update({ where: { id: inv.id }, data: { creditedMinor: { increment: toDue }, ...(fully ? { status: 'credited' } : {}) } });
      return { note, inv, fully };
    });
    await this.events.emit('invoice.credited', { invoiceId, creditNoteId: out.note.id, number: out.note.number, amountMinor, currency: out.note.currency, fully: out.fully }, { actor, teamId: out.inv.teamId, resource: `invoice:${invoiceId}` });
    await this.commissions.onCreditNote(invoiceId, amountMinor, `credit note ${out.note.number}: ${reason}`);
    if (out.fully) await this.payments.liftBillingSuspension(out.inv.teamId);
    return out.note;
  }

  /** Voids an unpaid invoice. Prepaid credit the invoice consumed is returned as refund credit. */
  async void(actor: Actor, invoiceId: string, reason: string | undefined) {
    const inv = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${invoiceId}`}))`;
      const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { payments: { where: { status: 'succeeded' }, select: { id: true } } } });
      if (!inv) throw ApiError.notFound('invoice', invoiceId);
      if (!['open', 'draft'].includes(inv.status) || inv.payments.length) throw ApiError.invalidState(`Only unpaid invoices can be voided; ${inv.number} is ${inv.status}`);
      await tx.invoice.update({ where: { id: inv.id }, data: { status: 'void', voidedAt: new Date() } });
      await tx.payment.updateMany({ where: { invoiceId: inv.id, status: 'pending' }, data: { status: 'failed', failureReason: 'invoice voided' } });
      if (inv.creditMinor > 0) {
        await tx.credit.create({ data: { teamId: inv.teamId, kind: 'refund', currency: inv.currency, amountMinor: inv.creditMinor, remainingMinor: inv.creditMinor, reason: `Credit returned from voided invoice ${inv.number}` } });
      }
      return inv;
    });
    await this.events.emit('invoice.voided', { invoiceId, number: inv.number, reason }, { actor, teamId: inv.teamId, resource: `invoice:${invoiceId}` });
    await this.payments.liftBillingSuspension(inv.teamId);
    return this.prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  }

  /** Records money received by bank transfer or by hand and marks the invoice paid. */
  async recordPayment(actor: Actor, invoiceId: string, input: { provider: 'bank_transfer' | 'manual'; amountMinor?: number; reference?: string; receivedAt?: Date }) {
    const out = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`invoice:${invoiceId}`}))`;
      const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (!inv) throw ApiError.notFound('invoice', invoiceId);
      if (!['open', 'uncollectible'].includes(inv.status)) throw ApiError.invalidState(`Invoice ${inv.number} is ${inv.status}`);
      const due = inv.totalMinor - inv.creditedMinor;
      const amount = input.amountMinor ?? due;
      if (amount !== due) throw ApiError.invalid(`The amount must equal what is due on ${inv.number}: ${due}`, { dueMinor: due });
      const paidAt = input.receivedAt ?? new Date();
      const payment = await tx.payment.create({
        data: { teamId: inv.teamId, invoiceId: inv.id, provider: input.provider, providerRef: input.reference, currency: inv.currency, amountMinor: amount, status: 'succeeded', paidAt, metadata: { recordedBy: actor.userId } },
      });
      await tx.invoice.update({ where: { id: inv.id }, data: { status: 'paid', paidAt } });
      return { payment, inv };
    });
    await this.events.emit('invoice.paid', { paymentId: out.payment.id, invoiceId, amountMinor: out.payment.amountMinor, currency: out.payment.currency, provider: input.provider }, { actor, teamId: out.inv.teamId, resource: `payment:${out.payment.id}` });
    await this.commissions.onInvoicePaid(invoiceId);
    await this.payments.liftBillingSuspension(out.inv.teamId);
    return out.payment;
  }

  /** Writes an open invoice off. It stays on record and can still be paid later. */
  async markUncollectible(actor: Actor, invoiceId: string, reason: string | undefined) {
    const r = await this.prisma.invoice.updateMany({ where: { id: invoiceId, status: 'open' }, data: { status: 'uncollectible' } });
    const inv = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw ApiError.notFound('invoice', invoiceId);
    if (!r.count) throw ApiError.invalidState(`Only open invoices can be marked uncollectible; ${inv.number} is ${inv.status}`);
    await this.events.emit('invoice.uncollectible', { invoiceId, number: inv.number, reason }, { actor, teamId: inv.teamId, resource: `invoice:${invoiceId}` });
    return inv;
  }

  private async prepaidBalance(db: Prisma.TransactionClient | PrismaService, teamId: string) {
    const agg = await db.credit.aggregate({ where: { teamId, kind: 'prepaid', remainingMinor: { gt: 0 } }, _sum: { remainingMinor: true } });
    return agg._sum.remainingMinor ?? 0;
  }

  /** Removes refunded money from prepaid credit, newest first. */
  private async takeBackPrepaid(tx: Prisma.TransactionClient, teamId: string, amountMinor: number) {
    const credits = await tx.credit.findMany({ where: { teamId, kind: 'prepaid', remainingMinor: { gt: 0 } }, orderBy: { createdAt: 'desc' } });
    let left = amountMinor;
    for (const c of credits) {
      if (left <= 0) break;
      const use = Math.min(c.remainingMinor, left);
      const r = await tx.credit.updateMany({ where: { id: c.id, remainingMinor: { gte: use } }, data: { remainingMinor: { decrement: use } } });
      if (r.count !== 1) throw new Error(`credit ${c.id} changed during the refund`);
      left -= use;
    }
    if (left > 0) throw new Error(`not enough unused prepaid credit to take back ${amountMinor}`);
  }
}
