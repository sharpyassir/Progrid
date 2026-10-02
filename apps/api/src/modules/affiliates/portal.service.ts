import { Injectable } from '@nestjs/common';
import { Prisma, type Affiliate, type Currency } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiError } from '../../common/errors/api-error';
import { open, seal } from '../../common/crypto/secretbox';
import type { Actor } from '../../common/auth/actor';
import { EventsService } from '../events/events.service';
import { AffiliateSettingsService } from './settings';
import { AffiliateMailer, referralLinks } from './mailer';
import { normalizeCode, suggestCode } from './rules';
import type { ApplyDto, PayoutDetailsDto } from './portal.dto';
import { TaxService } from './tax.service';
import { CERTIFICATIONS, FORM_REVISIONS } from './tax-rules';
import type { TaxFormDto } from './tax.dto';

/** An application sent faster than a person can fill the form is treated as a bot. */
const MIN_FORM_SECONDS = 3;
/** A rejected applicant may apply again after this long. */
const REAPPLY_DAYS = 30;
const CURRENCIES: Currency[] = ['USD', 'SAR'];

export function formatMoney(minor: number, currency: Currency) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 100);
}

/** The affiliate portal (docs/affiliates.md): apply, status, dashboard, referrals, payouts. Works on the signed in user. */
@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AffiliateSettingsService,
    private readonly events: EventsService,
    private readonly mailer: AffiliateMailer,
    private readonly tax: TaxService,
  ) {}

  /** The portal home: the user's application or affiliate account and the program terms. */
  async me(actor: Actor) {
    const [a, user, s] = await Promise.all([
      this.prisma.affiliate.findUnique({ where: { userId: actor.userId } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { name: true, email: true } }),
      this.settings.get(),
    ]);
    return {
      user,
      affiliate: a ? presentAffiliate(a) : null,
      canReapplyAt: a?.status === 'rejected' && a.reviewedAt ? new Date(a.reviewedAt.getTime() + REAPPLY_DAYS * 86_400_000) : null,
      program: { applicationsOpen: s.applicationsOpen, termsVersion: s.termsVersion, rates: s.rates, holdDays: s.holdDays, cookieDays: s.cookieDays, commissionMonths: s.commissionMonths, minPayoutMinor: s.minPayoutMinor, promoDiscountPercent: s.promoDiscountPercent, promoDiscountMonths: s.promoDiscountMonths },
    };
  }

  async apply(actor: Actor, dto: ApplyDto, ip?: string | null) {
    // Bot protection without a third party: a hidden field people never fill, and a minimum time on the form.
    if (dto.website || !dto.formStartedAt || Date.now() - dto.formStartedAt < MIN_FORM_SECONDS * 1000) throw new ApiError(400, 'bot_check_failed', 'Your application could not be sent. Wait a few seconds and try again.');
    const s = await this.settings.get();
    if (!s.applicationsOpen) throw new ApiError(409, 'applications_closed', 'Applications to the affiliate program are paused.');
    if (dto.acceptTerms !== true) throw ApiError.invalid('Accept the affiliate program terms to apply.');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { email: true } });
    const existing = await this.prisma.affiliate.findUnique({ where: { userId: actor.userId } });
    if (existing && existing.status !== 'rejected') throw new ApiError(409, 'already_applied', existing.status === 'pending' ? 'Your application is being reviewed.' : 'You already have an affiliate account.');
    if (existing?.reviewedAt && Date.now() - existing.reviewedAt.getTime() < REAPPLY_DAYS * 86_400_000) throw new ApiError(409, 'reapply_later', `You can apply again ${REAPPLY_DAYS} days after the last decision.`);

    const fields = {
      name: dto.name.trim(),
      email: user.email,
      country: dto.country,
      channels: dto.channels.map((c) => c.trim()).filter(Boolean),
      audienceSize: dto.audienceSize,
      contentLanguage: dto.contentLanguage,
      promotionPlan: dto.promotionPlan.trim(),
      termsVersion: s.termsVersion,
      termsAcceptedAt: new Date(),
      applicationIp: ip ?? null,
      status: 'pending' as const,
      reviewedAt: null,
      reviewedById: null,
      statusReason: null,
    };
    const a = existing
      ? await this.prisma.affiliate.update({ where: { id: existing.id }, data: fields })
      : await this.createWithCode(actor.userId, fields, dto.preferredCode);
    await this.events.emit('affiliate.applied', { affiliateId: a.id, reapplied: !!existing }, { actor, resource: `affiliate:${a.id}` });
    await this.mailer.send(a, 'received');
    return presentAffiliate(a);
  }

  /** The preferred code when it is valid and free, otherwise one made from the name. */
  private async createWithCode(userId: string, fields: Omit<Prisma.AffiliateUncheckedCreateInput, 'userId' | 'code'>, preferred?: string) {
    const wanted = normalizeCode(preferred);
    const candidates = [...(wanted ? [wanted] : []), ...Array.from({ length: 5 }, () => suggestCode(fields.name))];
    for (const code of candidates) {
      try {
        return await this.prisma.affiliate.create({ data: { ...fields, userId, code } });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const target = String((err.meta as { target?: unknown })?.target ?? '');
          if (target.includes('userId')) throw new ApiError(409, 'already_applied', 'Your application is being reviewed.');
          continue;
        }
        throw err;
      }
    }
    throw new ApiError(409, 'code_unavailable', 'Could not reserve a partner code. Try again.');
  }

  private async approved(actor: Actor) {
    const a = await this.prisma.affiliate.findUnique({ where: { userId: actor.userId } });
    if (!a || a.status !== 'approved') throw new ApiError(403, 'not_an_affiliate', 'The affiliate dashboard opens once your application is approved.');
    return a;
  }

  /** Statistics for a date range, and the balances that payouts draw from (all time). */
  async dashboard(actor: Actor, q: { from?: string; to?: string }) {
    const a = await this.approved(actor);
    const to = q.to ? endOfDay(q.to) : new Date();
    const from = q.from ? startOfDay(q.from) : new Date(to.getTime() - 30 * 86_400_000);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) throw ApiError.invalid('Invalid date range');
    const range = { gte: from, lte: to };
    const [clicks, signups, paying, inRange, all, s, payouts] = await Promise.all([
      this.prisma.affiliateClick.count({ where: { affiliateId: a.id, at: range } }),
      this.prisma.referral.count({ where: { affiliateId: a.id, status: 'active', attributedAt: range } }),
      this.prisma.referral.count({ where: { affiliateId: a.id, status: 'active', team: { invoices: { some: { status: 'paid', totalMinor: { gt: 0 }, paidAt: range } } } } }),
      this.prisma.affiliateCommission.findMany({ where: { affiliateId: a.id, createdAt: range }, select: { currency: true, status: true, amountMinor: true, reversedMinor: true } }),
      this.prisma.affiliateCommission.findMany({ where: { affiliateId: a.id, OR: [{ status: 'pending' }, { status: 'approved', payoutId: null }] }, select: { currency: true, status: true, amountMinor: true, reversedMinor: true } }),
      this.settings.get(),
      this.prisma.affiliatePayout.groupBy({ by: ['currency', 'status'], where: { affiliateId: a.id }, _sum: { amountMinor: true } }),
    ]);
    // Clawbacks (negative rows) are counted through reversedMinor on the commission they reverse.
    const commissions = Object.fromEntries(CURRENCIES.map((c) => {
      const rows = inRange.filter((r) => r.currency === c && r.amountMinor > 0);
      const sum = (st: string) => rows.filter((r) => r.status === st).reduce((t, r) => t + r.amountMinor - r.reversedMinor, 0);
      return [c, { pending: sum('pending'), approved: sum('approved'), paid: rows.filter((r) => r.status === 'paid').reduce((t, r) => t + r.amountMinor, 0), reversed: rows.reduce((t, r) => t + r.reversedMinor, 0) }];
    }));
    const balances = Object.fromEntries(CURRENCIES.map((c) => {
      const rows = all.filter((r) => r.currency === c);
      const net = (r: (typeof rows)[number]) => r.amountMinor - r.reversedMinor;
      const payout = (st: string) => payouts.find((p) => p.currency === c && p.status === st)?._sum.amountMinor ?? 0;
      return [c, {
        pending: rows.filter((r) => r.status === 'pending').reduce((t, r) => t + net(r), 0),
        // Ready to pay out, after any clawback of commission reversed after it was paid.
        available: rows.filter((r) => r.status === 'approved').reduce((t, r) => t + net(r), 0),
        requested: payout('requested'),
        paidOut: payout('paid'),
        minPayoutMinor: s.minPayoutMinor[c as 'USD' | 'SAR'],
      }];
    }));
    return { code: a.code, links: referralLinks(a.code), range: { from, to }, clicks, signups, payingCustomers: paying, commissions, balances };
  }

  /** Referred customers, anonymized: no names, emails or team details. */
  async referrals(actor: Actor, q: { cursor?: string }) {
    const a = await this.approved(actor);
    const rows = await this.prisma.referral.findMany({
      where: { affiliateId: a.id },
      orderBy: [{ attributedAt: 'desc' }, { id: 'desc' }],
      take: 51,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      select: {
        id: true, status: true, attributedAt: true, commissionUntil: true,
        commissions: { select: { category: true, currency: true, status: true, amountMinor: true, reversedMinor: true } },
        team: { select: { invoices: { where: { status: 'paid', totalMinor: { gt: 0 } }, select: { id: true }, take: 1 } } },
      },
    });
    const page = rows.slice(0, 50);
    return {
      data: page.map((r) => {
        const totals: Record<string, number> = {};
        for (const c of r.commissions) if (c.status !== 'reversed') totals[c.currency] = (totals[c.currency] ?? 0) + c.amountMinor - c.reversedMinor;
        return {
          id: r.id,
          customer: `Customer ${createHash('sha256').update(r.id).digest('hex').slice(0, 6).toUpperCase()}`,
          signedUpAt: r.attributedAt,
          commissionUntil: r.commissionUntil,
          status: r.status === 'blocked' ? 'not_eligible' : r.team.invoices.length ? 'paying' : 'signed_up',
          services: [...new Set(r.commissions.map((c) => c.category))],
          commission: Object.entries(totals).map(([currency, amountMinor]) => ({ currency, amountMinor })),
        };
      }),
      meta: { next_cursor: rows.length > 50 ? page[page.length - 1].id : null, count: page.length },
    };
  }

  async payoutDetails(actor: Actor) {
    const a = await this.approved(actor);
    return { details: a.payoutDetails ? maskDetails(JSON.parse(open(a.payoutDetails)) as PayoutDetailsDto) : null };
  }

  async setPayoutDetails(actor: Actor, dto: PayoutDetailsDto) {
    const a = await this.approved(actor);
    const clean: PayoutDetailsDto = {
      method: 'bank_transfer',
      holderName: dto.holderName.trim(),
      bankName: dto.bankName.trim(),
      bankCountry: dto.bankCountry,
      iban: dto.iban.replace(/\s+/g, '').toUpperCase(),
      swift: dto.swift?.replace(/\s+/g, '').toUpperCase() || undefined,
      note: dto.note?.trim() || undefined,
    };
    await this.prisma.affiliate.update({ where: { id: a.id }, data: { payoutMethod: 'bank_transfer', payoutDetails: seal(JSON.stringify(clean)) } });
    await this.events.emit('affiliate.payout_details_changed', { affiliateId: a.id }, { actor, resource: `affiliate:${a.id}` });
    return { details: maskDetails(clean) };
  }

  async payouts(actor: Actor) {
    const a = await this.approved(actor);
    const data = await this.prisma.affiliatePayout.findMany({ where: { affiliateId: a.id }, orderBy: { requestedAt: 'desc' }, take: 100, select: { id: true, currency: true, amountMinor: true, withheldMinor: true, status: true, reference: true, requestedAt: true, paidAt: true } });
    return { data };
  }

  /** Requests a payout of all payable commission in one currency, once it reaches the minimum. */
  async requestPayout(actor: Actor, currency: Currency) {
    const a = await this.approved(actor);
    if (!a.payoutDetails) throw new ApiError(409, 'payout_details_missing', 'Add your payout details first.');
    const s = await this.settings.get();
    const min = s.minPayoutMinor[currency as 'USD' | 'SAR'];
    const payout = await this.prisma.$transaction(async (tx) => {
      const open = await tx.affiliatePayout.findFirst({ where: { affiliateId: a.id, currency, status: 'requested' } });
      if (open) throw new ApiError(409, 'payout_pending', 'A payout in this currency is already being processed.');
      const rows = await tx.affiliateCommission.findMany({ where: { affiliateId: a.id, currency, status: 'approved', payoutId: null }, select: { id: true, amountMinor: true, reversedMinor: true } });
      const amount = rows.reduce((t, r) => t + r.amountMinor - r.reversedMinor, 0);
      if (amount < min || amount <= 0) throw new ApiError(409, 'below_minimum', `The payable balance must reach ${formatMoney(min, currency)} before a payout.`);
      // US dollars are paid by Progrid Technologies LLC: a W-9 or W-8 must be on file (docs/affiliates-tax.md).
      const tax = currency === 'USD' ? await this.tax.forUsdPayout(a.id, amount) : null;
      const p = await tx.affiliatePayout.create({ data: { affiliateId: a.id, currency, amountMinor: amount, details: a.payoutDetails, taxFormId: tax?.form.id ?? null, withheldMinor: tax?.withheldMinor ?? 0 } });
      const linked = await tx.affiliateCommission.updateMany({ where: { id: { in: rows.map((r) => r.id) }, payoutId: null, status: 'approved' }, data: { payoutId: p.id } });
      if (linked.count !== rows.length) throw new ApiError(409, 'balance_changed', 'Your balance changed. Try again.');
      return p;
    });
    await this.events.emit('affiliate.payout_requested', { affiliateId: a.id, payoutId: payout.id, currency, amountMinor: payout.amountMinor }, { actor, resource: `affiliate_payout:${payout.id}` });
    await this.mailer.send(a, 'payout_requested', { amount: formatMoney(payout.amountMinor, currency) });
    return { id: payout.id, currency: payout.currency, amountMinor: payout.amountMinor, withheldMinor: payout.withheldMinor, status: payout.status, requestedAt: payout.requestedAt, paidAt: null, reference: null };
  }

  /** The affiliate's tax information (TIN masked). */
  async taxForm(actor: Actor) {
    const a = await this.approved(actor);
    // The certification texts the portal shows before signing (English, as on the IRS forms).
    const certifications = { W9: CERTIFICATIONS.W9(false), W9Backup: CERTIFICATIONS.W9(true), W8BEN: CERTIFICATIONS.W8BEN(), W8BENE: CERTIFICATIONS.W8BENE(), servicesOutsideUs: CERTIFICATIONS.servicesOutsideUs, revisions: FORM_REVISIONS };
    return { ...(await this.tax.presentCurrent(a.id)), certifications };
  }

  async submitTaxForm(actor: Actor, dto: TaxFormDto, ip?: string | null) {
    const a = await this.approved(actor);
    await this.tax.submit(actor, a.id, dto, ip);
    return this.tax.presentCurrent(a.id);
  }
}

export function presentAffiliate(a: Affiliate) {
  return {
    id: a.id, status: a.status, code: a.status === 'approved' ? a.code : null, name: a.name, email: a.email, country: a.country, channels: a.channels,
    audienceSize: a.audienceSize, contentLanguage: a.contentLanguage, promotionPlan: a.promotionPlan, statusReason: a.status === 'rejected' || a.status === 'suspended' ? a.statusReason : null,
    appliedAt: a.termsAcceptedAt, reviewedAt: a.reviewedAt, hasPayoutDetails: !!a.payoutDetails,
    links: a.status === 'approved' ? referralLinks(a.code) : [],
  };
}

function maskDetails(d: PayoutDetailsDto) {
  return { method: d.method, holderName: d.holderName, bankName: d.bankName, bankCountry: d.bankCountry, ibanLast4: d.iban.slice(-4), swift: d.swift ?? null, note: d.note ?? null };
}

function startOfDay(s: string) { return new Date(`${s.slice(0, 10)}T00:00:00.000Z`); }
function endOfDay(s: string) { return new Date(`${s.slice(0, 10)}T23:59:59.999Z`); }
