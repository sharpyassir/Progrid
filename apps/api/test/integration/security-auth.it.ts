import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Client, signup, sut, totp, waitFor, type Sut, type Team } from './harness';
import { loadConfig } from '../../src/config/config';
import { TokenService } from '../../src/modules/iam/token.service';
import { RedisService } from '../../src/common/redis/redis.service';

/**
 * Authentication hardening (ISO 27001 / NCA checklist): audited sign in, per account lockout,
 * idle session timeout, TOTP replay, explicit full staff role, staff IP allowlist, leavers,
 * back office tokens, rate limits that fail closed and one time ops enrollment.
 */

let s: Sut;
beforeAll(async () => {
  s = await sut();
});

afterEach(() => {
  loadConfig().STAFF_IP_ALLOWLIST = '';
  vi.restoreAllMocks();
});

const login = (t: { email: string; password: string }, extra: Record<string, unknown> = {}, c = new Client(s.baseUrl)) =>
  c.post('/v1/auth/login', { email: t.email, password: t.password, ...extra });

const audit = (userId: string, action: string) => s.prisma.auditLog.findMany({ where: { userId, action }, orderBy: { at: 'asc' } });

async function enableTotp(t: Team) {
  const setup = await t.client.ok('POST', '/v1/auth/totp/setup', {}, 201);
  const enabled = await t.client.ok('POST', '/v1/auth/totp/enable', { code: totp(setup.secret) }, 201);
  return { secret: setup.secret as string, recoveryCodes: enabled.recoveryCodes as string[] };
}

/** A staff user with these roles, two factor on, signed in with it. */
async function staffUser(roles: string[]) {
  const t = await signup(s);
  await s.prisma.user.update({ where: { id: t.userId }, data: { isStaff: true, staffRoles: roles } });
  const { secret } = await enableTotp(t);
  const r = await login(t, { totp: totp(secret) });
  expect(r.status).toBe(200);
  t.client.token = r.body.session;
  return { ...t, secret };
}

describe('sign in auditing and lockout', () => {
  it('audits sign ins and locks after five failures until the lockout expires', async () => {
    const t = await signup(s);
    const wrong = { email: t.email, password: 'wrong-password-123' };
    const c = new Client(s.baseUrl);
    for (let i = 0; i < 5; i++) expect((await login(wrong, {}, c)).status).toBe(401);
    const locked = await s.prisma.user.findUniqueOrThrow({ where: { id: t.userId } });
    expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    expect(locked.lockoutCount).toBe(1);
    expect(locked.failedLoginCount).toBe(0);

    // The right password is refused with the same generic answer while locked.
    const during = await login(t);
    expect(during.status).toBe(401);
    expect(during.text).toContain('Wrong email or password');

    const failed = await audit(t.userId, 'user.signin_failed');
    expect(failed.map((a) => (a.request as { reason: string }).reason)).toEqual(['bad_password', 'bad_password', 'bad_password', 'bad_password', 'bad_password', 'locked']);
    expect(failed[0].ip).toBe(c.ip);
    expect(failed[0].teamId).toBe(t.teamId);
    expect(await audit(t.userId, 'user.locked')).toHaveLength(1);
    expect(s.outbox.some((m) => m.to === t.email && /paused for 15 minutes/.test(m.text))).toBe(true);

    // The lockout runs out; another five failures lock for twice as long.
    await s.prisma.user.update({ where: { id: t.userId }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    const c2 = new Client(s.baseUrl);
    for (let i = 0; i < 5; i++) expect((await login(wrong, {}, c2)).status).toBe(401);
    const again = await s.prisma.user.findUniqueOrThrow({ where: { id: t.userId } });
    expect(again.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 29 * 60_000);
    expect(again.lockoutCount).toBe(2);

    // After expiry the right password works and clears the history.
    await s.prisma.user.update({ where: { id: t.userId }, data: { lockedUntil: new Date(Date.now() - 1000) } });
    const ok = await login(t);
    expect(ok.status).toBe(200);
    const cleared = await s.prisma.user.findUniqueOrThrow({ where: { id: t.userId } });
    expect([cleared.failedLoginCount, cleared.lockoutCount, cleared.lockedUntil]).toEqual([0, 0, null]);
    const signedIn = await audit(t.userId, 'user.signed_in');
    expect(signedIn.at(-1)!.request).toMatchObject({ method: 'password' });
    expect(signedIn.at(-1)!.userAgent).toBe('prgd-integration');
  });

  it('audits unknown emails without naming them, and answers like a wrong password', async () => {
    const email = `nobody-${randomBytes(4).toString('hex')}@example.test`;
    const c = new Client(s.baseUrl);
    const r = await login({ email, password: 'whatever-password' }, {}, c);
    expect(r.status).toBe(401);
    expect(r.text).toContain('Wrong email or password');
    const row = await s.prisma.auditLog.findFirst({ where: { action: 'user.signin_failed', ip: c.ip }, orderBy: { at: 'desc' } });
    expect(row?.userId).toBeNull();
    expect(row?.request).toMatchObject({ reason: 'unknown_user' });
    expect(JSON.stringify(row?.request)).not.toContain(email);
  });

  it('counts wrong TOTP codes toward the lockout and audits totp_required', async () => {
    const t = await signup(s);
    await enableTotp(t);
    expect((await login(t)).body.error.code).toBe('totp_required');
    for (let i = 0; i < 5; i++) expect((await login(t, { totp: '000000' })).status).toBe(401);
    expect((await s.prisma.user.findUniqueOrThrow({ where: { id: t.userId } })).lockedUntil).not.toBeNull();
    const reasons = (await audit(t.userId, 'user.signin_failed')).map((a) => (a.request as { reason: string }).reason);
    expect(reasons).toEqual(['totp_required', 'totp_invalid', 'totp_invalid', 'totp_invalid', 'totp_invalid', 'totp_invalid']);
  });
});

describe('rate limits', () => {
  it('limits sign in per email address across many addresses', async () => {
    const email = `spray-${randomBytes(4).toString('hex')}@example.test`;
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await login({ email, password: 'nope-nope-nope' })).status);
    expect(statuses.slice(0, 20).every((x) => x === 401)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it('fails closed on sign in endpoints when Redis is unavailable, open elsewhere', async () => {
    const t = await signup(s);
    vi.spyOn(s.get(RedisService), 'allowStrict').mockRejectedValue(new Error('redis is end'));
    const r = await login(t);
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('auth_unavailable');
    expect((await t.client.get('/v1/account')).status).toBe(200);
  });
});

describe('sessions', () => {
  it('ends idle console sessions, sooner for staff', async () => {
    const t = await signup(s);
    const session = await s.prisma.session.findFirstOrThrow({ where: { userId: t.userId, revokedAt: null } });
    await s.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(Date.now() - 45 * 60_000) } });
    expect((await t.client.get('/v1/account')).status).toBe(200); // 45 minutes is fine for a customer
    // That request refreshes lastSeenAt in the background; let it land before aging the row again.
    await waitFor(async () => (await s.prisma.session.findUniqueOrThrow({ where: { id: session.id } })).lastSeenAt.getTime() > Date.now() - 60_000, { what: 'lastSeenAt refresh', timeoutMs: 5000, intervalMs: 50 });
    await s.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(Date.now() - 121 * 60_000) } });
    expect((await t.client.get('/v1/account')).status).toBe(401);
    expect((await s.prisma.session.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).not.toBeNull();

    const staff = await staffUser(['full_admin']);
    const ss = await s.prisma.session.findFirstOrThrow({ where: { userId: staff.userId, revokedAt: null }, orderBy: { createdAt: 'desc' } });
    await s.prisma.session.update({ where: { id: ss.id }, data: { lastSeenAt: new Date(Date.now() - 31 * 60_000) } });
    expect((await staff.client.get('/admin/v1/overview')).status).toBe(401);
  });
});

describe('TOTP', () => {
  it('refuses a code that was already used, and burns a recovery code once under concurrency', async () => {
    const t = await signup(s);
    const { secret, recoveryCodes } = await enableTotp(t);
    const code = totp(secret);
    expect((await login(t, { totp: code })).status).toBe(200);
    const replay = await login(t, { totp: code });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('totp_invalid');

    const both = await Promise.all([login(t, { totp: recoveryCodes[0] }), login(t, { totp: recoveryCodes[0] })]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 401]);
    const u = await s.prisma.user.findUniqueOrThrow({ where: { id: t.userId } });
    expect(u.totpRecoveryHashes).toHaveLength(recoveryCodes.length - 1);
  });
});

describe('back office access', () => {
  it('gives staff without a role no back office, and full_admin all of it', async () => {
    const none = await staffUser([]);
    expect((await none.client.get('/admin/v1/overview')).status).toBe(403);
    const me = await none.client.ok('GET', '/v1/account');
    expect(me.scopes.some((x: string) => x === 'admin' || x.startsWith('admin:'))).toBe(false);

    const full = await staffUser(['full_admin']);
    expect((await full.client.get('/admin/v1/overview')).status).toBe(200);
    expect((await full.client.get('/admin/v1/hosts')).status).toBe(200);

    // Granting staff needs explicit roles.
    const other = await signup(s);
    expect((await full.client.post(`/admin/v1/staff/${other.userId}`, { isStaff: true })).status).toBe(400);
    expect((await full.client.post(`/admin/v1/staff/${other.userId}`, { isStaff: true, staffRoles: [] })).status).toBe(400);
    expect((await full.client.post(`/admin/v1/staff/${other.userId}`, { isStaff: true, staffRoles: ['support'] })).status).toBe(201);
  });

  it('allows the back office only from STAFF_IP_ALLOWLIST when it is set', async () => {
    const full = await staffUser(['full_admin']);
    loadConfig().STAFF_IP_ALLOWLIST = '203.0.113.0/24, 2001:db8::/32';
    const refused = await full.client.get('/admin/v1/overview');
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('ip_not_allowed');
    // Customer routes are not affected.
    expect((await full.client.get('/v1/account')).status).toBe(200);
    loadConfig().STAFF_IP_ALLOWLIST = `203.0.113.0/24,${full.client.ip}/32`;
    expect((await full.client.get('/admin/v1/overview')).status).toBe(200);
  });
});

describe('API tokens and leavers', () => {
  it('limits admin scope tokens to full staff with two factor, for at most a day', async () => {
    const customer = await signup(s);
    expect((await customer.client.post('/v1/tokens', { name: 'x', scopes: ['admin'] })).status).toBe(403);
    expect((await customer.client.post('/v1/tokens', { name: 'x', scopes: ['servers:read'], expiresInDays: 366 })).status).toBe(400);
    const plain = await customer.client.ok('POST', '/v1/tokens', { name: 'ci', scopes: ['servers:read'] }, 201);
    expect((await s.prisma.apiToken.findUniqueOrThrow({ where: { id: plain.id } })).expiresAt).toBeNull();

    const full = await staffUser(['full_admin']);
    expect((await full.client.post('/v1/tokens', { name: 'ops', scopes: ['admin'], expiresInDays: 7 })).status).toBe(422);
    const tok = await full.client.ok('POST', '/v1/tokens', { name: 'ops', scopes: ['admin'] }, 201);
    const row = await s.prisma.apiToken.findUniqueOrThrow({ where: { id: tok.id } });
    expect(row.expiresAt!.getTime() - Date.now()).toBeLessThanOrEqual(86_400_000);
    const api = new Client(s.baseUrl, tok.token);
    expect((await api.get('/admin/v1/overview')).status).toBe(200);

    // A legacy back office token without expiry no longer carries `admin`.
    const legacy = await s.get(TokenService).issueApiToken({ teamId: full.teamId, userId: full.userId, name: 'old', scopes: ['admin'] });
    expect((await new Client(s.baseUrl, legacy.token).get('/admin/v1/overview')).status).toBe(403);

    // Losing full staff revokes the back office tokens.
    const boss = await staffUser(['full_admin']);
    await boss.client.ok('POST', `/admin/v1/staff/${full.userId}`, { isStaff: true, staffRoles: ['support'] }, 201);
    expect((await s.prisma.apiToken.findUniqueOrThrow({ where: { id: tok.id } })).revokedAt).not.toBeNull();
    expect((await api.get('/admin/v1/overview')).status).toBe(401);
  });

  it('revokes a removed member’s tokens and sessions for that team', async () => {
    const owner = await signup(s);
    const member = await signup(s);
    await s.prisma.teamMember.create({ data: { teamId: owner.teamId, userId: member.userId, role: 'member' } });
    const tokens = s.get(TokenService);
    const tok = await tokens.issueApiToken({ teamId: owner.teamId, userId: member.userId, name: 'm', scopes: ['servers:read'] });
    const session = await tokens.issueSession(member.userId, owner.teamId);
    const asToken = new Client(s.baseUrl, tok.token);
    const asSession = new Client(s.baseUrl, session);
    expect((await asToken.get('/v1/servers')).status).toBe(200);
    expect((await asSession.get('/v1/servers')).status).toBe(200);

    await owner.client.ok('DELETE', `/v1/team/members/${member.userId}`, undefined, 204);
    expect((await asToken.get('/v1/servers')).status).toBe(401);
    expect((await asSession.get('/v1/servers')).status).toBe(401);
    expect(await s.prisma.session.count({ where: { userId: member.userId, teamId: owner.teamId, revokedAt: null } })).toBe(0);
    // Their own team is untouched.
    expect((await member.client.get('/v1/account')).status).toBe(200);
  });
});

describe('ops console sign in', () => {
  /** An external engineer with a password and no second factor, its profile created `ageHours` ago. */
  async function engineer(ageHours: number) {
    const t = await signup(s);
    await s.prisma.engineerProfile.create({ data: { userId: t.userId, kind: 'EXTERNAL', country: 'JO', createdAt: new Date(Date.now() - ageHours * 3_600_000) } });
    return t;
  }

  it('lets a password only challenge enroll the first factor once, within the window', async () => {
    const late = await engineer(80);
    const c = new Client(s.baseUrl);
    const l1 = await c.ok('POST', '/ops/v1/auth/login', { email: late.email, password: late.password }, 200);
    expect(l1.enroll).toBe(true);
    const refused = await c.post('/ops/v1/auth/totp/setup', { challenge: l1.challenge });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('enrollment_closed');

    const fresh = await engineer(1);
    const c2 = new Client(s.baseUrl);
    const l2 = await c2.ok('POST', '/ops/v1/auth/login', { email: fresh.email, password: fresh.password }, 200);
    const setup = await c2.ok('POST', '/ops/v1/auth/totp/setup', { challenge: l2.challenge }, 200);
    const enabled = await c2.ok('POST', '/ops/v1/auth/totp/enable', { challenge: l2.challenge, code: totp(setup.secret) }, 200);
    expect(enabled.session).toBeTruthy();
    expect((await s.prisma.engineerProfile.findUniqueOrThrow({ where: { userId: fresh.userId } })).enrolledAt).not.toBeNull();
    expect(await audit(fresh.userId, 'ops.second_factor_enrolled_from_password')).toHaveLength(1);

    // Even with the factor gone (reset by hand), the password path stays closed.
    await s.prisma.user.update({ where: { id: fresh.userId }, data: { totpEnabled: false, totpSecret: null } });
    const l3 = await c2.ok('POST', '/ops/v1/auth/login', { email: fresh.email, password: fresh.password }, 200);
    expect((await c2.post('/ops/v1/auth/totp/setup', { challenge: l3.challenge })).status).toBe(403);
  });

  it('audits failed ops passwords and second factors and locks the account', async () => {
    const e = await engineer(1);
    const c = new Client(s.baseUrl);
    const l = await c.ok('POST', '/ops/v1/auth/login', { email: e.email, password: e.password }, 200);
    const setup = await c.ok('POST', '/ops/v1/auth/totp/setup', { challenge: l.challenge }, 200);
    await c.ok('POST', '/ops/v1/auth/totp/enable', { challenge: l.challenge, code: totp(setup.secret) }, 200);

    expect((await c.post('/ops/v1/auth/login', { email: e.email, password: 'wrong-password-1' })).status).toBe(401);
    const l2 = await c.ok('POST', '/ops/v1/auth/login', { email: e.email, password: e.password }, 200);
    for (let i = 0; i < 4; i++) expect((await c.post('/ops/v1/auth/totp', { challenge: l2.challenge, code: '000000' })).status).toBe(401);
    expect((await audit(e.userId, 'ops.signin_failed')).map((a) => (a.request as { reason: string }).reason)).toEqual(['bad_password']);
    expect(await audit(e.userId, 'ops.second_factor_failed')).toHaveLength(4);
    expect((await s.prisma.user.findUniqueOrThrow({ where: { id: e.userId } })).lockedUntil).not.toBeNull();
    const locked = await c.post('/ops/v1/auth/login', { email: e.email, password: e.password });
    expect(locked.status).toBe(401);
  });
});
