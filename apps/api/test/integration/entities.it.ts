import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { MeteringService } from '../../src/modules/billing/metering.service';
import { RatingService } from '../../src/modules/billing/rating.service';
import { InvoicesService } from '../../src/modules/billing/invoices.service';
import { BillingAdminService } from '../../src/modules/billing/billing-admin.service';
import { startOfMonth } from '../../src/modules/billing/pricing';
import { renderInvoicePdf } from '../../src/modules/billing/invoice-pdf';
import { FxService } from '../../src/modules/billing/fx.service';
import { nextBillingPeriod } from '../../src/modules/billing/entity-change';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Actor } from '../../src/common/auth/actor';
import { Client, signup, sut, topUp, totp, waitFor, waitStatus, type Sut, type Team } from './harness';

/**
 * One billing company on two domains (docs/domains-and-entities.md): Progrid Arabia bills every
 * team. The billing country decides currency and VAT: SA pays SAR with 15% VAT, everyone else USD
 * at 0% (zero-rated export of services) with the SAR figures and exchange rate on the invoice.
 * Progrid Technologies LLC remains only in the history (PRGD-US invoices).
 */
let s: Sut;
beforeAll(async () => {
  s = await sut();
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function raw(method: string, path: string, headers: Record<string, string>, body?: unknown) {
  const r = await fetch(s.baseUrl + path, { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: r.status, headers: r.headers, body: json, text };
}

async function serverWithUsage(t: Team, hours: number) {
  const r = await t.client.ok('POST', '/v1/servers', { name: `ent-${randomBytes(3).toString('hex')}`, size: 's-8vcpu-16gb', image: 'ubuntu-24-04' }, 202);
  const srv = await waitStatus<any>(t.client, `/v1/servers/${r.id}`, 'active');
  const row = await s.prisma.server.findUniqueOrThrow({ where: { id: srv.id } });
  const first = new Date(startOfMonth(new Date(startOfMonth(new Date()).getTime() - 1)).getTime() + 2 * DAY);
  for (let h = 0; h < hours; h++) {
    const hourStart = new Date(first.getTime() + h * HOUR);
    await s.get(MeteringService).ingest(Array.from({ length: 60 }, (_, m) => ({ v: 1 as const, at: new Date(hourStart.getTime() + m * 60_000).toISOString(), resourceType: 'server' as const, resourceId: row.id, projectId: row.projectId, hostId: row.hostId!, quantity: 1, unit: 'minute' as const })));
    await s.get(RatingService).rollupHour(hourStart);
  }
  return srv;
}

async function staff(roles: string[] = []) {
  const t = await signup(s, { country: 'US' });
  await s.prisma.user.update({ where: { id: t.userId }, data: { isStaff: true, staffRoles: roles } });
  const setup = await t.client.ok('POST', '/v1/auth/totp/setup', {}, 201);
  await t.client.ok('POST', '/v1/auth/totp/enable', { code: totp(setup.secret) }, 201);
  return t;
}

const signupVia = (host: string, country?: string) => raw('POST', '/v1/auth/signup', { 'x-forwarded-host': host }, { email: `it-${randomBytes(6).toString('hex')}@example.test`, acceptTerms: true, password: 'pw-long-enough-1', name: 'Via', teamName: `via ${randomBytes(3).toString('hex')}`, ...(country ? { country } : {}) });

describe('one billing entity', () => {
  it('signs every account up with Progrid Arabia, whatever the domain; the country decides the currency', async () => {
    const sa = await signup(s, { country: 'SA' });
    const de = await signup(s, { country: 'DE' });
    expect(await s.prisma.team.findUniqueOrThrow({ where: { id: sa.teamId } })).toMatchObject({ country: 'SA', billingEntity: 'progrid_arabia', currency: 'SAR' });
    expect(await s.prisma.team.findUniqueOrThrow({ where: { id: de.teamId } })).toMatchObject({ country: 'DE', billingEntity: 'progrid_arabia', currency: 'USD' });

    // The team page and the balance name the company, with the team's own currency and VAT.
    const team = await sa.client.ok('GET', '/v1/team');
    expect(team.team.entity).toMatchObject({ id: 'progrid_arabia', legalName: 'Progrid Arabia', currency: 'SAR', taxRate: 0.15, vatCategory: 'standard', supportEmail: 'support@progrid.sa', consoleUrl: 'https://console.progrid.sa' });
    const bal = await de.client.ok('GET', '/v1/billing/balance');
    expect(bal.currency).toBe('USD');
    expect(bal.billingEntity).toMatchObject({ id: 'progrid_arabia', legalName: 'Progrid Arabia', currency: 'USD', taxRate: 0, vatCategory: 'zero_rated_export', taxNote: 'Zero-rated export of services' });

    // Both public domains: the company is always Progrid Arabia, the currency follows the country.
    // (A Saudi address on progrid.co was the LLC in USD before; a German one on progrid.sa was Arabia in SAR.)
    const viaCo = await signupVia('api.progrid.co', 'SA');
    expect(viaCo.status).toBe(201);
    expect(viaCo.body.team).toMatchObject({ country: 'SA', billingEntity: 'progrid_arabia', currency: 'SAR' });
    const viaSa = await signupVia('api.progrid.sa', 'DE');
    expect(viaSa.body.team).toMatchObject({ country: 'DE', billingEntity: 'progrid_arabia', currency: 'USD' });
    // Without a country, progrid.sa still suggests Saudi Arabia as the address (and so SAR).
    expect((await signupVia('api.progrid.sa')).body.team).toMatchObject({ country: 'SA', billingEntity: 'progrid_arabia', currency: 'SAR' });
    const geo = await raw('GET', '/v1/geo', { 'x-forwarded-host': 'api.progrid.sa' });
    expect(geo.body).toMatchObject({ country: 'SA', source: 'domain', billingEntity: 'progrid_arabia', legalName: 'Progrid Arabia', currency: 'SAR', taxRate: 0.15 });
    const geoCo = await raw('GET', '/v1/geo', { 'x-forwarded-host': 'api.progrid.co', 'x-real-ip': '2.88.0.1' });
    expect(geoCo.body).toMatchObject({ billingEntity: 'progrid_arabia', legalName: 'Progrid Arabia' });
    expect(geoCo.body.currency).toBe(geoCo.body.country === 'SA' ? 'SAR' : 'USD');

    // No account can be created with the LLC any more.
    expect(await s.prisma.team.count({ where: { billingEntity: 'progrid_llc', id: { in: [sa.teamId, de.teamId] } } })).toBe(0);
  });

  it('invoices SA in SAR with 15% VAT and DE/US in USD at 0% with the zero-rated note and the VAT in SAR, all in the PRGD-SA series', async () => {
    const sa = await signup(s, { country: 'SA' });
    const de = await signup(s, { country: 'DE' });
    const us = await signup(s, { country: 'US' });
    await topUp(s, sa, 2_000); // 20 SAR, less than the usage below
    await topUp(s, de, 500); // 5 USD
    await topUp(s, us, 500);
    const saSrv = await serverWithUsage(sa, 80);
    const deSrv = await serverWithUsage(de, 80);
    await serverWithUsage(us, 10);

    // The book is in riyals; dollar teams are rated at the pegged 3.75: 239 SAR = 63.73 USD a month, 9 cents an hour.
    const saRec = await s.prisma.usageRecord.findMany({ where: { resourceId: saSrv.id, resourceType: 'server' } });
    const deRec = await s.prisma.usageRecord.findMany({ where: { resourceId: deSrv.id, resourceType: 'server' } });
    expect(saRec.every((r) => r.currency === 'SAR' && r.amountMinor === 36)).toBe(true);
    expect(deRec.every((r) => r.currency === 'USD' && r.amountMinor === 9)).toBe(true);

    s.outbox.length = 0;
    const rate = await s.get(FxService).rate('SAR');
    await s.get(InvoicesService).issueForPreviousMonth(new Date());
    const saInv = (await sa.client.ok('GET', '/v1/billing/invoices')).data[0];
    const deInv = (await de.client.ok('GET', '/v1/billing/invoices')).data[0];
    const usInv = (await us.client.ok('GET', '/v1/billing/invoices')).data[0];

    const year = new Date().getUTCFullYear();
    for (const inv of [saInv, deInv, usInv]) expect(inv.number).toMatch(new RegExp(`^PRGD-SA-${year}-\\d{5}$`));
    const saTax = Math.round(80 * 36 * 0.15);
    expect(saInv).toMatchObject({ billingEntity: 'progrid_arabia', currency: 'SAR', subtotalMinor: 80 * 36, taxMinor: saTax, creditMinor: 2_000, eInvoiceType: 'zatca', vatCategory: 'standard', taxNote: null, status: 'open', subtotalSarMinor: 80 * 36, taxSarMinor: saTax, totalSarMinor: 80 * 36 + saTax - 2_000 });
    expect(Number(saInv.fxRateSar)).toBe(1);
    expect(deInv).toMatchObject({ billingEntity: 'progrid_arabia', currency: 'USD', subtotalMinor: 80 * 9, taxMinor: 0, creditMinor: 500, totalMinor: 80 * 9 - 500, eInvoiceType: 'zatca', vatCategory: 'zero_rated_export', taxNote: 'Zero-rated export of services', status: 'open' });
    expect(Number(deInv.fxRateSar)).toBeCloseTo(rate, 6);
    expect(deInv).toMatchObject({ subtotalSarMinor: Math.round(80 * 9 * rate), taxSarMinor: 0, totalSarMinor: Math.round((80 * 9 - 500) * rate) });
    expect(usInv).toMatchObject({ currency: 'USD', taxMinor: 0, vatCategory: 'zero_rated_export', taxNote: 'Zero-rated export of services', taxSarMinor: 0 });
    // No new invoice in the LLC's series.
    expect(await s.prisma.invoice.count({ where: { teamId: { in: [sa.teamId, de.teamId, us.teamId] }, OR: [{ billingEntity: 'progrid_llc' }, { number: { startsWith: 'PRGD-US' } }] } })).toBe(0);

    // Invoice mails come from Progrid Arabia and link to its console, in the invoice's currency.
    const saMail = await waitFor(async () => s.outbox.find((m) => m.to === sa.email && m.subject.includes(saInv.number)), { what: 'the SA invoice mail', timeoutMs: 10_000 });
    const deMail = await waitFor(async () => s.outbox.find((m) => m.to === de.email && m.subject.includes(deInv.number)), { what: 'the DE invoice mail', timeoutMs: 10_000 });
    expect(saMail).toMatchObject({ entity: 'progrid_arabia', from: 'Progrid <no-reply@progrid.sa>' });
    expect(saMail!.text).toContain('https://console.progrid.sa/billing');
    expect(saMail!.subject).toContain('SAR');
    expect(deMail).toMatchObject({ entity: 'progrid_arabia', from: 'Progrid <no-reply@progrid.sa>' });
    expect(deMail!.subject).toContain('$');

    // PDFs render for both currencies.
    for (const [t, inv] of [[sa, saInv], [de, deInv]] as const) {
      const pdf = await t.client.get(`/v1/billing/invoices/${inv.id}/pdf`);
      expect(pdf.status).toBe(200);
      expect(pdf.headers.get('content-type')).toBe('application/pdf');
    }
    const full = await s.prisma.invoice.findUniqueOrThrow({ where: { id: deInv.id }, include: { team: true, records: true } });
    expect((await renderInvoicePdf(full)).subarray(0, 4).toString()).toBe('%PDF');

    // Paying goes to Progrid Arabia's gateway, in the invoice's currency (the test page stands in for Moyasar).
    const pay = await de.client.ok('POST', `/v1/billing/invoices/${deInv.id}/pay`, {}, 201);
    expect(pay).toMatchObject({ currency: 'USD', billingEntity: 'progrid_arabia', amountMinor: deInv.totalMinor, provider: 'fake' });
    const paySa = await sa.client.ok('POST', `/v1/billing/invoices/${saInv.id}/pay`, {}, 201);
    expect(paySa).toMatchObject({ currency: 'SAR', billingEntity: 'progrid_arabia' });

    // Credit notes: CN-SA series, the invoice's VAT treatment and the SAR figures at the invoice's rate.
    const actor = { userId: de.userId, teamId: de.teamId, role: 'owner', scopes: new Set(['admin']), isAgent: false, requireApprovalFor: new Set() } as unknown as Actor;
    const noteDe = await s.get(BillingAdminService).creditNote(actor, deInv.id, 100, 'goodwill');
    const noteSa = await s.get(BillingAdminService).creditNote(actor, saInv.id, 115, 'goodwill');
    expect(noteDe.number).toMatch(new RegExp(`^CN-SA-${year}-\\d{5}$`));
    expect(noteDe).toMatchObject({ billingEntity: 'progrid_arabia', currency: 'USD', amountMinor: 100, taxMinor: 0, vatCategory: 'zero_rated_export', taxNote: 'Zero-rated export of services', amountSarMinor: Math.round(100 * rate), taxSarMinor: 0 });
    expect(noteSa.number).toMatch(new RegExp(`^CN-SA-${year}-\\d{5}$`));
    expect(noteSa).toMatchObject({ currency: 'SAR', amountMinor: 115, taxMinor: 15, vatCategory: 'standard', amountSarMinor: 115, taxSarMinor: 15 });
  });

  it('keeps old PRGD-US invoices of Progrid Technologies LLC readable and downloadable', async () => {
    const t = await signup(s, { country: 'US' });
    const year = new Date().getUTCFullYear();
    const inv = await s.prisma.invoice.create({ data: { teamId: t.teamId, number: `PRGD-US-${year}-9${randomBytes(2).toString('hex')}`, billingEntity: 'progrid_llc', currency: 'USD', periodStart: new Date('2026-08-01T00:00:00Z'), periodEnd: new Date('2026-09-01T00:00:00Z'), subtotalMinor: 1_000, totalMinor: 1_000, status: 'open', dueAt: new Date() } });
    const listed = (await t.client.ok('GET', '/v1/billing/invoices')).data.find((x: any) => x.id === inv.id);
    expect(listed).toMatchObject({ number: inv.number, billingEntity: 'progrid_llc', currency: 'USD', eInvoiceType: null, fxRateSar: null });
    const pdf = await t.client.get(`/v1/billing/invoices/${inv.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    // The LLC issues nothing new: no credit note in its series.
    const actor = { userId: t.userId, teamId: t.teamId, role: 'owner', scopes: new Set(['admin']), isAgent: false, requireApprovalFor: new Set() } as unknown as Actor;
    await expect(s.get(BillingAdminService).creditNote(actor, inv.id, 100, 'goodwill')).rejects.toThrow(/no longer issues credit notes/);
    // An open one is collected by Progrid Arabia through its gateway.
    const pay = await t.client.ok('POST', `/v1/billing/invoices/${inv.id}/pay`, {}, 201);
    expect(pay).toMatchObject({ billingEntity: 'progrid_arabia', currency: 'USD', amountMinor: 1_000 });
  });

  it('sends account mail from Progrid Arabia, whatever the country', async () => {
    s.outbox.length = 0;
    const sa = await signup(s, { country: 'SA', verify: false });
    const gb = await signup(s, { country: 'GB', verify: false });
    const saMail = await waitFor(async () => s.outbox.find((m) => m.to === sa.email && /verify\?token=/.test(m.text)), { what: 'the SA verification mail', timeoutMs: 10_000 });
    const gbMail = await waitFor(async () => s.outbox.find((m) => m.to === gb.email && /verify\?token=/.test(m.text)), { what: 'the GB verification mail', timeoutMs: 10_000 });
    for (const m of [saMail, gbMail]) {
      expect(m).toMatchObject({ from: 'Progrid <no-reply@progrid.sa>' });
      expect(m!.text).toContain('https://console.progrid.sa/verify?token=');
    }
  });

  it('schedules a currency change for the next month when a customer moves into or out of Saudi Arabia', async () => {
    const t = await signup(s, { country: 'DE' });
    // DE to US keeps USD and 0% VAT: applies now.
    await t.client.ok('PATCH', '/v1/team', { country: 'US' });
    expect(await s.prisma.team.findUniqueOrThrow({ where: { id: t.teamId } })).toMatchObject({ country: 'US', currency: 'USD', pendingCountry: null, pendingCurrency: null, billingChangeAt: null });

    // US to SA: SAR and 15% VAT from the first day of next month; this month stays in USD.
    await t.client.ok('PATCH', '/v1/team', { country: 'SA' });
    const next = nextBillingPeriod(new Date());
    let row = await s.prisma.team.findUniqueOrThrow({ where: { id: t.teamId } });
    expect(row).toMatchObject({ country: 'US', currency: 'USD', billingEntity: 'progrid_arabia', pendingCountry: 'SA', pendingCurrency: 'SAR' });
    expect(row.billingChangeAt?.toISOString()).toBe(next.toISOString());
    const bal = await t.client.ok('GET', '/v1/billing/balance');
    expect(bal.pendingChange).toMatchObject({ country: 'SA', currency: 'SAR', vat: { rate: 0.15, category: 'standard' }, billingEntity: { id: 'progrid_arabia', currency: 'SAR', taxRate: 0.15 } });
    expect(await s.prisma.auditLog.count({ where: { teamId: t.teamId, action: 'team.billing_currency_scheduled' } })).toBe(1);

    // Changing back before the date drops the scheduled change.
    await t.client.ok('PATCH', '/v1/team', { country: 'US' });
    expect(await s.prisma.team.findUniqueOrThrow({ where: { id: t.teamId } })).toMatchObject({ country: 'US', pendingCountry: null, pendingCurrency: null, billingChangeAt: null });

    // Scheduled again; nothing changes before the date, from it the team pays SAR.
    await t.client.ok('PATCH', '/v1/team', { country: 'SA' });
    await s.get(InvoicesService).applyDueEntityChanges(new Date());
    expect((await s.prisma.team.findUniqueOrThrow({ where: { id: t.teamId } })).currency).toBe('USD');
    await s.get(InvoicesService).applyDueEntityChanges(new Date(next.getTime() + 1000));
    row = await s.prisma.team.findUniqueOrThrow({ where: { id: t.teamId } });
    expect(row).toMatchObject({ country: 'SA', currency: 'SAR', billingEntity: 'progrid_arabia', pendingCountry: null, pendingCurrency: null, billingChangeAt: null });
    expect(await s.prisma.auditLog.count({ where: { teamId: t.teamId, action: 'team.billing_currency_changed' } })).toBe(1);

    // SA to AE: back to USD at 0%, again from the next month.
    await t.client.ok('PATCH', '/v1/team', { country: 'AE' });
    expect(await s.prisma.team.findUniqueOrThrow({ where: { id: t.teamId } })).toMatchObject({ country: 'SA', currency: 'SAR', pendingCountry: 'AE', pendingCurrency: 'USD' });
  });

  it('lets finance staff change a team\'s country and currency, audited; there is no company to move to', async () => {
    const admin = await staff(['finance', 'support']);
    const t = await signup(s, { country: 'AE' });
    // A country change that keeps the currency applies now.
    const addr = await admin.client.ok('POST', `/admin/v1/teams/${t.teamId}/billing-country`, { country: 'GB', reason: 'new office address' }, 201);
    expect(addr).toMatchObject({ scheduled: false, billingEntity: { id: 'progrid_arabia', currency: 'USD', taxRate: 0 } });
    // Into Saudi Arabia: SAR from next month.
    const r = await admin.client.ok('POST', `/admin/v1/teams/${t.teamId}/billing-country`, { country: 'SA', reason: 'moved to Riyadh' }, 201);
    expect(r).toMatchObject({ scheduled: true, billingEntity: { id: 'progrid_arabia', currency: 'SAR', taxRate: 0.15 } });
    expect(new Date(r.effectiveAt).getUTCDate()).toBe(1);
    expect(await s.prisma.team.findUniqueOrThrow({ where: { id: t.teamId } })).toMatchObject({ country: 'GB', currency: 'USD', pendingCountry: 'SA', pendingCurrency: 'SAR' });
    const audit = await s.prisma.auditLog.findFirst({ where: { teamId: t.teamId, action: 'admin.team_billing_currency_scheduled' } });
    expect(audit?.userId).toBe(admin.userId);
    await admin.client.ok('POST', `/admin/v1/teams/${t.teamId}/billing-country/cancel`, { reason: 'customer changed their mind' }, 200);
    expect(await s.prisma.team.findUniqueOrThrow({ where: { id: t.teamId } })).toMatchObject({ country: 'GB', pendingCurrency: null, billingChangeAt: null });
    // Staff may keep a currency that differs from the country's (for example, credit left in it).
    const keep = await admin.client.ok('POST', `/admin/v1/teams/${t.teamId}/billing-country`, { country: 'SA', currency: 'USD', reason: 'keeps USD credit until used' }, 201);
    expect(keep.scheduled).toBe(false);
    expect(await s.prisma.team.findUniqueOrThrow({ where: { id: t.teamId } })).toMatchObject({ country: 'SA', currency: 'USD' });
    // The old "move to the other company" option is gone.
    expect((await admin.client.post(`/admin/v1/teams/${t.teamId}/billing-country`, { country: 'US', billingEntity: 'progrid_llc', reason: 'x'.repeat(5) })).status).toBe(400);

    // Teams list under Progrid Arabia; finance shows Progrid Arabia first.
    const teams = await admin.client.ok('GET', `/admin/v1/teams?entity=progrid_arabia&q=${encodeURIComponent(t.email)}`);
    expect(teams.data.map((x: any) => x.id)).toEqual([t.teamId]);
    expect((await admin.client.ok('GET', `/admin/v1/teams?entity=progrid_llc&q=${encodeURIComponent(t.email)}`)).data).toEqual([]);
    const fin = await admin.client.ok('GET', '/admin/v1/finance/entities');
    expect(fin.data[0]).toMatchObject({ billingEntity: 'progrid_arabia', legalName: 'Progrid Arabia', legacy: false });
    expect(fin.data.every((d: any) => d.billingEntity === 'progrid_arabia' || d.legacy === true)).toBe(true);

    // Customers cannot use it.
    expect((await t.client.post(`/admin/v1/teams/${t.teamId}/billing-country`, { country: 'US', reason: 'x' })).status).toBe(403);
  });

  it('migration 20261012100000_single_entity moves LLC teams to Progrid Arabia and schedules currencies by country', async () => {
    const sql = readFileSync(join(__dirname, '../../prisma/migrations/20261012100000_single_entity/migration.sql'), 'utf8');
    const block = sql.slice(sql.indexOf('-- BEGIN single_entity data'), sql.indexOf('-- END single_entity data'));
    const statements = block.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').split(/;\s*\n/).map((x) => x.trim()).filter(Boolean);
    expect(statements.length).toBe(3);
    const next = nextBillingPeriod(new Date());
    class Rollback extends Error {}
    const mk = (tx: any, name: string, data: Record<string, unknown>) => tx.team.create({ data: { name, slug: `mig-${name}-${randomBytes(4).toString('hex')}`, ...data } });
    let checked = false;
    await s.prisma.$transaction(async (tx) => {
      const llcUs = await mk(tx, 'llc-us', { country: 'US', currency: 'USD', billingEntity: 'progrid_llc' });
      const llcSa = await mk(tx, 'llc-sa', { country: 'SA', currency: 'USD', billingEntity: 'progrid_llc' });
      const llcSaCredit = await mk(tx, 'llc-sa-credit', { country: 'SA', currency: 'USD', billingEntity: 'progrid_llc' });
      await tx.credit.create({ data: { teamId: llcSaCredit.id, kind: 'prepaid', currency: 'USD', amountMinor: 1_000, remainingMinor: 400 } });
      const llcSaSpent = await mk(tx, 'llc-sa-spent', { country: 'SA', currency: 'USD', billingEntity: 'progrid_llc' });
      await tx.credit.create({ data: { teamId: llcSaSpent.id, kind: 'prepaid', currency: 'USD', amountMinor: 1_000, remainingMinor: 0 } });
      const arDeOpen = await mk(tx, 'ar-de-open', { country: 'DE', currency: 'SAR', billingEntity: 'progrid_arabia' });
      await tx.invoice.create({ data: { teamId: arDeOpen.id, number: `MIG-${randomBytes(4).toString('hex')}`, currency: 'SAR', periodStart: new Date('2026-08-01T00:00:00Z'), periodEnd: new Date('2026-09-01T00:00:00Z'), subtotalMinor: 100, totalMinor: 115, status: 'open' } });
      const arDe = await mk(tx, 'ar-de', { country: 'DE', currency: 'SAR', billingEntity: 'progrid_arabia' });
      const arSa = await mk(tx, 'ar-sa', { country: 'SA', currency: 'SAR', billingEntity: 'progrid_arabia', pendingCountry: 'US', billingChangeAt: next });
      const llcPending = await mk(tx, 'llc-pending', { country: 'US', currency: 'USD', billingEntity: 'progrid_llc', pendingCountry: 'SA', billingChangeAt: next });

      for (const st of statements) await tx.$executeRawUnsafe(st);

      const get = (t: { id: string }) => tx.team.findUniqueOrThrow({ where: { id: t.id } });
      // Every team is Progrid Arabia's.
      expect(await tx.team.count({ where: { billingEntity: 'progrid_llc' } })).toBe(0);
      // Currency already matches the country: nothing scheduled.
      expect(await get(llcUs)).toMatchObject({ billingEntity: 'progrid_arabia', currency: 'USD', pendingCurrency: null, billingChangeAt: null });
      // A Saudi team on USD with no money held in USD: SAR from the first day of next month.
      const a = await get(llcSa);
      expect(a).toMatchObject({ billingEntity: 'progrid_arabia', currency: 'USD', pendingCurrency: 'SAR', pendingCountry: null });
      expect(a.billingChangeAt?.toISOString()).toBe(next.toISOString());
      expect(await get(llcSaSpent)).toMatchObject({ pendingCurrency: 'SAR' });
      // Credit left in USD: the team keeps USD.
      expect(await get(llcSaCredit)).toMatchObject({ billingEntity: 'progrid_arabia', currency: 'USD', pendingCurrency: null, billingChangeAt: null });
      // An unpaid SAR invoice: the team keeps SAR.
      expect(await get(arDeOpen)).toMatchObject({ currency: 'SAR', pendingCurrency: null, billingChangeAt: null });
      // Outside Saudi Arabia on SAR, nothing held: USD from next month.
      expect(await get(arDe)).toMatchObject({ currency: 'SAR', pendingCurrency: 'USD' });
      // Pending changes of company are cleared.
      expect(await get(arSa)).toMatchObject({ country: 'SA', currency: 'SAR', pendingCountry: null, pendingCurrency: null, billingChangeAt: null });
      expect(await get(llcPending)).toMatchObject({ country: 'US', currency: 'USD', billingEntity: 'progrid_arabia', pendingCountry: null, pendingCurrency: null, billingChangeAt: null });
      checked = true;
      throw new Rollback('roll back the migration test');
    }, { timeout: 60_000 }).catch((e) => { if (!(e instanceof Rollback)) throw e; });
    expect(checked).toBe(true);
    // The migration has run on this database too: the old column is gone and nothing is on the LLC.
    const cols = await s.prisma.$queryRawUnsafe<{ column_name: string }[]>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'prgd_teams' AND column_name IN ('pendingBillingEntity', 'pendingCurrency')`);
    expect(cols.map((c) => c.column_name)).toEqual(['pendingCurrency']);
  });

  it('allows credentialed CORS from both domains and only those', async () => {
    for (const origin of ['https://console.progrid.co', 'https://console.progrid.sa', 'https://ops.progrid.co', 'https://progrid.sa']) {
      const pre = await raw('OPTIONS', '/v1/servers', { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization,content-type' });
      expect(pre.status).toBeLessThan(300);
      expect(pre.headers.get('access-control-allow-origin')).toBe(origin);
      expect(pre.headers.get('access-control-allow-credentials')).toBe('true');
    }
    const other = await raw('OPTIONS', '/v1/servers', { origin: 'https://evil.example', 'access-control-request-method': 'POST' });
    expect(other.headers.get('access-control-allow-credentials')).toBeNull();
    const get = await raw('GET', '/v1/pricing', { origin: 'https://console.progrid.sa' });
    expect(get.headers.get('access-control-allow-origin')).toBe('https://console.progrid.sa');
  });

  it('prints links for the domain the request came through', async () => {
    const t = await signup(s, { country: 'SA' });
    await topUp(s, t);
    const viaSa = new Client(s.baseUrl, t.client.token);
    const agentSa = await raw('POST', '/v1/connect/agents', { authorization: `Bearer ${viaSa.token}`, 'x-forwarded-host': 'api.progrid.sa' }, { name: 'domain probe', instructions: 'Say hello.' });
    expect(agentSa.status).toBe(201);
    expect(agentSa.body.runEndpoint).toBe(`https://api.progrid.sa/v1/connect/agents/${agentSa.body.id}/run`);
    const agentCo = await raw('GET', `/v1/connect/agents/${agentSa.body.id}`, { authorization: `Bearer ${viaSa.token}`, 'x-forwarded-host': 'api.progrid.co' });
    expect(agentCo.body.runEndpoint).toBe(`https://api.progrid.co/v1/connect/agents/${agentSa.body.id}/run`);

    // A top up started from console.progrid.co returns there, even for a Progrid Arabia team.
    const top = await raw('POST', '/v1/billing/topup', { authorization: `Bearer ${viaSa.token}`, origin: 'https://console.progrid.co', 'x-forwarded-host': 'api.progrid.co' }, { amountMinor: 2_000 });
    expect(top.status).toBe(201);
    const pay = await s.prisma.payment.findUniqueOrThrow({ where: { id: top.body.paymentId } });
    expect((pay.metadata as any).successUrl).toBe('https://console.progrid.co/billing?payment=success');
    expect(top.body.redirectUrl.startsWith('https://api.progrid.co/v1/billing/payments/fake/pay')).toBe(true);
  });
});
