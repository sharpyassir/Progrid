import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { MeteringService } from '../../src/modules/billing/metering.service';
import { RatingService } from '../../src/modules/billing/rating.service';
import { InvoicesService } from '../../src/modules/billing/invoices.service';
import { BillingAdminService } from '../../src/modules/billing/billing-admin.service';
import { startOfMonth } from '../../src/modules/billing/pricing';
import { renderInvoicePdf } from '../../src/modules/billing/invoice-pdf';
import type { Actor } from '../../src/common/auth/actor';
import { Client, signup, sut, topUp, totp, waitFor, waitStatus, type Sut, type Team } from './harness';

/**
 * Two domains and two billing companies (docs/domains-and-entities.md): Progrid Arabia bills
 * teams whose billing country is Saudi Arabia, Progrid Technologies LLC everyone else.
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

describe('billing entities', () => {
  it('assigns the company from the billing country, never from the domain or address alone', async () => {
    const sa = await signup(s, { country: 'SA' });
    const de = await signup(s, { country: 'DE' });
    const saTeam = await s.prisma.team.findUniqueOrThrow({ where: { id: sa.teamId } });
    const deTeam = await s.prisma.team.findUniqueOrThrow({ where: { id: de.teamId } });
    expect(saTeam).toMatchObject({ country: 'SA', billingEntity: 'progrid_arabia', currency: 'SAR' });
    expect(deTeam).toMatchObject({ country: 'DE', billingEntity: 'progrid_llc', currency: 'USD' });

    // The team page and the balance name the company.
    const team = await sa.client.ok('GET', '/v1/team');
    expect(team.team.entity).toMatchObject({ id: 'progrid_arabia', currency: 'SAR', supportEmail: 'support@progrid.sa', consoleUrl: 'https://console.progrid.sa' });
    const bal = await de.client.ok('GET', '/v1/billing/balance');
    expect(bal.billingEntity).toMatchObject({ id: 'progrid_llc', legalName: 'Progrid Technologies LLC', currency: 'USD', taxRate: 0 });

    // A country picked on the .sa domain still wins: a German signup there is billed by the LLC.
    const email = `it-${randomBytes(6).toString('hex')}@example.test`;
    const viaSa = await raw('POST', '/v1/auth/signup', { 'x-forwarded-host': 'api.progrid.sa' }, { email, password: 'pw-long-enough-1', name: 'Via SA', teamName: 'via sa', country: 'DE' });
    expect(viaSa.status).toBe(201);
    expect(viaSa.body.team).toMatchObject({ country: 'DE', billingEntity: 'progrid_llc', currency: 'USD' });

    // Without a country, the .sa domain defaults to Saudi Arabia and the .co domain to the caller's country (US without a database).
    const noCountrySa = await raw('POST', '/v1/auth/signup', { 'x-forwarded-host': 'api.progrid.sa' }, { email: `it-${randomBytes(6).toString('hex')}@example.test`, password: 'pw-long-enough-1', name: 'Default SA', teamName: 'default sa' });
    expect(noCountrySa.body.team).toMatchObject({ country: 'SA', billingEntity: 'progrid_arabia', currency: 'SAR' });
    const geo = await raw('GET', '/v1/geo', { 'x-forwarded-host': 'api.progrid.sa' });
    expect(geo.body).toMatchObject({ country: 'SA', source: 'domain', billingEntity: 'progrid_arabia', currency: 'SAR' });
    const geoCo = await raw('GET', '/v1/geo', { 'x-forwarded-host': 'api.progrid.co', 'x-real-ip': '2.88.0.1' });
    if (geoCo.body.database) expect(geoCo.body).toMatchObject({ country: 'SA', source: 'ip', billingEntity: 'progrid_arabia' });
    else expect(geoCo.body).toMatchObject({ country: 'US', source: 'default', billingEntity: 'progrid_llc' });

    // Customers cannot move themselves between companies; a move within one company is fine.
    const locked = await sa.client.patch('/v1/team', { country: 'AE' });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('billing_country_locked');
    expect(locked.body.error.message).toContain('support@progrid.sa');
    expect((await de.client.patch('/v1/team', { country: 'FR' })).status).toBe(200);
    expect((await de.client.patch('/v1/team', { country: 'SA' })).status).toBe(409);
    expect((await s.prisma.team.findUniqueOrThrow({ where: { id: de.teamId } })).country).toBe('FR');
  });

  it('issues SAR invoices with VAT in the PRGD-SA series and USD invoices without tax in the PRGD-US series', async () => {
    const sa = await signup(s, { country: 'SA' });
    const us = await signup(s, { country: 'US' });
    await topUp(s, sa, 2_000); // 20 SAR, less than the usage below
    await topUp(s, us, 500); // 5 USD
    const saSrv = await serverWithUsage(sa, 80);
    const usSrv = await serverWithUsage(us, 80);

    // The book is in riyals; dollar teams are rated at the pegged 3.75: 239 SAR = 63.73 USD a month, 9 cents an hour.
    const saRec = await s.prisma.usageRecord.findMany({ where: { resourceId: saSrv.id, resourceType: 'server' } });
    const usRec = await s.prisma.usageRecord.findMany({ where: { resourceId: usSrv.id, resourceType: 'server' } });
    expect(saRec.every((r) => r.currency === 'SAR' && r.amountMinor === 36)).toBe(true);
    expect(usRec.every((r) => r.currency === 'USD' && r.amountMinor === 9)).toBe(true);

    s.outbox.length = 0;
    await s.get(InvoicesService).issueForPreviousMonth(new Date());
    const saInv = (await sa.client.ok('GET', '/v1/billing/invoices')).data[0];
    const usInv = (await us.client.ok('GET', '/v1/billing/invoices')).data[0];

    const year = new Date().getUTCFullYear();
    expect(saInv.number).toMatch(new RegExp(`^PRGD-SA-${year}-\\d{5}$`));
    expect(saInv).toMatchObject({ billingEntity: 'progrid_arabia', currency: 'SAR', subtotalMinor: 80 * 36, taxMinor: Math.round(80 * 36 * 0.15), creditMinor: 2_000, eInvoiceType: 'zatca', status: 'open' });
    expect(usInv.number).toMatch(new RegExp(`^PRGD-US-${year}-\\d{5}$`));
    expect(usInv).toMatchObject({ billingEntity: 'progrid_llc', currency: 'USD', subtotalMinor: 80 * 9, taxMinor: 0, creditMinor: 500, totalMinor: 80 * 9 - 500, eInvoiceType: null, status: 'open' });

    // The two series count independently.
    const saNext = await s.prisma.$queryRawUnsafe<{ last_value: bigint }[]>(`SELECT last_value FROM prgd_invoice_number_sa_seq`);
    const usNext = await s.prisma.$queryRawUnsafe<{ last_value: bigint }[]>(`SELECT last_value FROM prgd_invoice_number_us_seq`);
    expect(Number(saInv.number.slice(-5))).toBeLessThanOrEqual(Number(saNext[0].last_value));
    expect(Number(usInv.number.slice(-5))).toBeLessThanOrEqual(Number(usNext[0].last_value));

    // Invoice mails come from the company of the invoice and link to its console.
    const saMail = await waitFor(async () => s.outbox.find((m) => m.to === sa.email && m.subject.includes(saInv.number)), { what: 'the SA invoice mail', timeoutMs: 10_000 });
    const usMail = await waitFor(async () => s.outbox.find((m) => m.to === us.email && m.subject.includes(usInv.number)), { what: 'the US invoice mail', timeoutMs: 10_000 });
    expect(saMail).toMatchObject({ entity: 'progrid_arabia', from: 'Progrid <no-reply@progrid.sa>' });
    expect(saMail!.text).toContain('https://console.progrid.sa/billing');
    expect(saMail!.subject).toContain('SAR');
    expect(usMail).toMatchObject({ entity: 'progrid_llc', from: 'Progrid <no-reply@progrid.co>' });
    expect(usMail!.text).toContain('https://console.progrid.co/billing');
    expect(usMail!.subject).toContain('$');

    // PDFs render in the name of each company.
    for (const [t, inv] of [[sa, saInv], [us, usInv]] as const) {
      const pdf = await t.client.get(`/v1/billing/invoices/${inv.id}/pdf`);
      expect(pdf.status).toBe(200);
      expect(pdf.headers.get('content-type')).toBe('application/pdf');
    }
    const full = await s.prisma.invoice.findUniqueOrThrow({ where: { id: usInv.id }, include: { team: true, records: true } });
    expect((await renderInvoicePdf(full)).subarray(0, 4).toString()).toBe('%PDF');

    // Paying goes to the company's gateway, in the invoice's currency (the test page stands in for Stripe and Moyasar).
    const pay = await us.client.ok('POST', `/v1/billing/invoices/${usInv.id}/pay`, {}, 201);
    expect(pay).toMatchObject({ currency: 'USD', billingEntity: 'progrid_llc', amountMinor: usInv.totalMinor });
    const paySa = await sa.client.ok('POST', `/v1/billing/invoices/${saInv.id}/pay`, {}, 201);
    expect(paySa).toMatchObject({ currency: 'SAR', billingEntity: 'progrid_arabia' });

    // Credit notes follow the invoice's company and series.
    const actor = { userId: us.userId, teamId: us.teamId, role: 'owner', scopes: new Set(['admin']), isAgent: false, requireApprovalFor: new Set() } as unknown as Actor;
    const noteUs = await s.get(BillingAdminService).creditNote(actor, usInv.id, 100, 'goodwill');
    const noteSa = await s.get(BillingAdminService).creditNote(actor, saInv.id, 100, 'goodwill');
    expect(noteUs.number).toMatch(new RegExp(`^CN-US-${year}-\\d{5}$`));
    expect(noteUs.billingEntity).toBe('progrid_llc');
    expect(noteSa.number).toMatch(new RegExp(`^CN-SA-${year}-\\d{5}$`));
  });

  it('sends account mail from the company of the team', async () => {
    s.outbox.length = 0;
    const sa = await signup(s, { country: 'SA', verify: false });
    const us = await signup(s, { country: 'GB', verify: false });
    const saMail = await waitFor(async () => s.outbox.find((m) => m.to === sa.email && /verify\?token=/.test(m.text)), { what: 'the SA verification mail', timeoutMs: 10_000 });
    const usMail = await waitFor(async () => s.outbox.find((m) => m.to === us.email && /verify\?token=/.test(m.text)), { what: 'the GB verification mail', timeoutMs: 10_000 });
    expect(saMail).toMatchObject({ from: 'Progrid <no-reply@progrid.sa>' });
    expect(saMail!.text).toContain('https://console.progrid.sa/verify?token=');
    expect(usMail).toMatchObject({ from: 'Progrid <no-reply@progrid.co>' });
    expect(usMail!.text).toContain('https://console.progrid.co/verify?token=');
  });

  it('lets staff move a team to the other company from the next billing period, audited', async () => {
    const admin = await staff(['finance', 'support']);
    const t = await signup(s, { country: 'AE' });
    const r = await admin.client.ok('POST', `/admin/v1/teams/${t.teamId}/billing-country`, { country: 'SA', reason: 'moved to Riyadh office' }, 201);
    expect(r.scheduled).toBe(true);
    const next = new Date(r.effectiveAt);
    expect(next.getUTCDate()).toBe(1);
    expect(next.getTime()).toBeGreaterThan(Date.now());
    let row = await s.prisma.team.findUniqueOrThrow({ where: { id: t.teamId } });
    expect(row).toMatchObject({ country: 'AE', billingEntity: 'progrid_llc', currency: 'USD', pendingCountry: 'SA', pendingBillingEntity: 'progrid_arabia' });
    const bal = await t.client.ok('GET', '/v1/billing/balance');
    expect(bal.pendingChange.billingEntity.id).toBe('progrid_arabia');
    const audit = await s.prisma.auditLog.findFirst({ where: { teamId: t.teamId, action: 'admin.team_billing_entity_scheduled' } });
    expect(audit?.userId).toBe(admin.userId);

    // Before the date nothing changes; from it the team is billed by Progrid Arabia in SAR.
    await s.get(InvoicesService).applyDueEntityChanges(new Date());
    expect((await s.prisma.team.findUniqueOrThrow({ where: { id: t.teamId } })).billingEntity).toBe('progrid_llc');
    await s.get(InvoicesService).applyDueEntityChanges(new Date(next.getTime() + 1000));
    row = await s.prisma.team.findUniqueOrThrow({ where: { id: t.teamId } });
    expect(row).toMatchObject({ country: 'SA', billingEntity: 'progrid_arabia', currency: 'SAR', pendingBillingEntity: null, billingChangeAt: null });

    // Team and invoice lists filter by company; finance shows revenue per company.
    const teams = await admin.client.ok('GET', `/admin/v1/teams?entity=progrid_arabia&q=${encodeURIComponent(t.email)}`);
    expect(teams.data.every((x: any) => x.billingEntity === 'progrid_arabia')).toBe(true);
    expect(teams.data.map((x: any) => x.id)).toEqual([t.teamId]);
    expect((await admin.client.ok('GET', `/admin/v1/teams?entity=progrid_llc&q=${encodeURIComponent(t.email)}`)).data).toEqual([]);
    const invoices = await admin.client.ok('GET', '/admin/v1/invoices?entity=progrid_llc');
    expect(invoices.data.every((x: any) => x.billingEntity === 'progrid_llc')).toBe(true);
    const fin = await admin.client.ok('GET', '/admin/v1/finance/entities');
    expect(fin.data.map((d: any) => d.billingEntity)).toEqual(['progrid_llc', 'progrid_arabia']);
    expect(fin.data[0]).toMatchObject({ legalName: 'Progrid Technologies LLC', currency: 'USD' });
    expect(fin.data[1].currency).toBe('SAR');

    // Customers cannot do it themselves; support staff without finance cannot either.
    expect((await t.client.post(`/admin/v1/teams/${t.teamId}/billing-country`, { country: 'US', reason: 'x' })).status).toBe(403);
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
