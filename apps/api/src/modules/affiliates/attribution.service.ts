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

export interface SignupAttribution {
  teamId: string;
  userId: string;
  email: string;
  ip?: string | null;
  /** The partner code entered (or prefilled from a referral link) on the signup form. */
  promoCode?: string | null;
}

/**
 * Who referred a customer (docs/affiliates.md). Only a customer who uses the partner's code is
 * referred: at signup, or on the billing page before the team's first paid invoice. The link is
 * then permanent and the customer gets the code discount. Referral links count clicks and
 * prefill the code on the signup form; they do not attribute on their own.
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
  async approved(code: string | null): Promise<(Affiliate & { user: { email: string } }) | null> {
    if (!code) return null;
    const a = await this.prisma.affiliate.findUnique({ where: { code }, include: { user: { select: { email: true } } } });
    return a?.status === 'approved' ? a : null;
  }

  /**
   * Public check of a code for the signup form and the billing page. Also takes the referral
   * cookie value (CODE.<seconds>), which is only valid within the configured cookie days.
   */
  async describe(raw: unknown) {
    const s = await this.settings.get();
    const code = typeof raw === 'string' && raw.includes('.') ? parseRef(raw, new Date(), s.cookieDays) : normalizeCode(raw);
    const a = await this.approved(code);
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

  /** Rejects an unknown code before an account is created, so the person can fix it. */
  async assertPromo(raw: unknown) {
    if (raw === undefined || raw === null || raw === '') return;
    if (!(await this.approved(normalizeCode(raw)))) throw new ApiError(400, 'invalid_promo_code', 'This promo code is not valid.');
  }

  /** Links a team created at signup with a partner code. Never fails the signup: problems are logged, self referral is recorded as blocked. */
  async attributeSignup(i: SignupAttribution) {
    try {
      const affiliate = await this.approved(normalizeCode(i.promoCode));
      if (!affiliate) return null;
      return await this.link(affiliate, { teamId: i.teamId, userId: i.userId, customer: { userIds: [i.userId], emails: [i.email] }, ip: i.ip });
    } catch (err) {
      this.log.error(`referral for team ${i.teamId} failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** Adds a partner code to an existing team (billing page), until the team pays its first invoice. */
  async applyPromo(actor: Actor, raw: unknown, ip?: string | null) {
    const affiliate = await this.approved(normalizeCode(raw));
    if (!affiliate) throw new ApiError(400, 'invalid_promo_code', 'This promo code is not valid.');
    if (await this.prisma.referral.findUnique({ where: { teamId: actor.teamId } })) throw new ApiError(409, 'promo_already_applied', 'A promo code is already applied to this account.');
    const paid = await this.prisma.invoice.count({ where: { teamId: actor.teamId, status: 'paid', totalMinor: { gt: 0 } } });
    if (paid) throw new ApiError(409, 'promo_too_late', 'Promo codes can only be added before your first paid invoice.');
    const members = await this.prisma.teamMember.findMany({ where: { teamId: actor.teamId }, include: { user: { select: { email: true } } } });
    const r = await this.link(affiliate, { teamId: actor.teamId, userId: actor.userId, customer: { userIds: members.map((m) => m.userId), emails: members.map((m) => m.user.email) }, ip });
    if (!r) throw new ApiError(409, 'promo_already_applied', 'A promo code is already applied to this account.');
    if (r.status === 'blocked') throw new ApiError(400, 'invalid_promo_code', 'This promo code cannot be used on this account.');
    return presentReferral(r);
  }

  /** The referral of a team as its own billing page shows it (no affiliate details). */
  async forTeam(teamId: string) {
    const r = await this.prisma.referral.findUnique({ where: { teamId } });
    return r && r.status === 'active' ? presentReferral(r) : null;
  }

  private async link(affiliate: Affiliate & { user: { email: string } }, i: { teamId: string; userId: string; customer: { userIds: string[]; emails: string[] }; ip?: string | null }) {
    const s = await this.settings.get();
    const now = new Date();
    const blocked = selfReferralReason({ affiliate: { userId: affiliate.userId, email: affiliate.email, userEmail: affiliate.user.email }, customer: i.customer });
    let r;
    try {
      r = await this.prisma.referral.create({
        data: {
          affiliateId: affiliate.id,
          teamId: i.teamId,
          userId: i.userId,
          code: affiliate.code,
          status: blocked ? 'blocked' : 'active',
          blockedReason: blocked ? `self_referral:${blocked}` : null,
          signupIp: i.ip ?? null,
          discountPercent: blocked ? 0 : s.promoDiscountPercent,
          discountUntil: !blocked && s.promoDiscountMonths ? addMonths(now, s.promoDiscountMonths) : null,
          commissionUntil: addMonths(now, s.commissionMonths),
          attributedAt: now,
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
    await this.events.emit('affiliate.referral_created', { referralId: r.id, affiliateId: affiliate.id, teamId: i.teamId }, { resource: `referral:${r.id}` });
    if (i.ip) await this.checkSignupBurst(affiliate.id, i.ip, s.flagSignupsPerIpPerDay);
    return r;
  }

  /** Many referred signups from one address in a day: flag the affiliate for review (no block). */
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

function presentReferral(r: { code: string; discountPercent: number; discountUntil: Date | null; attributedAt: Date }) {
  return { code: r.code, discountPercent: r.discountPercent, discountUntil: r.discountUntil, attributedAt: r.attributedAt };
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
