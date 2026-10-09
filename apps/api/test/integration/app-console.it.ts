import { beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { AppPlatformService } from '../../src/modules/app-platform/app.service';
import { Client, readyTeam, signup, sut, waitFor, waitStatus, type Sut, type Team } from './harness';

/**
 * App Platform console features: the pre-deploy command, one off commands in a container from
 * the live image (runs), and managed databases attached to an app. The fake app host simulates
 * pre-deploy commands containing "fail" as exiting 1, runs printing "ran: <command>", "exit 3"
 * exiting 3 and "sleep" running until canceled or timed out.
 */

let s: Sut;
beforeAll(async () => {
  s = await sut();
});

const tag = () => randomBytes(3).toString('hex');

async function liveApp(c: Client, body: Record<string, unknown> = {}) {
  const created = await c.ok('POST', '/v1/app-platform/apps', { name: `con-${tag()}`, repoUrl: 'https://github.com/example/hello-prisma', ...body }, 202);
  return waitStatus<any>(c, `/v1/app-platform/apps/${created.id}`, 'live', 120_000);
}

/** Waits for the newest deploy to finish and returns the app. */
async function settled(c: Client, id: string, deploys: number) {
  return waitFor(async () => {
    const r = await c.ok('GET', `/v1/app-platform/apps/${id}`);
    return r.deploys.length >= deploys && ['live', 'failed'].includes(r.deploys[0].status) && ['live', 'failed', 'stopped'].includes(r.status) ? r : null;
  }, { what: `deploy ${deploys} of ${id} to finish`, timeoutMs: 90_000 });
}

async function hostOf(appId: string) {
  const row = await s.prisma.platformApp.findUniqueOrThrow({ where: { id: appId }, include: { host: { include: { server: { include: { publicIps: true } } } } } });
  return { serverId: row.host!.serverId, ip: row.host!.server.publicIps[0].address };
}

async function pushed(appId: string) {
  const node = await s.agents.inspect((await hostOf(appId)).serverId);
  return node!.last!.apps.find((x: { id: string }) => x.id === appId);
}

async function finished(c: Client, appId: string, runId: string) {
  return waitFor(async () => {
    const r = await c.ok('GET', `/v1/app-platform/apps/${appId}/runs/${runId}`);
    return ['queued', 'running'].includes(r.status) ? null : r;
  }, { what: `run ${runId} to finish`, timeoutMs: 20_000 });
}

async function token(c: Client, body: Record<string, unknown>) {
  const t = await c.ok('POST', '/v1/tokens', { name: `it-${tag()}`, ...body }, 201);
  return new Client(c.baseUrl, t.token);
}

async function member(team: Team, role: 'member' | 'readonly') {
  const m = await signup(s);
  await s.prisma.teamMember.deleteMany({ where: { userId: m.userId } });
  await s.prisma.teamMember.create({ data: { teamId: team.teamId, userId: m.userId, role } });
  const client = new Client(s.baseUrl);
  client.token = (await client.ok('POST', '/v1/auth/login', { email: m.email, password: m.password }, 200)).session;
  return client;
}

describe('pre-deploy command', () => {
  it('runs before the new version goes live, and a failure keeps the running version', async () => {
    const c = (await readyTeam(s)).client;
    expect((await c.post('/v1/app-platform/apps', { name: `con-${tag()}`, repoUrl: 'https://github.com/example/x', preDeployCommand: 'x'.repeat(1001) })).status).toBe(400);

    const app = await liveApp(c, { preDeployCommand: 'npx prisma migrate deploy' });
    expect(app.preDeployCommand).toBe('npx prisma migrate deploy');
    expect((await pushed(app.id)).preDeploy).toBe('npx prisma migrate deploy');
    const log = (await c.ok('GET', `/v1/app-platform/apps/${app.id}/logs?type=build`)).log as string;
    expect(log).toContain('=== pre-deploy: npx prisma migrate deploy ===');
    expect(log).toContain('=== pre-deploy exited 0 ===');
    expect(log.indexOf('=== pre-deploy exited 0 ===')).toBeLessThan(log.indexOf('=== live ==='));

    // A failing command fails the deploy; the version from before keeps serving.
    await c.ok('PATCH', `/v1/app-platform/apps/${app.id}`, { preDeployCommand: 'npx prisma migrate deploy && fail' }, 202);
    const after = await settled(c, app.id, 2);
    expect(after.deploys[0].status).toBe('failed');
    expect(after.deploys[1].status).toBe('live');
    expect(after.status).toBe('live');
    expect(after.statusMessage).toContain('pre-deploy command failed (exit 1)');
    const failedLog = (await c.ok('GET', `/v1/app-platform/apps/${app.id}/logs?type=build`)).log as string;
    expect(failedLog).toContain('=== pre-deploy exited 1 ===');
    expect(failedLog).not.toContain('=== live ===');
    const node = await s.agents.inspect((await hostOf(app.id)).serverId);
    expect(node!.st.caddySites.map((x: { app: string }) => x.app)).toContain(app.id);

    // An empty string removes the command.
    await c.ok('PATCH', `/v1/app-platform/apps/${app.id}`, { preDeployCommand: '' }, 202);
    const cleared = await settled(c, app.id, 3);
    expect(cleared.preDeployCommand).toBeNull();
    expect(cleared.deploys[0].status).toBe('live');
    expect(cleared.statusMessage).toBeNull();
    expect((await pushed(app.id)).preDeploy).toBeNull();
  });
});

describe('console runs', () => {
  let owner: Team;
  let app: any;

  beforeAll(async () => {
    owner = await readyTeam(s);
    app = await liveApp(owner.client);
  });

  it('runs a command to its end, with output, exit code and audit records', async () => {
    const c = owner.client;
    const base = `/v1/app-platform/apps/${app.id}/runs`;
    expect((await c.post(base, { command: '' })).status).toBe(400);
    expect((await c.post(base, { command: 'ls', timeoutSeconds: 10 })).status).toBe(400);
    expect((await c.post(base, { command: 'ls', timeoutSeconds: 3601 })).status).toBe(400);

    const started = await c.ok('POST', base, { command: 'npx prisma migrate status' }, 202);
    expect(started).toMatchObject({ status: 'running', command: 'npx prisma migrate status', timeoutSeconds: 600, exitCode: null });
    const ok = await finished(c, app.id, started.id);
    expect(ok).toMatchObject({ status: 'succeeded', exitCode: 0, output: 'ran: npx prisma migrate status\n' });
    expect(ok.durationMs).toBeGreaterThanOrEqual(0);

    const bad = await finished(c, app.id, (await c.ok('POST', base, { command: 'node -e "process.exit(1)"; exit 3' }, 202)).id);
    expect(bad).toMatchObject({ status: 'failed', exitCode: 3 });

    const list = await c.ok('GET', base);
    expect(list.data.map((r: { id: string }) => r.id)).toEqual([bad.id, ok.id]);
    expect(list.data[0].output).toBeUndefined();

    const audit = await s.prisma.auditLog.findMany({ where: { resource: `app:${app.id}`, action: { startsWith: 'app.run_' } }, orderBy: { seq: 'asc' }, omit: { seq: true } });
    const started1 = audit.find((a) => a.action === 'app.run_started' && (a.request as any).runId === ok.id)!;
    expect((started1.request as any).command).toBe('npx prisma migrate status');
    expect(started1.userId).toBe(owner.userId);
    const fin = audit.filter((a) => a.action === 'app.run_finished').map((a) => a.request as any);
    expect(fin).toEqual(expect.arrayContaining([expect.objectContaining({ runId: ok.id, status: 'succeeded', exitCode: 0 }), expect.objectContaining({ runId: bad.id, status: 'failed', exitCode: 3 })]));
  });

  it('cancels, times out, caps concurrency and folds results nobody polled', async () => {
    const c = owner.client;
    const base = `/v1/app-platform/apps/${app.id}/runs`;
    const a = await c.ok('POST', base, { command: 'sleep 100' }, 202);
    const b = await c.ok('POST', base, { command: 'sleep 200', timeoutSeconds: 30 }, 202);
    const third = await c.post(base, { command: 'echo three' });
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe('run_limit');
    expect((await c.ok('GET', `${base}/${a.id}`)).status).toBe('running');

    const canceled = await c.ok('POST', `${base}/${a.id}/cancel`, {}, 200);
    expect(canceled.status).toBe('canceled');
    expect(canceled.finishedAt).not.toBeNull();
    // Canceling again changes nothing.
    expect((await c.ok('POST', `${base}/${a.id}/cancel`, {}, 200)).status).toBe('canceled');

    await s.agents.expireRuns((await hostOf(app.id)).serverId);
    expect(await finished(c, app.id, b.id)).toMatchObject({ status: 'timed_out', exitCode: 137 });

    // Nobody asks for this one: the minute job records the result from the host's status.
    const quiet = await c.ok('POST', base, { command: 'npx prisma db seed' }, 202);
    await new Promise((r) => setTimeout(r, 600));
    await s.get(AppPlatformService).refreshAll();
    const row = await s.prisma.appRun.findUniqueOrThrow({ where: { id: quiet.id } });
    expect(row).toMatchObject({ status: 'succeeded', exitCode: 0, output: 'ran: npx prisma db seed\n' });

    const audit = await s.prisma.auditLog.findMany({ where: { resource: `app:${app.id}`, action: 'app.run_canceled' }, omit: { seq: true } });
    expect(audit.map((x) => (x.request as any).runId)).toEqual([a.id]);
  });

  it('keeps runs to the team and the project, and asks a person before an agent runs a command', async () => {
    const base = `/v1/app-platform/apps/${app.id}/runs`;
    const run = await owner.client.ok('POST', base, { command: 'echo hi' }, 202);

    const ro = await member(owner, 'readonly');
    expect((await ro.get(base)).status).toBe(200);
    expect((await ro.get(`${base}/${run.id}`)).status).toBe(200);
    expect((await ro.post(base, { command: 'echo no' })).status).toBe(403);
    expect((await ro.post(`${base}/${run.id}/cancel`)).status).toBe(403);

    const stranger = (await signup(s)).client;
    expect((await stranger.get(base)).status).toBe(404);
    expect((await stranger.get(`${base}/${run.id}`)).status).toBe(404);
    expect((await stranger.post(base, { command: 'echo no' })).status).toBe(404);

    // A token limited to another project never reaches this app.
    const other = await owner.client.ok('POST', '/v1/projects', { name: 'Other', slug: `other-${tag()}` }, 201);
    const scoped = await token(owner.client, { scopes: ['apps:read', 'apps:write'], projectId: other.id });
    expect((await scoped.get(base)).status).toBe(403);
    expect((await scoped.post(base, { command: 'echo no' })).status).toBe(403);
    expect((await scoped.get(`${base}/${run.id}?project=${app.projectId}`)).status).toBe(403);

    // A run from the wrong app is not found.
    const app2 = await liveApp(owner.client);
    expect((await owner.client.get(`/v1/app-platform/apps/${app2.id}/runs/${run.id}`)).status).toBe(404);

    // Agent tokens park the run for approval; once a person approves, it runs with the token recorded.
    const agent = await token(owner.client, { scopes: ['apps:read', 'apps:write'], isAgent: true });
    const parked = await agent.post(base, { command: 'npx prisma migrate deploy' });
    expect(parked.status).toBe(403);
    expect(parked.body.error.code).toBe('approval_required');
    const approvalId = parked.body.error.details.approvalId;
    expect(await s.prisma.appRun.count({ where: { appId: app.id, command: 'npx prisma migrate deploy' } })).toBe(0);
    const approved = await owner.client.ok('POST', `/v1/approvals/${approvalId}/approve`, {}, [200, 201]);
    expect(approved.status).toBe('approved');
    const agentRun = await s.prisma.appRun.findFirstOrThrow({ where: { appId: app.id, command: 'npx prisma migrate deploy' } });
    expect(agentRun.tokenId).not.toBeNull();
    expect(agentRun.userId).toBe(owner.userId);
    expect((await finished(owner.client, app.id, agentRun.id)).status).toBe('succeeded');
  });

  it('refuses apps without a live image', async () => {
    const c = owner.client;
    const created = await c.ok('POST', '/v1/app-platform/apps', { name: `bad-${tag()}`, repoUrl: 'https://github.com/example/broken-app' }, 202);
    await waitFor(async () => (await c.ok('GET', `/v1/app-platform/apps/${created.id}`)).status === 'failed', { what: 'the first build to fail', timeoutMs: 120_000 });
    const r = await c.post(`/v1/app-platform/apps/${created.id}/runs`, { command: 'ls' });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toContain('no live image');
  });
});

describe('attached databases', () => {
  it('attaches a managed Postgres: user, database, URL in the environment and the host in the trusted sources', async () => {
    const owner = await readyTeam(s);
    const c = owner.client;
    const customer = '203.0.113.0/24';
    const dbCreated = await c.ok('POST', '/v1/databases', { name: `pg-${tag()}`, engine: 'postgres', size: 's-1vcpu-2gb', trustedSources: [customer] }, 202);
    const app = await liveApp(c, { env: { NODE_ENV: 'production' } });
    const db = await waitStatus<any>(c, `/v1/databases/${dbCreated.id}`, 'active', 150_000);
    const slug = `app_${app.name.replace(/-/g, '_')}`;
    const { ip: hostIp } = await hostOf(app.id);

    expect((await c.post(`/v1/app-platform/apps/${app.id}/databases`, { databaseId: db.id, envName: 'lower' })).status).toBe(400);
    expect((await c.post(`/v1/app-platform/apps/${app.id}/databases`, { databaseId: 'nope' })).status).toBe(404);

    const link = await c.ok('POST', `/v1/app-platform/apps/${app.id}/databases`, { databaseId: db.id }, 201);
    expect(link).toMatchObject({ databaseId: db.id, databaseName: db.name, engine: 'postgres', envName: 'DATABASE_URL', dbName: slug, dbUser: slug });
    expect(JSON.stringify(link)).not.toContain('password');
    const listed = await c.ok('GET', `/v1/app-platform/apps/${app.id}/databases`);
    expect(listed.data).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toMatch(/postgresql:\/\//);

    // The attach deployed again with the URL in the environment; it is never stored with the variables.
    const live = await settled(c, app.id, 2);
    expect(live.deploys[0].status).toBe('live');
    expect(live.env).toEqual({ NODE_ENV: 'production' });
    const env = (await pushed(app.id)).env;
    const url = new URL(env.DATABASE_URL);
    expect(url.protocol).toBe('postgresql:');
    expect(url.hostname).toBe(db.connection.host);
    expect(url.port).toBe('5432');
    expect(url.pathname).toBe(`/${slug}`);
    expect(url.username).toBe(slug);
    expect(url.searchParams.get('sslmode')).toBe('require');
    expect(decodeURIComponent(url.password).length).toBeGreaterThan(10);
    expect(env.NODE_ENV).toBe('production');

    const creds = await c.ok('GET', `/v1/app-platform/apps/${app.id}/databases/${link.id}/credentials`);
    expect(creds.url).toBe(env.DATABASE_URL);
    expect(await s.prisma.auditLog.count({ where: { resource: `app:${app.id}`, action: 'app.database_credentials_viewed' } })).toBe(1);
    const ro = await member(owner, 'readonly');
    expect((await ro.get(`/v1/app-platform/apps/${app.id}/databases`)).status).toBe(200);
    expect((await ro.get(`/v1/app-platform/apps/${app.id}/databases/${link.id}/credentials`)).status).toBe(403);
    expect((await (await signup(s)).client.get(`/v1/app-platform/apps/${app.id}/databases`)).status).toBe(404);

    // The cluster: the host's address next to the customer's own, the user and a database it owns.
    const cluster = await s.prisma.dbCluster.findUniqueOrThrow({ where: { id: db.id } });
    expect(cluster.trustedSources).toEqual([customer, `${hostIp}/32`]);
    expect(cluster.systemSources).toEqual([`${hostIp}/32`]);
    const shown = await waitStatus<any>(c, `/v1/databases/${db.id}`, 'active');
    expect(shown.appSources).toEqual([`${hostIp}/32`]);
    expect(shown.users.map((u: { name: string }) => u.name)).toContain(slug);
    expect(shown.databases.map((d: { name: string }) => d.name)).toContain(slug);
    const dbNode = await s.prisma.dbNode.findFirstOrThrow({ where: { clusterId: db.id } });
    const agent = (await s.agents.inspect(dbNode.serverId))!.last!;
    expect(agent.users.map((u: { name: string }) => u.name)).toContain(slug);
    expect(agent.owners).toEqual({ [slug]: slug });
    expect(agent.trustedSources).toEqual([customer, `${hostIp}/32`]);
    const fw = await s.prisma.firewallRule.findMany({ where: { firewallId: cluster.firewallId!, ports: '5432' } });
    expect(fw.some((r) => r.sources.includes(`${hostIp}/32`) && r.sources.includes(customer))).toBe(true);

    // The variable belongs to the database now.
    const clash = await c.patch(`/v1/app-platform/apps/${app.id}`, { env: { DATABASE_URL: 'postgresql://elsewhere' } });
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('env_conflict');
    const again = await c.post(`/v1/app-platform/apps/${app.id}/databases`, { databaseId: db.id });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('env_conflict');
    const withVar = await liveApp(c, { env: { DATABASE_URL: 'postgresql://mine' } });
    const taken = await c.post(`/v1/app-platform/apps/${withVar.id}/databases`, { databaseId: db.id });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('env_conflict');

    // The cluster cannot go while an app uses it.
    const del = await c.del(`/v1/databases/${db.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('database_in_use');

    // Detach: the variable, the user and the host's address go; the customer's CIDR and the data stay.
    await waitStatus(c, `/v1/databases/${db.id}`, 'active');
    expect((await c.ok('DELETE', `/v1/app-platform/apps/${app.id}/databases/${link.id}`, undefined, 200)).deleted).toBe(true);
    const detached = await settled(c, app.id, 3);
    expect(detached.deploys[0].status).toBe('live');
    expect((await pushed(app.id)).env.DATABASE_URL).toBeUndefined();
    const after = await s.prisma.dbCluster.findUniqueOrThrow({ where: { id: db.id }, include: { users: true, databases: true } });
    expect(after.trustedSources).toEqual([customer]);
    expect(after.systemSources).toEqual([]);
    expect(after.retiredUsers).toContain(slug);
    expect(after.users.map((u) => u.name)).not.toContain(slug);
    expect(after.databases.map((d) => d.name)).toContain(slug);
    const audit = await s.prisma.auditLog.findMany({ where: { resource: `app:${app.id}`, action: { in: ['app.database_attached', 'app.database_detached'] } }, orderBy: { seq: 'asc' }, omit: { seq: true } });
    expect(audit.map((a) => a.action)).toEqual(['app.database_attached', 'app.database_detached']);

    // Deleting the app removes its links, its user and the host's address.
    await waitStatus(c, `/v1/databases/${db.id}`, 'active');
    const second = await c.ok('POST', `/v1/app-platform/apps/${app.id}/databases`, { databaseId: db.id, envName: 'PRIMARY_DB_URL' }, 201);
    expect(second.dbUser).toBe(slug);
    expect(second.dbName).toBe(`${slug}_2`);
    expect((await s.prisma.dbCluster.findUniqueOrThrow({ where: { id: db.id } })).retiredUsers).not.toContain(slug);
    await settled(c, app.id, 4);
    expect((await pushed(app.id)).env.PRIMARY_DB_URL).toMatch(/^postgresql:\/\//);
    await c.ok('DELETE', `/v1/app-platform/apps/${app.id}`, undefined, 202);
    await waitFor(async () => (await c.get(`/v1/app-platform/apps/${app.id}`)).status === 404, { what: 'app to be deleted', timeoutMs: 60_000 });
    await waitFor(async () => (await s.prisma.appDatabaseLink.count({ where: { appId: app.id } })) === 0, { what: 'links to go', timeoutMs: 30_000 });
    const gone = await s.prisma.dbCluster.findUniqueOrThrow({ where: { id: db.id }, include: { users: true } });
    expect(gone.trustedSources).toEqual([customer]);
    expect(gone.systemSources).toEqual([]);
    expect(gone.users.map((u) => u.name)).not.toContain(slug);
    expect(gone.retiredUsers).toContain(slug);
  });

  it('only attaches databases of the app\'s own project', async () => {
    const owner = await readyTeam(s);
    const c = owner.client;
    const app = await liveApp(c);
    const other = await c.ok('POST', '/v1/projects', { name: 'Data', slug: `data-${tag()}` }, 201);
    const db = await c.ok('POST', '/v1/databases', { name: `pg-${tag()}`, engine: 'postgres', size: 's-1vcpu-2gb', project: other.id }, 202);
    const r = await c.post(`/v1/app-platform/apps/${app.id}/databases`, { databaseId: db.id });
    expect(r.status).toBe(404);
    // A token of the app's project cannot reach the other project's database either.
    const scoped = await token(c, { scopes: ['apps:read', 'apps:write', 'databases:read'], projectId: app.projectId });
    expect((await scoped.post(`/v1/app-platform/apps/${app.id}/databases`, { databaseId: db.id })).status).toBe(404);
    const stranger = await readyTeam(s);
    expect((await stranger.client.post(`/v1/app-platform/apps/${app.id}/databases`, { databaseId: db.id })).status).toBe(404);
  });
});
