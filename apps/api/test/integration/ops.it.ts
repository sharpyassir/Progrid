import { beforeAll, describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync, randomBytes, sign as edSign, type KeyObject } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { Client, signup, sleep, sut, totp, waitFor, type Sut, type Team } from './harness';
import { ManagedBillingService } from '../../src/modules/managed/billing-hooks/managed-billing.service';
import { periodBounds, periodKey } from '../../src/modules/managed/managed.constants';
import { GrantsService } from '../../src/modules/ops/access/grants.service';
import { ed25519Line, parseCertificate, rawEd25519 } from '../../src/modules/ops/access/ca/openssh';

/**
 * DevOps console backend (/ops/v1 and /admin/ops): engineers and assignments, residency, data
 * masking, ops sign in, and the audience split between console and ops sessions.
 */

let s: Sut;
let admin: Team & { totpSecret: string };
let lead: Team & { totpSecret: string };

beforeAll(async () => {
  s = await sut();
  admin = await staff([]);
  lead = await staff(['support_lead']);
});

// ---- helpers ----

/** A staff user with the given roles (none: full staff) and two factor sign in on. */
async function staff(roles: string[]) {
  const t = await signup(s);
  await s.prisma.user.update({ where: { id: t.userId }, data: { isStaff: true, staffRoles: roles } });
  const setup = await t.client.ok('POST', '/v1/auth/totp/setup', {}, 201);
  await t.client.ok('POST', '/v1/auth/totp/enable', { code: totp(setup.secret) }, 201);
  return { ...t, totpSecret: setup.secret as string };
}

export interface Engineer {
  profileId: string;
  userId: string;
  email: string;
  password: string;
  totpSecret: string;
  client: Client;
}

/** An external engineer created in the back office, through the welcome mail, TOTP enrollment and first ops session. */
async function externalEngineer(opts: { country?: string; contractIds?: string[]; rates?: boolean } = {}): Promise<Engineer> {
  const email = `eng-${randomBytes(5).toString('hex')}@example.test`;
  const created = await admin.client.ok('POST', '/admin/ops/engineers', {
    email, name: `Engineer ${email.slice(4, 9)}`, kind: 'EXTERNAL', country: opts.country ?? 'JO', timezone: 'Asia/Amman',
    ...(opts.rates !== false ? { hourlyRateMinor: 3000, standbyFeeMinor: 5000, currency: 'USD' } : {}), contractIds: opts.contractIds ?? [],
  }, 201);
  const mail = await waitFor(async () => s.outbox.find((m) => m.to === email && /set-password\?token=/.test(m.text)), { what: `welcome mail to ${email}` });
  const token = /set-password\?token=([A-Za-z0-9_-]+)/.exec(mail.text)![1];
  const password = `pw-${randomBytes(9).toString('base64url')}`;
  const client = new Client(s.baseUrl);
  await client.ok('POST', '/ops/v1/auth/password/reset', { token, password }, 200);
  const login = await client.ok('POST', '/ops/v1/auth/login', { email, password }, 200);
  expect(login).toMatchObject({ methods: [], enroll: true });
  const setup = await client.ok('POST', '/ops/v1/auth/totp/setup', { challenge: login.challenge }, 200);
  const enabled = await client.ok('POST', '/ops/v1/auth/totp/enable', { challenge: login.challenge, code: totp(setup.secret) }, 200);
  expect(enabled.recoveryCodes).toHaveLength(10);
  client.token = enabled.session;
  return { profileId: created.id, userId: created.userId, email, password, totpSecret: setup.secret, client };
}

/** A fresh ops session for an engineer with TOTP. */
async function opsLogin(e: { email: string; password: string; totpSecret: string }, client = new Client(s.baseUrl)) {
  const login = await client.ok('POST', '/ops/v1/auth/login', { email: e.email, password: e.password }, 200);
  expect(login.methods).toContain('totp');
  const r = await client.ok('POST', '/ops/v1/auth/totp', { challenge: login.challenge, code: totp(e.totpSecret) }, 200);
  client.token = r.session;
  return { client, body: r };
}

/** An ACTIVE managed contract with one approved external server that has a management address. */
async function contractWithAsset(plan = 'ESSENTIAL') {
  const owner = await signup(s);
  const c = await owner.client.ok('POST', '/v1/managed/contracts', { plan }, 201);
  await lead.client.ok('POST', `/admin/managed/contracts/${c.id}/activate`, { liabilityCapMinor: 1_000_000, signedByName: 'Customer CEO', overrideOnCallRule: true }, 200);
  const list = await lead.client.ok('GET', `/admin/managed/contracts/${c.id}/onboarding`);
  for (const item of list.data) await lead.client.ok('PATCH', `/admin/managed/contracts/${c.id}/onboarding/${item.key}`, { done: true });
  await waitFor(async () => (await owner.client.ok('GET', `/v1/managed/contracts/${c.id}`)).status === 'ACTIVE', { what: 'contract to become ACTIVE', timeoutMs: 30_000 });
  const asset = await lead.client.ok('POST', `/admin/managed/contracts/${c.id}/assets`, { kind: 'EXTERNAL_SERVER', name: `web-${randomBytes(2).toString('hex')}`, address: '203.0.113.70', managementAddress: '10.8.0.70', os: 'ubuntu' }, 201);
  await lead.client.ok('POST', `/admin/managed/assets/${asset.id}/approve`, {}, 200);
  return { owner, contractId: c.id as string, assetId: asset.id as string };
}

async function customerTicket(owner: Team, assetId: string, priority = 'P3', body = 'Please look at it') {
  return owner.client.ok('POST', '/v1/managed/tickets', { subject: `Issue ${randomBytes(2).toString('hex')}`, body, priority, assetId }, 201);
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

// ---- WebAuthn software authenticator (ES256, "none" attestation) ----

class SoftKey {
  readonly id = randomBytes(16);
  readonly keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  counter = 0;

  constructor(readonly rpId: string, readonly origin: string) {}

  register(options: { challenge: string }) {
    const jwk = this.keys.publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    const cose = isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(this.id.length);
    const authData = Buffer.concat([this.rpHash(), Buffer.from([0x45]), this.count(), Buffer.alloc(16), idLen, this.id, Buffer.from(cose)]);
    const attestationObject = isoCBOR.encode(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]) as never);
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin: this.origin, crossOrigin: false }));
    const id = this.id.toString('base64url');
    return { id, rawId: id, type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: clientDataJSON.toString('base64url'), attestationObject: Buffer.from(attestationObject).toString('base64url'), transports: ['usb'] } };
  }

  authenticate(options: { challenge: string }) {
    const authData = Buffer.concat([this.rpHash(), Buffer.from([0x05]), this.count()]);
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: this.origin, crossOrigin: false }));
    const signature = edSign('sha256', Buffer.concat([authData, createHash('sha256').update(clientDataJSON).digest()]), this.keys.privateKey as KeyObject);
    const id = this.id.toString('base64url');
    return { id, rawId: id, type: 'public-key', clientExtensionResults: {}, response: { clientDataJSON: clientDataJSON.toString('base64url'), authenticatorData: authData.toString('base64url'), signature: signature.toString('base64url') } };
  }

  private rpHash() {
    return createHash('sha256').update(this.rpId).digest();
  }
  private count() {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(++this.counter);
    return b;
  }
}

// ---- tests ----

describe('ops console sign in', () => {
  it('needs a second factor, keeps console and ops sessions apart and alerts the lead about new devices', async () => {
    const eng = await externalEngineer();
    // A password alone never opens a session.
    const login = await new Client(s.baseUrl).ok('POST', '/ops/v1/auth/login', { email: eng.email, password: eng.password }, 200);
    expect(login.session).toBeUndefined();
    expect((await new Client(s.baseUrl).post('/ops/v1/auth/totp', { challenge: login.challenge, code: '000000' })).status).toBe(401);
    expect((await new Client(s.baseUrl).post('/ops/v1/auth/login', { email: eng.email, password: 'wrong-password' })).status).toBe(401);

    const me = await eng.client.ok('GET', '/ops/v1/me');
    expect(me.engineer).toMatchObject({ kind: 'EXTERNAL', country: 'JO', timezone: 'Asia/Amman' });
    const row = await s.prisma.session.findFirstOrThrow({ where: { userId: eng.userId, audience: 'ops' } });
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeGreaterThan(11.9 * 3600_000);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBeLessThanOrEqual(12 * 3600_000 + 5000);

    // Ops session tokens do not work on /v1 or /admin; console sessions and API tokens do not work on /ops/v1.
    for (const path of ['/v1/account', '/v1/servers', '/admin/ops/engineers', '/admin/managed/tickets']) {
      expect((await eng.client.get(path)).status).toBe(401);
    }
    expect((await admin.client.get('/ops/v1/me')).status).toBe(401);
    const apiToken = await admin.client.ok('POST', '/v1/tokens', { name: 'ops probe', scopes: ['servers:read'] }, 201);
    expect((await admin.client.get('/ops/v1/me', { token: apiToken.token })).status).toBe(401);
    // An external engineer cannot use the customer console at all.
    expect((await new Client(s.baseUrl).post('/v1/auth/login', { email: eng.email, password: eng.password })).status).toBe(403);
    // Staff with the engineer area can use the ops console with a fresh ops session (full staff here).
    const staffOps = await opsLogin({ email: admin.email, password: admin.password, totpSecret: admin.totpSecret });
    expect((await staffOps.client.ok('GET', '/ops/v1/me')).engineer.kind).toBe('INTERNAL');

    // Every first sign in from a user agent and address pair alerts the support lead.
    const alerts = await s.prisma.auditLog.findMany({ where: { userId: eng.userId, action: 'ops.signed_in' } });
    expect(alerts.some((a) => (a.request as { newDevice: boolean }).newDevice)).toBe(true);
    expect(s.outbox.some((m) => m.subject.startsWith('Ops console sign in from a new device') && m.text.includes(eng.client.ip))).toBe(true);
    const again = await opsLogin(eng, eng.client);
    expect(again.body.engineer.kind).toBe('EXTERNAL');
    const latest = await s.prisma.auditLog.findFirstOrThrow({ where: { userId: eng.userId, action: 'ops.signed_in' }, orderBy: { at: 'desc' } });
    expect((latest.request as { newDevice: boolean }).newDevice).toBe(false);

    await eng.client.ok('POST', '/ops/v1/auth/logout', {}, 204);
    expect((await eng.client.get('/ops/v1/me')).status).toBe(401);
  });

  it('registers a security key and signs in with it', async () => {
    const eng = await externalEngineer();
    const key = new SoftKey('localhost', 'http://localhost:3002');
    const options = await eng.client.ok('POST', '/ops/v1/auth/webauthn/register/options', {}, 200);
    expect(options.rp.id).toBe('localhost');
    const reg = await eng.client.ok('POST', '/ops/v1/auth/webauthn/register/verify', { response: key.register(options), name: 'Test key' }, 200);
    expect(reg.credential.name).toBe('Test key');

    const client = new Client(s.baseUrl);
    const login = await client.ok('POST', '/ops/v1/auth/login', { email: eng.email, password: eng.password }, 200);
    expect(login.methods).toEqual(['totp', 'webauthn']);
    const authOptions = await client.ok('POST', '/ops/v1/auth/webauthn/authenticate/options', { challenge: login.challenge }, 200);
    const session = await client.ok('POST', '/ops/v1/auth/webauthn/authenticate/verify', { challenge: login.challenge, response: key.authenticate(authOptions) }, 200);
    client.token = session.session;
    expect((await client.ok('GET', '/ops/v1/me')).user.id).toBe(eng.userId);
    // The challenge opens one session only.
    expect((await new Client(s.baseUrl).post('/ops/v1/auth/totp', { challenge: login.challenge, code: totp(eng.totpSecret) })).status).toBe(401);
    const row = await s.prisma.session.findFirstOrThrow({ where: { userId: eng.userId, secondFactor: 'webauthn' } });
    expect(row.audience).toBe('ops');
  });

  it('enforces the IP allowlist on every request', async () => {
    const eng = await externalEngineer();
    await admin.client.ok('PATCH', `/admin/ops/engineers/${eng.profileId}`, { ipAllowlist: ['192.0.2.0/24'] });
    const r = await eng.client.get('/ops/v1/me');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('ip_not_allowed');
    await admin.client.ok('PATCH', `/admin/ops/engineers/${eng.profileId}`, { ipAllowlist: [`${eng.client.ip}/32`] });
    expect((await eng.client.get('/ops/v1/me')).status).toBe(200);
  });
});

describe('ops console assignments, residency and masking', () => {
  it('shows an external engineer only the contracts they are assigned to (404 otherwise)', async () => {
    const a = await contractWithAsset();
    const b = await contractWithAsset();
    const eng = await externalEngineer({ contractIds: [a.contractId] });
    const ta = await customerTicket(a.owner, a.assetId);
    const tb = await customerTicket(b.owner, b.assetId);

    const contracts = await eng.client.ok('GET', '/ops/v1/contracts');
    expect(contracts.data.map((c: { id: string }) => c.id)).toEqual([a.contractId]);
    const tickets = await eng.client.ok('GET', '/ops/v1/tickets?status=all');
    const ids = tickets.data.map((t: { id: string }) => t.id);
    expect(ids).toContain(ta.id);
    expect(ids).not.toContain(tb.id);

    expect((await eng.client.get(`/ops/v1/tickets/${ta.id}`)).status).toBe(200);
    for (const path of [`/ops/v1/tickets/${tb.id}`, `/ops/v1/assets/${b.assetId}`, `/ops/v1/tickets?contractId=${b.contractId}`, `/ops/v1/alerts?assetId=${b.assetId}`, '/ops/v1/tickets/does-not-exist']) {
      const r = await eng.client.get(path);
      expect(r.status, path).toBe(404);
    }
    expect((await eng.client.post(`/ops/v1/tickets/${tb.id}/messages`, { body: 'hello' })).status).toBe(404);
    expect((await eng.client.patch(`/ops/v1/tickets/${tb.id}`, { assigneeId: eng.userId })).status).toBe(404);

    // External engineers are not staff and never reach the back office, even with a console session.
    expect((await s.prisma.user.findUniqueOrThrow({ where: { id: eng.userId } })).isStaff).toBe(false);
    expect((await admin.client.post(`/admin/v1/staff/${eng.userId}`, { isStaff: true })).status).toBe(422);

    // Work the assigned ticket: reply, internal note, take it, close only with a root cause.
    await eng.client.ok('POST', `/ops/v1/tickets/${ta.id}/messages`, { body: 'Looking into it now.' }, 201);
    await eng.client.ok('PATCH', `/ops/v1/tickets/${ta.id}`, { assigneeId: eng.userId });
    const noCause = await eng.client.patch(`/ops/v1/tickets/${ta.id}`, { status: 'closed' });
    expect(noCause.status).toBe(422);
    expect(noCause.body.error.code).toBe('root_cause_required');
    const closed = await eng.client.ok('PATCH', `/ops/v1/tickets/${ta.id}`, { status: 'closed', rootCause: 'Log rotation was disabled after the last upgrade.' });
    expect(closed.ticket.status).toBe('closed');
    expect(closed.messages.some((m: { rootCause: boolean; internal: boolean }) => m.rootCause && m.internal)).toBe(true);
    const customerView = await a.owner.client.ok('GET', `/v1/managed/tickets/${ta.id}`);
    expect(JSON.stringify(customerView)).not.toContain('Log rotation was disabled');
    const audit = await s.prisma.auditLog.findMany({ where: { resource: `ticket:${ta.id}`, action: { startsWith: 'ops.' } } });
    expect(audit.map((x) => x.action)).toEqual(expect.arrayContaining(['ops.ticket_replied', 'ops.ticket_root_cause', 'ops.ticket_status']));
    expect(audit.every((x) => x.ip === eng.client.ip && x.teamId === a.owner.teamId && x.userId === eng.userId)).toBe(true);
  });

  it('blocks a Jordan engineer on a SAUDI_ONLY contract', async () => {
    const c = await contractWithAsset();
    const jo = await externalEngineer({ country: 'JO' });
    const sa = await externalEngineer({ country: 'SA' });
    // Residency policy is full staff only.
    expect((await lead.client.patch(`/admin/ops/contracts/${c.contractId}/access-policy`, { accessPolicy: 'SAUDI_ONLY' })).status).toBe(403);
    // Assigned while the contract allows ANY, removed when it becomes SAUDI_ONLY.
    await lead.client.ok('POST', `/admin/ops/engineers/${jo.profileId}/assignments`, { contractId: c.contractId }, 201);
    const changed = await admin.client.ok('PATCH', `/admin/ops/contracts/${c.contractId}/access-policy`, { accessPolicy: 'SAUDI_ONLY' });
    expect(changed.removedAssignments.map((r: { engineerId: string }) => r.engineerId)).toEqual([jo.profileId]);
    expect((await jo.client.get(`/ops/v1/assets/${c.assetId}`)).status).toBe(404);

    const refused = await lead.client.post(`/admin/ops/engineers/${jo.profileId}/assignments`, { contractId: c.contractId });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('residency_blocked');
    await lead.client.ok('POST', `/admin/ops/engineers/${sa.profileId}/assignments`, { contractId: c.contractId }, 201);
    expect((await sa.client.get(`/ops/v1/assets/${c.assetId}`)).status).toBe(200);

    // Nor can the Jordan engineer be given the contract's tickets or pages.
    const t = await customerTicket(c.owner, c.assetId);
    const assign = await lead.client.patch(`/admin/managed/tickets/${t.id}`, { assigneeId: jo.userId });
    expect(assign.status).toBe(403);
    expect(assign.body.error.code).toBe('residency_blocked');
  });

  it('never returns an email address or phone number to an external engineer', async () => {
    const c = await contractWithAsset();
    await s.prisma.user.update({ where: { id: c.owner.userId }, data: { phone: '+966500000123' } });
    const eng = await externalEngineer({ contractIds: [c.contractId] });
    await s.prisma.user.update({ where: { id: eng.userId }, data: { phone: '+962790000456' } });
    const t = await customerTicket(c.owner, c.assetId, 'P2', `Call me on +966 50 000 0123 or write to ${c.owner.email} please`);
    await lead.client.ok('POST', `/admin/managed/tickets/${t.id}/messages`, { body: 'Internal: owner prefers phone', internal: true }, 201);
    await eng.client.ok('PATCH', `/ops/v1/tickets/${t.id}`, { assigneeId: eng.userId });
    await s.prisma.alert.create({ data: { assetId: c.assetId, contractId: c.contractId, fingerprint: `fp-${t.id}`, name: 'DiskFull', severity: 'WARNING', startsAt: new Date(), ticketId: t.id } });

    const paths = ['/ops/v1/me', '/ops/v1/contracts', '/ops/v1/tickets?status=all', `/ops/v1/tickets/${t.id}`, '/ops/v1/alerts', `/ops/v1/assets/${c.assetId}`, `/ops/v1/tickets?mine=true`];
    for (const path of paths) {
      const r = await eng.client.get(path);
      expect(r.status, path).toBe(200);
      expect(r.text, path).not.toMatch(EMAIL);
      for (const phone of ['+966500000123', '966500000123', '+962790000456', '+966 50 000 0123']) expect(r.text, path).not.toContain(phone);
    }
    const workspace = await eng.client.ok('GET', `/ops/v1/tickets/${t.id}`);
    expect(workspace.messages[0].body).toBe('Call me on [phone hidden] or write to [email hidden] please');
    expect(workspace.messages.some((m: { internal: boolean }) => m.internal)).toBe(true);
    // Staff still see the original text.
    const staffView = await lead.client.ok('GET', `/admin/managed/tickets/${t.id}`);
    expect(staffView.messages[0].body).toContain(c.owner.email);
  });
});

describe('ops console timers and timesheets', () => {
  it('stops an idle timer after the configured time and prompts first', async () => {
    const c = await contractWithAsset();
    const eng = await externalEngineer({ contractIds: [c.contractId] });
    const t = await customerTicket(c.owner, c.assetId);
    const started = await eng.client.ok('POST', '/ops/v1/timers/start', { ticketId: t.id }, 201);
    expect(started.ticketId).toBe(t.id);
    const second = await eng.client.post('/ops/v1/timers/start', { ticketId: t.id });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('timer_running');
    expect((await eng.client.ok('GET', '/ops/v1/me')).runningTimer.id).toBe(started.id);

    const stopped = await waitFor(async () => {
      const row = await s.prisma.workTimer.findUniqueOrThrow({ where: { id: started.id } });
      return row.stoppedAt && row;
    }, { what: 'the idle timer to stop', timeoutMs: 30_000 });
    expect(stopped.stopReason).toBe('idle');
    expect(s.outbox.some((m) => m.to === eng.email && m.subject.startsWith('Your work timer is still running'))).toBe(true);
    const log = await s.prisma.workLog.findUniqueOrThrow({ where: { id: stopped.workLogId! } });
    expect(log).toMatchObject({ status: 'DRAFT', source: 'TIMER', flagged: true, ticketId: t.id, userId: eng.userId, engineerId: eng.profileId });
    // Idle time after the last activity is not counted.
    expect(log.endedAt!.getTime()).toBeLessThanOrEqual(stopped.lastActivityAt.getTime() + 60_000);
    await waitFor(async () => (await s.prisma.auditLog.count({ where: { resource: `timer:${started.id}`, action: 'ops.timer_auto_stopped' } })) === 1, { what: 'the auto stop audit event', timeoutMs: 10_000 });
    expect((await eng.client.ok('GET', '/ops/v1/timers/current')).timer).toBeNull();
  });

  it('keeps an active timer running and submits, rejects and approves time', async () => {
    const c = await contractWithAsset();
    const eng = await externalEngineer({ contractIds: [c.contractId] });
    const t = await customerTicket(c.owner, c.assetId);
    const timer = await eng.client.ok('POST', '/ops/v1/timers/start', { ticketId: t.id }, 201);
    // Heartbeats from the ops console keep it alive past the prompt and stop times.
    for (let i = 0; i < 7; i++) {
      await sleep(1000);
      await eng.client.ok('POST', '/ops/v1/activity', { ticketId: t.id }, 204);
    }
    expect((await s.prisma.workTimer.findUniqueOrThrow({ where: { id: timer.id } })).stoppedAt).toBeNull();
    const stop = await eng.client.ok('POST', '/ops/v1/timers/stop', { note: 'Cleared the disk' }, 200);
    expect(stop.workLog).toMatchObject({ status: 'DRAFT', minutes: 1 });

    const startedAt = new Date(Date.now() - 3 * 3600_000);
    expect((await eng.client.post('/ops/v1/timesheet/entries', { ticketId: t.id, minutes: 30, startedAt })).status).toBe(400);
    const manual = await eng.client.ok('POST', '/ops/v1/timesheet/entries', { ticketId: t.id, minutes: 45, startedAt, reason: 'Worked from the phone during an outage', note: 'Restarted nginx' }, 201);
    expect(manual).toMatchObject({ status: 'DRAFT', source: 'MANUAL', flagged: true });

    const month = periodKey(startedAt);
    const sheet = await eng.client.ok('GET', `/ops/v1/timesheet?month=${month}`);
    expect(sheet.entries.map((e: { id: string }) => e.id)).toEqual(expect.arrayContaining([stop.workLog.id, manual.id]));
    const submitted = await eng.client.ok('POST', '/ops/v1/timesheet/submit', { month }, 200);
    expect(submitted.submitted).toBeGreaterThanOrEqual(2);
    expect((await eng.client.patch(`/ops/v1/timesheet/entries/${manual.id}`, { minutes: 50 })).status).toBe(409);

    const waiting = await lead.client.ok('GET', '/admin/ops/timesheets');
    expect(waiting.data.find((r: { userId: string }) => r.userId === eng.userId)).toMatchObject({ engineerId: eng.profileId, flagged: 1 });
    const entries = await lead.client.ok('GET', `/admin/ops/timesheets/${eng.profileId}?month=${month}&status=SUBMITTED`);
    expect(entries.entries).toHaveLength(2);
    expect((await lead.client.post(`/admin/ops/timesheets/${eng.profileId}/approve`, { decision: 'REJECTED', workLogIds: [manual.id] })).status).toBe(422);
    await lead.client.ok('POST', `/admin/ops/timesheets/${eng.profileId}/approve`, { decision: 'REJECTED', workLogIds: [manual.id], comment: 'Use the timer, or split this into the real windows' }, 200);
    await lead.client.ok('POST', `/admin/ops/timesheets/${eng.userId}/approve`, { decision: 'APPROVED', workLogIds: [stop.workLog.id] }, 200);
    // Leads cannot approve their own time.
    expect((await lead.client.post(`/admin/ops/timesheets/${lead.userId}/approve`, { decision: 'APPROVED', month })).status).toBe(403);

    const after = await eng.client.ok('GET', `/ops/v1/timesheet?month=${month}`);
    const byId = Object.fromEntries(after.entries.map((e: { id: string }) => [e.id, e]));
    expect(byId[stop.workLog.id].status).toBe('APPROVED');
    expect(byId[manual.id]).toMatchObject({ status: 'REJECTED', reviewComment: 'Use the timer, or split this into the real windows' });
    // A rejected entry can be fixed and goes back to DRAFT.
    expect((await eng.client.ok('PATCH', `/ops/v1/timesheet/entries/${manual.id}`, { minutes: 40 })).status).toBe('DRAFT');
    const audit = await s.prisma.auditLog.findMany({ where: { resource: `timesheet:${eng.userId}` } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['ops.timesheet_approved', 'ops.timesheet_rejected']));
  });

  it('bills customer overage from approved worklogs only', async () => {
    const c = await contractWithAsset('ESSENTIAL');
    const eng = await externalEngineer({ contractIds: [c.contractId] });
    const t = await customerTicket(c.owner, c.assetId);
    const base = Date.now() - 13 * 3600_000;
    const entry = (minutes: number, hoursAgo: number) => eng.client.ok('POST', '/ops/v1/timesheet/entries', { ticketId: t.id, minutes, startedAt: new Date(base + hoursAgo * 60_000), reason: 'Long outage handled from the phone' }, 201);
    const approved = [await entry(300, 0), await entry(60, 310)];
    const pending = await entry(200, 380);
    const month = periodKey(new Date(base));
    const { start, end } = periodBounds(month);
    const usage = () => lead.client.ok('GET', `/admin/managed/contracts/${c.contractId}/usage?period=${month}`);

    expect(await usage()).toMatchObject({ billableMinutes: 0, overageMinutes: 0, pendingApprovalMinutes: 560 });
    await eng.client.ok('POST', '/ops/v1/timesheet/submit', { month }, 200);
    await lead.client.ok('POST', `/admin/ops/timesheets/${eng.profileId}/approve`, { decision: 'APPROVED', workLogIds: approved.map((a) => a.id) }, 200);
    expect(await usage()).toMatchObject({ includedMinutes: 120, billableMinutes: 360, overageMinutes: 240, pendingApprovalMinutes: 200 });

    const billing = s.get(ManagedBillingService);
    const contract = await s.prisma.managedContract.findUniqueOrThrow({ where: { id: c.contractId }, include: { plan: true, team: { select: { id: true, currency: true } } } });
    const r = await billing.accrueContract(contract, start, end);
    expect(r).toMatchObject({ overageMinutes: 240 });
    const line = await s.prisma.usageRecord.findUniqueOrThrow({ where: { resourceType_resourceId_hourStart: { resourceType: 'managed_overage', resourceId: c.contractId, hourStart: start } } });
    expect(line.quantity).toBeCloseTo(4, 5);
    const rows = await s.prisma.workLog.findMany({ where: { contractId: c.contractId } });
    expect(rows.filter((w) => w.billedPeriod).map((w) => w.id).sort()).toEqual(approved.map((a) => a.id).sort());
    expect(rows.find((w) => w.id === pending.id)!.billedPeriod).toBeNull();
  });
});

/** Puts a user on call now as PRIMARY for a few hours (their own shift, never overlapping). */
async function onCall(userId: string, role: 'PRIMARY' | 'SECONDARY' = 'PRIMARY') {
  const now = Date.now();
  await s.prisma.onCallShift.deleteMany({ where: { userId } });
  return lead.client.ok('POST', '/admin/managed/oncall/shifts', { userId, role, startsAt: new Date(now - 600_000), endsAt: new Date(now + 4 * 3600_000) }, 201);
}

/** A gateway style ephemeral ed25519 key pair. */
function ephemeralKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { line: ed25519Line(rawEd25519(publicKey), 'gateway'), privateKey };
}

describe('ops console access grants', () => {
  it('auto approves P1 work by the on call engineer and certifies keys for the asset until expiry', async () => {
    const c = await contractWithAsset();
    const eng = await externalEngineer({ contractIds: [c.contractId] });
    await onCall(eng.userId);
    const t = await customerTicket(c.owner, c.assetId, 'P1', 'Production is down');
    const requested = await eng.client.ok('POST', '/ops/v1/access/grants', { assetId: c.assetId, ticketId: t.id, reason: 'Investigate the outage', durationMin: 30 }, 201);
    expect(requested).toMatchObject({ auto: true, emergency: true, grantedMinutes: 120, principals: [`prgd-asset-${c.assetId}`] });
    const active = await waitFor(async () => {
      const g = await eng.client.ok('GET', `/ops/v1/access/grants/${requested.id}`);
      return g.status === 'ACTIVE' && g;
    }, { what: 'the grant to become ACTIVE', timeoutMs: 20_000 });
    const lifetime = new Date(active.expiresAt).getTime() - new Date(active.startsAt).getTime();
    expect(lifetime).toBe(120 * 60_000);
    expect((await eng.client.ok('GET', '/ops/v1/me')).activeGrants.map((g: { id: string }) => g.id)).toContain(active.id);

    // The local CA signs the gateway's key with the asset principal only, valid until the grant expires.
    const grant = await s.prisma.accessGrant.findUniqueOrThrow({ where: { id: active.id } });
    const key = ephemeralKey();
    const issued = await s.get(GrantsService).issueCertificate(grant, key.line, 'it-session');
    const cert = parseCertificate(issued.certificate);
    expect(cert.signatureValid).toBe(true);
    expect(cert.certType).toBe(1);
    expect(cert.principals).toEqual([`prgd-asset-${c.assetId}`]);
    expect(cert.validBefore.getTime()).toBe(Math.floor(grant.expiresAt!.getTime() / 1000) * 1000);
    expect(cert.validAfter.getTime()).toBeLessThan(Date.now());
    expect(cert.extensions).toEqual(['permit-pty']);
    expect(cert.publicKey.equals(rawEd25519(key.privateKey))).toBe(true);
    const ca = await lead.client.ok('GET', '/admin/ops/access/ca');
    expect(ca.ca).toBe('local');
    expect(Buffer.from(ca.publicKey.split(' ')[1], 'base64').subarray(-32).equals(cert.signatureKey)).toBe(true);
    const audit = await s.prisma.auditLog.findMany({ where: { resource: `access_grant:${active.id}` } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['ops.grant_requested', 'ops.grant_approved', 'ops.grant_active', 'ops.certificate_issued']));
  });

  it('waits for a support lead when the engineer is not on call, never self approved, and extends once', async () => {
    const c = await contractWithAsset();
    const eng = await externalEngineer({ contractIds: [c.contractId] });
    const t = await customerTicket(c.owner, c.assetId, 'P1', 'Down again');
    const g = await eng.client.ok('POST', '/ops/v1/access/grants', { assetId: c.assetId, ticketId: t.id, reason: 'Look at the logs', durationMin: 90 }, 201);
    expect(g).toMatchObject({ status: 'REQUESTED', auto: false });
    expect(s.outbox.some((m) => m.subject.startsWith(`Access request: `) && m.text.includes(g.id))).toBe(true);
    expect((await eng.client.post('/ops/v1/access/grants', { assetId: c.assetId, ticketId: t.id, reason: 'Again please', durationMin: 90 })).status).toBe(409);
    expect((await eng.client.post('/ops/v1/access/grants', { assetId: c.assetId, ticketId: t.id, reason: 'Too long a window', durationMin: 300 })).status).toBe(422);
    // An engineer cannot approve anything, and nobody approves their own access.
    expect((await eng.client.post(`/admin/ops/access/grants/${g.id}/approve`, {})).status).toBe(401);
    const leadOps = await opsLogin({ email: lead.email, password: lead.password, totpSecret: lead.totpSecret });
    const own = await leadOps.client.ok('POST', '/ops/v1/access/grants', { assetId: c.assetId, ticketId: t.id, reason: 'Lead checking himself', durationMin: 30 }, 201);
    expect(own.status).toBe('REQUESTED');
    expect((await lead.client.post(`/admin/ops/access/grants/${own.id}/approve`, {})).status).toBe(403);
    await admin.client.ok('POST', `/admin/ops/access/grants/${own.id}/deny`, { reason: 'Not needed' }, 200);

    const pending = await lead.client.ok('GET', '/admin/ops/access/grants?status=REQUESTED');
    expect(pending.data.map((x: { id: string }) => x.id)).toContain(g.id);
    await lead.client.ok('POST', `/admin/ops/access/grants/${g.id}/approve`, { minutes: 60 }, 200);
    const active = await waitFor(async () => {
      const x = await eng.client.ok('GET', `/ops/v1/access/grants/${g.id}`);
      return x.status === 'ACTIVE' && x;
    }, { what: 'the approved grant to become ACTIVE', timeoutMs: 20_000 });
    expect(new Date(active.expiresAt).getTime() - new Date(active.startsAt).getTime()).toBe(60 * 60_000);

    const extended = await eng.client.ok('POST', `/ops/v1/access/grants/${g.id}/extend`, { reason: 'Database restore still running', minutes: 30 }, 200);
    expect(new Date(extended.expiresAt).getTime() - new Date(active.expiresAt).getTime()).toBe(30 * 60_000);
    expect(extended).toMatchObject({ extensions: 1, extensionReason: 'Database restore still running' });
    const again = await eng.client.post(`/ops/v1/access/grants/${g.id}/extend`, { reason: 'One more time please', minutes: 30 });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('extension_used');
  });

  it('revokes the grant and its certificates when the ticket is closed', async () => {
    const c = await contractWithAsset();
    const eng = await externalEngineer({ contractIds: [c.contractId] });
    await onCall(eng.userId);
    const t = await customerTicket(c.owner, c.assetId, 'P2', 'Slow checkout');
    const g = await eng.client.ok('POST', '/ops/v1/access/grants', { assetId: c.assetId, ticketId: t.id, reason: 'Profile the database', durationMin: 60 }, 201);
    await waitFor(async () => (await s.prisma.accessGrant.findUniqueOrThrow({ where: { id: g.id } })).status === 'ACTIVE', { what: 'grant ACTIVE', timeoutMs: 20_000 });
    await s.get(GrantsService).issueCertificate(await s.prisma.accessGrant.findUniqueOrThrow({ where: { id: g.id } }), ephemeralKey().line, 'it-close');
    await eng.client.ok('PATCH', `/ops/v1/tickets/${t.id}`, { status: 'closed', rootCause: 'A missing index on the orders table.' });
    const after = await s.prisma.accessGrant.findUniqueOrThrow({ where: { id: g.id }, include: { certificates: true } });
    expect(after).toMatchObject({ status: 'REVOKED', revokeReason: 'ticket_closed' });
    expect(after.certificates.every((x) => x.revokedAt)).toBe(true);
    expect((await eng.client.post(`/ops/v1/access/grants/${g.id}/extend`, { reason: 'Need more time', minutes: 10 })).status).toBe(409);
    expect(await s.prisma.auditLog.count({ where: { resource: `access_grant:${g.id}`, action: 'ops.grant_revoked' } })).toBe(1);
  });
});

/** A call from prgd-gateway to /internal/gateway (shared secret header). */
async function gateway(path: string, body: unknown, secret: string | null = 'it-gateway-secret') {
  const r = await fetch(`${s.baseUrl}/internal/gateway/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(secret !== null ? { 'x-prgd-gateway-secret': secret } : {}) }, body: JSON.stringify(body) });
  const text = await r.text();
  return { status: r.status, body: text ? JSON.parse(text) : null, text };
}

/** An engineer with an ACTIVE emergency grant on a fresh contract's asset. */
async function activeGrant() {
  const c = await contractWithAsset();
  const eng = await externalEngineer({ contractIds: [c.contractId] });
  await onCall(eng.userId);
  const t = await customerTicket(c.owner, c.assetId, 'P1', 'Everything is down');
  const g = await eng.client.ok('POST', '/ops/v1/access/grants', { assetId: c.assetId, ticketId: t.id, reason: 'Restore service', durationMin: 60 }, 201);
  await waitFor(async () => (await s.prisma.accessGrant.findUniqueOrThrow({ where: { id: g.id } })).status === 'ACTIVE', { what: 'grant ACTIVE', timeoutMs: 20_000 });
  return { ...c, eng, ticketId: t.id as string, grantId: g.id as string };
}

describe('ops console terminal sessions and the gateway contract', () => {
  it('checks gateway tokens and grants, signs the gateway key and refuses expired or revoked grants', async () => {
    const x = await activeGrant();
    await admin.client.ok('PUT', `/admin/ops/assets/${x.assetId}/secrets`, { values: { sudo_password: 's3cret-value-1' } });
    expect((await lead.client.ok('GET', `/admin/ops/assets/${x.assetId}/secrets`)).keys).toEqual(['sudo_password']);

    const opened = await x.eng.client.ok('POST', '/ops/v1/sessions', { grantId: x.grantId }, 201);
    expect(opened.token).toMatch(/^prgd_gws_/);
    expect(opened.gatewayUrl).toBe(`ws://localhost:4100/v1/terminal?session=${opened.sessionId}`);
    expect(new Date(opened.tokenExpiresAt).getTime() - Date.now()).toBeLessThanOrEqual(60_000);

    const key = ephemeralKey();
    const check = { token: opened.token, sessionId: opened.sessionId, publicKey: key.line, gatewayId: 'gw-it', clientIp: '198.51.100.20' };
    expect((await gateway('session-check', check, null)).status).toBe(401);
    expect((await gateway('session-check', check, 'wrong-secret')).status).toBe(401);
    expect((await gateway('session-check', { ...check, token: 'prgd_gws_forged-token-value' })).status).toBe(401);

    const ok = await gateway('session-check', check);
    expect(ok.status).toBe(200);
    const grant = await s.prisma.accessGrant.findUniqueOrThrow({ where: { id: x.grantId } });
    expect(ok.body).toMatchObject({ sessionId: opened.sessionId, grantId: x.grantId, target: { host: '10.8.0.70', port: 22, username: 'prgd' }, principals: [`prgd-asset-${x.assetId}`], secrets: [{ ref: `assets/${x.assetId}`, keys: ['sudo_password'] }], policy: { fileDownload: false }, kill: { natsSubject: 'prgd.gateway.sessions.kill' } });
    expect(ok.body.recording).toMatchObject({ format: 'asciicast-v2', uploadMethod: 'PUT', key: expect.stringMatching(new RegExp(`^sessions/\\d{4}/\\d{2}/${opened.sessionId}\\.cast$`)) });
    expect(ok.text).not.toContain('s3cret-value-1');
    const cert = parseCertificate(ok.body.certificate);
    expect(cert).toMatchObject({ signatureValid: true, principals: [`prgd-asset-${x.assetId}`], keyId: `prgd-session-${opened.sessionId}` });
    expect(cert.validBefore.getTime()).toBe(Math.floor(grant.expiresAt!.getTime() / 1000) * 1000);
    expect(cert.publicKey.equals(rawEd25519(key.privateKey))).toBe(true);
    // The token works once.
    const replay = await gateway('session-check', check);
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe('token_used');

    // Only the gateway, for a live session on this asset, reads secret values.
    const secret = await gateway('secrets', { sessionId: opened.sessionId, ref: `assets/${x.assetId}` });
    expect(secret.body.values).toEqual({ sudo_password: 's3cret-value-1' });
    expect((await gateway('secrets', { sessionId: opened.sessionId, ref: 'assets/someone-else' })).status).toBe(403);
    for (const path of ['/ops/v1/me', '/ops/v1/sessions', '/ops/v1/access/grants', `/ops/v1/tickets/${x.ticketId}`, `/ops/v1/assets/${x.assetId}`]) {
      expect((await x.eng.client.get(path)).text, path).not.toContain('s3cret-value-1');
    }

    // Events from the gateway: activity for the engineer's timer, bytes, the stored recording.
    const timer = await x.eng.client.ok('POST', '/ops/v1/timers/start', { ticketId: x.ticketId }, 201);
    await s.prisma.workTimer.update({ where: { id: timer.id }, data: { startedAt: new Date(Date.now() - 15 * 60_000) } });
    await s.prisma.terminalSession.update({ where: { id: opened.sessionId }, data: { startedAt: new Date(Date.now() - 10 * 60_000) } });
    expect((await gateway('session-events', { sessionId: opened.sessionId, type: 'started' })).body.action).toBe('continue');
    expect((await gateway('session-events', { sessionId: opened.sessionId, type: 'heartbeat', bytesIn: 1200, bytesOut: 48_000 })).body).toMatchObject({ ok: true, action: 'continue' });
    expect((await gateway('session-events', { sessionId: opened.sessionId, type: 'ended', reason: 'client_closed', bytesIn: 1300, bytesOut: 50_000 })).status).toBe(200);
    expect((await gateway('session-events', { sessionId: opened.sessionId, type: 'recording_stored', recordingKey: 'sessions/wrong.cast', recordingSize: 10 })).status).toBe(422);
    await gateway('session-events', { sessionId: opened.sessionId, type: 'recording_stored', recordingKey: ok.body.recording.key, recordingSize: 51_234 });
    const stop = await x.eng.client.ok('POST', '/ops/v1/timers/stop', {}, 200);
    expect(stop.workLog.sessionMinutes).toBe(10);
    const ended = await lead.client.ok('GET', `/admin/ops/sessions/${opened.sessionId}`);
    expect(ended).toMatchObject({ status: 'ENDED', endReason: 'client_closed', bytesIn: 1300, bytesOut: 50_000, recorded: true, recordingSize: 51_234 });
    const playback = await lead.client.ok('GET', `/admin/ops/sessions/${opened.sessionId}/playback`);
    expect(playback).toMatchObject({ format: 'asciicast-v2' });
    expect(playback.url).toContain(ok.body.recording.key);

    // A staff kill ends a live session: the gateway's next event answers kill.
    const second = await x.eng.client.ok('POST', '/ops/v1/sessions', { grantId: x.grantId }, 201);
    expect((await gateway('session-check', { token: second.token, publicKey: ephemeralKey().line })).status).toBe(200);
    const killed = await lead.client.ok('POST', `/admin/ops/sessions/${second.sessionId}/kill`, { reason: 'Unexpected commands' }, 200);
    expect(killed).toMatchObject({ status: 'KILLED', killReason: 'Unexpected commands' });
    expect((await gateway('session-events', { sessionId: second.sessionId, type: 'heartbeat' })).body).toMatchObject({ action: 'kill', reason: 'Unexpected commands' });

    // An expired grant: no new session passes the check, live ones are told to end.
    const live = await x.eng.client.ok('POST', '/ops/v1/sessions', { grantId: x.grantId }, 201);
    expect((await gateway('session-check', { token: live.token, publicKey: ephemeralKey().line })).status).toBe(200);
    const late = await x.eng.client.ok('POST', '/ops/v1/sessions', { grantId: x.grantId }, 201);
    await s.prisma.accessGrant.update({ where: { id: x.grantId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await gateway('session-check', { token: late.token, publicKey: ephemeralKey().line });
    expect(expired.status).toBe(409);
    expect(expired.body.error.code).toBe('grant_expired');
    expect((await gateway('session-events', { sessionId: live.sessionId, type: 'heartbeat' })).body).toMatchObject({ action: 'kill', reason: 'grant expired' });
    expect((await x.eng.client.post('/ops/v1/sessions', { grantId: x.grantId })).status).toBe(409);

    // A revoked grant: the live session is killed and pending tokens are refused.
    await s.prisma.accessGrant.update({ where: { id: x.grantId }, data: { expiresAt: new Date(Date.now() + 3600_000) } });
    const pending = await x.eng.client.ok('POST', '/ops/v1/sessions', { grantId: x.grantId }, 201);
    await lead.client.ok('POST', `/admin/ops/access/grants/${x.grantId}/revoke`, { reason: 'Work is done' }, 200);
    expect((await s.prisma.terminalSession.findUniqueOrThrow({ where: { id: live.sessionId } })).status).toBe('KILLED');
    const revoked = await gateway('session-check', { token: pending.token, publicKey: ephemeralKey().line });
    expect(revoked.status).toBe(409);
    expect(revoked.body.error.code).toBe('grant_inactive');
    const certs = await s.prisma.sshCertificate.findMany({ where: { grantId: x.grantId } });
    expect(certs.length).toBe(3);
    expect(certs.every((c) => c.revokedAt)).toBe(true);
    const audit = await s.prisma.auditLog.findMany({ where: { resource: `terminal_session:${opened.sessionId}` } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['ops.session_opened', 'ops.session_started', 'ops.secret_resolved', 'ops.session_ended', 'ops.session_recording_stored']));
  });
});

describe('ops console shifts and handovers', () => {
  it('starts a shift with the checklist, ends it with a handover and revokes non emergency grants', async () => {
    const c = await contractWithAsset();
    const prev = await externalEngineer({ contractIds: [c.contractId] });
    const eng = await externalEngineer({ contractIds: [c.contractId] });
    // The previous engineer hands over first.
    await onCall(prev.userId, 'SECONDARY');
    await prev.client.ok('GET', '/ops/v1/shifts/handover/latest');
    await prev.client.ok('POST', '/ops/v1/shifts/start', { checklist: { pagingAppOnline: true, vpnWorking: true, twoFactorWorking: true, lastHandoverRead: true } }, 200);
    const prevEnd = await prev.client.ok('POST', '/ops/v1/shifts/end', { handover: { risks: 'Disk on web at 85 percent', pendingMaintenance: 'Kernel patch Friday', notes: 'Quiet night' } }, 200);
    expect(prevEnd.shift.state).toBe('ended');

    await onCall(eng.userId);
    const incomplete = await eng.client.post('/ops/v1/shifts/start', { checklist: { pagingAppOnline: true, vpnWorking: false, twoFactorWorking: true, lastHandoverRead: true } });
    expect(incomplete.status).toBe(422);
    expect(incomplete.body.error.details.missing).toEqual(['vpnWorking']);
    const unread = await eng.client.post('/ops/v1/shifts/start', { checklist: { pagingAppOnline: true, vpnWorking: true, twoFactorWorking: true, lastHandoverRead: true } });
    expect(unread.status).toBe(409);
    expect(unread.body.error.code).toBe('handover_not_read');
    const latest = await eng.client.ok('GET', '/ops/v1/shifts/handover/latest');
    expect(latest.handover).toMatchObject({ id: prevEnd.handover.id, risks: 'Disk on web at 85 percent' });
    const started = await eng.client.ok('POST', '/ops/v1/shifts/start', { checklist: { pagingAppOnline: true, vpnWorking: true, twoFactorWorking: true, lastHandoverRead: true } }, 200);
    expect(started.state).toBe('started');
    expect(started.startChecklist.lastHandoverId).toBe(prevEnd.handover.id);
    expect((await eng.client.ok('GET', '/ops/v1/me')).currentShift.startedAt).toBeTruthy();

    // One non emergency grant (P3, lead approved) and one emergency grant (P1, on call).
    const p3 = await customerTicket(c.owner, c.assetId, 'P3', 'Rotate logs');
    const normal = await eng.client.ok('POST', '/ops/v1/access/grants', { assetId: c.assetId, ticketId: p3.id, reason: 'Configure logrotate', durationMin: 60 }, 201);
    await lead.client.ok('POST', `/admin/ops/access/grants/${normal.id}/approve`, {}, 200);
    const p1 = await customerTicket(c.owner, c.assetId, 'P1', 'Down');
    const urgent = await eng.client.ok('POST', '/ops/v1/access/grants', { assetId: c.assetId, ticketId: p1.id, reason: 'Outage', durationMin: 60 }, 201);
    for (const id of [normal.id, urgent.id]) await waitFor(async () => (await s.prisma.accessGrant.findUniqueOrThrow({ where: { id } })).status === 'ACTIVE', { what: 'grants ACTIVE', timeoutMs: 20_000 });
    await eng.client.ok('PATCH', `/ops/v1/tickets/${p1.id}`, { assigneeId: eng.userId });

    const noHandover = await eng.client.post('/ops/v1/shifts/end', {});
    expect(noHandover.status).toBe(400);
    const ended = await eng.client.ok('POST', '/ops/v1/shifts/end', { handover: { risks: 'P1 still open', pendingMaintenance: '', notes: 'Customer was told' } }, 200);
    expect(ended.grantsRevoked).toBe(1);
    expect(ended.handover.openTickets.map((t: { id: string }) => t.id)).toContain(p1.id);
    expect((await s.prisma.accessGrant.findUniqueOrThrow({ where: { id: normal.id } })).revokeReason).toBe('shift_end');
    expect((await s.prisma.accessGrant.findUniqueOrThrow({ where: { id: urgent.id } })).status).toBe('ACTIVE');
    // An ended shift no longer receives pages.
    const current = await lead.client.ok('GET', '/admin/managed/oncall/current');
    expect(current.shifts.map((x: { userId: string }) => x.userId)).not.toContain(eng.userId);
    expect(await s.prisma.auditLog.count({ where: { resource: `oncall_shift:${started.id}`, action: { in: ['ops.shift_started', 'ops.shift_ended'] } } })).toBe(2);
  });
});

describe('ops console postmortems and runbooks', () => {
  it('keeps a closed P1 pending its postmortem, suggests runbooks and lets the lead close the postmortem', async () => {
    const c = await contractWithAsset();
    const other = await contractWithAsset();
    const eng = await externalEngineer({ contractIds: [c.contractId] });
    const tag = randomBytes(3).toString('hex');
    const mine = await lead.client.ok('POST', '/admin/managed/runbooks', { title: `Customer stack ${tag}`, body: 'Nginx in front of Node', tags: [`contract:${c.contractId}`] }, 201);
    const theirs = await lead.client.ok('POST', '/admin/managed/runbooks', { title: `Other customer ${tag}`, body: 'Secret layout', tags: [`contract:${other.contractId}`] }, 201);
    const generic = await lead.client.ok('POST', '/admin/managed/runbooks', { title: `Disk full on Linux ${tag}`, body: 'Clean journald', tags: ['disk'] }, 201);

    const t = await customerTicket(c.owner, c.assetId, 'P1', 'The disk is full and the site is down');
    const ws = await eng.client.ok('GET', `/ops/v1/tickets/${t.id}`);
    const suggested = ws.suggestedRunbooks.map((r: { id: string }) => r.id);
    expect(suggested[0]).toBe(mine.id);
    expect(suggested).toContain(generic.id);
    expect(suggested).not.toContain(theirs.id);
    const list = await eng.client.ok('GET', `/ops/v1/runbooks?q=${tag}`);
    expect(list.data.map((r: { id: string }) => r.id).sort()).toEqual([generic.id, mine.id].sort());
    expect((await eng.client.get(`/ops/v1/runbooks/${theirs.slug}`)).status).toBe(404);
    expect((await eng.client.post('/ops/v1/runbooks', { title: 'Sneaky', body: 'x', tags: [`contract:${other.contractId}`] })).status).toBe(403);
    await eng.client.ok('PATCH', `/ops/v1/runbooks/${generic.slug}`, { body: 'Clean journald and old kernels' });
    expect((await eng.client.del(`/ops/v1/runbooks/${generic.slug}`)).status).toBe(403);

    await eng.client.ok('PATCH', `/ops/v1/tickets/${t.id}`, { assigneeId: eng.userId });
    const closed = await eng.client.ok('PATCH', `/ops/v1/tickets/${t.id}`, { status: 'closed', rootCause: 'Application logs were never rotated.' });
    expect(closed.ticket.status).toBe('resolved_pending_pm');
    expect(closed.postmortem.status).toBe('DRAFT');
    // The customer sees it resolved.
    expect((await c.owner.client.ok('GET', `/v1/managed/tickets/${t.id}`)).status).toBe('closed');
    expect((await c.owner.client.ok('GET', '/v1/managed/tickets?status=closed')).data.map((x: { id: string }) => x.id)).toContain(t.id);
    expect((await c.owner.client.ok('GET', `/v1/support/tickets/${t.id}`)).status).toBe('closed');

    const pm = await eng.client.ok('GET', `/ops/v1/postmortems/${closed.postmortem.id}`);
    expect(pm.rootCause).toBe('Application logs were never rotated.');
    expect(pm.timeline).toContain('Resolved');
    expect(new Date(pm.dueAt).getTime() - new Date(pm.ticket.resolvedAt).getTime()).toBe(48 * 3600_000);
    const incomplete = await eng.client.patch(`/ops/v1/postmortems/${pm.id}`, { submit: true });
    expect(incomplete.status).toBe(422);
    expect(incomplete.body.error.details.missing).toEqual(['impact', 'fix', 'prevention']);
    const submitted = await eng.client.ok('PATCH', `/ops/v1/postmortems/${pm.id}`, { impact: 'Site down 40 minutes', fix: 'Rotated and compressed logs', prevention: 'logrotate in the base image, disk alert at 80 percent', submit: true });
    expect(submitted.status).toBe('SUBMITTED');
    expect((await s.prisma.ticket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('closed');
    expect((await eng.client.patch(`/ops/v1/postmortems/${pm.id}`, { impact: 'changed later' })).status).toBe(409);

    const pending = await lead.client.ok('GET', '/admin/ops/postmortems?status=SUBMITTED');
    expect(pending.data.map((x: { id: string }) => x.id)).toContain(pm.id);
    expect((await lead.client.ok('POST', `/admin/ops/postmortems/${pm.id}/close`, { comment: 'Good write up' }, 200)).status).toBe('CLOSED');
    const audit = await s.prisma.auditLog.findMany({ where: { resource: `postmortem:${pm.id}` } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['ops.postmortem_required', 'ops.postmortem_submitted', 'ops.postmortem_closed']));
  });
});

describe('ops console contractor payouts', () => {
  it('pays approved work with the night multiplier in contract local time plus standby, and marks work paid', async () => {
    const c = await contractWithAsset();
    const eng = await externalEngineer({ contractIds: [c.contractId] });
    const stranger = await externalEngineer();
    const t = await customerTicket(c.owner, c.assetId);
    const now = new Date();
    const prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const period = periodKey(prevStart);
    // 18:00 UTC is 21:00 in Riyadh: 60 of the 120 minutes are at night. The second entry is at noon.
    const night = await eng.client.ok('POST', '/ops/v1/timesheet/entries', { ticketId: t.id, minutes: 120, startedAt: new Date(prevStart.getTime() + 9 * 86_400_000 + 18 * 3600_000), reason: 'Evening outage work, logged late' }, 201);
    const day = await eng.client.ok('POST', '/ops/v1/timesheet/entries', { ticketId: t.id, minutes: 60, startedAt: new Date(prevStart.getTime() + 10 * 86_400_000 + 9 * 3600_000), reason: 'Midday follow up, logged late' }, 201);
    const unapproved = await eng.client.ok('POST', '/ops/v1/timesheet/entries', { ticketId: t.id, minutes: 30, startedAt: new Date(prevStart.getTime() + 11 * 86_400_000 + 9 * 3600_000), reason: 'Still waiting for review' }, 201);
    await eng.client.ok('POST', '/ops/v1/timesheet/submit', { month: period }, 200);
    await lead.client.ok('POST', `/admin/ops/timesheets/${eng.profileId}/approve`, { decision: 'APPROVED', workLogIds: [night.id, day.id] }, 200);
    const shiftStart = new Date(prevStart.getTime() + 5 * 86_400_000);
    await s.prisma.onCallShift.create({ data: { userId: eng.userId, role: 'PRIMARY', startsAt: shiftStart, endsAt: new Date(shiftStart.getTime() + 8 * 3600_000), startedAt: shiftStart, endedAt: new Date(shiftStart.getTime() + 8 * 3600_000) } });
    // A shift never started is not a completed shift.
    await s.prisma.onCallShift.create({ data: { userId: eng.userId, role: 'PRIMARY', startsAt: new Date(shiftStart.getTime() + 86_400_000), endsAt: new Date(shiftStart.getTime() + 86_400_000 + 8 * 3600_000) } });

    expect((await lead.client.post(`/admin/ops/payouts/${period}/generate`, { engineerId: eng.profileId })).status).toBe(403);
    const generated = await admin.client.ok('POST', `/admin/ops/payouts/${period}/generate`, { engineerId: eng.profileId }, 200);
    expect(generated.data).toHaveLength(1);
    const p = generated.data[0];
    expect(p).toMatchObject({ period, currency: 'USD', status: 'DRAFT', hourlyRateMinor: 3000, standbyFeeMinor: 5000, nightMultiplier: 1.5, workedMinutes: 180, nightMinutes: 60, workMinor: 7500 + 3000, standbyShifts: 1, standbyMinor: 5000, totalMinor: 15_500, hasStatement: true });
    expect(p.lines.workLogs.map((l: { workLogId: string; nightMinutes: number; amountMinor: number }) => [l.workLogId, l.nightMinutes, l.amountMinor])).toEqual([[night.id, 60, 7500], [day.id, 0, 3000]]);
    expect(p.lines.workLogs.map((l: { workLogId: string }) => l.workLogId)).not.toContain(unapproved.id);

    // Drafts are not shown to the engineer; issued ones are, with the statement.
    expect((await eng.client.ok('GET', '/ops/v1/payouts')).data).toHaveLength(0);
    await admin.client.ok('PATCH', `/admin/ops/payouts/${p.id}`, { status: 'ISSUED' });
    const mine = await eng.client.ok('GET', '/ops/v1/payouts');
    expect(mine.data.map((x: { id: string; totalMinor: number }) => [x.id, x.totalMinor])).toEqual([[p.id, 15_500]]);
    expect(mine.data[0].paidById).toBeUndefined();
    const pdf = await fetch(`${s.baseUrl}/ops/v1/payouts/${p.id}/statement`, { headers: { authorization: `Bearer ${eng.client.token}`, 'x-forwarded-for': eng.client.ip } });
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString()).toBe('%PDF');
    expect((await stranger.client.get(`/ops/v1/payouts/${p.id}/statement`)).status).toBe(404);
    expect(s.outbox.some((m) => m.to === eng.email && m.subject === `Your Progrid statement for ${period}`)).toBe(true);

    expect((await admin.client.patch(`/admin/ops/payouts/${p.id}`, { status: 'PAID' })).status).toBe(422);
    const paid = await admin.client.ok('PATCH', `/admin/ops/payouts/${p.id}`, { status: 'PAID', paidReference: 'TRF-2026-0042' });
    expect(paid).toMatchObject({ status: 'PAID', paidReference: 'TRF-2026-0042' });
    const logs = await s.prisma.workLog.findMany({ where: { id: { in: [night.id, day.id, unapproved.id] } } });
    expect(Object.fromEntries(logs.map((l) => [l.id, l.status]))).toEqual({ [night.id]: 'PAID', [day.id]: 'PAID', [unapproved.id]: 'SUBMITTED' });
    // A paid month is never regenerated.
    const again = await admin.client.ok('POST', `/admin/ops/payouts/${period}/generate`, { engineerId: eng.profileId }, 200);
    expect(again.data[0]).toMatchObject({ id: p.id, status: 'PAID', totalMinor: 15_500 });
    expect(await s.prisma.auditLog.count({ where: { resource: `contractor_payout:${p.id}`, action: { in: ['ops.payout_issued', 'ops.payout_paid'] } } })).toBe(2);
  });
});

describe('ops console offboarding', () => {
  it('revokes grants, kills sessions, ends shifts, removes assignments and asks for secret rotation', async () => {
    const x = await activeGrant();
    const opened = await x.eng.client.ok('POST', '/ops/v1/sessions', { grantId: x.grantId }, 201);
    expect((await gateway('session-check', { token: opened.token, publicKey: ephemeralKey().line })).status).toBe(200);
    await x.eng.client.ok('POST', '/ops/v1/timers/start', { ticketId: x.ticketId }, 201);
    const future = await s.prisma.onCallShift.create({ data: { userId: x.eng.userId, role: 'PRIMARY', startsAt: new Date(Date.now() + 5 * 86_400_000), endsAt: new Date(Date.now() + 5 * 86_400_000 + 8 * 3600_000) } });
    const current = await s.prisma.onCallShift.findFirstOrThrow({ where: { userId: x.eng.userId, startsAt: { lte: new Date() }, endsAt: { gt: new Date() } } });

    const off = await admin.client.ok('PATCH', `/admin/ops/engineers/${x.eng.profileId}`, { status: 'OFFBOARDED', statusReason: 'Contract ended' });
    expect(off).toMatchObject({ status: 'OFFBOARDED', contractIds: [] });

    const grant = await s.prisma.accessGrant.findUniqueOrThrow({ where: { id: x.grantId }, include: { certificates: true } });
    expect(grant).toMatchObject({ status: 'REVOKED', revokeReason: 'offboarded' });
    expect(grant.certificates.every((c) => c.revokedAt)).toBe(true);
    expect((await s.prisma.terminalSession.findUniqueOrThrow({ where: { id: opened.sessionId } })).status).toBe('KILLED');
    expect((await gateway('session-events', { sessionId: opened.sessionId, type: 'heartbeat' })).body.action).toBe('kill');
    const timer = await s.prisma.workTimer.findFirstOrThrow({ where: { userId: x.eng.userId } });
    expect(timer).toMatchObject({ stopReason: 'offboarded' });
    expect(timer.stoppedAt).toBeTruthy();
    expect((await s.prisma.onCallShift.findUniqueOrThrow({ where: { id: current.id } })).endedAt).toBeTruthy();
    expect(await s.prisma.onCallShift.findUnique({ where: { id: future.id } })).toBeNull();
    expect(await s.prisma.engineerAssignment.count({ where: { engineerId: x.eng.profileId } })).toBe(0);

    // The engineer is out: the ops session is gone and signing in is refused.
    expect((await x.eng.client.get('/ops/v1/me')).status).toBe(401);
    const login = await new Client(s.baseUrl).post('/ops/v1/auth/login', { email: x.eng.email, password: x.eng.password });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe('engineer_inactive');
    // Offboarded engineers cannot come back.
    expect((await admin.client.patch(`/admin/ops/engineers/${x.eng.profileId}`, { status: 'ACTIVE' })).status).toBe(409);

    // A rotate secrets ticket for the asset they accessed.
    const rotate = await s.prisma.ticket.findMany({ where: { assetId: x.assetId, source: 'offboarding' }, include: { messages: true } });
    expect(rotate).toHaveLength(1);
    expect(rotate[0]).toMatchObject({ managedPriority: 'P3', status: 'open', contractId: x.contractId });
    expect(rotate[0].messages.some((m) => m.internal && m.body.includes(`assets/${x.assetId}`))).toBe(true);
    const customer = await x.owner.client.ok('GET', `/v1/managed/tickets/${rotate[0].id}`);
    expect(JSON.stringify(customer)).not.toContain('Contract ended');
    const audit = await s.prisma.auditLog.findFirstOrThrow({ where: { resource: `engineer:${x.eng.profileId}`, action: 'ops.engineer_access_removed' } });
    expect(audit.request).toMatchObject({ grantsRevoked: 1, timerStopped: true, assignmentsRemoved: 1, rotateTickets: [rotate[0].id] });
  });
});

/** Reads a Server Sent Events stream to the end. */
async function readSse(url: string, headers: Record<string, string>) {
  const r = await fetch(url, { headers });
  const events: { event: string; data: any }[] = [];
  if (r.status !== 200 || !r.body) return { status: r.status, events };
  const text = await r.text();
  for (const block of text.split('\n\n')) {
    const event = /^event: (.+)$/m.exec(block)?.[1];
    const data = /^data: (.+)$/m.exec(block)?.[1];
    if (event && data) events.push({ event, data: JSON.parse(data) });
  }
  return { status: r.status, events };
}

describe('ops console maintenance', () => {
  it('runs a task from the ops console, streams the live log and retries the failed run', async () => {
    const c = await contractWithAsset();
    const other = await contractWithAsset();
    const eng = await externalEngineer({ contractIds: [c.contractId] });
    const task = await lead.client.ok('POST', '/admin/managed/maintenance/tasks', { contractId: c.contractId, assetId: c.assetId, kind: 'PATCHING', cron: '0 3 * * 5', vars: { simulateFailure: true } }, 201);
    const foreign = await lead.client.ok('POST', '/admin/managed/maintenance/tasks', { contractId: other.contractId, kind: 'PATCHING', cron: '0 3 * * 5' }, 201);
    const tasks = await eng.client.ok('GET', '/ops/v1/maintenance/tasks');
    expect(tasks.data.map((t: { id: string }) => t.id)).toContain(task.id);
    expect(tasks.data.map((t: { id: string }) => t.id)).not.toContain(foreign.id);
    expect((await eng.client.post(`/ops/v1/maintenance/tasks/${foreign.id}/run`)).status).toBe(404);

    const run = await eng.client.ok('POST', `/ops/v1/maintenance/tasks/${task.id}/run`, {}, 202);
    expect(run.startedById).toBe(eng.userId);
    const auth = { authorization: `Bearer ${eng.client.token}`, 'x-forwarded-for': eng.client.ip };
    const streamed = await readSse(`${s.baseUrl}/ops/v1/maintenance/runs/${run.id}/stream`, auth);
    expect(streamed.status).toBe(200);
    const log = streamed.events.filter((e) => e.event === 'log').map((e) => e.data.chunk).join('');
    expect(log).toContain('PLAY [patching.yml]');
    expect(log).toContain('fatal');
    expect(streamed.events.filter((e) => e.event === 'status').map((e) => e.data.status)).toContain('FAILED');
    expect(streamed.events.at(-1)).toMatchObject({ event: 'end', data: { status: 'FAILED', error: 'simulated failure' } });
    // The stream also takes the HttpOnly session cookie (GET only).
    const byCookie = await readSse(`${s.baseUrl}/ops/v1/maintenance/runs/${run.id}/stream`, { cookie: `prgd_ops_session=${eng.client.token}`, 'x-forwarded-for': eng.client.ip });
    expect(byCookie.events.at(-1)?.event).toBe('end');
    const cookiePost = await fetch(`${s.baseUrl}/ops/v1/maintenance/runs/${run.id}/retry`, { method: 'POST', headers: { cookie: `prgd_ops_session=${eng.client.token}` } });
    expect(cookiePost.status).toBe(401);

    // The failure ticket goes to the engineer who started the run.
    const failed = await waitFor(async () => {
      const r = await s.prisma.maintenanceRun.findUniqueOrThrow({ where: { id: run.id }, include: { ticket: true } });
      return r.ticket && r;
    }, { what: 'the failure ticket', timeoutMs: 20_000 });
    expect(failed.ticket).toMatchObject({ managedPriority: 'P3', assigneeId: eng.userId, source: 'maintenance' });

    const retried = await eng.client.ok('POST', `/ops/v1/maintenance/runs/${run.id}/retry`, {}, 202);
    expect(retried).toMatchObject({ taskId: task.id, trigger: 'retry' });
    expect((await eng.client.ok('GET', `/ops/v1/maintenance/runs/${retried.id}`)).log).toBeDefined();
    await waitFor(async () => (await s.prisma.maintenanceRun.findUniqueOrThrow({ where: { id: retried.id } })).status === 'FAILED', { what: 'the retried run to finish', timeoutMs: 30_000 });
    expect((await eng.client.post(`/ops/v1/maintenance/runs/${retried.id}/retry`)).status).toBe(202);
    const done = await s.prisma.maintenanceRun.findFirstOrThrow({ where: { taskId: task.id, status: 'SUCCEEDED' } }).catch(() => null);
    expect(done).toBeNull();
    expect(await s.prisma.auditLog.count({ where: { resource: `maintenance_task:${task.id}`, action: { in: ['ops.maintenance_run_started', 'ops.maintenance_run_retried'] } } })).toBe(3);
  });
});

describe('ops console alerts, escalation and settings', () => {
  it('acknowledges an alert and takes its ticket, escalates to the support lead, and keeps settings full staff only', async () => {
    const c = await contractWithAsset();
    const eng = await externalEngineer({ contractIds: [c.contractId] });
    await onCall(eng.userId);
    const fp = `ops-${randomBytes(4).toString('hex')}`;
    const labels = { alertname: 'HostDown', severity: 'critical', asset_id: c.assetId };
    const am = await fetch(`${s.baseUrl}/internal/alerts/alertmanager`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer it-alertmanager-secret' }, body: JSON.stringify({ version: '4', status: 'firing', alerts: [{ status: 'firing', labels, annotations: { summary: 'Host down' }, startsAt: new Date().toISOString(), fingerprint: fp }] }) });
    expect(am.status).toBe(200);
    const alert = await s.prisma.alert.findFirstOrThrow({ where: { fingerprint: fp } });
    // The on call external engineer was paged and assigned (eligible for the contract).
    const me = await eng.client.ok('GET', '/ops/v1/me');
    expect(me.openPages.map((p: { alertId: string }) => p.alertId)).toContain(alert.id);
    const alerts = await eng.client.ok('GET', '/ops/v1/alerts');
    expect(alerts.data.map((a: { id: string }) => a.id)).toContain(alert.id);

    const acked = await eng.client.ok('POST', `/ops/v1/alerts/${alert.id}/ack`, {}, 200);
    expect(acked.status).toBe('ACKNOWLEDGED');
    const ticket = await s.prisma.ticket.findUniqueOrThrow({ where: { id: alert.ticketId! } });
    expect(ticket.assigneeId).toBe(eng.userId);
    expect(await s.prisma.page.count({ where: { alertId: alert.id, ackAt: null } })).toBe(0);

    const esc = await eng.client.ok('POST', `/ops/v1/tickets/${ticket.id}/escalate`, { reason: 'Hardware fault, need the hosting provider' }, 200);
    expect(esc.escalated).toBe(true);
    expect(await s.prisma.page.count({ where: { ticketId: ticket.id, userId: esc.to.id, urgency: 'high' } })).toBeGreaterThan(0);
    const ws = await eng.client.ok('GET', `/ops/v1/tickets/${ticket.id}`);
    expect(ws.messages.some((m: { internal: boolean; body: string }) => m.internal && m.body.startsWith('Escalated to the support lead'))).toBe(true);
    expect(ws.escalation).toMatchObject({ suggested: false, afterMinutes: 45 });

    expect((await lead.client.patch('/admin/ops/settings', { escalationSuggestMinutes: 30 })).status).toBe(403);
    expect((await admin.client.patch('/admin/ops/settings', { noSuchSetting: 1 })).status).toBe(422);
    expect((await admin.client.patch('/admin/ops/settings', { autoGrantMinutes: 300 })).status).toBe(422);
    const changed = await admin.client.ok('PATCH', '/admin/ops/settings', { escalationSuggestMinutes: 30 });
    expect(changed.settings).toMatchObject({ escalationSuggestMinutes: 30, autoGrantMinutes: 120, maxGrantMinutes: 240, postmortemDueHours: 48, nightStartHour: 22, nightEndHour: 6, defaultAccessPolicy: 'ANY' });
    expect((await lead.client.ok('GET', '/admin/ops/settings')).settings.escalationSuggestMinutes).toBe(30);
    await admin.client.ok('PATCH', '/admin/ops/settings', { escalationSuggestMinutes: 45 });
  });
});
