import { beforeAll, describe, expect, it } from 'vitest';
import { Client, signup, sut, totp, waitFor, type Sut, type Team } from './harness';
import { addSlaMinutes } from '../../src/modules/managed/sla/sla-calculator';
import { ManagedAlertsService } from '../../src/modules/managed/alerts/alerts.service';
import { ManagedBillingService } from '../../src/modules/managed/billing-hooks/managed-billing.service';
import { InvoicesService } from '../../src/modules/billing/invoices.service';
import { startOfMonth } from '../../src/modules/billing/pricing';

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
    expect(await s.prisma.auditLog.count({ where: { resource: `managed_contract:${c.id}`, action: 'managed.contract_activated' } })).toBe(1);
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
