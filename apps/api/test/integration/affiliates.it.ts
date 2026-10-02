import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { Client, signup, sut, type Sut, type Team } from './harness';

/**
 * Affiliate program, phase (a): referral link clicks, attribution at signup (cookie and promo
 * code), the promo code on the billing page, and the self referral block (docs/affiliates.md).
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
    body: JSON.stringify({ password: `pw-${randomBytes(9).toString('base64url')}`, name: 'Referred Customer', teamName: 'Referred team', country: 'US', ...body, email }),
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

  it('describes a promo code', async () => {
    const c = new Client(s.baseUrl);
    expect(await c.ok('GET', `/v1/affiliates/codes/${code}`)).toEqual({ code, valid: true, discountPercent: 10, discountMonths: 3 });
    expect(await c.ok('GET', '/v1/affiliates/codes/NOSUCHCODE')).toEqual({ code: 'NOSUCHCODE', valid: false });
  });

  it('links a signup to the partner from the referral cookie, without a discount', async () => {
    const visitor = ip();
    const r = await rawSignup({}, { cookie: refCookie(code, Date.now() - 10 * DAY), ip: visitor });
    expect(r.status).toBe(201);
    const ref = await s.prisma.referral.findUniqueOrThrow({ where: { teamId: r.body.team.id } });
    expect(ref).toMatchObject({ affiliateId, source: 'link', status: 'active', discountPercent: 0, discountUntil: null, signupIp: visitor });
    const months = (ref.commissionUntil.getTime() - ref.attributedAt.getTime()) / DAY;
    expect(months).toBeGreaterThan(364);
    expect(months).toBeLessThan(367);
    expect((await s.prisma.user.findUniqueOrThrow({ where: { id: r.body.user.id } })).signupIp).toBe(visitor);
  });

  it('ignores a click older than the cookie duration', async () => {
    const r = await rawSignup({}, { cookie: refCookie(code, Date.now() - 61 * DAY) });
    expect(r.status).toBe(201);
    expect(await s.prisma.referral.findUnique({ where: { teamId: r.body.team.id } })).toBeNull();
  });

  it('lets a typed promo code win over the cookie and gives the discount', async () => {
    const other = await signup(s);
    const otherCode = `IT${randomBytes(4).toString('hex').toUpperCase()}`;
    const b = await s.prisma.affiliate.create({ data: { userId: other.userId, status: 'approved', code: otherCode, name: 'Other', email: other.email, country: 'SA', channels: [], audienceSize: '1k', contentLanguage: 'ar', promotionPlan: '-', termsVersion: '2026-10', termsAcceptedAt: new Date() } });
    const r = await rawSignup({ promoCode: otherCode.toLowerCase() }, { cookie: refCookie(code) });
    expect(r.status).toBe(201);
    const ref = await s.prisma.referral.findUniqueOrThrow({ where: { teamId: r.body.team.id } });
    expect(ref).toMatchObject({ affiliateId: b.id, source: 'promo_code', discountPercent: 10 });
    const days = (ref.discountUntil!.getTime() - ref.attributedAt.getTime()) / DAY;
    expect(days).toBeGreaterThan(88);
    expect(days).toBeLessThan(93);
  });

  it('refuses an unknown promo code before creating the account', async () => {
    const r = await rawSignup({ promoCode: 'NOSUCHCODE' });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('invalid_promo_code');
    expect(await s.prisma.user.findUnique({ where: { email: r.email } })).toBeNull();
  });

  it('ignores codes of affiliates that are not approved', async () => {
    const pending = await signup(s);
    const pendingCode = `IT${randomBytes(4).toString('hex').toUpperCase()}`;
    await s.prisma.affiliate.create({ data: { userId: pending.userId, status: 'pending', code: pendingCode, name: 'P', email: pending.email, country: 'US', channels: [], audienceSize: '1k', contentLanguage: 'en', promotionPlan: '-', termsVersion: '2026-10', termsAcceptedAt: new Date() } });
    const r = await rawSignup({}, { cookie: refCookie(pendingCode) });
    expect(await s.prisma.referral.findUnique({ where: { teamId: r.body.team.id } })).toBeNull();
    expect((await rawSignup({ promoCode: pendingCode })).status).toBe(400);
  });

  it('blocks self referral by mailbox and by address, and flags it', async () => {
    const [local, domain] = partner.email.split('@');
    const sameMailbox = await rawSignup({ email: `${local}+alt@${domain}` }, { cookie: refCookie(code) });
    expect(await s.prisma.referral.findUniqueOrThrow({ where: { teamId: sameMailbox.body.team.id } })).toMatchObject({ status: 'blocked', blockedReason: 'self_referral:same_email', discountPercent: 0 });

    const sameAddress = await rawSignup({ promoCode: code }, { ip: partner.client.ip });
    expect(sameAddress.status).toBe(201);
    expect(await s.prisma.referral.findUniqueOrThrow({ where: { teamId: sameAddress.body.team.id } })).toMatchObject({ status: 'blocked', blockedReason: 'self_referral:same_ip', discountPercent: 0 });

    const flags = await s.prisma.affiliateFlag.findMany({ where: { affiliateId, kind: 'self_referral' } });
    expect(flags.length).toBeGreaterThanOrEqual(2);
  });

  it('flags many referred signups from one address', async () => {
    const one = ip();
    for (let i = 0; i < 3; i++) await rawSignup({}, { cookie: refCookie(code), ip: one });
    expect(await s.prisma.affiliateFlag.count({ where: { affiliateId, kind: 'signups_from_one_ip' } })).toBe(1);
  });

  it('adds a promo code on the billing page until the first paid invoice', async () => {
    const t = await signup(s);
    expect((await t.client.ok('GET', '/v1/billing/referral')).referral).toBeNull();
    const bad = await t.client.post('/v1/billing/promo-code', { code: 'NOSUCHCODE' });
    expect(bad.status).toBe(400);
    const r = await t.client.ok('POST', '/v1/billing/promo-code', { code }, 201);
    expect(r.referral).toMatchObject({ code, source: 'promo_code', discountPercent: 10 });
    expect((await t.client.post('/v1/billing/promo-code', { code })).body.error.code).toBe('promo_already_applied');

    // A team that already paid an invoice is too late.
    const late = await signup(s);
    await s.prisma.invoice.create({ data: { teamId: late.teamId, number: `IT-${randomBytes(4).toString('hex')}`, currency: 'USD', periodStart: new Date('2026-01-01'), periodEnd: new Date('2026-02-01'), subtotalMinor: 1000, totalMinor: 1000, status: 'paid', paidAt: new Date() } });
    expect((await late.client.post('/v1/billing/promo-code', { code })).body.error.code).toBe('promo_too_late');
  });

  it('upgrades a link referral to the same partner promo code, and refuses another partner', async () => {
    const r = await rawSignup({}, { cookie: refCookie(code) });
    const client = new Client(s.baseUrl, r.body.session);
    const up = await client.ok('POST', '/v1/billing/promo-code', { code }, 201);
    expect(up.referral).toMatchObject({ source: 'promo_code', discountPercent: 10 });

    const r2 = await rawSignup({}, { cookie: refCookie(code) });
    const other = await s.prisma.affiliate.findFirstOrThrow({ where: { status: 'approved', NOT: { id: affiliateId } } });
    const res = await new Client(s.baseUrl, r2.body.session).post('/v1/billing/promo-code', { code: other.code });
    expect(res.body.error.code).toBe('already_referred');
  });
});
