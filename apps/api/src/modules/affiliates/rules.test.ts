import { describe, expect, it } from 'vitest';
import { addMonths, canonicalEmail, normalizeCode, parseRef, selfReferralReason, suggestCode } from './rules';
import { CATEGORY_OF, COMMISSION_CATEGORIES } from './categories';
import { defaultAffiliateSettings, merge } from './settings';

const NOW = new Date('2026-10-15T12:00:00Z');
const secs = (d: Date) => Math.floor(d.getTime() / 1000);

describe('codes', () => {
  it('accepts 4 to 20 letters and digits, case insensitive', () => {
    expect(normalizeCode(' sara10 ')).toBe('SARA10');
    expect(normalizeCode('ABC')).toBeNull();
    expect(normalizeCode('A'.repeat(21))).toBeNull();
    expect(normalizeCode('SARA-10')).toBeNull();
    expect(normalizeCode(undefined)).toBeNull();
  });

  it('suggests a valid code from any name', () => {
    expect(normalizeCode(suggestCode('Sara Ahmed', () => 0.0042))).toBe('SARAAHMED0042');
    expect(normalizeCode(suggestCode('سارة', () => 0.5))).toBe('PRGD5000');
  });
});

describe('referral cookie', () => {
  it('counts a click for the configured number of days', () => {
    const day59 = new Date(NOW.getTime() - 59 * 86_400_000);
    const day61 = new Date(NOW.getTime() - 61 * 86_400_000);
    expect(parseRef(`SARA10.${secs(day59)}`, NOW, 60)).toBe('SARA10');
    expect(parseRef(`SARA10.${secs(day61)}`, NOW, 60)).toBeNull();
    expect(parseRef(`SARA10.${secs(day61)}`, NOW, 90)).toBe('SARA10');
  });

  it('takes a bare code as a fresh click and rejects junk and future times', () => {
    expect(parseRef('sara10', NOW, 60)).toBe('SARA10');
    expect(parseRef(`SARA10.${secs(NOW) + 86_400}`, NOW, 60)).toBeNull();
    expect(parseRef('SARA10.abc', NOW, 60)).toBeNull();
    expect(parseRef('<script>', NOW, 60)).toBeNull();
    expect(parseRef(undefined, NOW, 60)).toBeNull();
  });
});

describe('self referral', () => {
  const affiliate = { userId: 'u_aff', email: 'Sara.Ahmed+promo@gmail.com', userEmail: 'sara@studio.example' };

  it('blocks the same user and the same mailbox', () => {
    expect(selfReferralReason({ affiliate, customer: { userIds: ['u_aff'], emails: ['x@example.com'] } })).toBe('same_user');
    expect(selfReferralReason({ affiliate, customer: { userIds: ['u1'], emails: ['saraahmed@googlemail.com'] } })).toBe('same_email');
    expect(selfReferralReason({ affiliate, customer: { userIds: ['u1'], emails: ['SARA+test@studio.example'] } })).toBe('same_email');
  });

  it('lets a real customer through, even from the same network', () => {
    expect(selfReferralReason({ affiliate, customer: { userIds: ['u1'], emails: ['sara.ahmed@outlook.com'] } })).toBeNull();
  });

  it('canonicalizes only what mail providers treat as the same mailbox', () => {
    expect(canonicalEmail('S.A.R.A@Gmail.com')).toBe('sara@gmail.com');
    expect(canonicalEmail('s.ara+x@example.com')).toBe('s.ara@example.com');
  });
});

describe('dates', () => {
  it('adds months and clamps to the end of the month', () => {
    expect(addMonths(new Date('2026-01-31T10:00:00Z'), 1).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addMonths(new Date('2026-10-15T00:00:00Z'), 12).toISOString()).toBe('2027-10-15T00:00:00.000Z');
    expect(addMonths(new Date('2026-11-30T00:00:00Z'), 3).toISOString()).toBe('2027-02-28T00:00:00.000Z');
  });
});

describe('categories and settings', () => {
  it('maps every resource type to a category with a default rate', () => {
    const rates = defaultAffiliateSettings().rates;
    for (const c of Object.values(CATEGORY_OF)) expect(COMMISSION_CATEGORIES).toContain(c);
    expect(rates).toEqual({ web_hosting: 30, connect: 30, servers: 15, managed_cloud: 15, ai_usage: 0, support: 0 });
    expect(CATEGORY_OF.app_instance).toBe('web_hosting');
    expect(CATEGORY_OF.connect_ai_output).toBe('ai_usage');
    expect(CATEGORY_OF.managed_plan).toBe('managed_cloud');
  });

  it('merges stored settings over the defaults key by key and ignores invalid values', () => {
    const s = merge({ cookieDays: 30, rates: { servers: 20, connect: 'x' }, minPayoutMinor: { USD: 10_000 }, unknown: 1, holdDays: -5 });
    expect(s.cookieDays).toBe(30);
    expect(s.holdDays).toBe(60);
    expect(s.rates.servers).toBe(20);
    expect(s.rates.web_hosting).toBe(30);
    expect(s.minPayoutMinor).toEqual({ SAR: 20_000, USD: 10_000 });
    expect(s.rates.connect).toBe(30);
    expect((s as Record<string, unknown>).unknown).toBeUndefined();
  });
});
