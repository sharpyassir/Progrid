import { beforeAll, describe, expect, it } from 'vitest';
import { MeteringService } from '../../src/modules/billing/metering.service';
import { RatingService } from '../../src/modules/billing/rating.service';
import { InvoicesService } from '../../src/modules/billing/invoices.service';
import { DunningService } from '../../src/modules/billing/dunning.service';
import { startOfMonth } from '../../src/modules/billing/pricing';
import { signup, sut, topUp, waitFor, waitStatus, type Sut, type Team } from './harness';

let s: Sut;
beforeAll(async () => {
  s = await sut();
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A running server of the team, active and metered. */
async function bigServer(t: Team, name: string) {
  const r = await t.client.ok('POST', '/v1/servers', { name, size: 's-8vcpu-16gb', image: 'ubuntu-24-04' }, 202);
  return waitStatus<any>(t.client, `/v1/servers/${r.id}`, 'active');
}

/**
 * Usage for `hours` whole hours of last month, reported per minute the way host agents do
 * (usage.v1), then rated hour by hour. Only this server is metered, so other tests' teams
 * are not billed.
 */
async function useLastMonth(serverId: string, hours: number) {
  const srv = await s.prisma.server.findUniqueOrThrow({ where: { id: serverId } });
  const first = new Date(startOfMonth(new Date(startOfMonth(new Date()).getTime() - 1)).getTime() + DAY);
  const metering = s.get(MeteringService);
  const rating = s.get(RatingService);
  for (let h = 0; h < hours; h++) {
    const hourStart = new Date(first.getTime() + h * HOUR);
    await metering.ingest(Array.from({ length: 60 }, (_, m) => ({ v: 1 as const, at: new Date(hourStart.getTime() + m * 60_000).toISOString(), resourceType: 'server' as const, resourceId: srv.id, projectId: srv.projectId, hostId: srv.hostId!, quantity: 1, unit: 'minute' as const })));
    await rating.rollupHour(hourStart);
  }
}

describe('billing', () => {
  it('rates hourly usage and issues the monthly invoice with 15 percent VAT, settled from credit', async () => {
    const t = await signup(s);
    await topUp(s, t, 50_000);
    const srv = await bigServer(t, 'rated');
    await useLastMonth(srv.id, 10);

    // s-8vcpu-16gb is 239 SAR a month over 672 hours: 35.57 halalas an hour, rounded per hour.
    const records = await s.prisma.usageRecord.findMany({ where: { resourceId: srv.id, resourceType: 'server' } });
    expect(records).toHaveLength(10);
    for (const r of records) expect(r.amountMinor).toBe(36);
    expect(records[0].currency).toBe('SAR');

    const issued = await s.get(InvoicesService).issueForPreviousMonth(new Date());
    expect(issued).toBeGreaterThanOrEqual(1);
    const list = await t.client.ok('GET', '/v1/billing/invoices');
    expect(list.data).toHaveLength(1);
    const inv = list.data[0];
    expect(inv.currency).toBe('SAR');
    expect(inv.subtotalMinor).toBe(360);
    expect(inv.taxMinor).toBe(54);
    expect(inv.taxMinor).toBe(Math.round(inv.subtotalMinor * 0.15));
    expect(inv.creditMinor).toBe(414);
    expect(inv.totalMinor).toBe(0);
    expect(inv.status).toBe('paid');
    expect(inv.eInvoiceType).toBe('zatca');
    const detail = await t.client.ok('GET', `/v1/billing/invoices/${inv.id}`);
    expect(detail.records).toHaveLength(10);
    const bal = await t.client.ok('GET', '/v1/billing/balance');
    expect(bal.creditMinor).toBe(50_000 - 414);
    // The console home compares the month's projection with last month.
    expect(bal.lastMonthMinor).toBe(360);
    const pdf = await t.client.get(`/v1/billing/invoices/${inv.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');

    // A second run for the same month issues nothing new.
    await s.get(InvoicesService).issueForPreviousMonth(new Date());
    expect((await t.client.ok('GET', '/v1/billing/invoices')).data).toHaveLength(1);
  });

  it('reports spend today and projects the month from the last 24 hours', async () => {
    const t = await signup(s);
    const team = await s.prisma.team.findUniqueOrThrow({ where: { id: t.teamId } });
    const thisHour = new Date(Math.floor(Date.now() / HOUR) * HOUR);
    await s.prisma.usageRecord.create({ data: { projectId: t.projectId, resourceType: 'server', resourceId: 'srv-home', hourStart: thisHour, quantity: 60, unit: 'minute', amountMinor: 240, currency: team.currency } });
    const bal = await t.client.ok('GET', '/v1/billing/balance');
    expect(bal.todayMinor).toBe(240);
    expect(bal.monthToDateMinor).toBe(240);
    // 240 in the last 24 hours is 10 an hour for every hour left in the month.
    const hoursLeft = (Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1) - Date.now()) / HOUR;
    expect(Math.abs(bal.projectedMonthMinor - (240 + Math.round(10 * hoursLeft)))).toBeLessThanOrEqual(1);
    expect(bal.lastMonthMinor).toBe(0);
  });

  it('suspends a team 14 days after the due date, powers its servers off, and reinstates it once paid', async () => {
    const t = await signup(s);
    await topUp(s, t, 2_000); // the smallest top up; the usage below costs more
    const srv = await bigServer(t, 'overdue');
    await useLastMonth(srv.id, 60);
    await s.get(InvoicesService).issueForPreviousMonth(new Date());
    const inv = (await t.client.ok('GET', '/v1/billing/invoices')).data[0];
    expect(inv.subtotalMinor).toBe(60 * 36);
    expect(inv.taxMinor).toBe(Math.round(60 * 36 * 0.15));
    expect(inv.creditMinor).toBe(2_000);
    expect(inv.totalMinor).toBe(inv.subtotalMinor + inv.taxMinor - 2_000);
    expect(inv.status).toBe('open');

    // Seven days late: a reminder, nothing more.
    const dunning = s.get(DunningService);
    const due = new Date(inv.dueAt).getTime();
    await dunning.run(new Date(due + 7 * DAY + HOUR));
    expect((await t.client.ok('GET', '/v1/billing/balance')).status).toBe('active');
    expect(s.outbox.some((m) => m.to === t.email && m.subject.startsWith(`Reminder: invoice ${inv.number}`))).toBe(true);

    // Fourteen days late: suspended, servers powered off, only billing still works.
    await dunning.run(new Date(due + 14 * DAY + HOUR));
    const off = await waitFor(async () => {
      const row = await s.prisma.server.findUniqueOrThrow({ where: { id: srv.id } });
      return row.status === 'off' ? row : null;
    }, { what: 'the server to be powered off', timeoutMs: 30_000 });
    expect(off.suspendedPoweredOff).toBe(true);
    expect((await t.client.ok('GET', '/v1/billing/balance')).status).toBe('suspended');
    const blocked = await t.client.get('/v1/servers');
    expect(blocked.status).toBe(403);
    expect(blocked.text).toContain('account_suspended');
    expect(s.outbox.some((m) => m.to === t.email && m.subject.startsWith('Account suspended'))).toBe(true);

    // Paying the invoice by card lifts the suspension and powers the server back on.
    const pay = await t.client.ok('POST', `/v1/billing/invoices/${inv.id}/pay`, {}, 201);
    expect(pay.amountMinor).toBe(inv.totalMinor);
    const ref = new URL(pay.redirectUrl).searchParams.get('ref')!;
    const confirm = await t.client.req('GET', `/v1/billing/payments/fake/confirm?ref=${ref}&outcome=ok`, undefined, { token: null, redirect: 'manual' });
    expect(confirm.status).toBe(302);
    expect((await t.client.ok('GET', `/v1/billing/invoices/${inv.id}`)).status).toBe('paid');
    expect((await t.client.ok('GET', '/v1/billing/balance')).status).toBe('active');
    const back = await waitStatus<any>(t.client, `/v1/servers/${srv.id}`, 'active', 30_000);
    expect(back.status).toBe('active');
    expect((await s.prisma.server.findUniqueOrThrow({ where: { id: srv.id } })).suspendedPoweredOff).toBe(false);
  });
});
