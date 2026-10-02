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
