import { beforeAll, describe, expect, it } from 'vitest';
import { readyTeam, sut, waitFor, waitStatus, type Client, type Sut } from './harness';

let s: Sut;
beforeAll(async () => {
  s = await sut();
});

async function server(c: Client, name: string, extra: Record<string, unknown> = {}) {
  const r = await c.ok('POST', '/v1/servers', { name, size: 's-1vcpu-2gb', image: 'ubuntu-24-04', ...extra }, 202);
  return waitStatus<any>(c, `/v1/servers/${r.id}`, 'active');
}

async function lastAction(c: Client, id: string, type: string) {
  return waitFor(async () => {
    const a = (await c.ok('GET', `/v1/servers/${id}/actions`)).data.find((x: { type: string }) => x.type === type);
    if (a?.status === 'failed') throw Object.assign(new Error(`${type} failed: ${a.error}`), { fatal: true });
    return a?.status === 'completed' ? a : null;
  }, { what: `${type} action on ${id} to complete`, timeoutMs: 60_000 });
}

describe('servers', () => {

  it('creates a server with a public and a project private address, powers it off and on, resizes and deletes it', async () => {
    const c = (await readyTeam(s)).client;
    const srv = await server(c, 'web-1');
    expect(srv.networks.v4).toHaveLength(1);
    expect(srv.networks.private[0].ipAddress).toMatch(/^10\.\d+\.\d+\.\d+$/);
    // A second server in the same project sits on the same private network.
    const peer = await server(c, 'web-2');
    const net = (ip: string) => ip.split('.').slice(0, 3).join('.');
    expect(net(peer.networks.private[0].ipAddress)).toBe(net(srv.networks.private[0].ipAddress));
    expect(peer.networks.private[0].ipAddress).not.toBe(srv.networks.private[0].ipAddress);

    await c.ok('POST', `/v1/servers/${srv.id}/actions`, { type: 'stop' }, 202);
    await waitStatus(c, `/v1/servers/${srv.id}`, 'off');
    await c.ok('POST', `/v1/servers/${srv.id}/actions`, { type: 'start' }, 202);
    await waitStatus(c, `/v1/servers/${srv.id}`, 'active');

    await c.ok('POST', `/v1/servers/${srv.id}/actions`, { type: 'resize', size: 's-2vcpu-4gb' }, 202);
    await lastAction(c, srv.id, 'resize');
    const resized = await waitStatus<any>(c, `/v1/servers/${srv.id}`, 'active');
    expect(resized.size.id).toBe('s-2vcpu-4gb');
    expect(resized.size.vcpu).toBe(2);

    await c.ok('DELETE', `/v1/servers/${srv.id}`, undefined, 202);
    await waitFor(async () => (await c.get(`/v1/servers/${srv.id}`)).status === 404, { what: 'server to be deleted', timeoutMs: 60_000 });
    // Its public address went back to the pool.
    const ips = await c.ok('GET', '/v1/public-ips');
    expect(ips.data.map((x: { address: string }) => x.address)).not.toContain(srv.networks.v4[0].ipAddress);
  });

  it('snapshots a server, restores it from the snapshot and creates a new server from it', async () => {
    const c = (await readyTeam(s)).client;
    const srv = await server(c, 'snap-src');
    await c.ok('POST', `/v1/servers/${srv.id}/actions`, { type: 'snapshot', name: 'before-upgrade' }, 202);
    await lastAction(c, srv.id, 'snapshot');
    const snap = await waitFor(async () => (await c.ok('GET', '/v1/snapshots')).data.find((x: { name: string; status: string }) => x.name === 'before-upgrade' && x.status === 'available'), { what: 'snapshot to be available' });
    expect(snap.serverId).toBe(srv.id);

    await c.ok('POST', `/v1/servers/${srv.id}/restore`, { snapshotId: snap.id }, 202);
    await lastAction(c, srv.id, 'restore');
    await waitStatus(c, `/v1/servers/${srv.id}`, 'active');

    const copy = await c.ok('POST', '/v1/servers', { name: 'snap-copy', size: 's-1vcpu-2gb', snapshotId: snap.id }, 202);
    const active = await waitStatus<any>(c, `/v1/servers/${copy.id}`, 'active');
    expect(active.image.id).toBe(srv.image.id);
    expect(active.networks.private[0].ipAddress).not.toBe(srv.networks.private[0].ipAddress);
  });

  it('attaches and detaches a volume and moves a public address between two servers', async () => {
    const c = (await readyTeam(s)).client;
    const [a, b] = await Promise.all([server(c, 'ip-a'), server(c, 'ip-b')]);

    const vol = await c.ok('POST', '/v1/volumes', { name: 'data-1', sizeGb: 10 }, 202);
    await waitStatus(c, `/v1/volumes/${vol.id}`, 'available');
    await c.ok('POST', `/v1/volumes/${vol.id}/attach`, { serverId: a.id }, 202);
    const attached = await waitStatus<any>(c, `/v1/volumes/${vol.id}`, 'attached');
    expect(attached.serverId).toBe(a.id);
    expect(attached.device).toContain('scsi-0QEMU_QEMU_HARDDISK_');
    await c.ok('POST', `/v1/volumes/${vol.id}/detach`, {}, 202);
    const detached = await waitStatus<any>(c, `/v1/volumes/${vol.id}`, 'available');
    expect(detached.serverId).toBeNull();

    // Move a's address to b: b gives up its own first, then takes a's.
    const ips = (await c.ok('GET', '/v1/public-ips')).data as { id: string; address: string; serverId: string | null }[];
    const ipA = ips.find((x) => x.serverId === a.id)!;
    const ipB = ips.find((x) => x.serverId === b.id)!;
    expect((await c.post(`/v1/public-ips/${ipA.id}/attach`, { serverId: b.id })).status).toBe(409);
    await c.ok('POST', `/v1/public-ips/${ipA.id}/detach`);
    await c.ok('POST', `/v1/public-ips/${ipB.id}/detach`);
    await c.ok('POST', `/v1/public-ips/${ipA.id}/attach`, { serverId: b.id });
    const bNow = await c.ok('GET', `/v1/servers/${b.id}`);
    expect(bNow.networks.v4.map((x: { ipAddress: string }) => x.ipAddress)).toEqual([ipA.address]);
    expect((await c.ok('GET', `/v1/servers/${a.id}`)).networks.v4).toHaveLength(0);
    // The detached address stays reserved for the project until released.
    await c.ok('DELETE', `/v1/public-ips/${ipB.id}`, undefined, 204);
    expect((await c.ok('GET', '/v1/public-ips')).data.map((x: { id: string }) => x.id)).not.toContain(ipB.id);
  });
});
