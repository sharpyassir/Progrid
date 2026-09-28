import { beforeAll, describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync, randomBytes, sign as edSign, type KeyObject } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';
import { Client, signup, sut, totp, waitFor, type Sut, type Team } from './harness';

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
