import type { ResourceType } from '@prisma/client';
import { CATEGORY_OF, COMMISSION_CATEGORIES, type CommissionCategory } from './categories';

/**
 * Commission maths (docs/affiliates.md). Pure, unit tested in commission-rules.test.ts.
 *
 * Base per product category = the category's share of the invoice usage, minus its share of the
 * promo discount, times the part of the invoice that was settled with money. Money is card,
 * bank transfer and prepaid credit (bought with money); promo, goodwill and refund credit and
 * credit notes are not. Tax is never part of the base.
 */
export interface InvoiceForCommission {
  /** Invoice lines before the discount. */
  lines: { resourceType: ResourceType; amountMinor: number }[];
  discountMinor: number;
  taxMinor: number;
  /** Promo, goodwill and refund credit applied, plus credit notes against what was due. */
  nonCashMinor: number;
}

export interface CommissionLine { category: CommissionCategory; baseMinor: number; rateBp: number; amountMinor: number }

/** Percent (30, 12.5) to basis points (3000, 1250). */
export const toBp = (percent: number) => Math.round(percent * 100);

export function computeCommissions(inv: InvoiceForCommission, ratesPercent: Record<CommissionCategory, number>): CommissionLine[] {
  const byCat = new Map<CommissionCategory, number>();
  for (const l of inv.lines) byCat.set(CATEGORY_OF[l.resourceType], (byCat.get(CATEGORY_OF[l.resourceType]) ?? 0) + l.amountMinor);
  const gross = [...byCat.values()].reduce((s, v) => s + v, 0);
  if (gross <= 0) return [];
  const net = gross - inv.discountMinor;
  const payable = net + inv.taxMinor;
  if (payable <= 0) return [];
  const cashShare = Math.max(0, payable - Math.max(0, inv.nonCashMinor)) / payable;
  const out: CommissionLine[] = [];
  for (const category of COMMISSION_CATEGORIES) {
    const catGross = byCat.get(category) ?? 0;
    if (catGross <= 0) continue;
    const catNet = catGross - (inv.discountMinor * catGross) / gross;
    const baseMinor = Math.round(catNet * cashShare);
    const rateBp = toBp(ratesPercent[category] ?? 0);
    const amountMinor = Math.round((baseMinor * rateBp) / 10_000);
    if (amountMinor > 0) out.push({ category, baseMinor, rateBp, amountMinor });
  }
  return out;
}

/** The promo discount on an invoice: a percentage of the usage, while the discount period lasts. */
export function discountFor(usageMinor: number, referral: { status: string; discountPercent: number; discountUntil: Date | null } | null, periodStart: Date): number {
  if (!referral || referral.status !== 'active' || referral.discountPercent <= 0 || !referral.discountUntil) return 0;
  if (periodStart >= referral.discountUntil || usageMinor <= 0) return 0;
  return Math.min(usageMinor, Math.round((usageMinor * referral.discountPercent) / 100));
}

/**
 * How much more of a commission to reverse when `fraction` of its invoice is refunded or
 * credited, never more than what is left.
 */
export function reversalFor(c: { amountMinor: number; reversedMinor: number }, fraction: number): number {
  const f = Math.min(1, Math.max(0, fraction));
  const left = c.amountMinor - c.reversedMinor;
  return Math.min(left, Math.max(0, Math.round(c.amountMinor * f)));
}
