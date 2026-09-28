import { beforeAll, describe, expect, it } from 'vitest';
import { KubernetesService } from '../../src/modules/kubernetes/k8s.service';
import { readyTeam, sut, waitFor, waitStatus, type Sut } from './harness';

let s: Sut;
beforeAll(async () => {
  s = await sut();
});

describe('managed Kubernetes', () => {
  it('bootstraps a cluster with a node pool, scales it with a fresh join token and hands out the kubeconfig', async () => {
    const c = (await readyTeam(s)).client;
    const created = await c.ok('POST', '/v1/kubernetes/clusters', { name: 'k1', pools: [{ name: 'workers', size: 's-2vcpu-4gb', count: 1, labels: { tier: 'web' } }] }, 202);
    expect(created.status).toBe('creating');
    // No kubeconfig before the control plane is up.
    expect((await c.get(`/v1/kubernetes/clusters/${created.id}/kubeconfig`)).status).toBe(409);

    const cluster = await waitStatus<any>(c, `/v1/kubernetes/clusters/${created.id}`, 'active', 120_000);
    expect(cluster.controlPlane).toHaveLength(1);
    expect(cluster.pools[0].nodes).toHaveLength(1);
    expect(cluster.endpoint).toBe(`https://${cluster.host}:6443`);

    // The minute job reads node readiness from the first control plane node.
    const k8s = s.get(KubernetesService);
    await k8s.refreshAll();
    const ready = await c.ok('GET', `/v1/kubernetes/clusters/${created.id}`);
    expect(ready.readyNodes).toBe(2);
    expect(ready.pools[0].nodes[0].kubeVersion).toMatch(/^v1\.31\./);

    const kc = await c.get(`/v1/kubernetes/clusters/${created.id}/kubeconfig`);
    expect(kc.status).toBe(200);
    expect(kc.headers.get('content-type')).toContain('application/yaml');
    expect(kc.text).toContain(`server: https://${cluster.host}:6443`);
    expect(kc.text).toContain('kind: Config');

    // Every node got the private addresses of its peers, and the worker its pool labels.
    const rows = await s.prisma.kubeNode.findMany({ where: { clusterId: created.id }, include: { server: true } });
    const worker = rows.find((n) => n.role === 'worker')!;
    const wAgent = await s.agents.inspect(worker.serverId);
    expect(wAgent!.st.initialized).toBe(true);
    const self = wAgent!.last!.cluster.nodes.find((n: { isSelf: boolean }) => n.isSelf);
    expect(self.ip).toBe(worker.server.privateIp);
    expect(self.labels).toEqual({ 'prgd.dev/pool': 'workers', tier: 'web' });

    // A day later the bootstrap token from creation has expired: scaling up must get a new one from node 0.
    const before = await s.prisma.kubeCluster.findUniqueOrThrow({ where: { id: created.id } });
    const clusterName = wAgent!.last!.cluster.name;
    await s.agents.expireJoinTokens(clusterName);
    const scaled = await c.ok('PATCH', `/v1/kubernetes/clusters/${created.id}/pools/${cluster.pools[0].id}`, { count: 2 }, 202);
    expect(scaled.pools[0].nodes).toHaveLength(2);
    const after = await s.prisma.kubeCluster.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.joinToken).toMatch(/^[a-z0-9]{6}\.[a-z0-9]{16}$/);
    expect(after.joinToken).not.toBe(before.joinToken);

    await waitFor(async () => {
      const r = await c.ok('GET', `/v1/kubernetes/clusters/${created.id}`);
      return r.status === 'active' && r.pools[0].nodes.length === 2 && r.pools[0].nodes.every((n: { status: string }) => n.status === 'active') ? r : null;
    }, { what: 'the new worker to be active', timeoutMs: 120_000 });
    const newNode = (await s.prisma.kubeNode.findMany({ where: { clusterId: created.id, role: 'worker' }, orderBy: { index: 'asc' } }))[1];
    const nAgent = await waitFor(async () => {
      const a = await s.agents.inspect(newNode.serverId);
      return a?.st.initialized ? a : null;
    }, { what: 'the new worker to join', timeoutMs: 60_000 });
    expect(nAgent.last!.joinToken).toBe(after.joinToken);
    await k8s.refreshAll();
    expect((await c.ok('GET', `/v1/kubernetes/clusters/${created.id}`)).readyNodes).toBe(3);

    // Scaling down drains the node through node 0 and deletes its server.
    await c.ok('PATCH', `/v1/kubernetes/clusters/${created.id}/pools/${cluster.pools[0].id}`, { count: 1 }, 202);
    await waitFor(async () => (await s.prisma.server.findUnique({ where: { id: newNode.serverId } }))?.status === 'deleted', { what: 'the removed worker to be deleted', timeoutMs: 60_000 });
    await waitStatus(c, `/v1/kubernetes/clusters/${created.id}`, 'active');
    await k8s.refreshAll();
    expect((await c.ok('GET', `/v1/kubernetes/clusters/${created.id}`)).readyNodes).toBe(2);

    // Scaling up again reuses the node name; later pushes must not drain the new node as the removed one.
    await c.ok('PATCH', `/v1/kubernetes/clusters/${created.id}/pools/${cluster.pools[0].id}`, { count: 2 }, 202);
    await waitFor(async () => {
      const r = await c.ok('GET', `/v1/kubernetes/clusters/${created.id}`);
      return r.status === 'active' && r.pools[0].nodes.length === 2 && r.pools[0].nodes.every((n: { status: string }) => n.status === 'active') ? r : null;
    }, { what: 'the worker to be back', timeoutMs: 120_000 });
    await c.ok('POST', `/v1/kubernetes/clusters/${created.id}/pools`, { name: 'batch', size: 's-2vcpu-4gb', count: 1 }, 202);
    await waitFor(async () => {
      const r = await c.ok('GET', `/v1/kubernetes/clusters/${created.id}`);
      return r.status === 'active' && r.pools.length === 2 && r.pools[1].nodes.every((n: { status: string }) => n.status === 'active') ? r : null;
    }, { what: 'the second pool to be active', timeoutMs: 120_000 });
    await k8s.refreshAll();
    const final = await c.ok('GET', `/v1/kubernetes/clusters/${created.id}`);
    expect(final.pools.flatMap((p: { nodes: { name: string; ready: boolean }[] }) => p.nodes).filter((n: { ready: boolean }) => !n.ready)).toEqual([]);
    expect(final.readyNodes).toBe(4);

    // Deleting removes every node server, the address and the etcd snapshot bucket.
    await c.ok('DELETE', `/v1/kubernetes/clusters/${created.id}`, undefined, 202);
    await waitFor(async () => (await c.get(`/v1/kubernetes/clusters/${created.id}`)).status === 404, { what: 'cluster to be deleted', timeoutMs: 120_000 });
    const gone = await s.prisma.kubeCluster.findUniqueOrThrow({ where: { id: created.id }, include: { nodes: { include: { server: true } } } });
    expect(gone.status).toBe('deleted');
    expect(gone.publicIpId).toBeNull();
    for (const n of gone.nodes) expect(n.server.status).toBe('deleted');
  });
});

describe('Kubernetes cloud controller', () => {
  it('turns a LoadBalancer Service into a platform load balancer and a claim into a mounted volume', async () => {
    const c = (await readyTeam(s)).client;
    const created = await c.ok('POST', '/v1/kubernetes/clusters', { name: 'k2', pools: [{ name: 'pool', size: 's-2vcpu-4gb', count: 2 }] }, 202);
    await waitStatus(c, `/v1/kubernetes/clusters/${created.id}`, 'active', 120_000);
    const k8s = s.get(KubernetesService);
    const rows = await s.prisma.kubeNode.findMany({ where: { clusterId: created.id }, include: { server: true }, orderBy: [{ role: 'asc' }, { index: 'asc' }] });
    const workers = rows.filter((n) => n.role === 'worker');
    const clusterName = (await s.agents.inspect(rows[0].serverId))!.last!.cluster.name as string;
    /** One pass of the minute job, then whatever push it caused. */
    const settle = async () => {
      await k8s.refreshAll();
      return waitStatus<any>(c, `/v1/kubernetes/clusters/${created.id}`, 'active', 60_000);
    };

    // kubectl expose ... --type=LoadBalancer
    await s.agents.kubectlApply(clusterName, { kind: 'Service', namespace: 'web', name: 'front', ports: [{ port: 80, nodePort: 30080 }] });
    let cluster = await settle();
    expect(cluster.cloud.loadBalancers).toHaveLength(1);
    const lbId = cluster.cloud.loadBalancers[0].loadBalancerId;
    const lb = await waitStatus<any>(c, `/v1/load-balancers/${lbId}`, 'active', 120_000);
    expect(lb.tag).toBe(`k8s-${created.id}`);
    expect(lb.forwardingRules).toEqual([{ entryProtocol: 'tcp', entryPort: 80, targetProtocol: 'tcp', targetPort: 30080 }]);
    // The address goes back into the cluster, where node 0 writes it into the Service status.
    cluster = await settle();
    expect(cluster.cloud.loadBalancers[0].ip).toBe(lb.ip);
    const node0 = await s.agents.inspect(rows[0].serverId);
    expect(node0!.last!.services['web/front'].ip).toBe(lb.ip);
    // The load balancer sends traffic to the workers' node port over the private network.
    const lbNode = await s.prisma.loadBalancerNode.findFirstOrThrow({ where: { loadBalancerId: lbId } });
    const lbAgent = await s.agents.inspect(lbNode.serverId);
    for (const w of workers) expect(lbAgent!.last!.haproxyCfg).toContain(`${w.server.privateIp}:30080`);

    // A prgd-block claim the scheduler put on the first worker.
    await s.agents.kubectlApply(clusterName, { kind: 'PersistentVolumeClaim', namespace: 'web', name: 'data', sizeGb: 20, node: workers[0].server.name });
    cluster = await settle();
    expect(cluster.cloud.volumes).toHaveLength(1);
    const volumeId = cluster.cloud.volumes[0].volumeId;
    const vol = await waitStatus<any>(c, `/v1/volumes/${volumeId}`, 'attached', 60_000);
    expect(vol.serverId).toBe(workers[0].serverId);
    expect(vol.sizeGb).toBe(20);
    // The worker mounts it, then node 0 gets the PersistentVolume and the claim binds.
    await waitFor(async () => {
      await settle();
      const now = await c.ok('GET', `/v1/kubernetes/clusters/${created.id}`);
      return now.cloud.volumes[0].mounted ? now : null;
    }, { what: 'the volume to be mounted', timeoutMs: 60_000 });
    const w0 = await s.agents.inspect(workers[0].serverId);
    expect(w0!.st.mounted).toEqual([volumeId]);
    await settle();
    const bound = await s.agents.inspect(rows[0].serverId);
    expect(bound!.last!.pvs).toEqual([expect.objectContaining({ volumeId, pvcNamespace: 'web', pvcName: 'data', node: workers[0].server.name, sizeGb: 20 })]);
    const st = await s.prisma.kubeCluster.findUniqueOrThrow({ where: { id: created.id } });
    expect((st.cloudState as { volumes: Record<string, { pvCreated?: boolean }> }).volumes['web/data'].pvCreated).toBe(true);

    // kubectl delete pvc: the PV goes, the volume is unmounted, detached and deleted.
    await s.agents.kubectlDelete(clusterName, 'PersistentVolumeClaim', 'web', 'data');
    await waitFor(async () => {
      await settle();
      const v = await c.get(`/v1/volumes/${volumeId}`);
      return v.status === 404 ? true : null;
    }, { what: 'the volume of the deleted claim to be deleted', timeoutMs: 90_000 });
    expect((await s.agents.inspect(workers[0].serverId))!.st.mounted).toEqual([]);
    // The next pass forgets the volume.
    await settle();
    expect((await c.ok('GET', `/v1/kubernetes/clusters/${created.id}`)).cloud.volumes).toEqual([]);

    // Deleting the cluster takes its load balancer with it.
    await c.ok('DELETE', `/v1/kubernetes/clusters/${created.id}`, undefined, 202);
    await waitFor(async () => (await c.get(`/v1/load-balancers/${lbId}`)).status === 404, { what: 'the load balancer to be deleted', timeoutMs: 120_000 });
    await waitFor(async () => (await c.get(`/v1/kubernetes/clusters/${created.id}`)).status === 404, { what: 'cluster to be deleted', timeoutMs: 120_000 });
  });
});
