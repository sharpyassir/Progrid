import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ResourceType } from '@prisma/client';
import { InvoicesService } from '../../src/modules/billing/invoices.service';
import { BillingAdminService } from '../../src/modules/billing/billing-admin.service';
import { CommissionService } from '../../src/modules/affiliates/commission.service';
import { AffiliateSettingsService } from '../../src/modules/affiliates/settings';
import { startOfMonth } from '../../src/modules/billing/pricing';
import type { Actor } from '../../src/common/auth/actor';
import { Client, signup, sut, totp, type Sut, type Team } from './harness';

/**
 * US tax compliance for USD affiliate payouts (docs/affiliates-tax.md): W-9 / W-8 forms, the payout
 * gate, backup withholding, the 1099-NEC report and the accounting journal.
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

const w9 = (over: Record<string, unknown> = {}) => ({
  formType: 'W9', legalName: 'Jane Doe', taxClassification: 'individual', tinType: 'ssn', tin: '123-45-6789',
  addressLine1: '100 Main St', city: 'Austin', region: 'TX', postalCode: '78701', country: 'US', signatureName: 'Jane Doe', certify: true, ...over,
});
const w8 = (over: Record<string, unknown> = {}) => ({
  formType: 'W8BEN', legalName: 'Ahmed Ali', tinType: 'foreign', tin: '1012345678', citizenshipCountry: 'SA', dateOfBirth: '1990-05-01',
  addressLine1: 'King Fahd Rd 10', city: 'Riyadh', postalCode: '12211', country: 'SA', servicesOutsideUs: true, signatureName: 'Ahmed Ali', certify: true, ...over,
});

beforeAll(async () => {
  s = await sut();
  finance = await staff();
});

describe('US tax forms and payouts', () => {
  it('validates W-9 forms and keeps the TIN out of every response', async () => {
    const { t, a } = await affiliate();
    expect((await t.client.ok('GET', '/v1/affiliates/me/tax-form')).state).toBe('missing');
    const err = async (body: object) => (await t.client.post('/v1/affiliates/me/tax-form', body)).body.error?.message;
    expect(await err(w9({ tin: '666-12-3456' }))).toMatch(/Social Security/);
    expect(await err(w9({ country: 'SA' }))).toMatch(/US address/);
    expect(await err(w9({ signatureName: 'Somebody Else' }))).toMatch(/same name/);
    expect(await err(w9({ taxClassification: 'c_corporation' }))).toMatch(/EIN/);
    expect(await err(w9({ certify: false }))).toMatch(/certification/);

    const r = await t.client.ok('POST', '/v1/affiliates/me/tax-form', w9(), 201);
    expect(r).toMatchObject({ state: 'active', form: { formType: 'W9', revision: 'Form W-9 (Rev. March 2024)', tinMasked: '•••••6789', backupWithholding: false, expiresAt: null } });
    expect(JSON.stringify(r)).not.toContain('123-45');
    const row = await s.prisma.affiliateTaxForm.findFirstOrThrow({ where: { affiliateId: a.id } });
    expect(row.tin).toMatch(/^enc:v1:/);
    expect(row.certificationText).toContain('Under penalties of perjury');
    expect(JSON.stringify(await finance.ok('GET', `/admin/v1/affiliates/${a.id}`))).not.toContain('123456789');

    // A second form supersedes the first.
    await t.client.ok('POST', '/v1/affiliates/me/tax-form', w9({ tinType: 'ein', tin: '12-3456789', taxClassification: 'llc_p', legalName: 'Jane Doe', businessName: 'Doe Media LLC' }), 201);
    expect(await s.prisma.affiliateTaxForm.count({ where: { affiliateId: a.id, status: 'active' } })).toBe(1);
  });

  it('blocks USD payouts without a form, pays with one, and withholds 24% after a B notice', async () => {
    const { t, a, code } = await affiliate();
    await paidCustomer(code, [['app_instance', 100_000]]);
    // 100000 usage, 10% discount: 90000 net, 30% = 27000 cents.
    expect((await t.client.post('/v1/affiliates/me/payouts', { currency: 'USD' })).body.error.code).toBe('tax_form_required');
    await t.client.ok('POST', '/v1/affiliates/me/tax-form', w9(), 201);
    const p1 = await t.client.ok('POST', '/v1/affiliates/me/payouts', { currency: 'USD' }, 201);
    expect(p1).toMatchObject({ amountMinor: 27_000, withheldMinor: 0 });
    await finance.ok('POST', `/admin/v1/affiliates/payouts/${p1.id}/paid`, { reference: 'ACH-1' });

    // The IRS sends a B notice: backup withholding starts.
    const form = (await finance.ok('GET', `/admin/v1/affiliates/${a.id}`)).taxForms[0];
    await finance.ok('POST', `/admin/v1/affiliates/tax-forms/${form.id}/backup-withholding`, { on: true, reason: 'CP2100 B notice 2026-10' });
    await paidCustomer(code, [['app_instance', 100_000]]);
    const p2 = await t.client.ok('POST', '/v1/affiliates/me/payouts', { currency: 'USD' }, 201);
    expect(p2.withheldMinor).toBe(6_480);
    const paid = await finance.ok('POST', `/admin/v1/affiliates/payouts/${p2.id}/paid`, { reference: 'ACH-2' });
    expect(paid).toMatchObject({ amountMinor: 27_000, withheldMinor: 6_480 });
    expect(s.outbox.some((m) => m.to === t.email && m.text.includes('US backup withholding'))).toBe(true);
    const listed = (await finance.ok('GET', '/admin/v1/affiliates/payouts?status=paid')).data.find((x: any) => x.id === p2.id);
    expect(listed.netMinor).toBe(20_520);

    // Form 1099-NEC data for this year: $540 paid; the threshold is lowered so it must be filed, with box 4.
    await s.get(AffiliateSettingsService).update(staffActor, { form1099ThresholdMinor: 50_000 });
    const year = new Date().getUTCFullYear();
    const rep = await finance.ok('GET', `/admin/v1/affiliates/tax/1099?year=${year}`);
    const rec = rep.recipients.find((x: any) => x.affiliateId === a.id);
    expect(rec).toMatchObject({ required: true, exempt: false, grossMinor: 54_000, withheldMinor: 6_480, tin: '123-45-6789', name: 'Jane Doe', state: 'TX', zip: '78701' });
    expect(rep.payer.issues).toContain('payer EIN not set');
    const csv = await finance.req('GET', `/admin/v1/affiliates/export/1099?year=${year}`);
    expect(csv.text.split('\r\n')[0]).toContain('box1_nonemployee_compensation,box4_federal_income_tax_withheld');
    expect(csv.text).toContain('123-45-6789');
    expect(csv.text).toContain(',540.00,64.80,');
    expect(await s.prisma.auditLog.count({ where: { action: 'affiliate.1099_exported' } })).toBeGreaterThan(0);
    await s.get(AffiliateSettingsService).update(staffActor, { form1099ThresholdMinor: 200_000 });
  });

  it('does not report corporations, and keeps foreign payees on a W-8 out of the 1099s', async () => {
    const corp = await affiliate();
    await corp.t.client.ok('POST', '/v1/affiliates/me/tax-form', w9({ legalName: 'Acme Media Inc', signatureName: 'Acme Media Inc', taxClassification: 'c_corporation', tinType: 'ein', tin: '12-3456789' }), 201);
    await paidCustomer(corp.code, [['app_instance', 100_000]]);
    const pc = await corp.t.client.ok('POST', '/v1/affiliates/me/payouts', { currency: 'USD' }, 201);
    await finance.ok('POST', `/admin/v1/affiliates/payouts/${pc.id}/paid`, { reference: 'ACH-C' });

    const foreign = await affiliate('SA');
    const err = (await foreign.t.client.post('/v1/affiliates/me/tax-form', w8({ servicesOutsideUs: false }))).body.error.message;
    expect(err).toMatch(/outside the United States/);
    expect((await foreign.t.client.post('/v1/affiliates/me/tax-form', w9({ country: 'US' }))).status).toBe(201); // a W-9 is allowed for a US person
    const r = await foreign.t.client.ok('POST', '/v1/affiliates/me/tax-form', w8(), 201);
    expect(r.form).toMatchObject({ formType: 'W8BEN', servicesOutsideUs: true, tinMasked: '•••••5678' });
    expect(new Date(r.form.expiresAt).getUTCFullYear()).toBe(new Date().getUTCFullYear() + 3);
    await paidCustomer(foreign.code, [['app_instance', 100_000]]);
    const pf = await foreign.t.client.ok('POST', '/v1/affiliates/me/payouts', { currency: 'USD' }, 201);
    expect(pf.withheldMinor).toBe(0);
    await finance.ok('POST', `/admin/v1/affiliates/payouts/${pf.id}/paid`, { reference: 'SWIFT-F' });

    const rep = await finance.ok('GET', `/admin/v1/affiliates/tax/1099?year=${new Date().getUTCFullYear()}`);
    expect(rep.recipients.find((x: any) => x.affiliateId === corp.a.id)).toMatchObject({ exempt: true, required: false });
    expect(rep.recipients.some((x: any) => x.affiliateId === foreign.a.id)).toBe(false);
    expect(rep.foreign.find((x: any) => x.affiliateId === foreign.a.id)).toMatchObject({ formType: 'W8BEN', servicesOutsideUs: true, grossMinor: 27_000 });

    // An expired W-8 stops USD payouts until a new one is signed.
    await s.prisma.affiliateTaxForm.updateMany({ where: { affiliateId: foreign.a.id, status: 'active' }, data: { expiresAt: new Date(Date.now() - DAY) } });
    await paidCustomer(foreign.code, [['app_instance', 100_000]]);
    expect((await foreign.t.client.post('/v1/affiliates/me/payouts', { currency: 'USD' })).body.error.code).toBe('tax_form_expired');
  });

  it('asks for a new form when finance marks one invalid', async () => {
    const { t, a, code } = await affiliate();
    await t.client.ok('POST', '/v1/affiliates/me/tax-form', w9(), 201);
    const form = (await finance.ok('GET', `/admin/v1/affiliates/${a.id}`)).taxForms[0];
    await finance.ok('POST', `/admin/v1/affiliates/tax-forms/${form.id}/invalidate`, { reason: 'Name and TIN do not match IRS records' });
    expect((await t.client.ok('GET', '/v1/affiliates/me/tax-form')).state).toBe('invalid');
    expect(s.outbox.some((m) => m.to === t.email && /tax information/.test(m.subject))).toBe(true);
    await paidCustomer(code, [['app_instance', 100_000]]);
    expect((await t.client.post('/v1/affiliates/me/payouts', { currency: 'USD' })).body.error.code).toBe('tax_form_required');
  });

  it('produces a balanced monthly journal from the ledger', async () => {
    const { t, code } = await affiliate();
    await t.client.ok('POST', '/v1/affiliates/me/tax-form', w9(), 201);
    const { payment } = await paidCustomer(code, [['app_instance', 200_000]]);
    // Commission 54000. A quarter of the invoice refunded: 13500 reversed.
    const inv = await s.prisma.invoice.findUniqueOrThrow({ where: { id: payment.invoiceId! } });
    await s.get(BillingAdminService).refund(staffActor, payment.id, Math.round((inv.subtotalMinor + inv.taxMinor) / 4), 'partial');
    const p = await t.client.ok('POST', '/v1/affiliates/me/payouts', { currency: 'USD' }, 201);
    expect(p.amountMinor).toBe(40_500);
    await finance.ok('POST', `/admin/v1/affiliates/payouts/${p.id}/paid`, { reference: 'ACH-J' });

    const month = new Date().toISOString().slice(0, 7);
    const j = await finance.ok('GET', `/admin/v1/affiliates/tax/accounting?month=${month}&currency=USD`);
    const debits = j.lines.reduce((t: number, l: any) => t + l.debitMinor, 0);
    const credits = j.lines.reduce((t: number, l: any) => t + l.creditMinor, 0);
    expect(debits).toBe(credits);
    expect(j.payable.closingMinor).toBe(j.payable.openingMinor + j.totals.earnedMinor - j.totals.reversedMinor - j.totals.paidGrossMinor);
    expect(j.totals.earnedMinor).toBeGreaterThanOrEqual(54_000);
    expect(j.totals.reversedMinor).toBeGreaterThanOrEqual(13_500);
    expect(j.totals.withheldMinor).toBeGreaterThanOrEqual(6_480);
    expect(j.company).toBe('Progrid Technologies LLC');
    const csv = await finance.req('GET', `/admin/v1/affiliates/export/journal?month=${month}&currency=USD`);
    expect(csv.text.split('\r\n')[0]).toBe('date,company,currency,account,debit,credit,memo');
    expect(csv.text).toContain('Backup withholding payable (IRS, Form 945)');
  });
});
