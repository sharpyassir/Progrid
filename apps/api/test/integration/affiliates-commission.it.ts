import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ResourceType } from '@prisma/client';
import { InvoicesService } from '../../src/modules/billing/invoices.service';
import { BillingAdminService } from '../../src/modules/billing/billing-admin.service';
import { PaymentsService } from '../../src/modules/billing/payments/payments.service';
import { CommissionService } from '../../src/modules/affiliates/commission.service';
import { startOfMonth } from '../../src/modules/billing/pricing';
import type { Actor } from '../../src/common/auth/actor';
import { Client, signup, sut, type Sut, type Team } from './harness';

/**
 * Affiliate program, phase (d): the promo discount on invoices, commission on paid invoices
 * (rates per category, net of tax, discount and free credit), the hold, refunds, credit notes,
 * chargebacks, clawbacks and the same card self referral block (docs/affiliates.md).
 */
let s: Sut;
let partner: Team;
let code: string;
let affiliateId: string;
let staff: Actor;
const DAY = 86_400_000;

beforeAll(async () => {
  s = await sut();
  partner = await signup(s);
  code = `CM${randomBytes(4).toString('hex').toUpperCase()}`;
  affiliateId = (await s.prisma.affiliate.create({ data: { userId: partner.userId, status: 'approved', code, name: 'Commission Partner', email: partner.email, country: 'US', channels: [], audienceSize: '10k_50k', contentLanguage: 'en', promotionPlan: 'Tutorials', termsVersion: '2026-10', termsAcceptedAt: new Date() } })).id;
  staff = { userId: partner.userId, teamId: partner.teamId, role: 'owner', scopes: new Set(['admin']), isAgent: false, requireApprovalFor: new Set() } as unknown as Actor;
});

/** A customer who signed up with the partner code, with last month's usage already rated. */
async function customer(country: 'US' | 'SA', usage: [ResourceType, number][], opts: { promoCredit?: number; promo?: boolean } = {}) {
  const email = `it-${randomBytes(6).toString('hex')}@example.test`;
  const r = await fetch(`${s.baseUrl}/v1/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': `198.19.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}` }, body: JSON.stringify({ email, password: `pw-${randomBytes(9).toString('base64url')}`, name: 'Customer', teamName: 'Customer team', country, ...(opts.promo === false ? {} : { promoCode: code }) }) });
  const body = (await r.json()) as any;
  const client = new Client(s.baseUrl, body.session);
  const teamId: string = body.team.id;
  const project = await s.prisma.project.findFirstOrThrow({ where: { teamId } });
  const currency = country === 'SA' ? 'SAR' : 'USD';
  // The referral is a few days older than the usage period, as in real life.
  await s.prisma.referral.updateMany({ where: { teamId }, data: { attributedAt: new Date(Date.now() - 40 * DAY), discountUntil: new Date(Date.now() + 50 * DAY) } });
  const hour = new Date(startOfMonth(new Date(startOfMonth(new Date()).getTime() - 1)).getTime() + 3 * DAY);
  await s.prisma.usageRecord.createMany({ data: usage.map(([resourceType, amountMinor], i) => ({ projectId: project.id, resourceType, resourceId: `res-${randomBytes(4).toString('hex')}`, hourStart: new Date(hour.getTime() + i * 3_600_000), quantity: 1, unit: 'hour', amountMinor, currency })) });
  if (opts.promoCredit) await s.prisma.credit.create({ data: { teamId, kind: 'promo', currency, amountMinor: opts.promoCredit, remainingMinor: opts.promoCredit, reason: 'Welcome credit' } });
  await s.get(InvoicesService).issueForPreviousMonth(new Date());
  const invoice = await s.prisma.invoice.findFirstOrThrow({ where: { teamId } });
  return { teamId, client, invoice };
}

async function pay(c: { client: Client; invoice: { id: string } }) {
  const start = await c.client.ok('POST', `/v1/billing/invoices/${c.invoice.id}/pay`, {}, 201);
  const ref = new URL(start.redirectUrl).searchParams.get('ref')!;
  const r = await c.client.req('GET', `/v1/billing/payments/fake/confirm?ref=${encodeURIComponent(ref)}&outcome=ok`, undefined, { token: null, redirect: 'manual' });
  expect(r.status).toBe(302);
  return s.prisma.payment.findFirstOrThrow({ where: { invoiceId: c.invoice.id, status: 'succeeded' } });
}

const rows = (invoiceId: string) => s.prisma.affiliateCommission.findMany({ where: { invoiceId }, orderBy: { category: 'asc' } });

describe('affiliate commission', () => {
  it('takes the promo discount off the invoice before tax', async () => {
    const c = await customer('SA', [['server', 10_000], ['app_instance', 5_000]]);
    expect(c.invoice).toMatchObject({ discountMinor: 1_500, subtotalMinor: 13_500, taxMinor: 2_025, totalMinor: 15_525, status: 'open' });
    // Without a code there is no discount and no commission.
    const plain = await customer('SA', [['server', 10_000]], { promo: false });
    expect(plain.invoice).toMatchObject({ discountMinor: 0, subtotalMinor: 10_000 });
    await pay(plain);
    expect(await rows(plain.invoice.id)).toEqual([]);
  });

  it('earns commission per category on the net paid amount, pending for the hold, then approved', async () => {
    const c = await customer('SA', [['server', 10_000], ['app_instance', 5_000], ['connect_ai_output', 3_000], ['support', 2_000]]);
    // usage 20000, discount 2000, subtotal 18000, VAT 2700.
    expect(c.invoice).toMatchObject({ discountMinor: 2_000, subtotalMinor: 18_000, taxMinor: 2_700 });
    expect(await rows(c.invoice.id)).toEqual([]);
    const payment = await pay(c);
    const earned = await rows(c.invoice.id);
    expect(earned.map((r) => [r.category, r.baseMinor, r.rateBp, r.amountMinor, r.currency, r.status])).toEqual([
      ['servers', 9_000, 1500, 1_350, 'SAR', 'pending'],
      ['web_hosting', 4_500, 3000, 1_350, 'SAR', 'pending'],
    ]);
    const hold = earned[0].holdUntil.getTime() - payment.paidAt!.getTime();
    expect(Math.abs(hold - 60 * DAY)).toBeLessThan(60_000);
    expect((await s.prisma.invoice.findUniqueOrThrow({ where: { id: c.invoice.id } })).affiliateCheckedAt).not.toBeNull();

    // Running the engine again changes nothing.
    expect(await s.get(CommissionService).earn(c.invoice.id)).toEqual([]);
    expect(await s.get(CommissionService).earnPending()).toBeGreaterThanOrEqual(0);
    expect(await rows(c.invoice.id)).toHaveLength(2);

    // Not yet: the hold is not over.
    await s.get(CommissionService).approveDue(new Date(Date.now() + 59 * DAY));
    expect((await rows(c.invoice.id)).every((r) => r.status === 'pending')).toBe(true);
    await s.get(CommissionService).approveDue(new Date(Date.now() + 61 * DAY));
    expect((await rows(c.invoice.id)).every((r) => r.status === 'approved')).toBe(true);
  });

  it('pays no commission on the part settled with free credit', async () => {
    // usage 10000, discount 1000, subtotal 9000, VAT 1350: 10350 payable, 5175 of it promo credit.
    const c = await customer('SA', [['app_instance', 10_000]], { promoCredit: 5_175 });
    expect(c.invoice).toMatchObject({ creditMinor: 5_175, totalMinor: 5_175 });
    await pay(c);
    expect((await rows(c.invoice.id)).map((r) => [r.baseMinor, r.amountMinor])).toEqual([[4_500, 1_350]]);
  });

  it('reverses commission for refunds and credit notes in proportion', async () => {
    const c = await customer('SA', [['app_instance', 20_000]]);
    // subtotal 18000, VAT 2700: gross 20700. Commission 30% of 18000 = 5400.
    const payment = await pay(c);
    expect((await rows(c.invoice.id))[0].amountMinor).toBe(5_400);
    await s.get(BillingAdminService).refund(staff, payment.id, 5_175, 'partial');
    expect((await rows(c.invoice.id))[0]).toMatchObject({ reversedMinor: 1_350, status: 'pending' });
    await s.get(BillingAdminService).creditNote(staff, c.invoice.id, 15_525, 'rest');
    expect((await rows(c.invoice.id))[0]).toMatchObject({ reversedMinor: 5_400, status: 'reversed' });
  });

  it('claws back commission reversed after it was paid out', async () => {
    const c = await customer('SA', [['server', 20_000]]);
    const payment = await pay(c);
    const [row] = await rows(c.invoice.id);
    expect(row.amountMinor).toBe(2_700);
    await s.prisma.affiliateCommission.update({ where: { id: row.id }, data: { status: 'paid', paidAt: new Date() } });
    await s.get(BillingAdminService).refund(staff, payment.id, undefined, 'full refund');
    const after = await rows(c.invoice.id);
    expect(after.find((r) => r.id === row.id)).toMatchObject({ status: 'paid', reversedMinor: 2_700 });
    expect(after.find((r) => r.category === 'servers:clawback:1')).toMatchObject({ amountMinor: -2_700, status: 'approved', payoutId: null });
  });

  it('reverses everything on a chargeback and flags the affiliate', async () => {
    const c = await customer('SA', [['connect_execution', 10_000]]);
    const payment = await pay(c);
    expect((await rows(c.invoice.id))[0].amountMinor).toBe(2_700);
    expect(await s.get(PaymentsService).recordDispute(payment.id, 'fraudulent')).toBe(true);
    expect(await s.get(PaymentsService).recordDispute(payment.id, 'fraudulent')).toBe(false);
    expect((await rows(c.invoice.id))[0]).toMatchObject({ status: 'reversed', reversedMinor: 2_700 });
    expect((await s.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).disputedAt).not.toBeNull();
    expect(await s.prisma.affiliateFlag.count({ where: { affiliateId, kind: 'chargeback' } })).toBe(1);
    // Several reversals push the affiliate over the refund rate.
    expect(await s.prisma.affiliateFlag.count({ where: { affiliateId, kind: 'high_refund_rate' } })).toBe(1);
  });

  it('blocks the referral when the affiliate pays with their own card', async () => {
    const c = await customer('US', [['server', 10_000]]);
    // The partner once paid for their own team with this card.
    await s.prisma.payment.create({ data: { teamId: partner.teamId, provider: 'stripe', providerRef: `cs_${randomBytes(6).toString('hex')}`, currency: 'USD', amountMinor: 100, status: 'succeeded', paidAt: new Date(), cardFingerprint: 'stripe:same-card' } });
    const payment = await pay(c);
    // The fake page reports no fingerprint; set the one Stripe would have sent, then let the engine look again.
    await s.prisma.payment.update({ where: { id: payment.id }, data: { cardFingerprint: 'stripe:same-card' } });
    await s.prisma.affiliateCommission.deleteMany({ where: { invoiceId: c.invoice.id } });
    await s.prisma.invoice.update({ where: { id: c.invoice.id }, data: { affiliateCheckedAt: null } });
    expect(await s.get(CommissionService).earn(c.invoice.id)).toEqual([]);
    expect(await s.prisma.referral.findUniqueOrThrow({ where: { teamId: c.teamId } })).toMatchObject({ status: 'blocked', blockedReason: 'self_referral:same_card', discountPercent: 0 });
  });

  it('earns nothing after the commission months or while the affiliate is suspended', async () => {
    const late = await customer('SA', [['server', 10_000]]);
    await s.prisma.referral.update({ where: { teamId: late.teamId }, data: { commissionUntil: new Date(Date.now() - 60 * DAY) } });
    await pay(late);
    expect(await rows(late.invoice.id)).toEqual([]);

    const c = await customer('SA', [['server', 10_000]]);
    await s.prisma.affiliate.update({ where: { id: affiliateId }, data: { status: 'suspended' } });
    try {
      await pay(c);
      expect(await rows(c.invoice.id)).toEqual([]);
    } finally {
      await s.prisma.affiliate.update({ where: { id: affiliateId }, data: { status: 'approved' } });
    }
  });
});
