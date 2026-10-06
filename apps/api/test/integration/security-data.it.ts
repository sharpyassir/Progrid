import { beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { Client, readyTeam, signup, sut, totp, waitFor, type Sut, type Team } from './harness';
import { isSealed, isSealedJson, open, openJson } from '../../src/common/crypto/secretbox';
import { loadConfig } from '../../src/config/config';
import { EventsService } from '../../src/modules/events/events.service';
import { verifyAuditChain } from '../../src/modules/events/audit-chain';
import { RetentionService } from '../../src/jobs/retention.service';
import { OBJECT_STORAGE_PROVIDER, type FakeObjectStorage } from '../../src/modules/storage/objects/objects.provider';
import { reseal } from '../../src/cli/reseal';

/**
 * Data protection: customer secrets sealed at rest but returned in clear by the API (and audited
 * when shown), the request level audit trail, the append only hash chained audit table, its
 * retention job, and account deletion.
 */

let s: Sut;
beforeAll(async () => {
  s = await sut();
});

function sshPublicKey() {
  const der = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' });
  const raw = der.subarray(der.length - 32);
  const str = (b: Buffer) => Buffer.concat([Buffer.from([0, 0, 0, b.length]), b]);
  return `ssh-ed25519 ${Buffer.concat([str(Buffer.from('ssh-ed25519')), str(raw)]).toString('base64')} it@test`;
}

async function enableTotp(t: Team) {
  const setup = await t.client.ok('POST', '/v1/auth/totp/setup', {}, 201);
  await t.client.ok('POST', '/v1/auth/totp/enable', { code: totp(setup.secret) }, 201);
  return setup.secret as string;
}

/** Apps share hosts with other test files: leave nothing behind on them. */
async function removeApp(c: Client, id: string) {
  await c.ok('DELETE', `/v1/app-platform/apps/${id}`, undefined, 202);
  await waitFor(async () => (await c.get(`/v1/app-platform/apps/${id}`)).status === 404, { what: 'app to be deleted', timeoutMs: 60_000 });
}

async function httpRows(where: Record<string, unknown>, n = 1) {
  return waitFor(async () => {
    const rows = await s.prisma.auditLog.findMany({ where, orderBy: { seq: 'asc' } });
    return rows.length >= n ? rows : null;
  }, { what: `audit rows ${JSON.stringify(where)}`, timeoutMs: 10_000, intervalMs: 200 });
}

describe('secrets at rest', () => {
  it('stores database passwords sealed, returns them in clear and audits the view', async () => {
    const t = await readyTeam(s);
    const c = t.client;
    const created = await c.ok('POST', '/v1/databases', { name: `pg-${randomBytes(3).toString('hex')}`, engine: 'postgres', size: 's-1vcpu-2gb' }, 202);
    const row = await s.prisma.dbCluster.findUniqueOrThrow({ where: { id: created.id }, include: { users: true } });
    expect(isSealed(row.adminPassword)).toBe(true);
    expect(isSealed(row.vmSecret)).toBe(true);
    expect(row.users.every((u) => isSealed(u.password))).toBe(true);
    if (row.backupSecretKey) expect(isSealed(row.backupSecretKey)).toBe(true);

    const got = await c.ok('GET', `/v1/databases/${created.id}`);
    expect(got.connection.password).toBe(open(row.adminPassword));
    expect(got.connection.password).not.toMatch(/^enc:/);
    expect(got.connection.uri).toContain(`:${got.connection.password}@`);
    expect(got.users[0].password).toBe(open(row.users[0].password));

    // A new user: the API shows the password once in clear; the row holds it sealed.
    const u = await c.ok('POST', `/v1/databases/${created.id}/users`, { name: 'reporting' }, 201);
    const urow = await s.prisma.dbUser.findUniqueOrThrow({ where: { id: u.id } });
    expect(isSealed(urow.password)).toBe(true);
    expect(open(urow.password)).toBe(u.password);

    const viewed = await s.prisma.auditLog.findMany({ where: { action: 'database.credentials_viewed', resource: `database:${created.id}` } });
    expect(viewed.length).toBeGreaterThan(0);
    expect(viewed[0].userId).toBe(t.userId);
    // The server's cloud-init (it carries the agent secret) is sealed too.
    const node = await s.prisma.dbNode.findFirstOrThrow({ where: { clusterId: created.id }, include: { server: true } });
    expect(isSealed(node.server.userData!)).toBe(true);
    expect(open(node.server.userData!)).toContain(open(row.vmSecret));
  });

  it('stores app environment variables and the git token sealed, returns env in clear and audits the view', async () => {
    const t = await readyTeam(s);
    const c = t.client;
    const created = await c.ok('POST', '/v1/app-platform/apps', { name: `sec-${randomBytes(3).toString('hex')}`, repoUrl: 'https://github.com/example/hello-node', gitToken: 'ghp_secret_token_value', env: { API_KEY: 'sk-live-123', DEBUG: '0' } }, 202);
    const row = await s.prisma.platformApp.findUniqueOrThrow({ where: { id: created.id } });
    expect(isSealedJson(row.envVars)).toBe(true);
    expect(JSON.stringify(row.envVars)).not.toContain('sk-live-123');
    expect(isSealed(row.gitToken!)).toBe(true);
    expect(openJson(row.envVars)).toEqual({ API_KEY: 'sk-live-123', DEBUG: '0' });

    const got = await c.ok('GET', `/v1/app-platform/apps/${created.id}`);
    expect(got.env).toEqual({ API_KEY: 'sk-live-123', DEBUG: '0' });
    expect(await s.prisma.auditLog.count({ where: { action: 'app.env_viewed', resource: `app:${created.id}` } })).toBeGreaterThan(0);

    // Invalid variable names and oversized maps are refused.
    expect((await c.patch(`/v1/app-platform/apps/${created.id}`, { env: { 'bad-name': 'x' } })).status).toBe(400);
    expect((await c.patch(`/v1/app-platform/apps/${created.id}`, { env: { OK: 'x'.repeat(33 * 1024) } })).status).toBe(400);
    await removeApp(c, created.id);
  });

  it('stores storage key secrets sealed', async () => {
    const t = await readyTeam(s);
    const k = await t.client.ok('POST', '/v1/storage-keys', { name: 'ci' }, 201);
    const row = await s.prisma.storageKey.findUniqueOrThrow({ where: { id: k.id } });
    expect(isSealed(row.secretKey)).toBe(true);
    expect(open(row.secretKey)).toBe(k.secretKey);
  });

  it('reseal seals plain legacy values and is idempotent', async () => {
    const t = await readyTeam(s);
    const created = await t.client.ok('POST', '/v1/app-platform/apps', { name: `rs-${randomBytes(3).toString('hex')}`, repoUrl: 'https://github.com/example/hello-node', env: { A: '1' } }, 202);
    // Simulate rows from before encryption at rest.
    await s.prisma.platformApp.update({ where: { id: created.id }, data: { envVars: { LEGACY: 'plain' }, gitToken: 'plain-token' } });
    const db = await t.client.ok('POST', '/v1/databases', { name: `rs-${randomBytes(3).toString('hex')}`, engine: 'valkey', size: 's-1vcpu-2gb' }, 202);
    await s.prisma.dbCluster.update({ where: { id: db.id }, data: { adminPassword: 'plain-password' } });
    expect((await t.client.ok('GET', `/v1/databases/${db.id}`)).connection.password).toBe('plain-password');

    const first = await reseal(s.prisma, { log: () => undefined });
    expect(first.platformApp).toBeGreaterThan(0);
    const app = await s.prisma.platformApp.findUniqueOrThrow({ where: { id: created.id } });
    expect(isSealedJson(app.envVars)).toBe(true);
    expect(openJson(app.envVars)).toEqual({ LEGACY: 'plain' });
    expect(open(app.gitToken!)).toBe('plain-token');
    const dbRow = await s.prisma.dbCluster.findUniqueOrThrow({ where: { id: db.id } });
    expect(isSealed(dbRow.adminPassword)).toBe(true);
    expect((await t.client.ok('GET', `/v1/databases/${db.id}`)).connection.password).toBe('plain-password');

    const second = await reseal(s.prisma, { dryRun: true, log: () => undefined });
    expect(second.platformApp).toBe(0);
    expect(second.dbCluster).toBe(0);
    await removeApp(t.client, created.id);
  });
});

describe('HTTP hardening', () => {
  it('sends security headers, hides x-powered-by and refuses unknown body properties', async () => {
    const t = await signup(s);
    const r = await t.client.req('GET', '/v1/account');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    expect(r.headers.get('x-powered-by')).toBeNull();
    expect(r.headers.get('cross-origin-resource-policy')).toBeNull();
    const extra = await t.client.post('/v1/ssh-keys', { name: 'k', publicKey: sshPublicKey(), isAdmin: true });
    expect(extra.status).toBe(400);
    expect(extra.text).toContain('isAdmin');
  });
});

describe('audit log', () => {
  it('records every state changing request with the route, actor and status, never the body', async () => {
    const t = await signup(s);
    const c = t.client;
    const key = await c.ok('POST', '/v1/ssh-keys', { name: 'laptop', publicKey: sshPublicKey() }, 201);
    await c.ok('DELETE', `/v1/ssh-keys/${key.id}`, undefined, 204);
    expect((await c.post('/v1/ssh-keys', { name: 'x', publicKey: 'not a key' })).status).toBe(400);
    await c.ok('GET', '/v1/ssh-keys');

    const created = await httpRows({ userId: t.userId, action: 'http.POST /v1/ssh-keys' }, 2);
    expect(created.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(created[0].teamId).toBe(t.teamId);
    expect(created[0].userAgent).toBe('prgd-integration');
    expect(created[0].ip).toBe(c.ip);
    expect(JSON.stringify(created.map((r) => r.request))).not.toContain('ssh-ed25519');
    expect((created[0].request as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);
    const deleted = await httpRows({ userId: t.userId, action: 'http.DELETE /v1/ssh-keys/:id' });
    expect(deleted[0].status).toBe(204);
    expect((deleted[0].request as { params: Record<string, string> }).params).toEqual({ id: key.id });
    expect(await s.prisma.auditLog.count({ where: { userId: t.userId, action: { startsWith: 'http.GET' } } })).toBe(0);

    // Refused before any handler: no actor, still recorded with its status.
    const anon = new Client(s.baseUrl);
    expect((await anon.post('/v1/ssh-keys', { name: 'x', publicKey: sshPublicKey() })).status).toBe(401);
    const refused = await httpRows({ ip: anon.ip, action: 'http.POST /v1/ssh-keys' });
    expect(refused[0].status).toBe(401);
    expect(refused[0].userId).toBeNull();

    // Sign in attempts are recorded too, without the password.
    const failed = new Client(s.baseUrl);
    expect((await failed.post('/v1/auth/login', { email: t.email, password: 'wrong-password' })).status).toBe(401);
    const login = await httpRows({ ip: failed.ip, action: 'http.POST /v1/auth/login' });
    expect(login[0].status).toBe(401);
    expect(JSON.stringify(login[0].request)).not.toContain('wrong-password');
  });

  it('records staff reads under /admin/v1 and verifies the hash chain', async () => {
    const admin = await signup(s);
    await s.prisma.user.update({ where: { id: admin.userId }, data: { isStaff: true, staffRoles: ['full_admin'] } });
    const secret = await enableTotp(admin);
    const boss = new Client(s.baseUrl);
    boss.token = (await boss.ok('POST', '/v1/auth/login', { email: admin.email, password: admin.password, totp: totp(secret) }, 200)).session;

    // The back office audit list serialises the chain position (a BigInt) as a string.
    const listed = await boss.ok('GET', '/admin/v1/audit?limit=5');
    expect(typeof listed.data[0].seq).toBe('string');
    expect(listed.data[0].hash).toMatch(/^[0-9a-f]{64}$/);
    const report = await boss.ok('GET', '/admin/v1/audit/verify');
    expect(report.ok).toBe(true);
    expect(report.checked).toBeGreaterThan(0);
    const read = await httpRows({ userId: admin.userId, action: 'http.GET /admin/v1/audit/verify' });
    expect(read[0].status).toBe(200);
    expect((read[0].request as { actor: { staff: boolean } }).actor.staff).toBe(true);

    // Every row links to the one before it.
    const last = await s.prisma.auditLog.findMany({ orderBy: { seq: 'desc' }, take: 5 });
    for (let i = 0; i < last.length - 1; i++) expect(last[i].prevHash).toBe(last[i + 1].hash);
  });

  it('refuses updates and deletes of audit rows, and the chain exposes a removed row', async () => {
    const events = s.get(EventsService);
    const a = await events.audit({ action: 'it.chain_a', status: 200, request: { n: 1, nested: { b: 2, a: [1, 'x'] } } });
    const b = await events.audit({ action: 'it.chain_b', status: 200, request: { at: new Date() } });
    await events.audit({ action: 'it.chain_c', status: 200 });

    await expect(s.prisma.auditLog.update({ where: { id: a.id }, data: { action: 'it.tampered' } })).rejects.toThrow(/append only/);
    await expect(s.prisma.auditLog.delete({ where: { id: a.id } })).rejects.toThrow(/append only/);
    await expect(s.prisma.$executeRaw`DELETE FROM "prgd_audit_logs" WHERE "id" = ${a.id}`).rejects.toThrow(/append only/);
    await expect(s.prisma.$executeRaw`TRUNCATE "prgd_audit_logs"`).rejects.toThrow(/append only/);
    expect(await s.prisma.auditLog.count({ where: { id: a.id, action: 'it.chain_a' } })).toBe(1);
    expect((await verifyAuditChain(s.prisma)).ok).toBe(true);

    // Someone with the purge switch removes a row from the middle: verification points at the gap.
    const row = await s.prisma.auditLog.findUniqueOrThrow({ where: { id: b.id } });
    await s.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('prgd.audit_purge', 'on', true)`;
      await tx.auditLog.delete({ where: { id: b.id } });
    });
    const broken = await verifyAuditChain(s.prisma);
    expect(broken.ok).toBe(false);
    expect(broken.broken?.reason).toBe('link_mismatch');
    // Put it back exactly as it was (inserts are allowed): the chain is whole again.
    await s.prisma.auditLog.create({ data: { ...row, request: row.request ?? undefined } as never });
    expect((await verifyAuditChain(s.prisma)).ok).toBe(true);
  });

  it('archives audit rows past retention to object storage before deleting them, and keeps them without an archive', async () => {
    const cfg = loadConfig() as { AUDIT_ARCHIVE_BUCKET?: string; AUDIT_RETENTION_DAYS: number; AUDIT_PURGE_WITHOUT_ARCHIVE: boolean };
    const events = s.get(EventsService);
    const retention = s.get(RetentionService);
    const marker = await events.audit({ action: 'it.retention_marker', status: 200 });
    // "Now" is set so the marker and everything before it are past retention.
    const now = new Date(marker.at.getTime() + cfg.AUDIT_RETENTION_DAYS * 86_400_000 + 1);
    const before = await s.prisma.auditLog.count({ where: { at: { lte: marker.at } } });

    const kept = await retention.purgeAudit(now);
    expect(kept.deleted).toBe(0);
    expect(await s.prisma.auditLog.count({ where: { id: marker.id } })).toBe(1);

    const saved = cfg.AUDIT_ARCHIVE_BUCKET;
    cfg.AUDIT_ARCHIVE_BUCKET = 'prgd-audit-archive-it';
    try {
      const done = await retention.purgeAudit(now);
      expect(done.deleted).toBe(before);
      expect(done.archived).toBe(before);
      expect(await s.prisma.auditLog.count({ where: { id: marker.id } })).toBe(0);
      const storage = s.api.get(OBJECT_STORAGE_PROVIDER) as FakeObjectStorage;
      const objects = [...storage.buckets.get('prgd-audit-archive-it')!.objects.entries()].filter(([k]) => done.archives.includes(k));
      const lines = objects.flatMap(([, o]) => gunzipSync(o.body).toString('utf8').trim().split('\n'));
      expect(lines).toHaveLength(before);
      expect(lines.some((l) => JSON.parse(l).id === marker.id)).toBe(true);
      expect(JSON.parse(lines[0]).hash).toBeTruthy();
    } finally {
      cfg.AUDIT_ARCHIVE_BUCKET = saved;
    }
    // The purge itself is recorded, and the remaining chain still verifies from its new anchor.
    expect(await s.prisma.auditLog.count({ where: { action: 'audit.purged' } })).toBeGreaterThan(0);
    expect((await verifyAuditChain(s.prisma)).ok).toBe(true);
  });

  it('purges old webhook deliveries and expired sessions', async () => {
    const t = await signup(s);
    const old = new Date(Date.now() - 200 * 86_400_000);
    const session = await s.prisma.session.create({ data: { userId: t.userId, expiresAt: old, createdAt: old } });
    const r = await s.get(RetentionService).purgeOperational();
    expect(r.sessions).toBeGreaterThan(0);
    expect(await s.prisma.session.count({ where: { id: session.id } })).toBe(0);
    // The live session of the account is untouched.
    expect((await t.client.get('/v1/account')).status).toBe(200);
  });
});

describe('account deletion', () => {
  it('anonymises the account after the password and TOTP, revokes access and records user.deleted', async () => {
    const t = await signup(s);
    const c = t.client;
    await c.ok('POST', '/v1/ssh-keys', { name: 'laptop', publicKey: sshPublicKey() }, 201);
    const token = await c.ok('POST', '/v1/tokens', { name: 'ci', scopes: ['servers:read'] }, [200, 201]);
    const secret = await enableTotp(t);

    expect((await c.req('DELETE', '/v1/account', { password: 'wrong' })).status).toBe(401);
    const noCode = await c.req('DELETE', '/v1/account', { password: t.password });
    expect(noCode.status).toBe(401);
    expect(noCode.body.error.code).toBe('totp_required');
    // API tokens cannot delete the account.
    expect((await c.req('DELETE', '/v1/account', { password: t.password, totp: totp(secret) }, { token: token.token })).status).toBe(403);

    const done = await c.ok('DELETE', '/v1/account', { password: t.password, totp: totp(secret) }, 200);
    expect(done.deleted).toBe(true);
    expect(done.closedTeams).toEqual([t.teamId]);

    const user = await s.prisma.user.findUniqueOrThrow({ where: { id: t.userId } });
    expect(user.email).toBe(`deleted+${t.userId}@invalid`);
    expect(user.name).toBe('');
    expect(user.passwordHash).toBeNull();
    expect(user.totpSecret).toBeNull();
    expect(await s.prisma.sshKey.count({ where: { userId: t.userId } })).toBe(0);
    expect(await s.prisma.session.count({ where: { userId: t.userId, revokedAt: null } })).toBe(0);
    expect(await s.prisma.apiToken.count({ where: { userId: t.userId, revokedAt: null } })).toBe(0);
    expect((await s.prisma.team.findUniqueOrThrow({ where: { id: t.teamId } })).status).toBe('closed');
    expect(await s.prisma.auditLog.count({ where: { action: 'user.deleted', resource: `user:${t.userId}` } })).toBe(1);

    expect((await c.get('/v1/account')).status).toBe(401);
    expect((await c.get('/v1/account', { token: token.token })).status).toBe(401);
    expect((await new Client(s.baseUrl).post('/v1/auth/login', { email: t.email, password: t.password })).status).toBe(401);
  });

  it('refuses while the user is the only owner of a team with resources', async () => {
    const t = await readyTeam(s);
    await t.client.ok('POST', '/v1/storage-keys', { name: 'x' }, 201);
    await t.client.ok('POST', '/v1/buckets', { name: `del-${randomBytes(4).toString('hex')}` }, 201);
    const r = await t.client.req('DELETE', '/v1/account', { password: t.password });
    expect(r.status).toBe(409);
    expect(r.text).toContain('sole_owner');
    expect((await s.prisma.user.findUniqueOrThrow({ where: { id: t.userId } })).email).toBe(t.email);
  });
});
