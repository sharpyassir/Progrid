import { beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { Client, readyTeam, signup, sut, topUp, waitFor, waitStatus, type Sut, type Team } from './harness';

/**
 * Tenant isolation: another team never sees or touches a team's resources (404, never 403, so
 * ids do not leak), a token limited to one project never reaches another project's resources,
 * SSH keys are managed by their owner (and team owners/admins), and approvals are decided by a
 * person in the console or by a token holding approvals:write.
 */

let s: Sut;
beforeAll(async () => {
  s = await sut();
});

/** A fresh OpenSSH ed25519 public key line. */
function sshPublicKey() {
  const der = generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' });
  const raw = der.subarray(der.length - 32);
  const str = (b: Buffer) => Buffer.concat([Buffer.from([0, 0, 0, b.length]), b]);
  return `ssh-ed25519 ${Buffer.concat([str(Buffer.from('ssh-ed25519')), str(raw)]).toString('base64')} it@test`;
}

async function server(c: Client, name: string, extra: Record<string, unknown> = {}) {
  const r = await c.ok('POST', '/v1/servers', { name, size: 's-1vcpu-2gb', image: 'ubuntu-24-04', ...extra }, 202);
  return waitStatus<any>(c, `/v1/servers/${r.id}${extra.project ? `?project=${extra.project}` : ''}`, 'active');
}

async function snapshot(c: Client, serverId: string, name: string, project?: string) {
  await c.ok('POST', `/v1/servers/${serverId}/actions`, { type: 'snapshot', name }, 202);
  return waitFor(async () => (await c.ok('GET', `/v1/snapshots${project ? `?project=${project}` : ''}`)).data.find((x: { name: string; status: string }) => x.name === name && x.status === 'available'), { what: `snapshot ${name} to be available` });
}

async function token(c: Client, body: Record<string, unknown>) {
  const t = await c.ok('POST', '/v1/tokens', { name: `it-${randomBytes(3).toString('hex')}`, ...body }, 201);
  return new Client(c.baseUrl, t.token);
}

/** A second user moved into the team with `role`, signed in to it. */
async function member(team: Team, role: 'member' | 'readonly' | 'admin') {
  const m = await signup(s);
  await s.prisma.teamMember.deleteMany({ where: { userId: m.userId } });
  await s.prisma.teamMember.create({ data: { teamId: team.teamId, userId: m.userId, role } });
  const client = new Client(s.baseUrl);
  client.token = (await client.ok('POST', '/v1/auth/login', { email: m.email, password: m.password }, 200)).session;
  return { client, userId: m.userId };
}

/** Parks a servers:delete request from an agent token and returns the pending approval id. */
async function pendingApproval(owner: Team, serverId: string) {
  const agent = await token(owner.client, { scopes: ['servers:read', 'servers:write', 'servers:delete'], isAgent: true, requireApprovalFor: ['servers:delete'] });
  const r = await agent.del(`/v1/servers/${serverId}`);
  expect(r.status).toBe(403);
  expect(r.body.error.code).toBe('approval_required');
  return r.body.error.details.approvalId as string;
}

describe('stranger team', () => {
  let owner: Team;
  let stranger: Team;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    owner = await readyTeam(s);
    stranger = await signup(s);
    const c = owner.client;
    const tag = randomBytes(4).toString('hex');
    const srv = await server(c, 'iso-web');
    ids.server = srv.id;
    ids.snapshot = (await snapshot(c, srv.id, `iso-snap-${tag}`)).id;
    ids.volume = (await c.ok('POST', '/v1/volumes', { name: 'iso-data', sizeGb: 10 }, 202)).id;
    ids.firewall = (await c.ok('POST', '/v1/firewalls', { name: 'iso-fw', rules: [{ direction: 'inbound', protocol: 'tcp', ports: '22', cidrs: ['0.0.0.0/0'] }] }, 201)).id;
    ids.domain = (await c.ok('POST', '/v1/domains', { name: `iso-${tag}.example.com` }, 201)).name;
    ids.bucket = (await c.ok('POST', '/v1/buckets', { name: `iso-${tag}` }, 201)).name;
    ids.database = (await c.ok('POST', '/v1/databases', { name: 'iso-db', engine: 'postgres', size: 's-1vcpu-2gb' }, 202)).id;
    ids.invoice = (await s.prisma.invoice.create({ data: { teamId: owner.teamId, number: `IT-${randomBytes(4).toString('hex')}`, currency: 'SAR', periodStart: new Date('2026-08-01'), periodEnd: new Date('2026-09-01'), subtotalMinor: 1000, totalMinor: 1150, status: 'open' } })).id;
    ids.approval = await pendingApproval(owner, srv.id);
    ids.sshKey = (await c.ok('POST', '/v1/ssh-keys', { name: 'laptop', publicKey: sshPublicKey() }, 201)).id;
  });

  const cases: [string, string, (i: Record<string, string>) => string][] = [
    ['server', 'GET', (i) => `/v1/servers/${i.server}`],
    ['server', 'DELETE', (i) => `/v1/servers/${i.server}`],
    ['volume', 'GET', (i) => `/v1/volumes/${i.volume}`],
    ['volume', 'DELETE', (i) => `/v1/volumes/${i.volume}`],
    ['snapshot', 'DELETE', (i) => `/v1/snapshots/${i.snapshot}`],
    ['firewall', 'GET', (i) => `/v1/firewalls/${i.firewall}`],
    ['firewall', 'DELETE', (i) => `/v1/firewalls/${i.firewall}`],
    ['domain', 'GET', (i) => `/v1/domains/${i.domain}`],
    ['domain', 'DELETE', (i) => `/v1/domains/${i.domain}`],
    ['bucket', 'GET', (i) => `/v1/buckets/${i.bucket}`],
    ['bucket', 'DELETE', (i) => `/v1/buckets/${i.bucket}`],
    ['database', 'GET', (i) => `/v1/databases/${i.database}`],
    ['database', 'DELETE', (i) => `/v1/databases/${i.database}`],
    ['invoice', 'GET', (i) => `/v1/billing/invoices/${i.invoice}`],
    ['approval', 'GET', (i) => `/v1/approvals/${i.approval}`],
    ['approval', 'POST', (i) => `/v1/approvals/${i.approval}/approve`],
    ['ssh key', 'DELETE', (i) => `/v1/ssh-keys/${i.sshKey}`],
  ];

  it.each(cases)('answers 404 for %s %s', async (_what, method, path) => {
    const r = await stranger.client.req(method, path(ids), method === 'POST' ? {} : undefined);
    expect(r.status, r.text).toBe(404);
  });

  it('lists none of the team resources to the stranger', async () => {
    const c = stranger.client;
    expect((await c.ok('GET', '/v1/servers')).data.map((x: { id: string }) => x.id)).not.toContain(ids.server);
    expect((await c.ok('GET', '/v1/ssh-keys')).data.map((x: { id: string }) => x.id)).not.toContain(ids.sshKey);
    expect((await c.ok('GET', '/v1/approvals')).data.map((x: { id: string }) => x.id)).not.toContain(ids.approval);
    // And everything is still there for the owner.
    expect((await owner.client.get(`/v1/servers/${ids.server}`)).status).toBe(200);
    expect((await owner.client.get(`/v1/approvals/${ids.approval}`)).body.status).toBe('pending');
  });

  it('cannot create a server from the team snapshot', async () => {
    await topUp(s, stranger);
    const r = await stranger.client.post('/v1/servers', { name: 'steal', size: 's-1vcpu-2gb', snapshotId: ids.snapshot });
    expect(r.status, r.text).toBe(404);
  });
});

describe('project scoped token', () => {
  let team: Team;
  let scoped: Client;
  let projectB: { id: string; slug: string };
  let serverA: any;
  let serverB: any;
  let snapB: any;
  let deployB: any;
  let firewallA: any;

  beforeAll(async () => {
    team = await readyTeam(s);
    const c = team.client;
    projectB = await c.ok('POST', '/v1/projects', { name: 'Project B', slug: 'proj-b' }, 201);
    serverA = await server(c, 'a-web');
    serverB = await server(c, 'b-web', { project: projectB.id });
    snapB = await snapshot(c, serverB.id, 'b-snap', projectB.id);
    deployB = await c.ok('POST', '/v1/deploys', { repoUrl: 'https://github.com/example/app', project: projectB.id, name: 'b-app' }, 202);
    firewallA = await c.ok('POST', '/v1/firewalls', { name: 'a-fw', rules: [{ direction: 'inbound', protocol: 'tcp', ports: '22', cidrs: ['0.0.0.0/0'] }] }, 201);
    // Project A is the default project.
    scoped = await token(c, { scopes: ['servers:read', 'servers:write', 'servers:delete', 'snapshots:read', 'snapshots:write', 'volumes:read', 'network:read', 'network:write'], projectId: team.projectId });
  });

  it('sees its own project', async () => {
    expect((await scoped.get(`/v1/servers/${serverA.id}`)).status).toBe(200);
  });

  it('cannot read or act on the other project servers', async () => {
    expect((await scoped.get(`/v1/servers/${serverB.id}`)).status).toBe(404);
    expect((await scoped.get(`/v1/servers?project=${projectB.id}`)).status).toBe(403);
    expect((await scoped.del(`/v1/servers/${serverB.id}`)).status).toBe(404);
    expect((await scoped.post(`/v1/servers/${serverB.id}/actions`, { type: 'reboot' })).status).toBe(404);
    expect((await scoped.del(`/v1/snapshots/${snapB.id}`)).status).toBe(404);
  });

  it('cannot reach the other project Git deployments', async () => {
    expect((await team.client.get(`/v1/deploys/${deployB.id}`)).status).toBe(200);
    expect((await scoped.get(`/v1/deploys/${deployB.id}`)).status).toBe(404);
    expect((await scoped.get(`/v1/deploys/${deployB.id}/logs`)).status).toBe(404);
    expect((await scoped.post(`/v1/deploys/${deployB.id}/redeploy`)).status).toBe(404);
  });

  it('cannot clone a server from the other project snapshot', async () => {
    const r = await scoped.post('/v1/servers', { name: 'clone', size: 's-1vcpu-2gb', snapshotId: snapB.id });
    expect(r.status, r.text).toBe(404);
  });

  it('cannot point an alert policy at the other project servers', async () => {
    const policy = { name: 'cpu', metric: 'cpu', threshold: 90 };
    expect((await scoped.post('/v1/alerts', { ...policy, serverIds: [serverB.id] })).status).toBe(422);
    // A team wide policy would cover project B too.
    expect((await scoped.post('/v1/alerts', policy)).status).toBe(403);
    expect((await scoped.post('/v1/alerts', { ...policy, serverIds: [serverA.id] })).status).toBe(201);
  });

  it('cannot push firewall rules onto a server outside the firewall project', async () => {
    expect((await team.client.req('DELETE', `/v1/firewalls/${firewallA.id}/servers/${serverB.id}`)).status).toBe(404);
    expect((await scoped.req('DELETE', `/v1/firewalls/${firewallA.id}/servers/${serverB.id}`)).status).toBe(404);
  });

  it('cannot see or decide the other project approvals', async () => {
    const approvalB = await pendingApproval(team, serverB.id);
    const decider = await token(team.client, { scopes: ['servers:read', 'servers:delete', 'approvals:write'], projectId: team.projectId });
    expect((await decider.get(`/v1/approvals/${approvalB}`)).status).toBe(404);
    expect((await decider.post(`/v1/approvals/${approvalB}/approve`)).status).toBe(404);
    expect((await team.client.get(`/v1/approvals/${approvalB}`)).body.status).toBe('pending');
  });
});

describe('SSH keys', () => {
  let owner: Team;

  beforeAll(async () => {
    owner = await readyTeam(s);
  });

  it('lets a member manage only their own keys, and owners the team members keys', async () => {
    const a = await member(owner, 'member');
    const b = await member(owner, 'member');
    const keyA = await a.client.ok('POST', '/v1/ssh-keys', { name: 'a-laptop', publicKey: sshPublicKey() }, 201);
    const keyB = await b.client.ok('POST', '/v1/ssh-keys', { name: 'b-laptop', publicKey: sshPublicKey() }, 201);

    // B neither sees nor deletes A's key.
    expect((await b.client.ok('GET', '/v1/ssh-keys')).data.map((k: { id: string }) => k.id)).toEqual([keyB.id]);
    expect((await b.client.del(`/v1/ssh-keys/${keyA.id}`)).status).toBe(404);
    expect(await s.prisma.sshKey.count({ where: { id: keyA.id } })).toBe(1);

    // The owner sees both and may remove a member's key.
    const ownerView = (await owner.client.ok('GET', '/v1/ssh-keys')).data.map((k: { id: string }) => k.id);
    expect(ownerView).toEqual(expect.arrayContaining([keyA.id, keyB.id]));
    await owner.client.ok('DELETE', `/v1/ssh-keys/${keyA.id}`, undefined, 204);
    // B removes their own.
    await b.client.ok('DELETE', `/v1/ssh-keys/${keyB.id}`, undefined, 204);
  });

  it('refuses readonly members and agent tokens', async () => {
    const ro = await member(owner, 'readonly');
    expect((await ro.client.post('/v1/ssh-keys', { name: 'ro', publicKey: sshPublicKey() })).status).toBe(403);
    expect((await ro.client.get('/v1/ssh-keys')).status).toBe(200);

    const own = await owner.client.ok('POST', '/v1/ssh-keys', { name: 'owner', publicKey: sshPublicKey() }, 201);
    const agent = await token(owner.client, { scopes: ['servers:read', 'servers:write'], isAgent: true });
    expect((await agent.post('/v1/ssh-keys', { name: 'agent', publicKey: sshPublicKey() })).status).toBe(403);
    expect((await agent.del(`/v1/ssh-keys/${own.id}`)).status).toBe(403);
    // Agents may still list keys to put on new servers.
    expect((await agent.ok('GET', '/v1/ssh-keys')).data.map((k: { id: string }) => k.id)).toContain(own.id);
  });
});

describe('approvals', () => {
  let owner: Team;
  let srv: any;

  beforeAll(async () => {
    owner = await readyTeam(s);
    srv = await server(owner.client, 'appr-web');
  });

  it('refuses an API token without approvals:write', async () => {
    const id = await pendingApproval(owner, srv.id);
    const plain = await token(owner.client, { scopes: ['servers:read', 'servers:write', 'servers:delete'] });
    expect((await plain.post(`/v1/approvals/${id}/approve`)).status).toBe(403);
    expect((await plain.post(`/v1/approvals/${id}/deny`, {})).status).toBe(403);
    // approvals:write without the scope the action needs is not enough either.
    const narrow = await token(owner.client, { scopes: ['servers:read', 'approvals:write'] });
    expect((await narrow.post(`/v1/approvals/${id}/approve`)).status).toBe(403);
    expect((await owner.client.get(`/v1/approvals/${id}`)).body.status).toBe('pending');
    // Agents never decide, whatever their scopes.
    const agent = await token(owner.client, { scopes: ['servers:read', 'servers:delete', 'approvals:write'], isAgent: true });
    expect((await agent.post(`/v1/approvals/${id}/approve`)).status).toBe(403);
    // A token with approvals:write and the action's scope decides.
    const decider = await token(owner.client, { scopes: ['servers:read', 'servers:delete', 'approvals:write'] });
    const done = await decider.ok('POST', `/v1/approvals/${id}/approve`, {}, [200, 201]);
    expect(done.status).toBe('approved');
  });
});

describe('private images', () => {
  it('are refused on create for customers', async () => {
    const t = await readyTeam(s);
    const base = await s.prisma.image.findUniqueOrThrow({ where: { id: 'ubuntu-24-04' } });
    const id = `it-private-${randomBytes(3).toString('hex')}`;
    await s.prisma.image.create({ data: { id, kind: base.kind, name: 'private', distribution: base.distribution, version: base.version, driverRef: base.driverRef, public: false } });
    const r = await t.client.post('/v1/servers', { name: 'priv', size: 's-1vcpu-2gb', image: id });
    expect(r.status, r.text).toBe(422);
  });
});
