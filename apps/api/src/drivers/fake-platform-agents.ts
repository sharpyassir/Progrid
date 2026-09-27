import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { RedisService } from '../common/redis/redis.service';
import type { AgentRequest } from '../common/platform-agent';

/**
 * Stand in for the Python agents that platform VMs run on :9009 (lbd.py, dbd.py, k8sd.py,
 * appd.py, deployd.py), used only with the fake hypervisor driver. The fake driver registers a
 * node when it "boots" a VM: it reads the agent kind and the shared secret from the VM's
 * cloud-init, exactly the files the real agent reads. Every call is then answered in process
 * with the paths, status codes and JSON shapes of the real agent, including its 401 without the
 * secret, the 409 a database node sends while it waits for a primary or for users to replicate,
 * and the Docker and Caddy readiness an app host reports.
 *
 * State lives in Redis when it is reachable, so the API and the worker (separate processes in
 * development) see the same nodes; otherwise in this process. Work that takes time on a real
 * node (backups, restores, builds) finishes a short, fixed time after it starts.
 */

type Kind = 'lb' | 'db' | 'k8s' | 'app' | 'deploy';
type Engine = 'postgres' | 'valkey' | 'mysql';
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

interface FakeNode {
  serverId: string;
  address: string;
  power: 'running' | 'stopped';
  /** The agent answers from this time on (boot plus the agent starting). */
  upAt: number;
  kind?: Kind;
  secret?: string;
  engine?: Engine;
  repo?: { url: string; branch: string };
  /** The agent's own state file. */
  st: Json;
  /** Last config the control plane pushed. */
  last?: Json | null;
  /** Deploy agents and app hosts: when running work finishes. Internal, never reported. */
  due?: Record<string, number>;
}

/** How long simulated work takes. */
export const FAKE_AGENT_TIMINGS = { bootMs: 500, backupMs: 1500, restoreMs: 2000, buildMs: 2000, caddyMs: 2500, deployMs: 1500 };

const PREFIX = 'fake-agents:';

class NotReady extends Error {}

/** Answers like a Python http.server handler: JSON body and Content-Type. */
function send(code: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return new Response(text, { status: code, headers: { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(text)) } });
}

/** What fetch throws when nothing listens on the address. */
function unreachable(host: string): never {
  const err = new TypeError('fetch failed');
  (err as TypeError & { cause?: unknown }).cause = Object.assign(new Error(`connect ECONNREFUSED ${host}:9009`), { code: 'ECONNREFUSED' });
  throw err;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const now = () => Date.now();
const secs = () => Date.now() / 1000;

@Injectable()
export class FakePlatformAgents {
  private readonly log = new Logger('FakePlatformAgents');
  private readonly mem = new Map<string, string>();
  private readonly chains = new Map<string, Promise<unknown>>();

  constructor(private readonly redis: RedisService) {}

  // ---- storage ----

  private get shared() {
    return this.redis.client.status === 'ready';
  }

  private async get<T>(key: string): Promise<T | null> {
    const raw = this.shared ? await this.redis.client.get(PREFIX + key) : this.mem.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  private async put(key: string, value: unknown) {
    const raw = JSON.stringify(value);
    if (this.shared) await this.redis.client.set(PREFIX + key, raw);
    else this.mem.set(key, raw);
  }

  private async drop(key: string) {
    if (this.shared) await this.redis.client.del(PREFIX + key);
    else this.mem.delete(key);
  }

  private async incr(key: string): Promise<number> {
    if (this.shared) return this.redis.client.incr(PREFIX + key);
    const n = Number(this.mem.get(key) ?? 0) + 1;
    this.mem.set(key, String(n));
    return n;
  }

  /** Serializes work on one key in this process, like the agent's lock around a config push. */
  private locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(key) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(fn);
    this.chains.set(key, next);
    return next.finally(() => {
      if (this.chains.get(key) === next) this.chains.delete(key);
    });
  }

  // ---- called by the fake driver ----

  /**
   * A private address on the project's network, like the real platform will hand out: every
   * network (`vpc-<projectId>`) gets its own 10.x.y.0/24 and hosts count up from .2.
   */
  async allocateAddress(networkRef: string): Promise<string> {
    let subnet = await this.get<number>(`net:${networkRef}`);
    if (subnet == null) {
      subnet = await this.incr('nets');
      await this.put(`net:${networkRef}`, subnet);
    }
    const host = ((await this.incr(`net:${networkRef}:hosts`)) % 253) + 1;
    return `10.${16 + (subnet >> 8)}.${subnet & 255}.${host + 1}`;
  }

  /** A VM finished booting: starts the agent its cloud-init installs, if any. */
  async boot(serverId: string, address: string, userData: string | undefined) {
    const agent = parseAgent(userData ?? '');
    const node: FakeNode = { serverId, address, power: 'running', upAt: now() + FAKE_AGENT_TIMINGS.bootMs, st: {}, last: null, ...agent };
    if (node.kind === 'deploy') {
      // cloud-init runs deploy.sh once at boot.
      node.st = { status: 'deploying', commit: null, log: `=== deploy ${new Date().toISOString()} ===\n` };
      node.due = { deploy: now() + FAKE_AGENT_TIMINGS.deployMs };
    }
    if (node.kind === 'app') node.st = { version: 0, apps: {} };
    await this.locked(address, async () => {
      await this.put(`vm:${address}`, node);
      await this.put(`server:${serverId}`, address);
    });
    if (node.kind) this.log.debug(`${node.kind} agent on ${address} (server ${serverId})`);
  }

  async setPower(address: string, power: 'running' | 'stopped') {
    await this.locked(address, async () => {
      const node = await this.get<FakeNode>(`vm:${address}`);
      if (!node) return;
      node.power = power;
      if (power === 'running') node.upAt = now() + FAKE_AGENT_TIMINGS.bootMs;
      await this.put(`vm:${address}`, node);
    });
  }

  async remove(address: string) {
    await this.locked(address, async () => {
      const node = await this.get<FakeNode>(`vm:${address}`);
      await this.drop(`vm:${address}`);
      if (node) await this.drop(`server:${node.serverId}`);
    });
  }

  // ---- for tests ----

  /** The node behind a server id or an address, as the agent sees itself. */
  async inspect(serverIdOrAddress: string): Promise<FakeNode | null> {
    const address = (await this.get<string>(`server:${serverIdOrAddress}`)) ?? serverIdOrAddress;
    return this.get<FakeNode>(`vm:${address}`);
  }

  /** Lets every bootstrap token of a Kubernetes cluster run out, as they do after 24 hours. */
  async expireJoinTokens(clusterName: string) {
    await this.locked(`k8s:${clusterName}`, async () => {
      const cl = await this.get<Json>(`cluster:k8s:${clusterName}`);
      if (!cl) return;
      for (const t of Object.keys(cl.tokens ?? {})) cl.tokens[t] = 0;
      await this.put(`cluster:k8s:${clusterName}`, cl);
    });
  }

  // ---- the transport ----

  /** Answers one request as the agent on `host` would, or throws like fetch when nothing listens. */
  handle = async (host: string, req: AgentRequest): Promise<Response> => {
    return this.locked(host, async () => {
      const node = await this.get<FakeNode>(`vm:${host}`);
      if (!node?.kind || node.power !== 'running' || now() < node.upAt) unreachable(host);
      const method = req.method ?? 'GET';
      // The agents read the body as JSON; a round trip keeps the simulator from sharing objects with the caller.
      const body = req.body === undefined ? {} : (JSON.parse(JSON.stringify(req.body)) as Json);
      const res = await this.dispatch(node, method, req.path, req.secret, body);
      await this.put(`vm:${host}`, node);
      return res;
    });
  };

  private dispatch(node: FakeNode, method: string, path: string, secret: string, body: Json): Promise<Response> | Response {
    switch (node.kind) {
      case 'lb':
        return this.lb(node, method, path, secret, body);
      case 'db':
        return this.db(node, method, path, secret, body);
      case 'k8s':
        return this.k8s(node, method, path, secret, body);
      case 'app':
        return this.app(node, method, path, secret, body);
      case 'deploy':
        return this.deploy(node, method, path, secret, body);
      default:
        return send(404, {});
    }
  }

  // ---- lbd.py ----

  private async lb(node: FakeNode, method: string, path: string, secret: string, body: Json) {
    if (secret !== node.secret) return send(401, { error: 'unauthorized' });
    if (method === 'GET') {
      if (path !== '/status') return send(404, {});
      return send(200, { version: node.st.version ?? 0, backends: await this.haproxyStats(String(node.last?.haproxyCfg ?? '')) });
    }
    if (path !== '/config') return send(404, {});
    const cfg = String(body.haproxyCfg ?? '');
    // `haproxy -c`: the simulator only checks the rendered file has the sections HAProxy needs.
    if (!/^global$/m.test(cfg) || !/^defaults$/m.test(cfg)) return send(422, { error: 'invalid_config', detail: '[ALERT] config : missing global or defaults section' });
    node.last = body;
    node.st = { version: body.version };
    return send(200, { version: body.version });
  }

  /** Backend health as the stats socket reports it: a target is UP while its VM runs. */
  private async haproxyStats(cfg: string) {
    const backends: Record<string, Record<string, string>> = {};
    let current: string | null = null;
    for (const line of cfg.split('\n')) {
      const be = /^backend (be_\S+)/.exec(line);
      if (be) current = be[1];
      else if (/^\S/.test(line)) current = null;
      const srv = /^\s+server (srv_\S+) ([^:\s]+):\d+/.exec(line);
      if (current && srv) {
        const target = await this.get<FakeNode>(`vm:${srv[2]}`);
        (backends[current] ??= {})[srv[1]] = target?.power === 'running' ? 'UP' : 'DOWN';
      }
    }
    return backends;
  }

  // ---- dbd.py ----

  private async db(node: FakeNode, method: string, path: string, secret: string, body: Json) {
    if (secret !== node.secret) return send(401, { error: 'unauthorized' });
    this.settleDb(node);
    if (method === 'GET') {
      if (path !== '/status') return send(404, {});
      const engine = await this.dbEngineStatus(node);
      return send(200, { version: node.st.version ?? 0, engine: node.engine, backups: node.st.backups ?? [], restore: node.st.restore ?? null, ...engine });
    }
    const restoring = node.st.restore?.status === 'running';
    if (path === '/config') {
      if (restoring) return send(409, { error: 'not_ready', detail: 'a restore is running' });
      try {
        node.last = body;
        await this.applyDb(node, body);
        node.st.version = body.version;
      } catch (e) {
        if (e instanceof NotReady) return send(409, { error: 'not_ready', detail: e.message });
        return send(500, { error: 'apply_failed', detail: (e as Error).message });
      }
      return send(200, { version: body.version });
    }
    if (path === '/backup') {
      if (restoring) return send(409, { error: 'restore_running' });
      if ((await this.dbEngineStatus(node)).role !== 'primary') return send(409, { error: 'not_primary' });
      this.recordBackup(node, { id: body.id, status: 'running', startedAt: secs() });
      (node.due ??= {})[`backup:${body.id}`] = now() + FAKE_AGENT_TIMINGS.backupMs;
      return send(202, { id: body.id });
    }
    if (path === '/restore') {
      if (restoring) return send(409, { error: 'restore_running' });
      node.st.restore = { id: body.id, backupId: body.backupId, status: 'running', startedAt: secs() };
      node.st.restoreRequest = body;
      (node.due ??= {}).restore = now() + FAKE_AGENT_TIMINGS.restoreMs;
      return send(202, { id: body.id });
    }
    return send(404, {});
  }

  private recordBackup(node: FakeNode, rec: Json) {
    node.st.backups = [...((node.st.backups ?? []) as Json[]).filter((b) => b.id !== rec.id), rec].slice(-30);
  }

  /** Finishes backups and restores whose time has come. */
  private settleDb(node: FakeNode) {
    const c = node.last;
    for (const [key, at] of Object.entries(node.due ?? {})) {
      if (now() < at) continue;
      delete node.due![key];
      if (key.startsWith('backup:')) {
        const bid = key.slice('backup:'.length);
        const rec = ((node.st.backups ?? []) as Json[]).find((b) => b.id === bid);
        if (!rec) continue;
        const name = c?.cluster?.name ?? 'db';
        rec.completedAt = secs();
        if (!c?.backup?.bucket) {
          rec.status = 'failed';
          rec.error = node.engine === 'postgres' ? 'ERROR: [055]: unable to load info file: repository is not configured' : "'NoneType' object is not subscriptable";
        } else {
          rec.status = 'completed';
          rec.error = null;
          rec.sizeBytes = 8_000_000 + Math.floor(Math.random() * 1_000_000);
          const d = new Date();
          const label = `${d.toISOString().slice(0, 10).replace(/-/g, '')}-${d.toISOString().slice(11, 19).replace(/:/g, '')}F`;
          rec.ref = node.engine === 'postgres' ? label : node.engine === 'valkey' ? `${name}/${bid}.rdb` : `${name}/${bid}`;
        }
        this.recordBackup(node, rec);
      } else if (key === 'restore') {
        const req = (node.st.restoreRequest ?? {}) as Json;
        const rec = node.st.restore as Json;
        if (node.engine === 'postgres' && !req.ref) {
          rec.status = 'failed';
          rec.error = 'the backup has no pgBackRest label to restore';
        } else {
          rec.status = 'completed';
          if (node.engine === 'mysql') {
            const me = c ? selfNode(c) : null;
            node.st.mysqlPrimary = req.primary ? me?.ip : req.primaryIp;
            node.st.mysqlRole = req.primary ? 'primary' : 'replica';
          }
        }
        rec.completedAt = secs();
        delete node.st.restoreRequest;
      }
    }
  }

  private async applyDb(node: FakeNode, c: Json) {
    const me = selfNode(c);
    const nodes = c.cluster.nodes as Json[];
    const first = [...nodes].sort((a, b) => a.index - b.index)[0];
    const key = `db:${c.cluster.name}`;
    await this.locked(key, async () => {
      const cl = (await this.get<Json>(`cluster:${key}`)) ?? { configured: [], leader: null, roles: [], dbs: [] };
      if (!cl.configured.includes(me.index)) cl.configured.push(me.index);
      const wantRoles = [c.admin.user, ...((c.users ?? []) as Json[]).map((u) => u.name)];
      const wantDbs = (c.databases ?? []) as string[];
      try {
        if (node.engine === 'postgres') {
          // etcd elects nothing until a majority of its members run; the first Patroni to start then leads.
          if (cl.leader == null && cl.configured.length >= Math.floor(nodes.length / 2) + 1) cl.leader = cl.configured[0];
          if (cl.leader == null) throw new NotReady('waiting for the cluster to elect a primary');
          if (cl.leader === me.index) {
            cl.roles = [...new Set([...cl.roles, ...wantRoles])];
            cl.dbs = [...new Set([...cl.dbs, ...wantDbs])];
          }
          // Replicas see the roles and databases once the primary made them.
          const missing = [...wantRoles.filter((r) => !cl.roles.includes(r)), ...wantDbs.filter((d) => !cl.dbs.includes(d))];
          if (missing.length) throw new NotReady('waiting for ' + missing.slice(0, 5).join(', ') + ' on this node');
        } else if (node.engine === 'mysql') {
          const primary = node.st.mysqlPrimary ?? first.ip;
          if (primary === me.ip) {
            cl.roles = [...new Set([...cl.roles, ...wantRoles])];
            cl.dbs = [...new Set([...cl.dbs, ...wantDbs])];
          } else if (!cl.roles.includes(c.admin.user)) {
            node.st.mysqlPrimary = primary;
            node.st.mysqlRole = 'replica';
            throw new NotReady('waiting for the accounts to replicate from the primary');
          }
          node.st.mysqlPrimary = primary;
          node.st.mysqlRole = primary === me.ip ? 'primary' : 'replica';
        } else {
          // Valkey: the lowest index node is primary until Sentinel moves it.
          node.st.valkeyPrimary = node.st.valkeyPrimary ?? first.ip;
        }
      } finally {
        await this.put(`cluster:${key}`, cl);
      }
    });
  }

  private async dbEngineStatus(node: FakeNode): Promise<Json> {
    const c = node.last;
    const disk = 12.5;
    if (node.engine === 'postgres') {
      const cl = c ? await this.get<Json>(`cluster:db:${c.cluster.name}`) : null;
      const me = c ? selfNode(c) : null;
      const primary = !!me && cl?.leader === me.index;
      const members = c && cl?.leader != null ? (c.cluster.nodes as Json[]).filter((n) => cl.configured.includes(n.index)).map((n) => ({ name: n.name, role: n.index === cl.leader ? 'leader' : 'replica', state: n.index === cl.leader ? 'running' : 'streaming', lag: n.index === cl.leader ? undefined : 0 })) : [];
      return { role: primary ? 'primary' : 'replica', members, lagBytes: primary || !me || cl?.leader == null ? null : 0, dbSizes: Object.fromEntries(((cl?.dbs ?? []) as string[]).map((d) => [d, 7_500_000])), memberName: me?.name ?? null, diskUsedPercent: disk };
    }
    if (node.engine === 'mysql') {
      // A fresh MySQL server is writable; the agent makes replicas read only on their first config.
      const role = !node.st.mysqlRole || node.st.mysqlRole === 'primary' ? 'primary' : 'replica';
      return { role, members: [], lagBytes: null, dbSizes: {}, ...(role === 'replica' ? { lagSeconds: 0 } : {}), diskUsedPercent: disk };
    }
    const me = c ? selfNode(c) : null;
    const role = !me || !node.st.valkeyPrimary || node.st.valkeyPrimary === me.ip ? 'primary' : 'replica';
    return { role, members: [], lagBytes: role === 'replica' ? 0 : null, dbSizes: { default: 1_048_576 }, diskUsedPercent: disk };
  }

  // ---- k8sd.py ----

  private async k8s(node: FakeNode, method: string, path: string, secret: string, body: Json) {
    if (method === 'GET') {
      if (path !== '/status') return send(404, {});
      if (secret !== node.secret) return send(401, { error: 'unauthorized' });
      return send(200, await this.k8sStatus(node));
    }
    if (secret !== node.secret) return send(401, { error: 'unauthorized' });
    const c = node.last;
    const m = c ? selfNode(c) : null;
    const cl = c ? await this.get<Json>(`cluster:k8s:${c.cluster.name}`) : null;
    if (path === '/join-token') {
      // admin.conf exists on control plane nodes once they are initialized.
      if (!node.st.initialized || m?.role !== 'control' || !cl) return send(409, { error: 'not_ready' });
      const token = kubeadmToken();
      await this.locked(`k8s:${c!.cluster.name}`, async () => {
        const fresh = (await this.get<Json>(`cluster:k8s:${c!.cluster.name}`))!;
        fresh.tokens[token] = now() + 24 * 3600_000;
        await this.put(`cluster:k8s:${c!.cluster.name}`, fresh);
      });
      return send(200, { token });
    }
    if (path === '/renew-certs' || path === '/etcd-snapshot') {
      if (!c || !node.st.initialized || m?.role !== 'control') return send(409, { error: 'not_control_plane' });
      if (path === '/renew-certs') node.st.certsRenewedAt = secs();
      else Object.assign(node.st, { etcdSnapshotAt: secs(), etcdSnapshot: `etcd-${m.name}-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z.db` });
      return send(202, { started: true });
    }
    if (path === '/config') {
      try {
        node.last = body;
        await this.applyK8s(node, body);
        node.st.version = body.version;
      } catch (e) {
        if (e instanceof NotReady) return send(409, { error: 'not_ready', detail: e.message });
        return send(500, { error: 'apply_failed', detail: (e as Error).message });
      }
      return send(200, { version: body.version });
    }
    return send(404, {});
  }

  private async applyK8s(node: FakeNode, c: Json) {
    const m = selfNode(c);
    const key = `k8s:${c.cluster.name}`;
    await this.locked(key, async () => {
      let cl = await this.get<Json>(`cluster:${key}`);
      const kubelet = `v${c.kubeVersion}.4`;
      if (m.role === 'control') {
        if (!node.st.initialized) {
          if (m.index === 0) {
            // kubeadm init: a new CA, the bootstrap token from the config, the admin kubeconfig.
            cl = { caHash: sha(randomBytes(32).toString('hex')), tokens: { [c.joinToken]: now() + 24 * 3600_000 }, nodes: {}, kubeconfig: kubeconfigFor(c) };
          } else if (c.caHash) {
            this.join(cl, c, m);
          } else {
            throw new NotReady('waiting for the first control plane node');
          }
          node.st.initialized = true;
          cl!.nodes[m.name] = { ready: true, version: kubelet };
        }
        if (m.index === 0 && cl) {
          for (const name of (c.removeNodes ?? []) as string[]) delete cl.nodes[name];
        }
      } else {
        if (!node.st.initialized) {
          if (!c.caHash) throw new NotReady('waiting for the control plane');
          this.join(cl, c, m);
          node.st.initialized = true;
          cl!.nodes[m.name] = { ready: true, version: kubelet };
        }
        // Block volumes the platform attached are formatted and mounted.
        node.st.mounted = ((c.volumes ?? []) as Json[]).map((v) => v.id);
      }
      if (cl) await this.put(`cluster:${key}`, cl);
    });
  }

  /** kubeadm join: the token must be one the cluster issued and not expired, the CA hash must match. */
  private join(cl: Json | null, c: Json, m: Json) {
    const tokenId = String(c.joinToken ?? '').split('.')[0];
    if (!cl) throw new Error(`kubeadm join ${c.cluster.endpoint} --token ... --node-name ${m.name}: couldn't validate the identity of the API Server: connection refused`);
    const exp = cl.tokens?.[c.joinToken];
    if (!exp || exp < now()) throw new Error(`kubeadm join ${c.cluster.endpoint} --token ... --node-name ${m.name}: couldn't validate the identity of the API Server: could not find a JWS signature in the cluster-info ConfigMap for token ID "${tokenId}"`);
    if (c.caHash !== cl.caHash) throw new Error(`kubeadm join ${c.cluster.endpoint} --token ... --node-name ${m.name}: cluster CA found in cluster-info ConfigMap is invalid: none of the public keys "sha256:${cl.caHash}" are pinned`);
  }

  private async k8sStatus(node: FakeNode) {
    const c = node.last;
    const m = c ? selfNode(c) : null;
    const st = node.st;
    const out: Json = { version: st.version ?? 0, initialized: !!st.initialized, mounted: st.mounted ?? [], role: m?.role ?? null, index: m?.index ?? null, etcdSnapshot: st.etcdSnapshot ?? null, etcdSnapshotError: st.etcdSnapshotError ?? null, certsRenewedAt: st.certsRenewedAt ?? null, certsError: st.certsError ?? null };
    if (c && m?.role === 'control' && m.index === 0 && st.initialized) {
      const cl = await this.get<Json>(`cluster:k8s:${c.cluster.name}`);
      if (cl) {
        out.caHash = cl.caHash;
        out.kubeconfig = Buffer.from(cl.kubeconfig).toString('base64');
        out.nodes = Object.entries(cl.nodes as Record<string, Json>).map(([name, n]) => ({ name, ready: n.ready, version: n.version }));
        out.services = [];
        out.pvcs = [];
        out.apiHealthy = true;
      }
    }
    return out;
  }

  // ---- appd.py ----

  private app(node: FakeNode, method: string, path: string, secret: string, body: Json) {
    if (secret !== node.secret) return send(401, { error: 'unauthorized' });
    this.settleApps(node);
    if (method === 'GET') {
      if (path === '/status') return send(200, this.appStatus(node));
      if (path.startsWith('/logs')) {
        const q = new Map(path.includes('?') ? path.split('?', 2)[1].split('&').filter((p) => p.includes('=')).map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)] as [string, string]) : []);
        const aid = q.get('app') ?? '';
        const kind = q.get('type') ?? 'build';
        if (!/^[A-Za-z0-9]+$/.test(aid)) return send(400, { error: 'bad_app' });
        const st = node.st.apps[aid] as Json | undefined;
        if (kind === 'runtime') {
          const n = st && st.state === 'live' && !st.stopped ? st.instances ?? 1 : 0;
          return send(200, { log: Array.from({ length: n }, (_, i) => `=== pgcloud-${aid}-${i} ===\n${new Date().toISOString()} listening on port ${st!.port}\n`).join('') });
        }
        return send(200, { log: st?.buildLog ?? '' });
      }
      return send(404, {});
    }
    if (path === '/config') {
      node.last = body;
      this.applyApps(node, body);
      node.st.version = body.version;
      return send(200, { version: body.version });
    }
    return send(404, {});
  }

  private applyApps(node: FakeNode, c: Json) {
    const wanted = new Set((c.apps as Json[]).map((a) => a.id));
    for (const aid of Object.keys(node.st.apps)) if (!wanted.has(aid)) delete node.st.apps[aid];
    for (const app of c.apps as Json[]) {
      const st = (node.st.apps[app.id] ?? {}) as Json;
      if (app.stopped) {
        st.stopped = true;
        node.st.apps[app.id] = st;
        continue;
      }
      delete st.stopped;
      if (st.deployId !== app.deployId && st.state !== 'building') {
        node.st.apps[app.id] = { ...st, deployId: app.deployId, state: 'building', error: null, port: app.port, instances: app.instances, buildLog: `=== build ${app.id} ${new Date().toISOString().slice(0, 19)}Z ===\n$ git clone --depth 1 --branch ${app.branch} ${app.repo}\n` };
        (node.due ??= {})[`build:${app.id}`] = now() + FAKE_AGENT_TIMINGS.buildMs;
        node.st.builds = { ...(node.st.builds ?? {}), [app.id]: { repo: app.repo, branch: app.branch, commit: app.commit } };
      } else {
        node.st.apps[app.id] = { ...st, port: app.port, instances: app.instances };
      }
    }
    // The Caddyfile: one site per live app, with its verified hostnames only.
    node.st.caddySites = (c.apps as Json[]).filter((a) => node.st.apps[a.id]?.state === 'live' && !a.stopped).map((a) => ({ app: a.id, hostnames: a.hostnames }));
  }

  private settleApps(node: FakeNode) {
    let changed = false;
    for (const [key, at] of Object.entries(node.due ?? {})) {
      if (now() < at || !key.startsWith('build:')) continue;
      delete node.due![key];
      const aid = key.slice('build:'.length);
      const st = node.st.apps[aid] as Json | undefined;
      const src = node.st.builds?.[aid] as Json | undefined;
      if (!st || !src) continue;
      // A repository named like "...-broken" has nothing the builder can detect, like an empty repository.
      if (/broken/.test(String(src.repo))) {
        Object.assign(st, { state: 'failed', error: 'no Dockerfile and no Node, Python, Go or static project detected at the repository root' });
        st.buildLog += `=== failed: ${st.error} ===\n`;
      } else {
        const commit = src.commit ?? sha(`${src.repo}#${src.branch}`).slice(0, 40);
        Object.assign(st, { state: 'live', commit, image: `pgcloud-app-${aid}:${commit.slice(0, 12)}`, error: null });
        st.buildLog += `$ docker build -t ${st.image} .\nSuccessfully built ${commit.slice(0, 12)}\n=== live ===\n`;
      }
      changed = true;
    }
    if (changed && node.last) node.st.caddySites = (node.last.apps as Json[]).filter((a) => node.st.apps[a.id]?.state === 'live' && !a.stopped).map((a) => ({ app: a.id, hostnames: a.hostnames }));
  }

  private appStatus(node: FakeNode) {
    const apps: Json = {};
    for (const [aid, st] of Object.entries(node.st.apps as Record<string, Json>)) {
      const { buildLog, port: _port, instances, stopped, ...rest } = st;
      apps[aid] = { ...rest, running: rest.state === 'live' && !stopped ? instances ?? 1 : 0, logTail: String(buildLog ?? '').slice(-4096) };
    }
    const docker = true;
    // Caddy runs as a container that is pulled and started after Docker comes up.
    const caddy = now() >= node.upAt + FAKE_AGENT_TIMINGS.caddyMs;
    return { version: node.st.version ?? 0, apps, memUsed: Object.keys(apps).length, docker, caddy, ready: docker && caddy };
  }

  // ---- deployd.py ----

  private deploy(node: FakeNode, method: string, path: string, secret: string, body: Json) {
    if (secret !== node.secret) return send(401, { error: 'unauthorized' });
    if (node.due?.deploy && now() >= node.due.deploy) {
      delete node.due.deploy;
      const commit = node.st.wantCommit ?? sha(`${node.repo?.url}#${node.repo?.branch}#${node.st.deploys ?? 0}`).slice(0, 40);
      node.st = { ...node.st, status: 'live', commit, deploys: (node.st.deploys ?? 0) + 1, log: `${node.st.log}Cloning into '/srv/app'...\n=== done ${new Date().toISOString()} ===\n` };
    }
    if (method === 'GET') {
      if (path === '/status') return send(200, { status: node.st.status, commit: node.st.commit });
      if (path.startsWith('/logs')) return send(200, { status: node.st.status, commit: node.st.commit, log: node.st.log });
      return send(404, {});
    }
    if (path !== '/redeploy') return send(404, {});
    if (body.token) node.st.gitToken = body.token;
    node.st = { ...node.st, status: 'deploying', wantCommit: body.commit ?? null, log: `${node.st.log}=== deploy ${new Date().toISOString()} ===\n` };
    (node.due ??= {}).deploy = now() + FAKE_AGENT_TIMINGS.deployMs;
    return send(202, { status: 'deploying' });
  }
}

function selfNode(c: Json): Json {
  return (c.cluster.nodes as Json[]).find((n) => n.isSelf)!;
}

/** Which agent a VM's cloud-init installs, and the files that agent reads at start. */
export function parseAgent(userData: string): Partial<FakeNode> {
  const kind: Kind | undefined = userData.includes('/opt/pgcloud/lbd.py') ? 'lb'
    : userData.includes('/opt/pgcloud/dbd.py') ? 'db'
    : userData.includes('/opt/pgcloud/k8sd.py') ? 'k8s'
    : userData.includes('/opt/pgcloud/appd.py') ? 'app'
    : userData.includes('/opt/pgcloud/deployd.py') ? 'deploy'
    : undefined;
  if (!kind) return {};
  const file = (path: string) => new RegExp(`path: ${path.replace(/[.]/g, '\\.')}\\n(?:\\s+permissions: '\\d+'\\n)?\\s+content: '([^']*)'`).exec(userData)?.[1];
  const out: Partial<FakeNode> = { kind, secret: file('/opt/pgcloud/vm.secret') };
  if (kind === 'db') out.engine = file('/opt/pgcloud/engine') as Engine;
  if (kind === 'deploy') out.repo = { url: /REPO='([^']*)'/.exec(userData)?.[1] ?? '', branch: /BRANCH='([^']*)'/.exec(userData)?.[1] ?? 'main' };
  return out;
}

/** kubeadm bootstrap token: [a-z0-9]{6}.[a-z0-9]{16}. */
function kubeadmToken() {
  const part = (n: number) => Array.from(randomBytes(n), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
  return `${part(6)}.${part(16)}`;
}

function kubeconfigFor(c: Json) {
  const ca = randomBytes(48).toString('base64');
  return `apiVersion: v1
kind: Config
clusters:
- cluster:
    certificate-authority-data: ${ca}
    server: https://${c.cluster.endpoint}
  name: ${c.cluster.name}
contexts:
- context:
    cluster: ${c.cluster.name}
    user: kubernetes-admin
  name: kubernetes-admin@${c.cluster.name}
current-context: kubernetes-admin@${c.cluster.name}
users:
- name: kubernetes-admin
  user:
    client-certificate-data: ${randomBytes(48).toString('base64')}
    client-key-data: ${randomBytes(48).toString('base64')}
`;
}
