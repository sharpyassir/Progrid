'use client';

import { useShell } from '@/components/shell';
import { adyn, at, atf, type AKey, type AStringKey } from '@/lib/i18n-affiliates';

/** Affiliate portal strings for the current console language. */
export function useA() {
  const { locale } = useShell();
  return {
    locale,
    a: (k: AStringKey) => at(locale, k),
    af: <K extends AKey>(k: K) => atf(locale, k),
    ad: (prefix: string, v: string) => adyn(locale, prefix, v),
  };
}

export type Cur = 'USD' | 'SAR';
export const CURRENCIES: Cur[] = ['USD', 'SAR'];

export interface Program {
  applicationsOpen: boolean; termsVersion: string; rates: Record<string, number>; holdDays: number; cookieDays: number; commissionMonths: number;
  minPayoutMinor: Record<Cur, number>; promoDiscountPercent: number; promoDiscountMonths: number;
}
export interface AffiliateInfo {
  id: string; status: 'pending' | 'approved' | 'rejected' | 'suspended'; code: string | null; name: string; email: string; country: string; channels: string[];
  audienceSize: string; contentLanguage: string; promotionPlan: string; statusReason: string | null; appliedAt: string; reviewedAt: string | null; hasPayoutDetails: boolean; links: string[];
}
export interface Me { user: { name: string; email: string }; affiliate: AffiliateInfo | null; canReapplyAt: string | null; program: Program }

export function date(iso: string | null | undefined, locale: string) {
  return iso ? new Date(iso).toLocaleDateString(locale === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : locale, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-lg font-semibold" dir="ltr" style={{ unicodeBidi: 'isolate' }}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-neutral-500">{hint}</div>}
    </div>
  );
}
