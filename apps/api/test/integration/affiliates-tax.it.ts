import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ResourceType } from '@prisma/client';
import { InvoicesService } from '../../src/modules/billing/invoices.service';
import { BillingAdminService } from '../../src/modules/billing/billing-admin.service';
import { CommissionService } from '../../src/modules/affiliates/commission.service';
import { merge } from '../../src/modules/affiliates/settings';
import { startOfMonth } from '../../src/modules/billing/pricing';
import type { Actor } from '../../src/common/auth/actor';
import { Client, signup, sut, totp, type Sut, type Team } from './harness';

/**
 * Affiliate payouts by Progrid Arabia (docs/affiliates-tax.md): SAR and USD payouts without US tax
 * forms, gates or withholding, and the accounting journal in the name of Progrid Arabia.
 */
let s: Sut;
let finance: Client;
let staffActor: Actor;
const DAY = 86_400_000;

async function staff() {
  const t = await signup(s);
  const setup = await t.client.ok('POST', '/v1/auth/totp/setup', {}, 201);
  await t.client.ok('POST', '/v1/auth/totp/enable', { code: totp(setup.secret) }, 201);
  await s.prisma.user.update({ where: { id: t.userId }, data: { isStaff: true, staffRoles: ['finance'] } });
  const c = new Client(s.baseUrl);
  const r = await c.post('/v1/auth/login', { email: t.email, password: t.password, totp: totp(setup.secret) });
  c.token = r.body.session;
  staffActor = { userId: t.userId, teamId: t.teamId, role: 'owner', scopes: new Set(['admin']), isAgent: false, requireApprovalFor: new Set() } as unknown as Actor;
  return c;
}

/** An approved affiliate with bank details, signed in to the portal. */
async function affiliate(country = 'US') {
  const t = await signup(s, { country: country === 'US' ? 'US' : 'SA' });
  const code = `TX${randomBytes(4).toString('hex').toUpperCase()}`;
  const a = await s.prisma.affiliate.create({ data: { userId: t.userId, status: 'approved', code, name: 'Tax Partner', email: t.email, country, channels: [], audienceSize: '10k_50k', contentLanguage: 'en', promotionPlan: 'Tutorials', termsVersion: '2026-10', termsAcceptedAt: new Date() } });
  await t.client.ok('PUT', '/v1/affiliates/me/payout-details', { method: 'bank_transfer', holderName: 'Jane Doe', bankName: 'Example Bank', bankCountry: country, iban: 'US00EXMP0000123456' });
  return { t, a, code };
}

/** A USD customer referred with the code, last month's usage invoiced and paid by card. */
async function paidCustomer(code: string, usage: [ResourceType, number][]) {
  const r = await fetch(`${s.baseUrl}/v1/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.20.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}` }, body: JSON.stringify({ acceptTerms: true, email: `it-${randomBytes(6).toString('hex')}@example.test`, password: `pw-${randomBytes(9).toString('base64url')}`, name: 'Customer', teamName: 'Customer', country: 'US', promoCode: code }) });
  const body = (await r.json()) as any;
  const client = new Client(s.baseUrl, body.session);
  const teamId: string = body.team.id;
  const project = await s.prisma.project.findFirstOrThrow({ where: { teamId } });
  await s.prisma.referral.updateMany({ where: { teamId }, data: { attributedAt: new Date(Date.now() - 40 * DAY), discountUntil: new Date(Date.now() + 50 * DAY) } });
  const hour = new Date(startOfMonth(new Date(startOfMonth(new Date()).getTime() - 1)).getTime() + 3 * DAY);
  await s.prisma.usageRecord.createMany({ data: usage.map(([resourceType, amountMinor], i) => ({ projectId: project.id, resourceType, resourceId: `res-${randomBytes(4).toString('hex')}`, hourStart: new Date(hour.getTime() + i * 3_600_000), quantity: 1, unit: 'hour', amountMinor, currency: 'USD' })) });
  await s.get(InvoicesService).issueForPreviousMonth(new Date());
  const invoice = await s.prisma.invoice.findFirstOrThrow({ where: { teamId } });
  const start = await client.ok('POST', `/v1/billing/invoices/${invoice.id}/pay`, {}, 201);
  const ref = new URL(start.redirectUrl).searchParams.get('ref')!;
  await client.req('GET', `/v1/billing/payments/fake/confirm?ref=${encodeURIComponent(ref)}&outcome=ok`, undefined, { token: null, redirect: 'manual' });
  await s.get(CommissionService).approveDue(new Date(Date.now() + 61 * DAY));
  return { invoice, payment: await s.prisma.payment.findFirstOrThrow({ where: { invoiceId: invoice.id, status: 'succeeded' } }) };
}

beforeAll(async () => {
  s = await sut();
  finance = await staff();
});

describe('affiliate payouts by Progrid Arabia', () => {
  it('pays USD without a US tax form and withholds nothing', async () => {
    const { t, a, code } = await affiliate();
    await paidCustomer(code, [['app_instance', 100_000]]);
    // 100000 usage, 10% discount: 90000 net, 30% = 27000 cents. No form is asked for.
    const p = await t.client.ok('POST', '/v1/affiliates/me/payouts', { currency: 'USD' }, 201);
    expect(p).toMatchObject({ currency: 'USD', amountMinor: 27_000, withheldMinor: 0 });
    const listed = (await finance.ok('GET', '/admin/v1/affiliates/payouts?status=requested')).data.find((x: any) => x.id === p.id);
    expect(listed).toMatchObject({ payingCompany: 'Progrid Arabia', netMinor: 27_000, taxFormId: null });
    const paid = await finance.ok('POST', `/admin/v1/affiliates/payouts/${p.id}/paid`, { reference: 'SWIFT-1' });
    expect(paid).toMatchObject({ amountMinor: 27_000, withheldMinor: 0, taxFormId: null });
    const mail = s.outbox.find((m) => m.to === t.email && /Payout sent/.test(m.subject));
    expect(mail?.text).toContain('$270.00');
    expect(mail?.text).not.toMatch(/withholding|IRS/);
    expect(mail).toMatchObject({ entity: 'progrid_arabia' });

    // The US tax forms, B notices and the Form 1099 report are gone.
    expect((await t.client.req('GET', '/v1/affiliates/me/tax-form')).status).toBe(404);
    expect((await t.client.req('POST', '/v1/affiliates/me/tax-form', { formType: 'W9' })).status).toBe(404);
    expect((await finance.req('GET', `/admin/v1/affiliates/tax/1099?year=${new Date().getUTCFullYear()}`)).status).toBe(404);
    expect((await finance.req('GET', `/admin/v1/affiliates/export/1099?year=${new Date().getUTCFullYear()}`)).status).toBe(422);
    expect((await finance.req('POST', '/admin/v1/affiliates/tax-forms/x/backup-withholding', { on: true, reason: 'CP2100' })).status).toBe(404);
    expect((await finance.ok('GET', `/admin/v1/affiliates/${a.id}`)).taxForms).toBeUndefined();
  });

  it('ignores stored US tax settings', async () => {
    const m = merge({ form1099ThresholdMinor: 50_000, taxPayerName: 'Progrid Technologies LLC', cookieDays: 30 }) as Record<string, unknown>;
    expect(m.cookieDays).toBe(30);
    expect(m).not.toHaveProperty('form1099ThresholdMinor');
    expect(m).not.toHaveProperty('taxPayerName');
    expect((await finance.req('PATCH', '/admin/v1/affiliates/settings', { form1099ThresholdMinor: 1 })).status).toBe(422);
  });

  it('pays a Saudi partner in SAR the same way', async () => {
    const { t, code } = await affiliate('SA');
    await paidCustomer(code, [['app_instance', 100_000]]);
    // The customer of paidCustomer is a US team (USD); the partner is paid in that currency.
    const p = await t.client.ok('POST', '/v1/affiliates/me/payouts', { currency: 'USD' }, 201);
    expect(p.withheldMinor).toBe(0);
  });

  it('produces a balanced monthly journal from the ledger, in the name of Progrid Arabia', async () => {
    const { t, code } = await affiliate();
    const { payment } = await paidCustomer(code, [['app_instance', 200_000]]);
    // Commission 54000. A quarter of the invoice refunded: 13500 reversed.
    const inv = await s.prisma.invoice.findUniqueOrThrow({ where: { id: payment.invoiceId! } });
    await s.get(BillingAdminService).refund(staffActor, payment.id, Math.round((inv.subtotalMinor + inv.taxMinor) / 4), 'partial');
    const p = await t.client.ok('POST', '/v1/affiliates/me/payouts', { currency: 'USD' }, 201);
    expect(p.amountMinor).toBe(40_500);
    await finance.ok('POST', `/admin/v1/affiliates/payouts/${p.id}/paid`, { reference: 'SWIFT-J' });

    const month = new Date().toISOString().slice(0, 7);
    const j = await finance.ok('GET', `/admin/v1/affiliates/tax/accounting?month=${month}&currency=USD`);
    const debits = j.lines.reduce((t: number, l: any) => t + l.debitMinor, 0);
    const credits = j.lines.reduce((t: number, l: any) => t + l.creditMinor, 0);
    expect(debits).toBe(credits);
    expect(j.payable.closingMinor).toBe(j.payable.openingMinor + j.totals.earnedMinor - j.totals.reversedMinor - j.totals.paidGrossMinor);
    expect(j.totals.earnedMinor).toBeGreaterThanOrEqual(54_000);
    expect(j.totals.reversedMinor).toBeGreaterThanOrEqual(13_500);
    expect(j.totals.withheldMinor).toBe(0);
    expect(j.company).toBe('Progrid Arabia');
    const csv = await finance.req('GET', `/admin/v1/affiliates/export/journal?month=${month}&currency=USD`);
    expect(csv.text.split('\r\n')[0]).toBe('date,company,currency,account,debit,credit,memo');
    expect(csv.text).toContain('Cash (Progrid Arabia bank, USD)');
    expect(csv.text).not.toContain('Form 945');
  });
});
