import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Affiliate } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiError } from '../../common/errors/api-error';
import { keyedHash } from '../../common/crypto/secretbox';
import { countryOfIp } from '../../common/geo/geoip';
import type { Actor } from '../../common/auth/actor';
import { EventsService } from '../events/events.service';
import { AffiliateSettingsService } from './settings';
import { addMonths, normalizeCode, parseRef, selfReferralReason } from './rules';

/** Addresses the affiliate used recently count as theirs for the self referral check. */
const OWN_IP_LOOKBACK_DAYS = 180;

export interface SignupAttribution {
  teamId: string;
  userId: string;
  email: string;
  ip?: string | null;
  /** Value of the prgd_ref cookie (CODE.<seconds>) or a bare code from ?ref=. */
  ref?: string | null;
  /** Promo code typed on the signup form. */
  promoCode?: string | null;
}

/**
 * Who referred a customer (docs/affiliates.md). The referral link sets a cookie (last click
 * wins, valid for the configured days); at signup the cookie, or a typed promo code, links the
 * new team to the affiliate permanently. A promo code also gives the customer a discount, and may
 * still be added later as long as the team has not paid an invoice.
 */
@Injectable()
export class AttributionService {
  private readonly log = new Logger(AttributionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AffiliateSettingsService,
    private readonly events: EventsService,
  ) {}

  /** An approved affiliate by code, or null. */
  async approved(code: string | null): Promise<(Affiliate & { user: { email: string; signupIp: string | null } }) | null> {
    if (!code) return null;
    const a = await this.prisma.affiliate.findUnique({ where: { code }, include: { user: { select: { email: true, signupIp: true } } } });
    return a?.status === 'approved' ? a : null;
  }

  /** Public check of a promo code for the signup form and the billing page. */
  async describe(raw: unknown) {
    const code = normalizeCode(raw);
    const a = await this.approved(code);
    const s = await this.settings.get();
    return a ? { code, valid: true, discountPercent: s.promoDiscountPercent, discountMonths: s.promoDiscountMonths } : { code, valid: false };
  }

  /** One visit through a referral link; counted once per address per affiliate per day. */
  async recordClick(i: { code: unknown; ip?: string | null; path?: unknown; referrer?: unknown }) {
    const a = await this.approved(normalizeCode(i.code));
    if (!a || !i.ip) return;
    const now = new Date();
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    await this.prisma.affiliateClick.createMany({
      data: [{
        affiliateId: a.id,
        day,
        ipHash: keyedHash(i.ip, 'affiliate-click'),
        landingPath: typeof i.path === 'string' ? i.path.slice(0, 300) : null,
        referrer: typeof i.referrer === 'string' ? safeReferrer(i.referrer) : null,
        country: countryOfIp(i.ip),
      }],
      skipDuplicates: true,
    });
  }

  /** Rejects an unknown promo code before an account is created, so the person can fix it. */
  async assertPromo(raw: unknown) {
    if (raw === undefined || raw === null || raw === '') return;
    if (!(await this.approved(normalizeCode(raw)))) throw new ApiError(400, 'invalid_promo_code', 'This promo code is not valid.');
  }

  /**
   * Links a team created at signup to its affiliate. A typed promo code wins over the cookie.
   * Never fails the signup: problems are logged, self referral is recorded as blocked.
   */
  async attributeSignup(i: SignupAttribution) {
    try {
      const s = await this.settings.get();
      const now = new Date();
      const promo = normalizeCode(i.promoCode);
      const code = promo ?? parseRef(i.ref, now, s.cookieDays);
      const affiliate = await this.approved(code);
      if (!affiliate) return null;
      return await this.link(affiliate, {
        teamId: i.teamId,
        userId: i.userId,
        source: promo ? 'promo_code' : 'link',
        customer: { userIds: [i.userId], emails: [i.email], ip: i.ip },
        now,
      });
    } catch (err) {
      this.log.error(`referral for team ${i.teamId} failed: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Adds a promo code to an existing team (billing page). Allowed until the team pays its first
   * invoice, and only when the team is not already referred by someone else.
   */
  async applyPromo(actor: Actor, raw: unknown, ip?: string | null) {
    const code = normalizeCode(raw);
    const affiliate = await this.approved(code);
    if (!affiliate) throw new ApiError(400, 'invalid_promo_code', 'This promo code is not valid.');
    const paid = await this.prisma.invoice.count({ where: { teamId: actor.teamId, status: 'paid', totalMinor: { gt: 0 } } });
    if (paid) throw new ApiError(409, 'promo_too_late', 'Promo codes can only be added before your first paid invoice.');
    const existing = await this.prisma.referral.findUnique({ where: { teamId: actor.teamId } });
    if (existing && (existing.affiliateId !== affiliate.id || existing.status !== 'active')) throw new ApiError(409, 'already_referred', 'This account is already linked to a partner.');
    if (existing?.source === 'promo_code') throw new ApiError(409, 'promo_already_applied', 'A promo code is already applied to this account.');

    const s = await this.settings.get();
    const now = new Date();
    if (existing) {
      // Came through the same affiliate's link: the code adds the customer discount.
      const r = await this.prisma.referral.update({
        where: { id: existing.id },
        data: { source: 'promo_code', code: affiliate.code, discountPercent: s.promoDiscountPercent, discountUntil: s.promoDiscountMonths ? addMonths(now, s.promoDiscountMonths) : null },
      });
      await this.events.emit('affiliate.promo_applied', { referralId: r.id, affiliateId: affiliate.id, teamId: actor.teamId }, { actor, resource: `referral:${r.id}` });
      return presentReferral(r);
    }
    const members = await this.prisma.teamMember.findMany({ where: { teamId: actor.teamId }, include: { user: { select: { email: true } } } });
    const r = await this.link(affiliate, {
      teamId: actor.teamId,
      userId: actor.userId,
      source: 'promo_code',
      customer: { userIds: members.map((m) => m.userId), emails: members.map((m) => m.user.email), ip },
      now,
    });
    if (!r || r.status === 'blocked') throw new ApiError(400, 'invalid_promo_code', 'This promo code cannot be used on this account.');
    return presentReferral(r);
  }

  /** The referral of a team as its own billing page shows it (no affiliate details). */
  async forTeam(teamId: string) {
    const r = await this.prisma.referral.findUnique({ where: { teamId } });
    return r && r.status === 'active' ? presentReferral(r) : null;
  }

  private async link(affiliate: Affiliate & { user: { email: string; signupIp: string | null } }, i: { teamId: string; userId: string; source: 'link' | 'promo_code'; customer: { userIds: string[]; emails: string[]; ip?: string | null }; now: Date }) {
    const s = await this.settings.get();
    const blocked = selfReferralReason({
      affiliate: { userId: affiliate.userId, email: affiliate.email, userEmail: affiliate.user.email, ips: await this.ownIps(affiliate) },
      customer: i.customer,
    });
    const promo = i.source === 'promo_code' && !blocked;
    let r;
    try {
      r = await this.prisma.referral.create({
        data: {
          affiliateId: affiliate.id,
          teamId: i.teamId,
          userId: i.userId,
          source: i.source,
          code: affiliate.code,
          status: blocked ? 'blocked' : 'active',
          blockedReason: blocked ? `self_referral:${blocked}` : null,
          signupIp: i.customer.ip ?? null,
          discountPercent: promo ? s.promoDiscountPercent : 0,
          discountUntil: promo && s.promoDiscountMonths ? addMonths(i.now, s.promoDiscountMonths) : null,
          commissionUntil: addMonths(i.now, s.commissionMonths),
          attributedAt: i.now,
        },
      });
    } catch (err) {
      // The team was linked meanwhile (double submit); the first one stands.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null;
      throw err;
    }
    if (blocked) {
      await this.flag(affiliate.id, 'self_referral', { teamId: i.teamId, reason: blocked });
      await this.events.emit('affiliate.referral_blocked', { referralId: r.id, affiliateId: affiliate.id, teamId: i.teamId, reason: blocked }, { resource: `referral:${r.id}` });
      return r;
    }
    await this.events.emit('affiliate.referral_created', { referralId: r.id, affiliateId: affiliate.id, teamId: i.teamId, source: i.source }, { resource: `referral:${r.id}` });
    if (i.customer.ip) await this.checkSignupBurst(affiliate.id, i.customer.ip, s.flagSignupsPerIpPerDay);
    return r;
  }

  /** The affiliate's own addresses: signup, application, and console sessions of the last months. */
  private async ownIps(a: Affiliate & { user: { signupIp: string | null } }) {
    const since = new Date(Date.now() - OWN_IP_LOOKBACK_DAYS * 86_400_000);
    const sessions = await this.prisma.session.findMany({ where: { userId: a.userId, createdAt: { gte: since }, ip: { not: null } }, select: { ip: true }, distinct: ['ip'], take: 200 });
    return [a.user.signupIp, a.applicationIp, ...sessions.map((x) => x.ip)].filter((x): x is string => !!x);
  }

  /** Many referred signups from one address in a day: flag the affiliate for review. */
  private async checkSignupBurst(affiliateId: string, ip: string, threshold: number) {
    const since = new Date(Date.now() - 86_400_000);
    const n = await this.prisma.referral.count({ where: { affiliateId, signupIp: ip, attributedAt: { gte: since } } });
    if (n < threshold) return;
    const open = await this.prisma.affiliateFlag.findFirst({ where: { affiliateId, kind: 'signups_from_one_ip', resolvedAt: null, createdAt: { gte: since } } });
    if (!open) await this.flag(affiliateId, 'signups_from_one_ip', { ipHash: keyedHash(ip, 'affiliate-flag'), signups24h: n });
  }

  async flag(affiliateId: string, kind: string, detail: Record<string, unknown>) {
    await this.prisma.affiliateFlag.create({ data: { affiliateId, kind, detail: detail as Prisma.InputJsonValue } });
    await this.events.emit('affiliate.flagged', { affiliateId, kind, ...detail }, { resource: `affiliate:${affiliateId}` });
  }
}

function presentReferral(r: { code: string; source: string; discountPercent: number; discountUntil: Date | null; attributedAt: Date }) {
  return { code: r.code, source: r.source, discountPercent: r.discountPercent, discountUntil: r.discountUntil, attributedAt: r.attributedAt };
}

/** Only the origin of the referring page (no paths or queries with personal data). */
function safeReferrer(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin.slice(0, 200) : null;
  } catch {
    return null;
  }
}
