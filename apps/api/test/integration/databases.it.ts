import { beforeAll, describe, expect, it } from 'vitest';
import { DatabasesService } from '../../src/modules/databases/db.service';
import { readyTeam, sut, waitFor, waitStatus, type Client, type Sut } from './harness';

let s: Sut;
beforeAll(async () => {
  s = await sut();
});

/** Creates a database and records every status and node state it passes through on the way to active. */
async function createDb(c: Client, body: Record<string, unknown>, timeoutMs = 150_000) {
  const created = await c.ok('POST', '/v1/databases', { size: 's-1vcpu-2gb', ...body }, 202);
  expect(created.status).toBe('creating');
  const seen: { status: string; applied: number[] }[] = [];
  const db = await waitFor(async () => {
    const r = await c.ok('GET', `/v1/databases/${created.id}`);
    seen.push({ status: r.status, applied: r.nodeStatus.map((n: { appliedVersion: number }) => n.appliedVersion) });
    if (r.status === 'failed') throw Object.assign(new Error(`database failed: ${r.statusMessage}`), { fatal: true });
    return r.status === 'active' ? r : null;
  }, { what: `database ${body.name} to be active`, timeoutMs, intervalMs: 1000 });
  return { db, seen };
}

describe('managed databases', () => {
  it('runs a one node Postgres: users, databases, a backup and a restore', async () => {
    const c = (await readyTeam(s)).client;
    const { db } = await createDb(c, { name: 'pg-one', engine: 'postgres' });
    expect(db.nodeStatus).toHaveLength(1);
    expect(db.nodeStatus[0].appliedVersion).toBe(db.configVersion);
    expect(db.connection.privateHost).toMatch(/^10\./);
    expect(db.connection.uri).toContain(`@${db.connection.host}:5432/defaultdb`);

    const user = await c.ok('POST', `/v1/databases/${db.id}/users`, { name: 'reporting' }, 201);
    expect(user.password.length).toBeGreaterThan(10);
    await c.ok('POST', `/v1/databases/${db.id}/dbs`, { name: 'analytics' }, 201);
    const updated = await waitStatus<any>(c, `/v1/databases/${db.id}`, 'active');
    expect(updated.users.map((u: { name: string }) => u.name)).toEqual(['app', 'reporting']);
    expect(updated.databases.map((d: { name: string }) => d.name)).toEqual(['defaultdb', 'analytics']);
    const node = await s.prisma.dbNode.findFirstOrThrow({ where: { clusterId: db.id } });
    const agent = await s.agents.inspect(node.serverId);
    expect(agent!.last!.users.map((u: { name: string }) => u.name)).toEqual(['app', 'reporting']);
    expect(agent!.last!.databases).toEqual(['defaultdb', 'analytics']);
    expect(agent!.st.version).toBe(updated.configVersion);

    // Backup: accepted by the primary, finished on the node, picked up by the minute job.
    const b = await c.ok('POST', `/v1/databases/${db.id}/backups`, {}, 202);
    expect(b.status).toBe('running');
    const dbs = s.get(DatabasesService);
    const done = await waitFor(async () => {
      await dbs.refreshAll();
      return (await c.ok('GET', `/v1/databases/${db.id}/backups`)).data.find((x: { id: string; status: string }) => x.id === b.id && x.status !== 'running');
    }, { what: 'backup to finish', timeoutMs: 30_000, intervalMs: 1000 });
    expect(done.status).toBe('completed');
    expect(done.ref).toMatch(/^\d{8}-\d{6}F$/);
    expect(done.sizeBytes).toBeGreaterThan(0);
    const refreshed = await c.ok('GET', `/v1/databases/${db.id}`);
    expect(refreshed.nodeStatus[0].role).toBe('primary');

    // Restore: the cluster is restoring until the node reports it done, then applies the config again.
    const r = await c.ok('POST', `/v1/databases/${db.id}/restore`, { backupId: b.id }, 202);
    expect(r.status).toBe('restoring');
    const restored = await waitStatus<any>(c, `/v1/databases/${db.id}`, 'active', 90_000);
    expect(restored.configVersion).toBeGreaterThan(updated.configVersion);
    const after = await s.agents.inspect(node.serverId);
    expect(after!.st.restore.status).toBe('completed');
    expect(after!.st.version).toBe(restored.configVersion);
  });

  it('runs a three node Postgres that is active only once every node applied', async () => {
    const c = (await readyTeam(s)).client;
    const { db, seen } = await createDb(c, { name: 'pg-ha', engine: 'postgres', nodes: 3 }, 180_000);
    expect(db.nodeStatus).toHaveLength(3);
    for (const n of db.nodeStatus) expect(n.appliedVersion).toBe(db.configVersion);
    // On the way there the nodes waited for a primary and for the users to exist (409), so for a
    // while some nodes had not applied the version while the cluster was still creating.
    expect(seen.some((x) => x.status === 'creating' && x.applied.length === 3 && x.applied.some((v) => v < db.configVersion))).toBe(true);
    expect(seen.filter((x) => x.status === 'active')).toHaveLength(1);

    // Roles from the nodes: one primary, two replicas, all on the private network.
    await s.get(DatabasesService).refreshAll();
    const now = await c.ok('GET', `/v1/databases/${db.id}`);
    expect(now.nodeStatus.map((n: { role: string }) => n.role).sort()).toEqual(['primary', 'replica', 'replica']);
    const nodes = await s.prisma.dbNode.findMany({ where: { clusterId: db.id }, include: { server: true }, orderBy: { index: 'asc' } });
    const agent = await s.agents.inspect(nodes[2].serverId);
    expect(agent!.last!.cluster.nodes.map((n: { ip: string }) => n.ip)).toEqual(nodes.map((n) => n.server.privateIp));

    // The primary's VM goes down: another node takes over, the event goes out and connections follow it.
    const primaryIndex = now.nodeStatus.find((n: { role: string }) => n.role === 'primary').index as number;
    const primaryServer = nodes[primaryIndex].serverId;
    await c.ok('POST', `/v1/servers/${primaryServer}/actions`, { type: 'stop' }, 202);
    await waitStatus(c, `/v1/servers/${primaryServer}`, 'off');
    await s.get(DatabasesService).refreshAll();
    const failed = await c.ok('GET', `/v1/databases/${db.id}`);
    const next = failed.nodeStatus.find((n: { role: string }) => n.role === 'primary');
    expect(next.index).not.toBe(primaryIndex);
    expect(failed.connection.privateHost).toBe(nodes[next.index].server.privateIp);
    const audit = await s.prisma.auditLog.findFirst({ where: { action: 'database.failover', request: { path: ['databaseId'], equals: db.id } } });
    expect(audit?.request).toMatchObject({ from: primaryIndex, to: next.index });
    // Backups go to the new primary.
    const b = await c.ok('POST', `/v1/databases/${db.id}/backups`, {}, 202);
    const done = await waitFor(async () => {
      await s.get(DatabasesService).refreshAll();
      return (await c.ok('GET', `/v1/databases/${db.id}/backups`)).data.find((x: { id: string; status: string }) => x.id === b.id && x.status !== 'running');
    }, { what: 'the backup on the new primary', timeoutMs: 30_000, intervalMs: 1000 });
    expect(done.status).toBe('completed');
    // Back up, it rejoins as a replica.
    await c.ok('POST', `/v1/servers/${primaryServer}/actions`, { type: 'start' }, 202);
    await waitStatus(c, `/v1/servers/${primaryServer}`, 'active');
    await waitFor(async () => {
      await s.get(DatabasesService).refreshAll();
      const r = await c.ok('GET', `/v1/databases/${db.id}`);
      return r.nodeStatus[primaryIndex].role === 'replica' && r.nodeStatus.filter((n: { role: string }) => n.role === 'primary').length === 1 ? r : null;
    }, { what: 'the old primary to rejoin as a replica', timeoutMs: 30_000 });

    // A new user reaches every node before the cluster is active again.
    await c.ok('POST', `/v1/databases/${db.id}/users`, { name: 'etl' }, 201);
    const updated = await waitStatus<any>(c, `/v1/databases/${db.id}`, 'active', 90_000);
    for (const n of nodes) {
      const a = await s.agents.inspect(n.serverId);
      expect(a!.st.version).toBe(updated.configVersion);
      expect(a!.last!.users.map((u: { name: string }) => u.name)).toContain('etl');
    }
  });

  it('brings a Valkey and a MySQL database to active', async () => {
    const c = (await readyTeam(s)).client;
    const [valkey, mysql] = await Promise.all([createDb(c, { name: 'cache', engine: 'valkey' }), createDb(c, { name: 'shop', engine: 'mysql' })]);
    expect(valkey.db.connection.uri).toMatch(/^rediss:\/\/default:/);
    expect(valkey.db.databases).toEqual([]);
    expect(mysql.db.connection.uri).toMatch(/^mysql:\/\/prgd_admin:.*:3306\/defaultdb/);
    // Valkey has no named databases.
    expect((await c.post(`/v1/databases/${valkey.db.id}/dbs`, { name: 'x' })).status).toBe(422);
    await c.ok('POST', `/v1/databases/${mysql.db.id}/dbs`, { name: 'orders' }, 201);
    await waitStatus(c, `/v1/databases/${mysql.db.id}`, 'active');

    // Deleting removes the nodes and the backup bucket.
    await c.ok('DELETE', `/v1/databases/${valkey.db.id}`, undefined, 202);
    await waitFor(async () => (await c.get(`/v1/databases/${valkey.db.id}`)).status === 404, { what: 'valkey to be deleted', timeoutMs: 90_000 });
  });
});
