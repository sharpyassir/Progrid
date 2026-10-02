import { Injectable } from '@nestjs/common';
import { Prisma, type AffiliateStatus, type Currency } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiError } from '../../common/errors/api-error';
import { open } from '../../common/crypto/secretbox';
import type { Actor } from '../../common/auth/actor';
import { EventsService } from '../events/events.service';
import { AffiliateMailer } from './mailer';
import { formatMoney } from './portal.service';
import { normalizeCode } from './rules';
import { TaxService, present as presentTaxForm } from './tax.service';

const STATUSES: AffiliateStatus[] = ['pending', 'approved', 'rejected', 'suspended'];

/** Finance staff tools for the affiliate program (docs/affiliates.md, back office). */
@Injectable()
export class AffiliateAdminService {
  constructor(private readonly prisma: PrismaService, private readonly events: EventsService, private readonly mailer: AffiliateMailer, private readonly tax: TaxService) {}

  /** Affiliates with their numbers: referrals, balances per currency, open flags. */
  async list(q: { status?: string; q?: string }) {
    const where: Prisma.AffiliateWhereInput = {
      ...(STATUSES.includes(q.status as AffiliateStatus) ? { status: q.status as AffiliateStatus } : {}),
      ...(q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { email: { contains: q.q, mode: 'insensitive' } }, { code: { contains: q.q.toUpperCase() } }] } : {}),
    };
    const rows = await this.prisma.affiliate.findMany({ where, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 200, include: { _count: { select: { referrals: true, flags: { where: { resolvedAt: null } } } } } });
    const ids = rows.map((r) => r.id);
    const sums = ids.length ? await this.prisma.affiliateCommission.groupBy({ by: ['affiliateId', 'currency', 'status'], where: { affiliateId: { in: ids } }, _sum: { amountMinor: true, reversedMinor: true } }) : [];
    return {
      data: rows.map((a) => ({
        id: a.id, status: a.status, code: a.code, name: a.name, email: a.email, country: a.country, channels: a.channels, audienceSize: a.audienceSize,
        contentLanguage: a.contentLanguage, appliedAt: a.termsAcceptedAt, reviewedAt: a.reviewedAt, statusReason: a.statusReason,
        referrals: a._count.referrals, openFlags: a._count.flags,
        balances: balances(sums.filter((s) => s.affiliateId === a.id)),
      })),
    };
  }

  /** Everything about one affiliate, including the application and payout details for finance. */
  async get(id: string) {
    const a = await this.prisma.affiliate.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, email: true, name: true, signupIp: true, createdAt: true } },
        referrals: { orderBy: { attributedAt: 'desc' }, take: 200, include: { team: { select: { id: true, name: true, slug: true, country: true } } } },
        payouts: { orderBy: { requestedAt: 'desc' }, take: 100 },
        flags: { orderBy: { createdAt: 'desc' }, take: 100 },
      },
    });
    if (!a) throw ApiError.notFound('affiliate', id);
    const sums = await this.prisma.affiliateCommission.groupBy({ by: ['affiliateId', 'currency', 'status'], where: { affiliateId: id }, _sum: { amountMinor: true, reversedMinor: true } });
    const clicks = await this.prisma.affiliateClick.count({ where: { affiliateId: id } });
    const { payoutDetails, ...rest } = a;
    const taxForms = await this.prisma.affiliateTaxForm.findMany({ where: { affiliateId: id }, orderBy: { signedAt: 'desc' } });
    return {
      ...rest,
      taxForms: taxForms.map(presentTaxForm),
      clicks,
      balances: balances(sums),
      payoutDetails: payoutDetails ? JSON.parse(open(payoutDetails)) : null,
      payouts: a.payouts.map(({ details, ...p }) => p),
    };
  }

  async approve(actor: Actor, id: string, code?: string) {
    const a = await this.prisma.affiliate.findUnique({ where: { id } });
    if (!a) throw ApiError.notFound('affiliate', id);
    if (a.status !== 'pending') throw ApiError.invalidState(`The application is ${a.status}`);
    const newCode = code ? normalizeCode(code) : a.code;
    if (!newCode) throw ApiError.invalid('A code is 4 to 20 letters and digits');
    try {
      const u = await this.prisma.affiliate.update({ where: { id }, data: { status: 'approved', code: newCode, reviewedAt: new Date(), reviewedById: actor.userId, statusReason: null } });
      await this.events.emit('affiliate.approved', { affiliateId: id, code: newCode }, { actor, resource: `affiliate:${id}` });
      await this.mailer.send(u, 'approved');
      return u;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw ApiError.conflict('code_taken', `The code ${newCode} is taken`);
      throw err;
    }
  }

  async reject(actor: Actor, id: string, reason: string) {
    return this.setStatus(actor, id, ['pending'], 'rejected', reason, 'rejected');
  }

  /** Stops new referrals and commission; pending commission waits until reinstated. */
  async suspend(actor: Actor, id: string, reason: string) {
    return this.setStatus(actor, id, ['approved'], 'suspended', reason, 'suspended');
  }

  async reinstate(actor: Actor, id: string) {
    return this.setStatus(actor, id, ['suspended'], 'approved', null, 'reinstated');
  }

  private async setStatus(actor: Actor, id: string, from: AffiliateStatus[], to: AffiliateStatus, reason: string | null, mail: 'rejected' | 'suspended' | 'reinstated') {
    const r = await this.prisma.affiliate.updateMany({ where: { id, status: { in: from } }, data: { status: to, statusReason: reason, reviewedAt: new Date(), reviewedById: actor.userId } });
    if (!r.count) {
      const a = await this.prisma.affiliate.findUnique({ where: { id } });
      if (!a) throw ApiError.notFound('affiliate', id);
      throw ApiError.invalidState(`The affiliate is ${a.status}`);
    }
    const a = await this.prisma.affiliate.findUniqueOrThrow({ where: { id } });
    await this.events.emit(`affiliate.${mail}`, { affiliateId: id, reason }, { actor, resource: `affiliate:${id}` });
    await this.mailer.send(a, mail);
    return a;
  }

  referrals(q: { affiliateId?: string }) {
    return this.prisma.referral.findMany({
      where: q.affiliateId ? { affiliateId: q.affiliateId } : {},
      orderBy: { attributedAt: 'desc' },
      take: 500,
      include: { affiliate: { select: { code: true, name: true } }, team: { select: { id: true, name: true, slug: true, country: true } } },
    });
  }

  commissions(q: { affiliateId?: string; status?: string; currency?: string }) {
    return this.prisma.affiliateCommission.findMany({
      where: {
        ...(q.affiliateId ? { affiliateId: q.affiliateId } : {}),
        ...(['pending', 'approved', 'paid', 'reversed'].includes(q.status ?? '') ? { status: q.status as never } : {}),
        ...(q.currency === 'USD' || q.currency === 'SAR' ? { currency: q.currency } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
      include: { affiliate: { select: { code: true, name: true } }, invoice: { select: { number: true, teamId: true, paidAt: true } } },
    });
  }

  /** Payout requests with the bank details to pay them. */
  async payouts(q: { status?: string }) {
    const rows = await this.prisma.affiliatePayout.findMany({
      where: ['requested', 'paid', 'cancelled'].includes(q.status ?? '') ? { status: q.status as never } : {},
      orderBy: { requestedAt: 'desc' },
      take: 200,
      include: { affiliate: { select: { id: true, code: true, name: true, email: true, country: true } }, _count: { select: { commissions: true } } },
    });
    return rows.map(({ details, ...p }) => ({ ...p, netMinor: p.amountMinor - p.withheldMinor, details: details ? JSON.parse(open(details)) : null, payingCompany: p.currency === 'SAR' ? 'Progrid Arabia' : 'Progrid Technologies LLC' }));
  }

  /** After the bank transfer: the payout and its commissions become paid, and the affiliate gets an email. */
  async markPaid(actor: Actor, id: string, reference: string, note?: string) {
    const now = new Date();
    const before = await this.prisma.affiliatePayout.findUnique({ where: { id } });
    if (!before || before.status !== 'requested') throw ApiError.invalidState('Only requested payouts can be marked paid');
    // USD: the tax form must still be valid when the money goes out, and backup withholding is
    // worked out on the form as it is now (an IRS B notice may have arrived since the request).
    const tax = before.currency === 'USD' ? await this.tax.forUsdPayout(before.affiliateId, before.amountMinor) : null;
    const p = await this.prisma.$transaction(async (tx) => {
      const r = await tx.affiliatePayout.updateMany({
        where: { id, status: 'requested' },
        data: { status: 'paid', paidAt: now, paidById: actor.userId, reference, note, ...(tax ? { taxFormId: tax.form.id, withheldMinor: tax.withheldMinor } : {}) },
      });
      if (!r.count) throw ApiError.invalidState('Only requested payouts can be marked paid');
      await tx.affiliateCommission.updateMany({ where: { payoutId: id }, data: { status: 'paid', paidAt: now } });
      const paid = await tx.affiliatePayout.findUniqueOrThrow({ where: { id }, include: { affiliate: true } });
      // Accounting ledger: payable settled, cash out, backup withholding owed to the IRS.
      await tx.affiliateLedgerEntry.create({ data: { affiliateId: paid.affiliateId, currency: paid.currency, kind: 'paid', amountMinor: paid.amountMinor, withheldMinor: paid.withheldMinor, payoutId: id, memo: reference.slice(0, 200), at: now } });
      return paid;
    });
    await this.events.emit('affiliate.payout_paid', { affiliateId: p.affiliateId, payoutId: id, currency: p.currency, amountMinor: p.amountMinor, withheldMinor: p.withheldMinor, reference }, { actor, resource: `affiliate_payout:${id}` });
    const cur = p.currency as Currency;
    const amount = p.withheldMinor
      ? `${formatMoney(p.amountMinor - p.withheldMinor, cur)} (${formatMoney(p.amountMinor, cur)} less ${formatMoney(p.withheldMinor, cur)} US backup withholding paid to the IRS)`
      : formatMoney(p.amountMinor, cur);
    await this.mailer.send(p.affiliate, 'payout_paid', { amount, reference });
    const { details, affiliate, ...rest } = p;
    return rest;
  }

  /** Puts the commission back into the payable balance (wrong bank details, a rejected transfer). */
  async cancelPayout(actor: Actor, id: string, note?: string) {
    const p = await this.prisma.$transaction(async (tx) => {
      const r = await tx.affiliatePayout.updateMany({ where: { id, status: 'requested' }, data: { status: 'cancelled', note } });
      if (!r.count) throw ApiError.invalidState('Only requested payouts can be cancelled');
      await tx.affiliateCommission.updateMany({ where: { payoutId: id }, data: { payoutId: null } });
      return tx.affiliatePayout.findUniqueOrThrow({ where: { id } });
    });
    await this.events.emit('affiliate.payout_cancelled', { affiliateId: p.affiliateId, payoutId: id, note }, { actor, resource: `affiliate_payout:${id}` });
    const { details, ...rest } = p;
    return rest;
  }

  flags(q: { open?: string }) {
    return this.prisma.affiliateFlag.findMany({
      where: q.open === 'false' ? {} : { resolvedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: { affiliate: { select: { id: true, code: true, name: true, status: true } } },
    });
  }

  async resolveFlag(actor: Actor, id: string) {
    const r = await this.prisma.affiliateFlag.updateMany({ where: { id, resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: actor.userId } });
    if (!r.count) throw ApiError.notFound('affiliate flag', id);
    return this.prisma.affiliateFlag.findUniqueOrThrow({ where: { id } });
  }

  /** CSV exports for finance and reviews. Amounts in major units with the currency next to them. */
  async csv(kind: string, q: { affiliateId?: string; status?: string; currency?: string }) {
    const amount = (minor: number) => (minor / 100).toFixed(2);
    const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '');
    if (kind === 'affiliates') {
      const { data } = await this.list({ status: q.status });
      return toCsv(['id', 'code', 'status', 'name', 'email', 'country', 'audience', 'language', 'channels', 'applied', 'referrals', 'open_flags', 'usd_approved', 'sar_approved', 'usd_paid', 'sar_paid'],
        data.map((a) => [a.id, a.code, a.status, a.name, a.email, a.country, a.audienceSize, a.contentLanguage, a.channels.join(' '), day(a.appliedAt), a.referrals, a.openFlags, amount(a.balances.USD.approved), amount(a.balances.SAR.approved), amount(a.balances.USD.paid), amount(a.balances.SAR.paid)]));
    }
    if (kind === 'referrals') {
      const rows = await this.referrals(q);
      return toCsv(['id', 'affiliate_code', 'team_id', 'team', 'country', 'status', 'blocked_reason', 'discount_percent', 'discount_until', 'commission_until', 'attributed'],
        rows.map((r) => [r.id, r.affiliate.code, r.team.id, r.team.name, r.team.country, r.status, r.blockedReason ?? '', r.discountPercent, day(r.discountUntil), day(r.commissionUntil), day(r.attributedAt)]));
    }
    if (kind === 'commissions') {
      const rows = await this.commissions(q);
      return toCsv(['id', 'affiliate_code', 'invoice', 'invoice_paid', 'category', 'currency', 'base', 'rate_percent', 'amount', 'reversed', 'status', 'hold_until', 'payout_id', 'created'],
        rows.map((c) => [c.id, c.affiliate.code, c.invoice.number, day(c.invoice.paidAt), c.category, c.currency, amount(c.baseMinor), (c.rateBp / 100).toFixed(2), amount(c.amountMinor), amount(c.reversedMinor), c.status, day(c.holdUntil), c.payoutId ?? '', day(c.createdAt)]));
    }
    if (kind === 'payouts') {
      const rows = await this.payouts(q);
      return toCsv(['id', 'affiliate_code', 'affiliate', 'email', 'paying_company', 'currency', 'gross', 'backup_withholding', 'net_to_send', 'status', 'requested', 'paid', 'reference', 'holder', 'bank', 'bank_country', 'iban', 'swift'],
        rows.map((p) => [p.id, p.affiliate.code, p.affiliate.name, p.affiliate.email, p.payingCompany, p.currency, amount(p.amountMinor), amount(p.withheldMinor), amount(p.netMinor), p.status, day(p.requestedAt), day(p.paidAt), p.reference ?? '', p.details?.holderName ?? '', p.details?.bankName ?? '', p.details?.bankCountry ?? '', p.details?.iban ?? '', p.details?.swift ?? '']));
    }
    throw ApiError.invalid('Export one of affiliates, referrals, commissions, payouts');
  }
}

type Sum = { currency: Currency; status: string; _sum: { amountMinor: number | null; reversedMinor: number | null } };

/** Net commission per currency and status (approved includes commission in a payout request). */
function balances(sums: Sum[]) {
  const out = { USD: { pending: 0, approved: 0, paid: 0, reversed: 0 }, SAR: { pending: 0, approved: 0, paid: 0, reversed: 0 } };
  for (const s of sums) {
    const b = out[s.currency];
    const amt = s._sum.amountMinor ?? 0;
    const rev = s._sum.reversedMinor ?? 0;
    if (s.status === 'pending') b.pending += amt - rev;
    else if (s.status === 'approved') b.approved += amt - rev;
    else if (s.status === 'paid') b.paid += amt;
    b.reversed += rev;
  }
  return out;
}

/** RFC 4180 CSV; cells that could start a spreadsheet formula are quoted with a leading apostrophe. */
export function toCsv(header: string[], rows: (string | number)[][]) {
  const cell = (v: string | number) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}
