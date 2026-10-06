import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { Client, signup, sut, type Sut, type Team } from './harness';

/**
 * Affiliate program, phase (a): referral link clicks, referral only by signing up with the
 * partner code (or adding it on the billing page), and the self referral block (docs/affiliates.md).
 */
let s: Sut;
let partner: Team;
let code: string;
let affiliateId: string;
beforeAll(async () => {
  s = await sut();
  partner = await signup(s);
  code = `IT${randomBytes(4).toString('hex').toUpperCase()}`;
  const a = await s.prisma.affiliate.create({
    data: {
      userId: partner.userId, status: 'approved', code, name: 'Sara Creator', email: partner.email, country: 'US',
      channels: ['https://youtube.com/@sara'], audienceSize: '10k-50k', contentLanguage: 'en', promotionPlan: 'Tutorials', termsVersion: '2026-10', termsAcceptedAt: new Date(),
    },
  });
  affiliateId = a.id;
});

const DAY = 86_400_000;
const ip = () => `198.18.${1 + Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;

/** Signup straight over HTTP so the test can send a Cookie header and pick the address. */
async function rawSignup(body: Record<string, unknown>, opts: { cookie?: string; ip?: string } = {}) {
  const email = (body.email as string) ?? `it-${randomBytes(6).toString('hex')}@example.test`;
  const r = await fetch(`${s.baseUrl}/v1/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': opts.ip ?? ip(), ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    body: JSON.stringify({ acceptTerms: true, password: `pw-${randomBytes(9).toString('base64url')}`, name: 'Referred Customer', teamName: 'Referred team', country: 'US', ...body, email }),
  });
  return { status: r.status, body: (await r.json()) as any, email };
}

const refCookie = (c: string, at = Date.now()) => `prgd_ref=${c}.${Math.floor(at / 1000)}`;

describe('affiliate tracking', () => {
  it('counts a referral click once per visitor per day and ignores unknown codes', async () => {
    const c = new Client(s.baseUrl);
    for (let i = 0; i < 2; i++) expect((await c.post('/v1/affiliates/clicks', { code: code.toLowerCase(), path: '/pricing', referrer: 'https://youtube.com/watch?v=abc' }, { token: null })).status).toBe(204);
    await new Client(s.baseUrl).post('/v1/affiliates/clicks', { code }, { token: null });
    expect((await c.post('/v1/affiliates/clicks', { code: 'NOSUCHCODE' }, { token: null })).status).toBe(204);
    const clicks = await s.prisma.affiliateClick.findMany({ where: { affiliateId } });
    expect(clicks).toHaveLength(2);
    expect(clicks.find((x) => x.landingPath === '/pricing')?.referrer).toBe('https://youtube.com');
  });

  it('publishes the program terms for the affiliates page', async () => {
    const p = await new Client(s.baseUrl).ok('GET', '/v1/affiliates/program');
    expect(p).toMatchObject({ applicationsOpen: true, cookieDays: 60, holdDays: 60, commissionMonths: 12, minPayoutMinor: { SAR: 20_000, USD: 5_000 }, promoDiscountPercent: 10, promoDiscountMonths: 3 });
    expect(p.rates).toEqual({ web_hosting: 30, connect: 30, servers: 15, managed_cloud: 15, ai_usage: 0, support: 0 });
  });

  it('describes a code, and a referral cookie only while the click is recent', async () => {
    const c = new Client(s.baseUrl);
    expect(await c.ok('GET', `/v1/affiliates/codes/${code}`)).toEqual({ code, valid: true, discountPercent: 10, discountMonths: 3 });
    expect(await c.ok('GET', '/v1/affiliates/codes/NOSUCHCODE')).toEqual({ code: 'NOSUCHCODE', valid: false });
    expect((await c.ok('GET', `/v1/affiliates/codes/${code}.${Math.floor((Date.now() - 10 * DAY) / 1000)}`)).valid).toBe(true);
    expect((await c.ok('GET', `/v1/affiliates/codes/${code}.${Math.floor((Date.now() - 61 * DAY) / 1000)}`)).valid).toBe(false);
  });

  it('does not refer a customer who only came through the link', async () => {
    const r = await rawSignup({}, { cookie: refCookie(code) });
    expect(r.status).toBe(201);
    expect(await s.prisma.referral.findUnique({ where: { teamId: r.body.team.id } })).toBeNull();
  });

  it('refers a customer who signs up with the code, for 12 months, with the discount', async () => {
    const visitor = ip();
    const r = await rawSignup({ promoCode: code.toLowerCase() }, { ip: visitor });
    expect(r.status).toBe(201);
    const ref = await s.prisma.referral.findUniqueOrThrow({ where: { teamId: r.body.team.id } });
    expect(ref).toMatchObject({ affiliateId, code, status: 'active', discountPercent: 10, signupIp: visitor });
    const months = (ref.commissionUntil.getTime() - ref.attributedAt.getTime()) / DAY;
    expect(months).toBeGreaterThan(364);
    expect(months).toBeLessThan(367);
    const days = (ref.discountUntil!.getTime() - ref.attributedAt.getTime()) / DAY;
    expect(days).toBeGreaterThan(88);
    expect(days).toBeLessThan(93);
    expect((await s.prisma.user.findUniqueOrThrow({ where: { id: r.body.user.id } })).signupIp).toBe(visitor);
  });

  it('refuses an unknown promo code before creating the account', async () => {
    const r = await rawSignup({ promoCode: 'NOSUCHCODE' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('invalid_promo_code');
    expect(await s.prisma.user.findUnique({ where: { email: r.email } })).toBeNull();
  });

  it('refuses codes of affiliates that are not approved', async () => {
    const pending = await signup(s);
    const pendingCode = `IT${randomBytes(4).toString('hex').toUpperCase()}`;
    await s.prisma.affiliate.create({ data: { userId: pending.userId, status: 'pending', code: pendingCode, name: 'P', email: pending.email, country: 'US', channels: [], audienceSize: '1k', contentLanguage: 'en', promotionPlan: '-', termsVersion: '2026-10', termsAcceptedAt: new Date() } });
    expect((await rawSignup({ promoCode: pendingCode })).status).toBe(400);
  });

  it('blocks self referral by mailbox and flags it, but not a customer on the same network', async () => {
    const [local, domain] = partner.email.split('@');
    const sameMailbox = await rawSignup({ email: `${local}+alt@${domain}`, promoCode: code });
    expect(sameMailbox.status).toBe(201);
    expect(await s.prisma.referral.findUniqueOrThrow({ where: { teamId: sameMailbox.body.team.id } })).toMatchObject({ status: 'blocked', blockedReason: 'self_referral:same_email', discountPercent: 0 });
    expect(await s.prisma.affiliateFlag.count({ where: { affiliateId, kind: 'self_referral' } })).toBe(1);

    const sameAddress = await rawSignup({ promoCode: code }, { ip: partner.client.ip });
    expect(await s.prisma.referral.findUniqueOrThrow({ where: { teamId: sameAddress.body.team.id } })).toMatchObject({ status: 'active', discountPercent: 10 });
  });

  it('flags many referred signups from one address without blocking them', async () => {
    const one = ip();
    for (let i = 0; i < 3; i++) await rawSignup({ promoCode: code }, { ip: one });
    expect(await s.prisma.affiliateFlag.count({ where: { affiliateId, kind: 'signups_from_one_ip' } })).toBe(1);
    expect(await s.prisma.referral.count({ where: { affiliateId, signupIp: one, status: 'active' } })).toBe(3);
  });

  it('adds a code on the billing page until the first paid invoice, once', async () => {
    const t = await signup(s);
    expect((await t.client.ok('GET', '/v1/billing/referral')).referral).toBeNull();
    expect((await t.client.post('/v1/billing/promo-code', { code: 'NOSUCHCODE' })).status).toBe(400);
    const r = await t.client.ok('POST', '/v1/billing/promo-code', { code }, 201);
    expect(r.referral).toMatchObject({ code, discountPercent: 10 });
    expect((await t.client.ok('GET', '/v1/billing/referral')).referral.code).toBe(code);
    expect((await t.client.post('/v1/billing/promo-code', { code })).body.error.code).toBe('promo_already_applied');

    const late = await signup(s);
    await s.prisma.invoice.create({ data: { teamId: late.teamId, number: `IT-${randomBytes(4).toString('hex')}`, currency: 'USD', periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-02-01'), subtotalMinor: 1000, totalMinor: 1000, status: 'paid', paidAt: new Date() } });
    expect((await late.client.post('/v1/billing/promo-code', { code })).body.error.code).toBe('promo_too_late');
  });
});

describe('affiliate portal', () => {
  const application = (over: Record<string, unknown> = {}) => ({
    name: 'Lina Builds', country: 'SA', channels: ['https://youtube.com/@linabuilds'], audienceSize: '10k_50k', contentLanguage: 'ar_en',
    promotionPlan: 'Weekly deploy tutorials in Arabic and English, with a pinned code in each video.', acceptTerms: true, formStartedAt: Date.now() - 20_000, ...over,
  });

  it('refuses bots and applications without the terms', async () => {
    const t = await signup(s);
    expect((await t.client.post('/v1/affiliates/apply', application({ website: 'http://spam.example' }))).body.error.code).toBe('bot_check_failed');
    expect((await t.client.post('/v1/affiliates/apply', application({ formStartedAt: Date.now() }))).body.error.code).toBe('bot_check_failed');
    // Test accounts sign up in Saudi Arabia, so their console language and mail are Arabic.
    expect((await t.client.post('/v1/affiliates/apply', application({ acceptTerms: false }))).status).toBe(422);
    expect((await t.client.post('/v1/affiliates/apply', application({ channels: ['not a url'] }))).status).toBe(400);
  });

  it('takes an application, keeps the dashboard closed until approval, and mails the applicant', async () => {
    const t = await signup(s);
    const wanted = `LINA${randomBytes(3).toString('hex').toUpperCase()}`;
    const r = await t.client.ok('POST', '/v1/affiliates/apply', application({ preferredCode: wanted.toLowerCase() }), 201);
    expect(r.affiliate).toMatchObject({ status: 'pending', code: null, email: t.email, country: 'SA' });
    expect((await t.client.post('/v1/affiliates/apply', application())).body.error.code).toBe('already_applied');
    expect(s.outbox.some((m) => m.to === t.email && /طلب انضمامك/.test(m.subject))).toBe(true);
    expect((await t.client.get('/v1/affiliates/me/dashboard')).body.error.code).toBe('not_an_affiliate');
    const row = await s.prisma.affiliate.findUniqueOrThrow({ where: { userId: t.userId } });
    expect(row.code).toBe(wanted);
    const me = await t.client.ok('GET', '/v1/affiliates/me');
    expect(me.affiliate.status).toBe('pending');
    expect(me.program.minPayoutMinor).toEqual({ SAR: 20_000, USD: 5_000 });
  });

  it('shows the dashboard, anonymized referrals, payout details and payouts to an approved affiliate', async () => {
    const t = await signup(s);
    await t.client.ok('POST', '/v1/affiliates/apply', application(), 201);
    const a = await s.prisma.affiliate.update({ where: { userId: t.userId }, data: { status: 'approved', reviewedAt: new Date() } });

    // Two referred customers: one paying, one not yet.
    const c1 = await rawSignup({ promoCode: a.code });
    await rawSignup({ promoCode: a.code });
    await new Client(s.baseUrl).post('/v1/affiliates/clicks', { code: a.code }, { token: null });
    const ref1 = await s.prisma.referral.findUniqueOrThrow({ where: { teamId: c1.body.team.id } });
    const inv = await s.prisma.invoice.create({ data: { teamId: c1.body.team.id, number: `IT-${randomBytes(4).toString('hex')}`, currency: 'SAR', periodStart: new Date('2026-08-01'), periodEnd: new Date('2026-09-01'), subtotalMinor: 100_000, totalMinor: 115_000, status: 'paid', paidAt: new Date() } });
    await s.prisma.affiliateCommission.createMany({ data: [
      { affiliateId: a.id, referralId: ref1.id, invoiceId: inv.id, category: 'servers', currency: 'SAR', baseMinor: 80_000, rateBp: 1500, amountMinor: 12_000, status: 'approved', holdUntil: new Date(), approvedAt: new Date() },
      { affiliateId: a.id, referralId: ref1.id, invoiceId: inv.id, category: 'web_hosting', currency: 'SAR', baseMinor: 20_000, rateBp: 3000, amountMinor: 6_000, status: 'pending', holdUntil: new Date(Date.now() + 60 * DAY) },
    ] });

    const d = await t.client.ok('GET', '/v1/affiliates/me/dashboard');
    expect(d).toMatchObject({ code: a.code, clicks: 1, signups: 2, payingCustomers: 1 });
    expect(d.links[0]).toMatch(new RegExp(`\\?ref=${a.code}$`));
    expect(d.balances.SAR).toMatchObject({ pending: 6_000, available: 12_000, paidOut: 0, minPayoutMinor: 20_000 });
    expect(d.commissions.SAR).toMatchObject({ pending: 6_000, approved: 12_000 });
    const past = await t.client.ok('GET', '/v1/affiliates/me/dashboard?from=2025-01-01&to=2025-01-31');
    expect(past).toMatchObject({ clicks: 0, signups: 0 });

    const refs = await t.client.ok('GET', '/v1/affiliates/me/referrals');
    expect(refs.data).toHaveLength(2);
    const paying = refs.data.find((x: any) => x.status === 'paying');
    expect(paying.customer).toMatch(/^Customer [0-9A-F]{6}$/);
    expect(paying.services.sort()).toEqual(['servers', 'web_hosting']);
    expect(paying.commission).toEqual([{ currency: 'SAR', amountMinor: 18_000 }]);
    expect(JSON.stringify(refs)).not.toContain(c1.email);

    // Below the minimum, and without payout details.
    expect((await t.client.post('/v1/affiliates/me/payouts', { currency: 'SAR' })).body.error.code).toBe('payout_details_missing');
    const det = await t.client.ok('PUT', '/v1/affiliates/me/payout-details', { method: 'bank_transfer', holderName: 'Lina A', bankName: 'Example Bank', bankCountry: 'SA', iban: 'SA03 8000 0000 6080 1016 7519', swift: 'EXMPSARI' });
    expect(det.details).toMatchObject({ ibanLast4: '7519', holderName: 'Lina A' });
    expect(JSON.stringify(det)).not.toContain('6080');
    expect((await s.prisma.affiliate.findUniqueOrThrow({ where: { id: a.id } })).payoutDetails).toMatch(/^enc:v[12]:/);
    expect((await t.client.post('/v1/affiliates/me/payouts', { currency: 'SAR' })).body.error.code).toBe('below_minimum');

    // Enough approved commission: one payout takes all of it.
    await s.prisma.affiliateCommission.create({ data: { affiliateId: a.id, referralId: ref1.id, invoiceId: inv.id, category: 'connect', currency: 'SAR', baseMinor: 30_000, rateBp: 3000, amountMinor: 9_000, status: 'approved', holdUntil: new Date(), approvedAt: new Date() } });
    const p = await t.client.ok('POST', '/v1/affiliates/me/payouts', { currency: 'SAR' }, 201);
    expect(p).toMatchObject({ currency: 'SAR', amountMinor: 21_000, status: 'requested' });
    expect((await t.client.post('/v1/affiliates/me/payouts', { currency: 'SAR' })).body.error.code).toBe('payout_pending');
    expect((await t.client.ok('GET', '/v1/affiliates/me/dashboard')).balances.SAR).toMatchObject({ available: 0, requested: 21_000 });
    expect((await t.client.ok('GET', '/v1/affiliates/me/payouts')).data).toHaveLength(1);
    expect(s.outbox.some((m) => m.to === t.email && /طلب الصرف/.test(m.subject))).toBe(true);
  });

  it('is not available to API tokens', async () => {
    const t = await signup(s);
    const tok = await t.client.ok('POST', '/v1/tokens', { name: 'ci', scopes: ['servers:read'] }, 201);
    const r = await new Client(s.baseUrl, tok.token ?? tok.secret).get('/v1/affiliates/me');
    expect(r.status).toBe(403);
  });
});
