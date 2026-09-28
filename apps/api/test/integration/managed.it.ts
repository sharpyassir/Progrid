import { beforeAll, describe, expect, it } from 'vitest';
import { Client, signup, sut, totp, waitFor, type Sut, type Team } from './harness';

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
