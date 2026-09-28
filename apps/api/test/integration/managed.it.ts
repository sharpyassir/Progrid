import { beforeAll, describe, expect, it } from 'vitest';
import { Client, signup, sut, totp, waitFor, type Sut, type Team } from './harness';
import { addSlaMinutes } from '../../src/modules/managed/sla/sla-calculator';
import { ManagedAlertsService } from '../../src/modules/managed/alerts/alerts.service';
import { ManagedBillingService } from '../../src/modules/managed/billing-hooks/managed-billing.service';
import { InvoicesService } from '../../src/modules/billing/invoices.service';
import { startOfMonth } from '../../src/modules/billing/pricing';
import { MaintenanceService } from '../../src/modules/managed/maintenance/maintenance.service';
import { ReportsService } from '../../src/modules/managed/reports/reports.service';

const DAY = 86_400_000;

/**
 * Managed cloud: contracts, onboarding, tickets and SLA due times, alerts and paging,
 * worklogs and invoices, maintenance runs and monthly reports.
 */

let s: Sut;
let lead: Team;
let engineer: Team;

beforeAll(async () => {
  s = await sut();
  lead = await staff(['support_lead']);
  engineer = await staff(['engineer']);
});

/** A staff user with the given roles and two factor sign in on (required for the back office). */
async function staff(roles: string[]) {
  const t = await signup(s);
  await s.prisma.user.update({ where: { id: t.userId }, data: { isStaff: true, staffRoles: roles } });
  const setup = await t.client.ok('POST', '/v1/auth/totp/setup', {}, 201);
  await t.client.ok('POST', '/v1/auth/totp/enable', { code: totp(setup.secret) }, 201);
  return t;
}

/** A second user moved into the owner's team as a plain member, signed in to it. */
async function member(owner: Team) {
  const m = await signup(s);
  await s.prisma.teamMember.deleteMany({ where: { userId: m.userId } });
  await s.prisma.teamMember.create({ data: { teamId: owner.teamId, userId: m.userId, role: 'member' } });
  const client = new Client(s.baseUrl);
  const r = await client.ok('POST', '/v1/auth/login', { email: m.email, password: m.password }, 200);
  client.token = r.session;
  return { ...m, client, teamId: owner.teamId };
}

/** A customer team with a contract on `plan`, activated and through onboarding. */
async function activeContract(plan = 'ESSENTIAL', opts: { overrideOnCallRule?: boolean } = {}) {
  const owner = await signup(s);
  const c = await owner.client.ok('POST', '/v1/managed/contracts', { plan, notes: 'Two web servers and a site' }, 201);
  await lead.client.ok('POST', `/admin/managed/contracts/${c.id}/activate`, { liabilityCapMinor: 1_000_000, signedByName: 'Customer CEO', ...opts }, 200);
  const list = await engineer.client.ok('GET', `/admin/managed/contracts/${c.id}/onboarding`);
  for (const item of list.data) await engineer.client.ok('PATCH', `/admin/managed/contracts/${c.id}/onboarding/${item.key}`, { done: true });
  await waitFor(async () => (await owner.client.ok('GET', `/v1/managed/contracts/${c.id}`)).status === 'ACTIVE', { what: 'contract to become ACTIVE', timeoutMs: 30_000 });
  return { owner, contractId: c.id as string };
}

describe('managed cloud contracts', () => {
  it('lists the seeded plans', async () => {
    const t = await signup(s);
    const plans = await t.client.ok('GET', '/v1/managed/plans');
    const codes = plans.data.map((p: { code: string }) => p.code);
    expect(codes).toEqual(['ESSENTIAL', 'BUSINESS', 'ENTERPRISE']);
    const essential = plans.data[0];
    expect(essential).toMatchObject({ priceMinor: 110_000, currency: 'SAR', maxAssets: 3, coverage: 'BUSINESS_HOURS', includedEngineerMinutes: 120, hourlyRateMinor: 25_000 });
    expect(essential.responseTargets).toEqual({ P1: 240, P2: 480, P3: 960, P4: 2400 });
    expect(plans.data[2].custom).toBe(true);
  });

  it('runs a request through onboarding to ACTIVE', async () => {
    const owner = await signup(s);
    const c = await owner.client.ok('POST', '/v1/managed/contracts', { plan: 'ESSENTIAL' }, 201);
    expect(c.status).toBe('DRAFT');
    expect(c.monthlyFeeMinor).toBe(110_000);
    expect(c.responsibilities.length).toBeGreaterThan(5);
    expect(c.sla).toMatchObject({ coverage: 'BUSINESS_HOURS', calendar: 'SA', timeZone: 'Asia/Riyadh' });

    // Only a support lead activates, and the signature fields are required.
    expect((await engineer.client.post(`/admin/managed/contracts/${c.id}/activate`, { liabilityCapMinor: 1, signedByName: 'X' })).status).toBe(403);
    expect((await lead.client.post(`/admin/managed/contracts/${c.id}/activate`, {})).status).toBe(400);
    const onboarding = await lead.client.ok('POST', `/admin/managed/contracts/${c.id}/activate`, { liabilityCapMinor: 1_000_000, signedByName: 'Customer CEO' }, 200);
    expect(onboarding.status).toBe('ONBOARDING');
    expect(onboarding.onboarding.total).toBe(5);

    // A member cannot read contracts or request plans, but can see assets.
    const m = await member(owner);
    expect((await m.client.get(`/v1/managed/contracts/${c.id}`)).status).toBe(403);
    expect((await m.client.post('/v1/managed/contracts', { plan: 'ESSENTIAL' })).status).toBe(403);
    expect((await m.client.get(`/v1/managed/contracts/${c.id}/assets`)).status).toBe(200);
    // Another team cannot see it at all.
    expect((await (await signup(s)).client.get(`/v1/managed/contracts/${c.id}/assets`)).status).toBe(404);

    const audit = await s.prisma.auditLog.findMany({ where: { resource: `managed_contract:${c.id}` }, orderBy: { at: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['managed.contract_requested', 'managed.contract_onboarding']));

    const items = (await engineer.client.ok('GET', `/admin/managed/contracts/${c.id}/onboarding`)).data;
    for (const item of items.slice(0, -1)) await engineer.client.ok('PATCH', `/admin/managed/contracts/${c.id}/onboarding/${item.key}`, { done: true });
    expect((await owner.client.ok('GET', `/v1/managed/contracts/${c.id}`)).status).toBe('ONBOARDING');
    await engineer.client.ok('PATCH', `/admin/managed/contracts/${c.id}/onboarding/${items.at(-1).key}`, { done: true });
    const active = await waitFor(async () => {
      const r = await owner.client.ok('GET', `/v1/managed/contracts/${c.id}`);
      return r.status === 'ACTIVE' && r;
    }, { what: 'contract to become ACTIVE', timeoutMs: 30_000 });
    expect(active.activatedAt).toBeTruthy();
    const activated = await s.prisma.auditLog.findMany({ where: { resource: `managed_contract:${c.id}`, action: 'managed.contract_activated' } });
    expect(activated).toHaveLength(1);
    // The onboarding workflow made the move, woken by the checklist signal.
    expect((activated[0].request as { via: string }).via).toBe('workflow');
  });

  it('holds 24/7 plans to the two person on call rule', async () => {
    const owner = await signup(s);
    const c = await owner.client.ok('POST', '/v1/managed/contracts', { plan: 'BUSINESS' }, 201);
    await s.prisma.onCallShift.deleteMany({});
    const refused = await lead.client.post(`/admin/managed/contracts/${c.id}/activate`, { liabilityCapMinor: 1, signedByName: 'CTO' });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('on_call_rule');
    const ok = await lead.client.ok('POST', `/admin/managed/contracts/${c.id}/activate`, { liabilityCapMinor: 1, signedByName: 'CTO', overrideOnCallRule: true }, 200);
    expect(ok.status).toBe('ONBOARDING');
    expect(await s.prisma.auditLog.count({ where: { resource: `managed_contract:${c.id}`, action: 'managed.on_call_rule_overridden' } })).toBe(1);
  });

  it('manages assets, suspension and cancellation', async () => {
    const { owner, contractId } = await activeContract();
    const asset = await owner.client.ok('POST', `/v1/managed/contracts/${contractId}/assets`, { kind: 'EXTERNAL_SERVER', name: 'web-1', address: '203.0.113.50', provider: 'Hetzner' }, 201);
    expect(asset.status).toBe('PENDING');
    const approved = await engineer.client.ok('POST', `/admin/managed/assets/${asset.id}/approve`, {}, 200);
    expect(approved.status).toBe('APPROVED');
    expect((await engineer.client.patch(`/admin/managed/assets/${asset.id}`, { backupEnabled: true })).status).toBe(403);
    await lead.client.ok('PATCH', `/admin/managed/assets/${asset.id}`, { backupEnabled: true, managementAddress: '10.8.0.5' });
    const assets = await owner.client.ok('GET', `/v1/managed/contracts/${contractId}/assets`);
    expect(assets.data[0]).toMatchObject({ name: 'web-1', backupEnabled: true, status: 'APPROVED' });
    expect(assets.data[0].managementAddress).toBeUndefined();

    const r = await lead.client.ok('POST', `/admin/managed/contracts/${contractId}/responsibilities`, { area: 'DNS records', owner: 'CUSTOMER' }, 201);
    expect(r.owner).toBe('CUSTOMER');

    expect((await lead.client.ok('POST', `/admin/managed/contracts/${contractId}/suspend`, { reason: 'test' }, 200)).status).toBe('SUSPENDED');
    expect((await lead.client.ok('POST', `/admin/managed/contracts/${contractId}/resume`, {}, 200)).status).toBe('ACTIVE');
    const cancelled = await lead.client.ok('POST', `/admin/managed/contracts/${contractId}/cancel`, { reason: 'moving on' }, 200);
    expect(cancelled.status).toBe('CANCELLED');
    const handover = s.outbox.find((m) => m.to === owner.email && m.subject.startsWith('Handover'));
    expect(handover?.text).toContain('web-1');
    const after = await s.prisma.managedAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(after.monitoringEnabled).toBe(false);
  });
});

describe('managed cloud tickets', () => {
  it('opens a P2 ticket with due times from the plan and the Saudi calendar', async () => {
    const { owner, contractId } = await activeContract('ESSENTIAL');
    const t = await owner.client.ok('POST', '/v1/managed/tickets', { subject: 'Site is slow', body: 'Checkout takes 20 seconds', priority: 'P2' }, 201);
    expect(t).toMatchObject({ priority: 'P2', status: 'open', contractId });
    const holidays = (await s.prisma.holiday.findMany({ where: { country: 'SA' } })).map((h) => h.date.toISOString().slice(0, 10));
    const cal = { coverage: 'BUSINESS_HOURS' as const, country: 'SA' as const, holidays };
    const opened = new Date(t.createdAt);
    expect(new Date(t.responseDueAt).toISOString()).toBe(addSlaMinutes(opened, 480, cal).toISOString());
    expect(new Date(t.resolveDueAt).toISOString()).toBe(addSlaMinutes(opened, 960, cal).toISOString());
    // The general support queue sees it as a high priority ticket.
    const row = await s.prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.priority).toBe('high');
    expect(row.firstResponseDueAt?.toISOString()).toBe(new Date(t.responseDueAt).toISOString());
  });

  it('never shows internal notes to the customer', async () => {
    const { owner } = await activeContract('ESSENTIAL');
    const m = await member(owner);
    const t = await m.client.ok('POST', '/v1/managed/tickets', { subject: 'Disk almost full', body: 'On web-1', priority: 'P3' }, 201);
    await engineer.client.ok('POST', `/admin/managed/tickets/${t.id}/messages`, { body: 'Customer runs an old kernel, see runbook', internal: true }, 201);
    const afterNote = await s.prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
    expect(afterNote.firstRespondedAt).toBeNull();
    await engineer.client.ok('POST', `/admin/managed/tickets/${t.id}/messages`, { body: 'We are cleaning old logs now.' }, 201);

    for (const c of [owner.client, m.client]) {
      const view = await c.ok('GET', `/v1/managed/tickets/${t.id}`);
      expect(view.messages.map((x: { body: string }) => x.body)).toEqual(['On web-1', 'We are cleaning old logs now.']);
      expect(JSON.stringify(view)).not.toContain('old kernel');
      expect(view.firstRespondedAt).toBeTruthy();
      // The general support endpoint hides it too.
      const general = await c.ok('GET', `/v1/support/tickets/${t.id}`);
      expect(JSON.stringify(general)).not.toContain('old kernel');
      const list = await c.ok('GET', '/v1/managed/tickets?status=all');
      expect(list.data.find((x: { id: string }) => x.id === t.id).messageCount).toBe(2);
    }
    const staffView = await engineer.client.ok('GET', `/admin/managed/tickets/${t.id}`);
    expect(staffView.messages.filter((x: { internal: boolean }) => x.internal).map((x: { body: string }) => x.body)).toEqual(['Customer runs an old kernel, see runbook']);
    expect(staffView.assigneeId).toBe(engineer.userId);

    // Engineers cannot assign to someone else; a support lead can.
    expect((await engineer.client.patch(`/admin/managed/tickets/${t.id}`, { assigneeId: lead.userId })).status).toBe(403);
    expect((await lead.client.ok('PATCH', `/admin/managed/tickets/${t.id}`, { assigneeId: lead.userId })).assigneeId).toBe(lead.userId);
  });

  it('warns at 75 percent and escalates a breach to the support lead', async () => {
    const { owner } = await activeContract('ESSENTIAL');
    const t = await owner.client.ok('POST', '/v1/managed/tickets', { subject: 'Backups failing', body: 'Since yesterday', priority: 'P4' }, 201);
    await lead.client.ok('PATCH', `/admin/managed/tickets/${t.id}`, { assigneeId: engineer.userId });
    // Opened a month ago: raising it to P3 recomputes due times in the past, so the new timers warn and breach at once.
    await s.prisma.ticket.update({ where: { id: t.id }, data: { createdAt: new Date(Date.now() - 30 * 86_400_000) } });
    const raised = await lead.client.ok('PATCH', `/admin/managed/tickets/${t.id}`, { priority: 'P3' });
    expect(new Date(raised.responseDueAt).getTime()).toBeLessThan(Date.now());
    const breached = await waitFor(async () => {
      const r = await s.prisma.ticket.findUniqueOrThrow({ where: { id: t.id } });
      return r.responseBreached && r.resolveBreached && r;
    }, { what: 'the SLA timers to breach', timeoutMs: 60_000 });
    expect(breached.warnedAt).toBeTruthy();
    expect(breached.breachedAt).toBeTruthy();
    const pages = await s.prisma.page.findMany({ where: { ticketId: t.id } });
    expect(pages.some((p) => p.userId === engineer.userId && p.urgency === 'low')).toBe(true);
    expect(pages.some((p) => p.userId === lead.userId && p.urgency === 'high')).toBe(true);
    expect(s.outbox.some((m) => m.to === engineer.email && m.subject.startsWith('SLA warning'))).toBe(true);
    expect(await s.prisma.auditLog.count({ where: { resource: `ticket:${t.id}`, action: 'managed.sla_breached' } })).toBe(2);
  });
});

/** An Alertmanager v4 webhook body with one alert. */
function amPayload(status: 'firing' | 'resolved', labels: Record<string, string>, fingerprint: string) {
  return {
    version: '4', status, receiver: 'prgd', groupKey: '{}:{alertname="x"}', groupLabels: {}, commonLabels: labels, commonAnnotations: {}, externalURL: 'http://alertmanager:9093',
    alerts: [{ status, labels, annotations: { summary: `${labels.alertname} on the test server` }, startsAt: new Date(Date.now() - 60_000).toISOString(), endsAt: status === 'resolved' ? new Date().toISOString() : '0001-01-01T00:00:00Z', generatorURL: 'http://prometheus:9090/graph', fingerprint }],
  };
}

describe('managed cloud alerts and paging', () => {
  it('turns a critical alert into a P1 ticket, pages the on call engineer and escalates to the support lead', async () => {
    await s.prisma.onCallShift.deleteMany({});
    const now = Date.now();
    await lead.client.ok('POST', '/admin/managed/oncall/shifts', { userId: engineer.userId, role: 'PRIMARY', startsAt: new Date(now - 3600_000), endsAt: new Date(now + 86_400_000) }, 201);
    await lead.client.ok('POST', '/admin/managed/oncall/shifts', { userId: lead.userId, role: 'SECONDARY', startsAt: new Date(now - 3600_000), endsAt: new Date(now + 86_400_000) }, 201);
    expect((await engineer.client.post('/admin/managed/oncall/shifts', { userId: engineer.userId, startsAt: new Date(), endsAt: new Date(now + 1000) })).status).toBe(403);
    const current = await engineer.client.ok('GET', '/admin/managed/oncall/current');
    expect(current.primary.id).toBe(engineer.userId);
    await engineer.client.ok('PUT', `/admin/managed/staff/${engineer.userId}/contact`, { phone: '+966500000001', pagingChannel: 'SMS' });

    const { owner, contractId } = await activeContract('ESSENTIAL');
    const asset = await lead.client.ok('POST', `/admin/managed/contracts/${contractId}/assets`, { kind: 'EXTERNAL_SERVER', name: 'db-1', address: '203.0.113.60', managementAddress: '10.8.0.6' }, 201);
    const fp = `fp-${asset.id}`;
    const labels = { alertname: 'HostDown', severity: 'critical', asset_id: asset.id, instance: '203.0.113.60:9100' };
    const anon = new Client(s.baseUrl);
    expect((await anon.post('/internal/alerts/alertmanager', amPayload('firing', labels, fp))).status).toBe(401);
    expect((await anon.post('/internal/alerts/alertmanager', amPayload('firing', labels, fp), { token: 'wrong' })).status).toBe(401);
    expect((await anon.post('/internal/alerts/alertmanager?secret=it-alertmanager-secret', amPayload('firing', labels, fp))).status).toBe(422);
    const first = await anon.req('POST', '/internal/alerts/alertmanager', amPayload('firing', labels, fp), { token: 'it-alertmanager-secret' });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ received: 1, created: 1 });
    // Delivered again (Alertmanager repeats): the same alert, no second ticket.
    const again = await fetch(`${s.baseUrl}/internal/alerts/alertmanager`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-prgd-webhook-secret': 'it-alertmanager-secret' }, body: JSON.stringify(amPayload('firing', labels, fp)) });
    expect(((await again.json()) as { updated: number }).updated).toBe(1);

    const alert = await s.prisma.alert.findFirstOrThrow({ where: { assetId: asset.id } });
    expect(alert).toMatchObject({ severity: 'CRITICAL', status: 'FIRING', openKey: fp });
    const ticket = await s.prisma.ticket.findUniqueOrThrow({ where: { id: alert.ticketId! } });
    expect(ticket).toMatchObject({ managedPriority: 'P1', assigneeId: engineer.userId, source: 'alert', contractId, assetId: asset.id });
    expect(await s.prisma.ticket.count({ where: { assetId: asset.id } })).toBe(1);
    const page = await s.prisma.page.findFirstOrThrow({ where: { alertId: alert.id, userId: engineer.userId } });
    expect(page).toMatchObject({ urgency: 'high', channel: 'SMS', provider: 'log' });

    // Nobody acknowledges within PAGE_ACK_TIMEOUT_SECONDS (3 in the suite): the support lead is paged.
    const escalated = await waitFor(() => s.prisma.page.findFirst({ where: { escalatedFromId: page.id, userId: lead.userId } }), { what: 'the escalation page to the support lead', timeoutMs: 30_000 });
    expect(escalated.urgency).toBe('high');
    expect((await s.prisma.page.findUniqueOrThrow({ where: { id: page.id } })).escalatedAt).toBeTruthy();

    const acked = await lead.client.ok('POST', `/admin/managed/pages/${escalated.id}/ack`, {}, 200);
    expect(acked.ackAt).toBeTruthy();
    expect(await s.prisma.page.count({ where: { alertId: alert.id, ackAt: null } })).toBe(0);

    // Resolved: the alert closes and the customer sees a note on the ticket.
    const resolved = await anon.req('POST', '/internal/alerts/alertmanager', amPayload('resolved', labels, fp), { token: 'it-alertmanager-secret' });
    expect(resolved.body.resolved).toBe(1);
    expect((await s.prisma.alert.findUniqueOrThrow({ where: { id: alert.id } })).status).toBe('RESOLVED');
    const view = await owner.client.ok('GET', `/v1/managed/tickets/${ticket.id}`);
    expect(view.messages.at(-1).body).toContain('resolved');

    // A warning opens a P3 ticket without paging anyone.
    const warn = await anon.req('POST', '/internal/alerts/alertmanager', amPayload('firing', { alertname: 'DiskFilling', severity: 'warning', asset_id: asset.id }, `${fp}-disk`), { token: 'it-alertmanager-secret' });
    expect(warn.body.created).toBe(1);
    const wa = await s.prisma.alert.findFirstOrThrow({ where: { fingerprint: `${fp}-disk` } });
    expect((await s.prisma.ticket.findUniqueOrThrow({ where: { id: wa.ticketId! } })).managedPriority).toBe('P3');
    expect(await s.prisma.page.count({ where: { alertId: wa.id } })).toBe(0);
    // Unknown assets are ignored.
    const unknown = await anon.req('POST', '/internal/alerts/alertmanager', amPayload('firing', { alertname: 'X', severity: 'critical', asset_id: 'nope' }, 'fp-unknown'), { token: 'it-alertmanager-secret' });
    expect(unknown.body.ignored).toBe(1);
  });

  it('takes heartbeats from external servers and alerts when they stop', async () => {
    const { contractId } = await activeContract('ESSENTIAL');
    const asset = await lead.client.ok('POST', `/admin/managed/contracts/${contractId}/assets`, { kind: 'EXTERNAL_SERVER', name: 'app-1', address: '203.0.113.61' }, 201);
    const { token } = await engineer.client.ok('POST', `/admin/managed/assets/${asset.id}/heartbeat-token`, {}, 201);
    expect(token).toMatch(/^prgd_hb_/);
    const anon = new Client(s.baseUrl);
    expect((await anon.post('/internal/agents/heartbeat', { status: 'ok' }, { token: 'prgd_hb_wrong' })).status).toBe(401);
    const hb = await anon.req('POST', '/internal/agents/heartbeat', { status: 'ok', hostname: 'app-1', agentVersion: '1.0.0' }, { token });
    expect(hb.status).toBe(200);
    const stored = await s.prisma.managedAsset.findUniqueOrThrow({ where: { id: asset.id } });
    expect(stored.health).toBe('HEALTHY');
    expect(stored.heartbeatTokenHash).not.toContain(token);

    await s.prisma.managedAsset.update({ where: { id: asset.id }, data: { lastHeartbeatAt: new Date(Date.now() - 20 * 60_000) } });
    await s.get(ManagedAlertsService).checkHeartbeats();
    expect((await s.prisma.managedAsset.findUniqueOrThrow({ where: { id: asset.id } })).health).toBe('UNHEALTHY');
    const missing = await s.prisma.alert.findFirstOrThrow({ where: { assetId: asset.id, name: 'HeartbeatMissing' } });
    expect(missing).toMatchObject({ severity: 'CRITICAL', status: 'FIRING', source: 'heartbeat' });
    expect(missing.ticketId).toBeTruthy();

    await anon.req('POST', '/internal/agents/heartbeat', { status: 'ok' }, { token });
    expect((await s.prisma.alert.findUniqueOrThrow({ where: { id: missing.id } })).status).toBe('RESOLVED');

    // Rotating the token revokes the old one.
    await engineer.client.ok('POST', `/admin/managed/assets/${asset.id}/heartbeat-token`, {}, 201);
    expect((await anon.post('/internal/agents/heartbeat', { status: 'ok' }, { token })).status).toBe(401);
  });
});

describe('managed cloud billing', () => {
  it('bills the prorated plan fee and engineer overage on the monthly invoice with VAT', async () => {
    const { owner, contractId } = await activeContract('ESSENTIAL');
    const now = new Date();
    const periodEnd = startOfMonth(now);
    const periodStart = startOfMonth(new Date(periodEnd.getTime() - 1));
    const period = periodStart.toISOString().slice(0, 7);
    // Activated on the 16th of last month.
    await s.prisma.managedContract.update({ where: { id: contractId }, data: { activatedAt: new Date(periodStart.getTime() + 15 * DAY) } });
    const workedAt = new Date(periodStart.getTime() + 20 * DAY).toISOString();
    const w1 = await engineer.client.ok('POST', '/admin/managed/worklogs', { contractId, minutes: 150, workedAt, note: 'Kernel update and reboot' }, 201);
    const w2 = await engineer.client.ok('POST', '/admin/managed/worklogs', { contractId, minutes: 50, workedAt }, 201);
    const w3 = await engineer.client.ok('POST', '/admin/managed/worklogs', { contractId, minutes: 30, billable: false, workedAt }, 201);
    // Engineers cannot change a colleague's entry; a support lead can.
    const other = await lead.client.ok('POST', '/admin/managed/worklogs', { contractId, userId: engineer.userId, minutes: 5, billable: false, workedAt }, 201);
    expect(other.userId).toBe(engineer.userId);
    const leads = await lead.client.ok('POST', '/admin/managed/worklogs', { contractId, minutes: 5, billable: false, workedAt }, 201);
    expect((await engineer.client.patch(`/admin/managed/worklogs/${leads.id}`, { minutes: 6 })).status).toBe(403);

    const usage = await engineer.client.ok('GET', `/admin/managed/contracts/${contractId}/usage?period=${period}`);
    expect(usage).toMatchObject({ includedMinutes: 120, billableMinutes: 200, overageMinutes: 80, hourlyRateMinor: 25_000, currency: 'SAR' });

    const billing = s.get(ManagedBillingService);
    await billing.accruePreviousMonth(now);
    await billing.accruePreviousMonth(now); // safe to run twice
    const days = (periodEnd.getTime() - periodStart.getTime()) / DAY;
    const planMinor = Math.round(110_000 * ((days - 15) / days));
    const overageMinor = Math.round((80 / 60) * 25_000);

    await s.get(InvoicesService).issueForPreviousMonth(now);
    const inv = await s.prisma.invoice.findFirstOrThrow({ where: { teamId: owner.teamId }, include: { records: true } });
    const byType = Object.fromEntries(inv.records.map((r) => [r.resourceType, r]));
    expect(Object.keys(byType).sort()).toEqual(['managed_overage', 'managed_plan']);
    expect(byType.managed_plan.amountMinor).toBe(planMinor);
    expect(byType.managed_overage.amountMinor).toBe(overageMinor);
    expect(byType.managed_overage.quantity).toBeCloseTo(80 / 60, 2);
    expect(inv.subtotalMinor).toBe(planMinor + overageMinor);
    expect(inv.taxMinor).toBe(Math.round((planMinor + overageMinor) * 0.15));
    expect(inv.currency).toBe('SAR');

    // Billable entries carry the invoice; nothing can be billed twice or edited afterwards.
    const logs = await s.prisma.workLog.findMany({ where: { id: { in: [w1.id, w2.id, w3.id] } } });
    expect(logs.filter((l) => l.billable).every((l) => l.billedInvoiceId === inv.id)).toBe(true);
    expect(logs.find((l) => !l.billable)?.billedInvoiceId).toBeNull();
    expect((await engineer.client.patch(`/admin/managed/worklogs/${w1.id}`, { minutes: 10 })).status).toBe(409);
    await billing.accruePreviousMonth(now);
    expect(await s.prisma.usageRecord.count({ where: { resourceId: contractId } })).toBe(2);

    const pdf = await owner.client.get(`/v1/billing/invoices/${inv.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
  });
});

describe('managed cloud maintenance', () => {
  it('runs playbooks with the fake runner and opens a ticket when a run fails', async () => {
    const now = Date.now();
    await s.prisma.onCallShift.deleteMany({ where: { userId: engineer.userId } });
    await lead.client.ok('POST', '/admin/managed/oncall/shifts', { userId: engineer.userId, role: 'PRIMARY', startsAt: new Date(now - 3600_000), endsAt: new Date(now + 86_400_000) }, 201);
    const { owner, contractId } = await activeContract('ESSENTIAL');
    const asset = await lead.client.ok('POST', `/admin/managed/contracts/${contractId}/assets`, { kind: 'EXTERNAL_SERVER', name: 'web-9', address: '203.0.113.70', managementAddress: '10.8.0.9', os: 'Ubuntu 24.04' }, 201);

    expect((await engineer.client.post('/admin/managed/maintenance/tasks', { contractId, kind: 'PATCHING', cron: 'every friday' })).status).toBe(422);
    const patching = await engineer.client.ok('POST', '/admin/managed/maintenance/tasks', { contractId, assetId: asset.id, kind: 'PATCHING', cron: '0 3 * * 5' }, 201);
    expect(patching).toMatchObject({ playbook: 'patching.yml', timezone: 'Asia/Riyadh', enabled: true });
    expect(new Date(patching.nextRunAt).getTime()).toBeGreaterThan(now);

    const run = await engineer.client.ok('POST', `/admin/managed/maintenance/tasks/${patching.id}/run`, {}, 202);
    const done = await waitFor(async () => {
      const r = await engineer.client.ok('GET', `/admin/managed/maintenance/runs/${run.id}`);
      return ['SUCCEEDED', 'FAILED'].includes(r.status) && r;
    }, { what: 'the patching run to finish', timeoutMs: 60_000 });
    expect(done).toMatchObject({ status: 'SUCCEEDED', runner: 'fake', trigger: 'manual' });
    expect(done.log).toContain('web-9');
    expect(done.log).toContain('PLAY RECAP');

    // The schedule starts due runs by itself.
    await s.prisma.maintenanceTask.update({ where: { id: patching.id }, data: { nextRunAt: new Date(now - 60_000) } });
    expect(await s.get(MaintenanceService).startDue()).toBeGreaterThanOrEqual(1);
    const scheduled = await s.prisma.maintenanceRun.findFirstOrThrow({ where: { taskId: patching.id, trigger: 'schedule' } });
    expect(scheduled).toBeTruthy();
    expect((await s.prisma.maintenanceTask.findUniqueOrThrow({ where: { id: patching.id } })).nextRunAt!.getTime()).toBeGreaterThan(now);

    // A failing run opens a P3 ticket for the on call engineer.
    const broken = await engineer.client.ok('POST', '/admin/managed/maintenance/tasks', { contractId, kind: 'CUSTOM', name: 'Rotate logs', playbook: 'rotate-logs.yml', cron: '0 4 1 * *', vars: { simulateFailure: true } }, 201);
    const failedRun = await engineer.client.ok('POST', `/admin/managed/maintenance/tasks/${broken.id}/run`, {}, 202);
    const failed = await waitFor(async () => {
      const r = await s.prisma.maintenanceRun.findUniqueOrThrow({ where: { id: failedRun.id } });
      return r.ticketId ? r : null;
    }, { what: 'the failed run to open a ticket', timeoutMs: 60_000 });
    expect(failed.status).toBe('FAILED');
    const ticket = await s.prisma.ticket.findUniqueOrThrow({ where: { id: failed.ticketId! }, include: { messages: true } });
    expect(ticket).toMatchObject({ managedPriority: 'P3', assigneeId: engineer.userId, source: 'maintenance', contractId });
    expect(ticket.messages.some((m) => m.internal && m.body.includes('simulated failure'))).toBe(true);
    const customerView = await owner.client.ok('GET', `/v1/managed/tickets/${ticket.id}`);
    expect(JSON.stringify(customerView)).not.toContain('PLAY RECAP');
  });
});

describe('managed cloud monthly reports', () => {
  it('drafts a report with uptime, incidents, SLA, maintenance and hours, then sends the PDF to the owners', async () => {
    const { owner, contractId } = await activeContract('ESSENTIAL');
    const now = new Date();
    const periodEnd = startOfMonth(now);
    const periodStart = startOfMonth(new Date(periodEnd.getTime() - 1));
    const period = periodStart.toISOString().slice(0, 7);
    const minutesInMonth = (periodEnd.getTime() - periodStart.getTime()) / 60_000;
    await s.prisma.managedContract.update({ where: { id: contractId }, data: { activatedAt: new Date(periodStart.getTime() - 30 * DAY) } });
    const asset = await lead.client.ok('POST', `/admin/managed/contracts/${contractId}/assets`, { kind: 'EXTERNAL_SERVER', name: 'shop-1', address: '203.0.113.80', managementAddress: '10.8.0.80' }, 201);
    await s.prisma.managedAsset.update({ where: { id: asset.id }, data: { approvedAt: new Date(periodStart.getTime() - DAY) } });
    // One hour of critical outage, a P1 ticket, a patch window and some engineer time last month.
    const outage = new Date(periodStart.getTime() + 10 * DAY);
    await s.prisma.alert.create({ data: { assetId: asset.id, contractId, fingerprint: `rep-${asset.id}`, name: 'HostDown', severity: 'CRITICAL', status: 'RESOLVED', startsAt: outage, endsAt: new Date(outage.getTime() + 60 * 60_000), resolvedAt: new Date(outage.getTime() + 60 * 60_000) } });
    const p1 = await owner.client.ok('POST', '/v1/managed/tickets', { subject: 'Shop down', body: 'Nothing loads', priority: 'P1' }, 201);
    await s.prisma.ticket.update({ where: { id: p1.id }, data: { createdAt: outage, firstRespondedAt: new Date(outage.getTime() + 20 * 60_000), status: 'closed', closedAt: new Date(outage.getTime() + 70 * 60_000) } });
    const task = await engineer.client.ok('POST', '/admin/managed/maintenance/tasks', { contractId, assetId: asset.id, kind: 'PATCHING', cron: '0 3 * * 5' }, 201);
    await s.prisma.maintenanceRun.create({ data: { taskId: task.id, status: 'SUCCEEDED', trigger: 'schedule', runner: 'fake', startedAt: new Date(periodStart.getTime() + 5 * DAY), finishedAt: new Date(periodStart.getTime() + 5 * DAY + 600_000), log: 'ok' } });
    await engineer.client.ok('POST', '/admin/managed/worklogs', { contractId, minutes: 90, workedAt: new Date(periodStart.getTime() + 11 * DAY).toISOString() }, 201);

    const draft = await engineer.client.ok('POST', `/admin/managed/reports/${contractId}/generate`, { period }, 201);
    expect(draft).toMatchObject({ status: 'DRAFT', period, hasPdf: true });
    const expectedUptime = Math.round((1 - 60 / (minutesInMonth)) * 100_000) / 1000;
    expect(draft.data.assets[0]).toMatchObject({ name: 'shop-1', downtimeMinutes: 60, uptimePercent: expectedUptime });
    expect(draft.data.incidents.alerts.critical).toBe(1);
    expect(draft.data.incidents.majorTickets.map((t: { number: number }) => t.number)).toEqual([p1.number]);
    expect(draft.data.sla).toMatchObject({ tickets: 1, responseMet: 1, resolveMet: 1, responseBreached: 0, resolveBreached: 0 });
    expect(draft.data.patches).toEqual({ runs: 1, succeeded: 1, failed: 0 });
    expect(draft.data.hours).toMatchObject({ billableMinutes: 90, includedMinutes: 120, overageMinutes: 0 });
    expect(draft.recommendations).toContain('backup restore test');

    // Drafts are not visible to the customer.
    expect((await owner.client.ok('GET', `/v1/managed/contracts/${contractId}/reports`)).data).toEqual([]);
    const edited = await engineer.client.ok('PATCH', `/admin/managed/reports/${draft.id}`, { recommendations: 'Add a second web server before the sale season.' });
    expect(edited.recommendations).toContain('second web server');
    const staffPdf = await engineer.client.get(`/admin/managed/reports/${draft.id}/pdf`);
    expect(staffPdf.headers.get('content-type')).toBe('application/pdf');
    expect(staffPdf.text.startsWith('%PDF')).toBe(true);

    const sent = await engineer.client.ok('POST', `/admin/managed/reports/${draft.id}/send`, {}, 200);
    expect(sent.status).toBe('SENT');
    expect(sent.sentAt).toBeTruthy();
    const mail = s.outbox.find((m) => m.to === owner.email && m.subject.startsWith('Your managed cloud report'));
    expect(mail?.attachments?.[0].contentType).toBe('application/pdf');
    expect(mail!.attachments![0].content.subarray(0, 4).toString()).toBe('%PDF');

    const list = await owner.client.ok('GET', `/v1/managed/contracts/${contractId}/reports`);
    expect(list.data).toHaveLength(1);
    const pdf = await owner.client.get(list.data[0].pdfUrl);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    const m = await member(owner);
    expect((await m.client.get(`/v1/managed/contracts/${contractId}/reports`)).status).toBe(403);
    expect((await engineer.client.patch(`/admin/managed/reports/${draft.id}`, { recommendations: 'late' })).status).toBe(409);
  });

  it('drafts every active contract on the 1st and sends drafts nobody sent', async () => {
    const { owner, contractId } = await activeContract('ESSENTIAL');
    const period = ReportsService.previousPeriod();
    expect(await s.get(ReportsService).startMonthly()).toBeGreaterThanOrEqual(1);
    const due = ReportsService.autoSendAt(period) <= new Date();
    const report = await waitFor(async () => {
      const r = await s.prisma.monthlyReport.findUnique({ where: { contractId_period: { contractId, period } } });
      return r && (!due || r.status === 'SENT') && r;
    }, { what: 'the monthly report workflow', timeoutMs: 60_000 });
    if (due) {
      expect(report.sentById).toBeNull();
      expect(s.outbox.some((m) => m.to === owner.email && m.subject.startsWith('Your managed cloud report'))).toBe(true);
    } else {
      expect(report.status).toBe('DRAFT');
    }
  });
});

describe('managed cloud runbooks', () => {
  it('keeps searchable markdown runbooks and links them to onboarding', async () => {
    const owner = await signup(s);
    const c = await owner.client.ok('POST', '/v1/managed/contracts', { plan: 'ESSENTIAL' }, 201);
    await lead.client.ok('POST', `/admin/managed/contracts/${c.id}/activate`, { liabilityCapMinor: 500_000, signedByName: 'Owner' }, 200);
    const before = await engineer.client.ok('GET', `/admin/managed/contracts/${c.id}/onboarding`);
    expect(before.data.find((i: { key: string }) => i.key === 'documentation').check.ready).toBe(false);

    const rb = await engineer.client.ok('POST', '/admin/managed/runbooks', { title: 'Restart the shop stack', body: '# Restart\n\n1. `systemctl restart shop`', tags: ['Nginx', `contract:${c.id}`] }, 201);
    expect(rb).toMatchObject({ slug: 'restart-the-shop-stack', tags: ['nginx', `contract:${c.id}`] });
    expect((await engineer.client.post('/admin/managed/runbooks', { title: 'Restart the shop stack', body: 'again' })).status).toBe(409);
    expect((await engineer.client.ok('GET', '/admin/managed/runbooks?q=SHOP')).data.map((r: { id: string }) => r.id)).toContain(rb.id);
    expect((await engineer.client.ok('GET', '/admin/managed/runbooks?q=nginx')).data.map((r: { id: string }) => r.id)).toContain(rb.id);
    expect((await engineer.client.ok('GET', '/admin/managed/runbooks?tag=postgres')).data.map((r: { id: string }) => r.id)).not.toContain(rb.id);
    const updated = await engineer.client.ok('PATCH', `/admin/managed/runbooks/${rb.slug}`, { body: '# Restart\n\nUse the deploy user.' });
    expect(updated.body).toContain('deploy user');
    expect(updated.updatedById).toBe(engineer.userId);
    expect((await owner.client.get('/admin/managed/runbooks')).status).toBe(403);

    const after = await engineer.client.ok('GET', `/admin/managed/contracts/${c.id}/onboarding`);
    expect(after.data.find((i: { key: string }) => i.key === 'documentation').check.ready).toBe(true);
    expect(after.data.find((i: { key: string }) => i.key === 'responsibility_matrix').check.ready).toBe(true);
    expect((await engineer.client.ok('DELETE', `/admin/managed/runbooks/${rb.id}`)).deleted).toBe(true);
  });
});

describe('managed cloud summaries and staff lookups', () => {
  it('shows every member the contract summary without prices or liability terms', async () => {
    const nobody = await signup(s);
    expect(await nobody.client.ok('GET', '/v1/managed/summary')).toEqual({ hasContract: false, contract: null, openTickets: 0, previous: null });

    const { owner, contractId } = await activeContract('ESSENTIAL');
    const m = await member(owner);
    // Members still cannot read the contract itself.
    expect((await m.client.get('/v1/managed/contracts')).status).toBe(403);
    await m.client.ok('POST', '/v1/managed/tickets', { subject: 'Backups question', body: 'How long do you keep them?', priority: 'P4' }, 201);

    const summary = await m.client.ok('GET', '/v1/managed/summary');
    expect(summary).toMatchObject({ hasContract: true, openTickets: 1, contract: { id: contractId, status: 'ACTIVE', planName: 'Essential', planCode: 'ESSENTIAL', coverage: 'BUSINESS_HOURS', calendar: 'SA' } });
    expect(summary.contract.sla).toMatchObject({ coverage: 'BUSINESS_HOURS', timeZone: 'Asia/Riyadh', responseTargets: { P1: 240, P2: 480, P3: 960, P4: 2400 } });
    const text = JSON.stringify(summary);
    for (const hidden of ['Minor', 'liability', 'price', 'signedBy', 'notes', 'currency', '110000', '1000000']) expect(text).not.toContain(hidden);
    // The owner gets the same summary.
    expect((await owner.client.ok('GET', '/v1/managed/summary')).contract.id).toBe(contractId);

    // After cancellation the summary says so, still without amounts.
    await lead.client.ok('POST', `/admin/managed/contracts/${contractId}/cancel`, { reason: 'test' }, 200);
    const after = await m.client.ok('GET', '/v1/managed/summary');
    expect(after).toMatchObject({ hasContract: false, contract: null, previous: { planName: 'Essential' } });
  });

  it('lets support leads search teams without billing data', async () => {
    const t = await signup(s);
    const team = await s.prisma.team.findUniqueOrThrow({ where: { id: t.teamId } });
    const r = await lead.client.ok('GET', `/admin/managed/teams?q=${encodeURIComponent(team.name.slice(3))}`);
    const hit = r.data.find((x: { id: string }) => x.id === t.teamId);
    expect(hit).toEqual({ id: t.teamId, name: team.name, slug: team.slug, country: 'SA', ownerName: 'Integration Test' });
    // By exact id and by the owner's email too.
    expect((await lead.client.ok('GET', `/admin/managed/teams?q=${t.teamId}`)).data.map((x: { id: string }) => x.id)).toEqual([t.teamId]);
    expect((await lead.client.ok('GET', `/admin/managed/teams?q=${encodeURIComponent(t.email)}`)).data.map((x: { id: string }) => x.id)).toEqual([t.teamId]);
    // Engineers and customers cannot search teams.
    expect((await engineer.client.get('/admin/managed/teams?q=it')).status).toBe(403);
    expect((await t.client.get('/admin/managed/teams?q=it')).status).toBe(403);
    // The lead creates a contract for the team it found.
    const c = await lead.client.ok('POST', '/admin/managed/contracts', { teamId: hit.id, plan: 'ESSENTIAL' }, 201);
    expect(c.teamId).toBe(t.teamId);
  });

  it('groups worklog totals per contract and per engineer', async () => {
    const a = await activeContract('ESSENTIAL');
    const b = await activeContract('ESSENTIAL');
    const [teamA, teamB] = await Promise.all([a, b].map((x) => s.prisma.team.findUniqueOrThrow({ where: { id: x.owner.teamId } })));
    // A month far in the past so no other test logs time in it.
    const from = new Date(Date.UTC(2021, 2, 1)), to = new Date(Date.UTC(2021, 3, 1));
    const at = new Date(Date.UTC(2021, 2, 10, 12));
    const log = (who: Team, contractId: string, minutes: number, billable = true) => who.client.ok('POST', '/admin/managed/worklogs', { contractId, minutes, billable }, 201).then((w) => s.prisma.workLog.update({ where: { id: w.id }, data: { workedAt: at } }));
    await log(engineer, a.contractId, 100);
    await log(engineer, a.contractId, 60);
    await log(engineer, a.contractId, 20, false);
    await log(lead, a.contractId, 30);
    await log(lead, b.contractId, 45);
    // Draft time from the ops console does not count.
    await s.prisma.workLog.create({ data: { contractId: b.contractId, userId: engineer.userId, minutes: 500, billable: true, status: 'DRAFT', workedAt: at } });

    const r = await engineer.client.ok('GET', `/admin/managed/worklogs?from=${from.toISOString()}&to=${to.toISOString()}&limit=1`);
    expect(r.data).toHaveLength(1);
    expect(r.totals).toMatchObject({ billableMinutes: 235, nonBillableMinutes: 20 });
    expect(r.totals.byContract).toEqual([
      { contractId: a.contractId, teamId: teamA.id, teamName: teamA.name, planName: 'Essential', includedMinutes: 120, overageMinutes: 70, billableMinutes: 190, nonBillableMinutes: 20, entries: 4 },
      { contractId: b.contractId, teamId: teamB.id, teamName: teamB.name, planName: 'Essential', includedMinutes: 120, overageMinutes: 0, billableMinutes: 45, nonBillableMinutes: 0, entries: 1 },
    ]);
    const byUser = Object.fromEntries(r.totals.byUser.map((u: { userId: string }) => [u.userId, u]));
    expect(byUser[engineer.userId]).toMatchObject({ billableMinutes: 160, nonBillableMinutes: 20, entries: 3, name: 'Integration Test' });
    expect(byUser[lead.userId]).toMatchObject({ billableMinutes: 75, nonBillableMinutes: 0, entries: 2 });
    // Filters apply to the groups too.
    const onlyB = await engineer.client.ok('GET', `/admin/managed/worklogs?contractId=${b.contractId}&from=${from.toISOString()}&to=${to.toISOString()}`);
    expect(onlyB.totals.byContract.map((x: { contractId: string }) => x.contractId)).toEqual([b.contractId]);
    expect(onlyB.totals.byUser).toEqual([{ userId: lead.userId, name: 'Integration Test', billableMinutes: 45, nonBillableMinutes: 0, entries: 1 }]);
  });

  it('names the team and plan on staff report and maintenance responses', async () => {
    const { owner, contractId } = await activeContract('ESSENTIAL');
    const team = await s.prisma.team.findUniqueOrThrow({ where: { id: owner.teamId } });
    const ref = { contractId, teamId: team.id, teamName: team.name, planName: 'Essential', planCode: 'ESSENTIAL' };

    const task = await engineer.client.ok('POST', '/admin/managed/maintenance/tasks', { contractId, kind: 'BACKUP_TEST', cron: '0 2 * * 0' }, 201);
    expect(task).toMatchObject(ref);
    const tasks = await engineer.client.ok('GET', `/admin/managed/maintenance/tasks?contractId=${contractId}`);
    expect(tasks.data[0]).toMatchObject(ref);
    expect(await engineer.client.ok('GET', `/admin/managed/maintenance/tasks/${task.id}`)).toMatchObject(ref);
    const run = await s.prisma.maintenanceRun.create({ data: { taskId: task.id, status: 'SUCCEEDED', trigger: 'manual', runner: 'fake', log: 'ok' } });
    const runs = await engineer.client.ok('GET', `/admin/managed/maintenance/runs?contractId=${contractId}`);
    expect(runs.data[0].task).toMatchObject({ ...ref, id: task.id });
    expect((await engineer.client.ok('GET', `/admin/managed/maintenance/runs/${run.id}`)).task).toMatchObject(ref);

    const report = await engineer.client.ok('POST', `/admin/managed/reports/${contractId}/generate`, { period: '2021-01' }, 201);
    expect(report).toMatchObject(ref);
    const reports = await engineer.client.ok('GET', `/admin/managed/reports?contractId=${contractId}`);
    expect(reports.data[0]).toMatchObject(ref);
    expect(await engineer.client.ok('PATCH', `/admin/managed/reports/${report.id}`, { recommendations: 'Nothing to add.' })).toMatchObject(ref);
    // Customers never see the staff fields.
    await engineer.client.ok('POST', `/admin/managed/reports/${report.id}/send`, {}, 200);
    const customer = await owner.client.ok('GET', `/v1/managed/contracts/${contractId}/reports`);
    expect(customer.data[0].teamName).toBeUndefined();
  });
});
