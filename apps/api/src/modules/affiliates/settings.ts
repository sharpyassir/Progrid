import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiError } from '../../common/errors/api-error';
import type { Actor } from '../../common/auth/actor';
import { COMMISSION_CATEGORIES } from './categories';

const percent = z.number().min(0).max(100);

/**
 * Affiliate program settings, edited by finance staff in the back office. Stored as one JSON row;
 * keys that are not stored use the defaults below, so a new setting needs no migration.
 */
export const affiliateSettingsSchema = z.object({
  /** New applications are accepted. */
  applicationsOpen: z.boolean(),
  /** Commission rate per product category, in percent of the net paid amount. */
  rates: z.object(Object.fromEntries(COMMISSION_CATEGORIES.map((c) => [c, percent])) as Record<(typeof COMMISSION_CATEGORIES)[number], typeof percent>),
  /** How long a referral link click counts (last click wins). */
  cookieDays: z.number().int().min(1).max(365),
  /** Commission stays pending this long after the invoice is paid, then becomes payable. */
  holdDays: z.number().int().min(0).max(365),
  /** Commission is earned on a referred customer's invoices for this many months after signup. */
  commissionMonths: z.number().int().min(1).max(120),
  /** Smallest payout an affiliate may request, per currency, in minor units. */
  minPayoutMinor: z.object({ SAR: z.number().int().min(0), USD: z.number().int().min(0) }),
  /** Discount a customer gets for signing up with a promo code, and for how many months. */
  promoDiscountPercent: z.number().int().min(0).max(100),
  promoDiscountMonths: z.number().int().min(0).max(24),
  /** Flag an affiliate when this many referred signups come from one address within a day. */
  flagSignupsPerIpPerDay: z.number().int().min(2).max(1000),
  /** Flag an affiliate whose reversed commission exceeds this share of earned commission. */
  flagRefundRatePercent: percent,
  /** Version of /affiliates/terms that applicants accept. */
  termsVersion: z.string().min(1).max(40),
});

export type AffiliateSettingsData = z.infer<typeof affiliateSettingsSchema>;

export function defaultAffiliateSettings(): AffiliateSettingsData {
  return {
    applicationsOpen: true,
    rates: { web_hosting: 30, connect: 30, servers: 15, managed_cloud: 15, ai_usage: 0, support: 0 },
    cookieDays: 60,
    holdDays: 60,
    commissionMonths: 12,
    minPayoutMinor: { SAR: 20_000, USD: 5_000 },
    promoDiscountPercent: 10,
    promoDiscountMonths: 3,
    flagSignupsPerIpPerDay: 3,
    flagRefundRatePercent: 30,
    termsVersion: '2026-10',
  };
}

@Injectable()
export class AffiliateSettingsService {
  private cache?: { at: number; value: AffiliateSettingsData };
  constructor(private readonly prisma: PrismaService) {}

  /** Effective settings: stored values over the defaults. Cached for ten seconds. */
  async get(): Promise<AffiliateSettingsData> {
    if (this.cache && Date.now() - this.cache.at < 10_000) return this.cache.value;
    const row = await this.prisma.affiliateSettings.findUnique({ where: { id: 'default' } });
    const value = merge((row?.data as Record<string, unknown>) ?? {});
    this.cache = { at: Date.now(), value };
    return value;
  }

  async present() {
    const [value, row] = await Promise.all([this.get(), this.prisma.affiliateSettings.findUnique({ where: { id: 'default' } })]);
    return { settings: value, defaults: defaultAffiliateSettings(), updatedAt: row?.updatedAt ?? null, updatedById: row?.updatedById ?? null };
  }

  async update(actor: Actor, patch: unknown) {
    const parsed = affiliateSettingsSchema.partial().extend({ rates: affiliateSettingsSchema.shape.rates.partial().optional(), minPayoutMinor: affiliateSettingsSchema.shape.minPayoutMinor.partial().optional() }).strict().safeParse(patch);
    if (!parsed.success) throw ApiError.invalid('Invalid settings', { issues: parsed.error.issues.slice(0, 10) });
    const row = await this.prisma.affiliateSettings.findUnique({ where: { id: 'default' } });
    const stored = (row?.data as Record<string, any>) ?? {};
    const p = parsed.data;
    const data = {
      ...stored,
      ...Object.fromEntries(Object.entries(p).filter(([k, v]) => v !== undefined && k !== 'rates' && k !== 'minPayoutMinor')),
      ...(p.rates ? { rates: { ...(stored.rates ?? {}), ...p.rates } } : {}),
      ...(p.minPayoutMinor ? { minPayoutMinor: { ...(stored.minPayoutMinor ?? {}), ...p.minPayoutMinor } } : {}),
    };
    await this.prisma.affiliateSettings.upsert({ where: { id: 'default' }, create: { id: 'default', data: data as Prisma.InputJsonValue, updatedById: actor.userId }, update: { data: data as Prisma.InputJsonValue, updatedById: actor.userId } });
    this.cache = undefined;
    return { changed: Object.keys(p), ...(await this.present()) };
  }
}

/** Stored keys over the defaults; nested objects merge key by key and invalid values are ignored. */
export function merge(stored: Record<string, unknown>): AffiliateSettingsData {
  const d = defaultAffiliateSettings();
  const shape = affiliateSettingsSchema.shape;
  const out: Record<string, unknown> = { ...d };
  for (const [k, v] of Object.entries(stored)) {
    if (!(k in shape)) continue;
    if (k === 'rates' || k === 'minPayoutMinor') {
      const inner = (shape[k] as z.ZodObject<z.ZodRawShape>).shape;
      const ok = Object.entries((v ?? {}) as Record<string, unknown>).filter(([ik, iv]) => ik in inner && inner[ik].safeParse(iv).success);
      out[k] = { ...(d[k] as object), ...Object.fromEntries(ok) };
      continue;
    }
    const r = (shape[k as keyof typeof shape] as z.ZodTypeAny).safeParse(v);
    if (r.success) out[k] = r.data;
  }
  return out as AffiliateSettingsData;
}
