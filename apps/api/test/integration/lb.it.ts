import { beforeAll, describe, expect, it } from 'vitest';
import { open } from '../../src/common/crypto/secretbox';
import { LoadBalancersService } from '../../src/modules/lb/lb.service';
import { agentFetch } from '../../src/common/platform-agent';
import { readyTeam, sut, waitFor, waitStatus, type Sut } from './harness';

let s: Sut;
beforeAll(async () => {
  s = await sut();
});

describe('load balancers', () => {
  it('balances two targets over their private addresses and follows their health', async () => {
    const c = (await readyTeam(s)).client;
    const ids = await Promise.all(['app-1', 'app-2'].map(async (name) => (await c.ok('POST', '/v1/servers', { name, size: 's-1vcpu-2gb', image: 'ubuntu-24-04' }, 202)).id as string));
    const targets = await Promise.all(ids.map((id) => waitStatus<any>(c, `/v1/servers/${id}`, 'active')));

    const created = await c.ok('POST', '/v1/load-balancers', {
      name: 'front', nodes: 2, serverIds: ids,
      forwardingRules: [{ entryProtocol: 'http', entryPort: 80, targetProtocol: 'http', targetPort: 8080 }],
      healthCheck: { protocol: 'http', port: 8080, path: '/healthz' },
    }, 202);
    expect(created.ip).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    const lb = await waitStatus<any>(c, `/v1/load-balancers/${created.id}`, 'active', 120_000);
    expect(lb.nodeStatus).toHaveLength(2);
    for (const n of lb.nodeStatus) expect(n.appliedVersion).toBe(lb.configVersion);

    // What the nodes received: HAProxy sends traffic to the targets' private addresses, keepalived peers over the private network.
    const nodes = await s.prisma.loadBalancerNode.findMany({ where: { loadBalancerId: lb.id }, include: { server: { include: { publicIps: true } } }, orderBy: { index: 'asc' } });
    const agent = await s.agents.inspect(nodes[0].serverId);
    expect(agent?.kind).toBe('lb');
    // The agent answers on the node's private address and only with the shared secret.
    const ip = nodes[0].server.privateIp!;
    expect((await agentFetch(ip, { path: '/status', secret: 'wrong', timeoutMs: 2000 })).status).toBe(401);
    expect((await agentFetch(ip, { path: '/status', secret: nodes[0].server.id, timeoutMs: 2000 })).status).toBe(401);
    const lbRow = await s.prisma.loadBalancer.findUniqueOrThrow({ where: { id: lb.id } });
    // The agent secret is sealed at rest; the control plane opens it for every call.
    lbRow.vmSecret = open(lbRow.vmSecret);
    expect((await agentFetch(ip, { path: '/nope', secret: lbRow.vmSecret, timeoutMs: 2000 })).status).toBe(404);
    expect(((await (await agentFetch(ip, { path: '/status', secret: lbRow.vmSecret, timeoutMs: 2000 })).json()) as { version: number }).version).toBe(lb.configVersion);
    // Nothing listens on the public address.
    await expect(agentFetch(nodes[0].server.publicIps[0].address, { path: '/status', secret: lbRow.vmSecret, timeoutMs: 2000 })).rejects.toThrow('fetch failed');
    for (const t of targets) expect(agent!.last!.haproxyCfg).toContain(`server srv_${t.id} ${t.networks.private[0].ipAddress}:8080`);
    expect(agent!.last!.keepalived).toContain(nodes[1].server.privateIp!);
    expect(agent!.last!.keepalived).toContain(lb.ip);

    // The minute job reads health from the stats socket: both up, then one down once its server is off.
    const lbs = s.get(LoadBalancersService);
    await lbs.refreshAll();
    let now = await c.ok('GET', `/v1/load-balancers/${lb.id}`);
    expect(now.targets.map((t: { healthy: boolean }) => t.healthy)).toEqual([true, true]);
    await c.ok('POST', `/v1/servers/${ids[1]}/actions`, { type: 'stop' }, 202);
    await waitStatus(c, `/v1/servers/${ids[1]}`, 'off');
    await lbs.refreshAll();
    now = await c.ok('GET', `/v1/load-balancers/${lb.id}`);
    expect(Object.fromEntries(now.targets.map((t: { serverId: string; healthy: boolean }) => [t.serverId, t.healthy]))).toEqual({ [ids[0]]: true, [ids[1]]: false });

    // Removing a target pushes a new version to every node.
    await c.ok('DELETE', `/v1/load-balancers/${lb.id}/servers/${ids[1]}`, undefined, 202);
    const updated = await waitStatus<any>(c, `/v1/load-balancers/${lb.id}`, 'active');
    expect(updated.targets).toHaveLength(1);
    expect(updated.configVersion).toBeGreaterThan(lb.configVersion);
    const pushed = await s.agents.inspect(nodes[1].serverId);
    expect(pushed!.st.version).toBe(updated.configVersion);
    expect(pushed!.last!.haproxyCfg).not.toContain(`srv_${ids[1]}`);

    await c.ok('DELETE', `/v1/load-balancers/${lb.id}`, undefined, 202);
    await waitFor(async () => (await c.get(`/v1/load-balancers/${lb.id}`)).status === 404, { what: 'load balancer to be deleted', timeoutMs: 90_000 });
    expect(await s.agents.inspect(nodes[0].serverId)).toBeNull();
  });
});
