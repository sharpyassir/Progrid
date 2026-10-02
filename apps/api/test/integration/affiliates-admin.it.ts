import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { Client, signup, sut, totp, type Sut, type Team } from './harness';

/**
 * Affiliate program, phase (e): the back office for finance staff. Review applications, settings,
 * payouts, suspension, flags, chargebacks and CSV exports (docs/affiliates.md).
 */
let s: Sut;
let finance: Client;
const DAY = 86_400_000;

/** A staff member with these roles, signed in with two factor. */
async function staff(roles: string[]) {
  const t = await signup(s);
  const setup = await t.client.ok('POST', '/v1/auth/totp/setup', {}, 201);
  await t.client.ok('POST', '/v1/auth/totp/enable', { code: totp(setup.secret) }, 201);
  await s.prisma.user.update({ where: { id: t.userId }, data: { isStaff: true, staffRoles: roles } });
  const c = new Client(s.baseUrl);
  const r = await c.post('/v1/auth/login', { email: t.email, password: t.password, totp: totp(setup.secret) });
  expect(r.status).toBe(200);
  c.token = r.body.session;
  return c;
}

const application = (over: Record<string, unknown> = {}) => ({
  name: 'Omar Teaches', country: 'SA', channels: ['https://youtube.com/@omarteaches'], audienceSize: '1k_10k', contentLanguage: 'ar',
  promotionPlan: 'Arabic DevOps course with a Progrid lab in every module.', acceptTerms: true, formStartedAt: Date.now() - 30_000, ...over,
});

async function applicant() {
  const t = await signup(s);
  const r = await t.client.ok('POST', '/v1/affiliates/apply', application(), 201);
  return { t, id: r.affiliate.id as string };
}

beforeAll(async () => {
  s = await sut();
  finance = await staff(['finance']);
});

describe('affiliate back office', () => {
  it('is for finance staff only', async () => {
    const support = await staff(['support']);
    expect((await support.get('/admin/v1/affiliates')).status).toBe(403);
    const customer = await signup(s);
    expect((await customer.client.get('/admin/v1/affiliates')).status).toBe(403);
    expect((await finance.get('/admin/v1/affiliates')).status).toBe(200);
  });

  it('approves with a chosen code and rejects with a reason, mailing the applicant each time', async () => {
    const a = await applicant();
    const list = await finance.ok('GET', '/admin/v1/affiliates?status=pending');
    expect(list.data.some((x: any) => x.id === a.id)).toBe(true);
    const detail = await finance.ok('GET', `/admin/v1/affiliates/${a.id}`);
    expect(detail).toMatchObject({ status: 'pending', promotionPlan: expect.stringContaining('DevOps course'), payoutDetails: null });

    const want = `OMAR${randomBytes(2).toString('hex').toUpperCase()}`;
    const ok = await finance.ok('POST', `/admin/v1/affiliates/${a.id}/approve`, { code: want.toLowerCase() });
    expect(ok).toMatchObject({ status: 'approved', code: want });
    expect((await finance.post(`/admin/v1/affiliates/${a.id}/approve`, {})).status).toBe(409);
    expect(s.outbox.some((m) => m.to === a.t.email && m.text.includes(want))).toBe(true);
    expect((await a.t.client.ok('GET', '/v1/affiliates/me/dashboard')).code).toBe(want);

    const b = await applicant();
    expect((await finance.post(`/admin/v1/affiliates/${b.id}/approve`, { code: want })).body.error.code).toBe('code_taken');
    await finance.ok('POST', `/admin/v1/affiliates/${b.id}/reject`, { reason: 'Audience outside our market for now' });
    const me = await b.t.client.ok('GET', '/v1/affiliates/me');
    expect(me.affiliate).toMatchObject({ status: 'rejected', statusReason: 'Audience outside our market for now' });
    expect(new Date(me.canReapplyAt).getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
    expect(s.outbox.filter((m) => m.to === b.t.email).length).toBeGreaterThanOrEqual(2);
  });

  it('edits the settings, and the public program follows', async () => {
    const r = await finance.ok('PATCH', '/admin/v1/affiliates/settings', { rates: { servers: 20 }, cookieDays: 45, minPayoutMinor: { USD: 7_500 } });
    expect(r.settings.rates).toMatchObject({ servers: 20, web_hosting: 30 });
    expect((await finance.patch('/admin/v1/affiliates/settings', { holdDays: -1 })).status).toBe(422);
    expect((await finance.patch('/admin/v1/affiliates/settings', { unknown: 1 })).status).toBe(422);
    await new Promise((res) => setTimeout(res, 10_500)); // settings are cached for ten seconds
    const p = await new Client(s.baseUrl).ok('GET', '/v1/affiliates/program');
    expect(p).toMatchObject({ cookieDays: 45, minPayoutMinor: { USD: 7_500, SAR: 20_000 } });
    expect(p.rates.servers).toBe(20);
    await finance.ok('PATCH', '/admin/v1/affiliates/settings', { rates: { servers: 15 }, cookieDays: 60, minPayoutMinor: { USD: 5_000 } });
  });

  it('pays a payout request, cancels another, and exports CSV', async () => {
    const a = await applicant();
    const aff = await finance.ok('POST', `/admin/v1/affiliates/${a.id}/approve`, {});
    // A referred customer with an invoice and approved commission.
    const cust = await signup(s);
    const ref = await s.prisma.referral.create({ data: { affiliateId: a.id, teamId: cust.teamId, userId: cust.userId, code: aff.code, commissionUntil: new Date(Date.now() + 300 * DAY) } });
    const inv = await s.prisma.invoice.create({ data: { teamId: cust.teamId, number: `IT-${randomBytes(4).toString('hex')}`, currency: 'SAR', periodStart: new Date('2026-08-01'), periodEnd: new Date('2026-09-01'), subtotalMinor: 100_000, totalMinor: 115_000, status: 'paid', paidAt: new Date() } });
    const mk = (category: string, amountMinor: number) => s.prisma.affiliateCommission.create({ data: { affiliateId: a.id, referralId: ref.id, invoiceId: inv.id, category, currency: 'SAR', baseMinor: amountMinor * 3, rateBp: 3000, amountMinor, status: 'approved', holdUntil: new Date(), approvedAt: new Date() } });
    await mk('web_hosting', 15_000);
    await mk('connect', 9_000);
    await a.t.client.ok('PUT', '/v1/affiliates/me/payout-details', { method: 'bank_transfer', holderName: 'Omar K', bankName: 'Example Bank', bankCountry: 'SA', iban: 'SA4420000001234567891234' });
    const req = await a.t.client.ok('POST', '/v1/affiliates/me/payouts', { currency: 'SAR' }, 201);
    expect(req.amountMinor).toBe(24_000);

    const pays = await finance.ok('GET', '/admin/v1/affiliates/payouts?status=requested');
    const mine = pays.data.find((p: any) => p.id === req.id);
    expect(mine).toMatchObject({ payingCompany: 'Progrid Arabia', details: { iban: 'SA4420000001234567891234', holderName: 'Omar K' } });

    const paid = await finance.ok('POST', `/admin/v1/affiliates/payouts/${req.id}/paid`, { reference: 'TRF-2026-1001' });
    expect(paid).toMatchObject({ status: 'paid', reference: 'TRF-2026-1001' });
    expect(await s.prisma.affiliateCommission.count({ where: { payoutId: req.id, status: 'paid' } })).toBe(2);
    expect((await finance.post(`/admin/v1/affiliates/payouts/${req.id}/paid`, { reference: 'again' })).status).toBe(409);
    expect((await a.t.client.ok('GET', '/v1/affiliates/me/dashboard')).balances.SAR).toMatchObject({ paidOut: 24_000, available: 0 });
    expect(s.outbox.some((m) => m.to === a.t.email && m.text.includes('TRF-2026-1001'))).toBe(true);

    // A second request, cancelled: its commission is payable again.
    await mk('servers', 21_000);
    const req2 = await a.t.client.ok('POST', '/v1/affiliates/me/payouts', { currency: 'SAR' }, 201);
    await finance.ok('POST', `/admin/v1/affiliates/payouts/${req2.id}/cancel`, { note: 'IBAN rejected by the bank' });
    expect((await a.t.client.ok('GET', '/v1/affiliates/me/dashboard')).balances.SAR).toMatchObject({ available: 21_000, requested: 0 });

    const csv = await finance.req('GET', `/admin/v1/affiliates/export/commissions?affiliateId=${a.id}`);
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    const lines = csv.text.trim().split('\r\n');
    expect(lines[0]).toBe('id,affiliate_code,invoice,invoice_paid,category,currency,base,rate_percent,amount,reversed,status,hold_until,payout_id,created');
    expect(lines).toHaveLength(4);
    expect(csv.text).toContain(',SAR,450.00,30.00,150.00,0.00,paid,');
    const payoutsCsv = await finance.req('GET', '/admin/v1/affiliates/export/payouts?status=paid');
    expect(payoutsCsv.text).toContain('SA4420000001234567891234');
    expect((await finance.get('/admin/v1/affiliates/export/nothing')).status).toBe(422);
  });

  it('suspends and reinstates an affiliate', async () => {
    const a = await applicant();
    const aff = await finance.ok('POST', `/admin/v1/affiliates/${a.id}/approve`, {});
    await finance.ok('POST', `/admin/v1/affiliates/${a.id}/suspend`, { reason: 'Brand bidding in search ads' });
    expect((await a.t.client.get('/v1/affiliates/me/dashboard')).body.error.code).toBe('not_an_affiliate');
    expect((await new Client(s.baseUrl).ok('GET', `/v1/affiliates/codes/${aff.code}`)).valid).toBe(false);
    await finance.ok('POST', `/admin/v1/affiliates/${a.id}/reinstate`, {});
    expect((await new Client(s.baseUrl).ok('GET', `/v1/affiliates/codes/${aff.code}`)).valid).toBe(true);
    const subjects = s.outbox.filter((m) => m.to === a.t.email).map((m) => m.subject).join(' | ');
    expect(subjects).toMatch(/إيقاف/);
    expect(subjects).toMatch(/أُعيد تفعيل/);
  });

  it('lists and resolves flags, and records a chargeback marked by staff', async () => {
    const a = await applicant();
    await finance.ok('POST', `/admin/v1/affiliates/${a.id}/approve`, {});
    await s.prisma.affiliateFlag.create({ data: { affiliateId: a.id, kind: 'signups_from_one_ip', detail: { signups24h: 4 } } });
    const flags = await finance.ok('GET', '/admin/v1/affiliates/flags');
    const f = flags.data.find((x: any) => x.affiliate.id === a.id);
    expect(f).toMatchObject({ kind: 'signups_from_one_ip', resolvedAt: null });
    await finance.ok('POST', `/admin/v1/affiliates/flags/${f.id}/resolve`, {});
    expect((await finance.ok('GET', '/admin/v1/affiliates/flags')).data.some((x: any) => x.id === f.id)).toBe(false);

    const cust = await signup(s);
    const pay = await s.prisma.payment.create({ data: { teamId: cust.teamId, provider: 'moyasar', providerRef: `inv_${randomBytes(4).toString('hex')}`, currency: 'SAR', amountMinor: 1_000, status: 'succeeded', paidAt: new Date() } });
    expect((await finance.ok('POST', `/admin/v1/payments/${pay.id}/dispute`, { reason: 'mada chargeback' })).recorded).toBe(true);
    expect((await finance.ok('POST', `/admin/v1/payments/${pay.id}/dispute`, {})).recorded).toBe(false);
    expect((await s.prisma.payment.findUniqueOrThrow({ where: { id: pay.id } })).disputedAt).not.toBeNull();
  });
});
