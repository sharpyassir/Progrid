/**
 * prgd SDK for TypeScript and JavaScript.
 *
 *   import { Prgd } from '@prgd/sdk';
 *   const prgd = new Prgd({ token: process.env.PRGD_TOKEN! });
 *   const server = await prgd.servers.create({ name: 'web-1', size: 's-1vcpu-1gb', image: 'ubuntu-24-04' });
 *   await prgd.servers.waitUntilActive(server.id);
 *
 * Types come from the OpenAPI document (src/types.gen.ts, regenerated with `pnpm gen`).
 * Every mutating call sends an Idempotency-Key, so a retried request never doubles a resource.
 */
import type { components, paths } from './types.gen.js';

export type Schemas = components['schemas'];
export type Paths = paths;
export type Approval = Schemas['Approval'];
export type Checkout = Schemas['Checkout'];
export type ApiErrorBody = Schemas['Error'];

export interface Server {
  id: string; name: string; status: string; statusMessage: string | null;
  region: { id: string; name: string }; size: { id: string; vcpu: number; memoryMb: number; diskGb: number; transferTb: number };
  image: { id: string; name: string; kind: string };
  networks: { v4: { ipAddress: string; floating?: boolean; reverseDns?: string | null }[]; private: { ipAddress: string }[] };
  firewalls: string[]; backupsEnabled: boolean; managed: boolean; managedHealth: 'ok' | 'warn' | 'stale' | 'pending' | null; projectId: string; tags: string[]; createdAt: string;
}
export interface SupportPlan { id: string; name: string; summary: string; features: string[]; targets: Record<'low' | 'normal' | 'high' | 'urgent', number | null>; maxOpen: number; currency: string; monthlyMinor: number }
export interface Ticket { id: string; number: number; subject: string; status: 'open' | 'answered' | 'closed'; priority: 'low' | 'normal' | 'high' | 'urgent'; plan: string; resource: string | null; firstResponseDueAt: string | null; firstRespondedAt: string | null; lastCustomerAt: string; lastSupportAt: string | null; closedAt: string | null; createdAt: string; updatedAt: string; messageCount: number; messages?: { id: string; fromSupport: boolean; author: string; body: string; createdAt: string }[] }
export interface ManagedStatus { serverId: string; managed: boolean; backupsEnabled: boolean; health: 'ok' | 'warn' | 'stale' | 'pending' | null; issues: string[]; reportedAt: string | null; report: Record<string, unknown> | null; installCommand: string | null }
export interface Deployment { id: string; name: string; repoUrl: string; repo: string | null; source: 'github_app' | 'url'; branch: string; port: number; status: string; url: string | null; serverId: string; serverStatus: string; lastCommit: string | null; lastDeployAt: string | null; createdAt: string }
export interface Size { id: string; vcpu: number; memoryMb: number; diskGb: number; transferTb: number }
export interface Image { id: string; kind: 'distribution' | 'marketplace'; name: string; distribution?: string; version?: string }
export interface Price { resourceType: string; sku: string; unit: string; monthlyMinor: number; hourlyMinor: number }
export interface Balance { currency: 'USD' | 'SAR'; creditMinor: number; monthToDateMinor: number; status: string }
export interface Firewall { id: string; name: string; rules: FirewallRule[]; servers: { serverId: string }[] }
export interface FirewallRule { id?: string; direction: 'inbound' | 'outbound'; protocol: 'tcp' | 'udp' | 'icmp' | 'any'; ports?: string | null; cidrs: string[]; description?: string }
export interface Snapshot { id: string; name: string; kind: 'manual' | 'backup'; status: string; sizeGb: number; serverId: string | null; createdAt: string }
export type VolumeStatus = 'creating' | 'available' | 'attaching' | 'attached' | 'detaching' | 'resizing' | 'deleting' | 'failed' | 'deleted';
export interface Volume { id: string; name: string; sizeGb: number; status: VolumeStatus; statusMessage: string | null; serverId: string | null; device: string | null; regionId: string; projectId: string; createdAt: string; server: { id: string; name: string } | null }
export interface ForwardingRule { entryProtocol: 'http' | 'https' | 'tcp'; entryPort: number; targetProtocol: 'http' | 'tcp'; targetPort: number; certificateId?: string }
export interface HealthCheck { protocol?: 'http' | 'tcp'; port?: number; path?: string; intervalSeconds?: number; timeoutSeconds?: number; healthyThreshold?: number; unhealthyThreshold?: number }
export interface StickySessions { type: 'none' | 'cookie'; cookieName?: string; ttlSeconds?: number }
export type LoadBalancerStatus = 'creating' | 'active' | 'updating' | 'failed' | 'deleting' | 'deleted';
export interface LoadBalancer { id: string; name: string; status: LoadBalancerStatus; statusMessage: string | null; ip: string | null; regionId: string; projectId: string; algorithm: 'round_robin' | 'least_conn'; nodes: number; forwardingRules: ForwardingRule[]; healthCheck: Required<HealthCheck>; stickySessions: StickySessions | null; redirectHttpToHttps: boolean; proxyProtocol: boolean; tag: string | null; configVersion: number; nodeStatus: { index: number; status: string; appliedVersion: number; lastSeenAt: string | null }[]; targets: { serverId: string; name: string; status: string; healthy: boolean | null; lastCheckedAt: string | null }[]; createdAt: string }
export interface CreateLoadBalancer { name: string; region?: string; project?: string; nodes?: number; algorithm?: 'round_robin' | 'least_conn'; forwardingRules: ForwardingRule[]; healthCheck?: HealthCheck; stickySessions?: StickySessions; redirectHttpToHttps?: boolean; proxyProtocol?: boolean; serverIds?: string[]; tag?: string }
export interface Certificate { id: string; name: string; type: 'custom' | 'letsencrypt'; domains: string[]; notAfter: string | null; createdAt: string }
export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'NS' | 'SRV' | 'CAA';
export interface DnsRecord { id: string; name: string; type: DnsRecordType; content: string; ttl: number; priority: number | null; updatedAt: string }
export interface Domain { id: string; name: string; status: string; statusMessage: string | null; serial: number; synced: boolean; nameservers: string[]; recordCount: number; createdAt: string }
export interface Bucket { id: string; name: string; status: string; statusMessage: string | null; regionId: string; projectId: string; public: boolean; sizeBytes: number; objectCount: number; usageUpdatedAt: string | null; endpoint: string; url: string; createdAt: string }
export interface StorageObject { key: string; size: number; lastModified: string; etag?: string }
export interface StorageKey { id: string; name: string; accessKey: string; createdAt: string; lastUsedAt: string | null }
export interface PlatformApp { id: string; name: string; status: string; statusMessage: string | null; url: string; hostname: string; customDomains: string[]; region: { id: string; name: string }; repoUrl: string; repo: string | null; source: 'github_app' | 'url'; branch: string; port: number; size: { id: string; memoryMb: number; cpus: number }; instances: number; healthPath: string | null; env: Record<string, string>; hostIp: string | null; lastCommit: string | null; lastDeployAt: string | null; deploys: { id: string; status: string; trigger: string; commit: string | null; startedAt: string; finishedAt: string | null }[]; projectId: string; createdAt: string }
export interface KubeNode { id: string; name: string; role: 'control' | 'worker'; index: number; poolId: string | null; status: string; ready: boolean; kubeVersion: string | null; ip: string | null; privateIp: string | null; lastSeenAt: string | null }
export interface KubePool { id: string; name: string; size: { id: string; vcpu: number; memoryMb: number; diskGb: number }; count: number; labels: Record<string, string>; taints: { key: string; value?: string; effect?: string }[]; nodes: KubeNode[] }
export interface KubeCluster { id: string; name: string; version: string; status: string; statusMessage: string | null; ha: boolean; region: { id: string; name: string }; controlSize: { id: string; vcpu: number; memoryMb: number; diskGb: number }; endpoint: string | null; host: string | null; podCidr: string; serviceCidr: string; configVersion: number; pools: KubePool[]; controlPlane: KubeNode[]; cloud: { loadBalancers: { service: string; loadBalancerId: string; ip: string | null }[]; volumes: { claim: string; volumeId: string; node: string; sizeGb: number; mounted: boolean }[] }; workers: number; readyNodes: number; projectId: string; createdAt: string }
export interface DatabaseCluster { id: string; name: string; engine: 'postgres' | 'valkey' | 'mysql'; version: string; status: string; statusMessage: string | null; nodes: number; size: { id: string; vcpu: number; memoryMb: number; diskGb: number }; port: number; poolerPort: number | null; trustedSources: string[]; backupHourUtc: number; connection: { host: string | null; privateHost: string | null; port: number; database: string; user?: string; password?: string; uri?: string | null; privateUri?: string | null; appUri?: string | null }; users: { id: string; name: string; password?: string }[]; databases: { id: string; name: string }[]; nodeStatus: { index: number; status: string; role: string; lagBytes: number | null }[]; createdAt: string }
export interface SshKey { id: string; name: string; fingerprint: string; createdAt: string }
export interface ApiToken { id: string; name: string; prefix: string; scopes: string[]; isAgent: boolean; spendCapMinor: number | null; spentThisMonthMinor: number; requireApprovalFor: string[]; expiresAt: string | null; lastUsedAt: string | null; createdAt: string }
export interface MetricPoint { at: string; cpu: number; cpuMax?: number; memoryUsedMb: number; memoryTotalMb: number; netInBps: number; netOutBps: number; diskReadBps: number; diskWriteBps: number; diskUsedPercent?: number | null }
export interface MetricSeries { serverId: string; period: string; resolution: 'minute' | 'hour'; from: string; to: string; latest: MetricPoint | null; points: MetricPoint[] }
export type AlertMetric = 'cpu' | 'memory' | 'disk' | 'net_in' | 'net_out';
export interface AlertPolicy { id: string; name: string; metric: AlertMetric; comparator: 'above' | 'below'; threshold: number; windowMinutes: number; serverIds: string[]; tags: string[]; emails: string[]; enabled: boolean; createdAt: string }
export interface AlertIncident { id: string; policyId: string; serverId: string; value: number; peakValue: number; startedAt: string; resolvedAt: string | null }
export interface List<T> { data: T[]; meta?: { next_cursor?: string | null } }

export class PrgdError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, unknown>) {
    super(message);
    this.name = 'PrgdError';
  }
  /** True for approval_required: a person must approve in the console; `details.approvalId` says which. */
  get needsApproval() { return this.code === 'approval_required'; }
}

export interface PrgdOptions {
  token: string;
  /** Defaults to https://api.prgd.example/v1 or PRGD_API_URL. */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Project id or slug applied to project scoped calls when set. */
  project?: string;
  userAgent?: string;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export class Prgd {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly opts: PrgdOptions) {
    if (!opts.token) throw new Error('prgd: token is required');
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.PRGD_API_URL;
    this.base = (opts.baseUrl ?? env ?? 'https://api.prgd.example').replace(/\/+$/, '').replace(/\/v1$/, '');
    this.fetchImpl = opts.fetch ?? fetch;
  }

  /** Raw call. Prefer the resource helpers below. */
  async request<T>(method: Method, path: string, body?: unknown, query?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { authorization: `Bearer ${this.opts.token}`, accept: 'application/json', 'user-agent': this.opts.userAgent ?? 'prgd-sdk-ts/0.1.0' };
    if (body !== undefined) { headers['content-type'] = 'application/json'; headers['idempotency-key'] = randomKey(); }
    const res = await this.fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    const json = text ? safeJson(text) : null;
    if (!res.ok) {
      const e = (json as { error?: ApiErrorBody['error'] } | null)?.error;
      throw new PrgdError(res.status, e?.code ?? 'http_error', e?.message ?? res.statusText, e?.details as Record<string, unknown> | undefined);
    }
    return json as T;
  }

  /** Like request, for endpoints that answer with text (the kubeconfig). */
  async requestText(method: Method, path: string): Promise<string> {
    const res = await this.fetchImpl(new URL(this.base + path), { method, headers: { authorization: `Bearer ${this.opts.token}`, accept: '*/*', 'user-agent': this.opts.userAgent ?? 'prgd-sdk-ts/0.1.0' } });
    const text = await res.text();
    if (!res.ok) {
      const e = (safeJson(text) as { error?: ApiErrorBody['error'] } | null)?.error;
      throw new PrgdError(res.status, e?.code ?? 'http_error', e?.message ?? res.statusText, e?.details as Record<string, unknown> | undefined);
    }
    return text;
  }

  readonly account = {
    me: () => this.request<{ user: { id: string; email: string; name: string; totpEnabled: boolean; emailVerified: boolean }; team: { id: string; slug: string; name: string; currency: 'USD' | 'SAR' }; role: string; scopes: string[]; isAgent: boolean; isStaff: boolean }>('GET', '/v1/account'),
    tokens: () => this.request<List<ApiToken>>('GET', '/v1/tokens'),
    createToken: (body: { name: string; scopes: string[]; isAgent?: boolean; spendCapMinor?: number; requireApprovalFor?: string[]; projectId?: string; expiresInDays?: number }) => this.request<ApiToken & { token: string }>('POST', '/v1/tokens', body),
    revokeToken: (id: string) => this.request<void>('DELETE', `/v1/tokens/${id}`),
    sshKeys: () => this.request<List<SshKey>>('GET', '/v1/ssh-keys'),
    addSshKey: (body: { name: string; publicKey: string }) => this.request<SshKey>('POST', '/v1/ssh-keys', body),
  };

  readonly catalog = {
    sizes: () => this.request<List<Size>>('GET', '/v1/sizes'),
    images: (kind?: 'distribution' | 'marketplace') => this.request<List<Image>>('GET', '/v1/images', undefined, { kind }),
    regions: () => this.request<List<{ id: string; name: string; country: string }>>('GET', '/v1/regions'),
    pricing: (currency: 'USD' | 'SAR' = 'USD') => this.request<{ currency: string; baseCurrency: 'USD'; fxRate: number; hoursPerMonth: number; data: Price[] }>('GET', '/v1/pricing', undefined, { currency }),
  };

  readonly servers = {
    list: (q?: { project?: string; status?: string; tag?: string }) => this.request<List<Server>>('GET', '/v1/servers', undefined, { project: this.opts.project, ...q }),
    get: (id: string) => this.request<Server>('GET', `/v1/servers/${id}`),
    create: (body: { name: string; size: string; image: string; region?: string; project?: string; sshKeys?: string[]; userData?: string; tags?: string[]; backups?: boolean; managed?: boolean; firewalls?: string[]; appVariables?: Record<string, string> }) =>
      this.request<Server>('POST', '/v1/servers', { project: this.opts.project, ...body }),
    action: (id: string, body: { type: 'start' | 'stop' | 'reboot' | 'resize' | 'rebuild' | 'snapshot'; size?: string; image?: string; name?: string; force?: boolean }) =>
      this.request<{ id: string; type: string; status: string }>('POST', `/v1/servers/${id}/actions`, body),
    actions: (id: string) => this.request<List<{ id: string; type: string; status: string; startedAt: string; finishedAt: string | null; error: string | null }>>('GET', `/v1/servers/${id}/actions`),
    update: (id: string, body: { name?: string; tags?: string[]; backups?: boolean; managed?: boolean }) => this.request<Server>('PATCH', `/v1/servers/${id}`, body),
    /** Managed tier: health, the agent's last report and the install command while it is not reporting. */
    managed: (id: string) => this.request<ManagedStatus>('GET', `/v1/servers/${id}/managed`),
    delete: (id: string) => this.request<{ id: string; status: string }>('DELETE', `/v1/servers/${id}`),
    /** CPU, memory, network and disk series. Minute resolution up to 24h, hourly for 7d and 30d. */
    metrics: (id: string, period: '1h' | '6h' | '24h' | '7d' | '30d' = '1h') => this.request<MetricSeries>('GET', `/v1/servers/${id}/metrics`, undefined, { period }),
    /** Polls until the server is active, off or failed. Throws on failed. */
    waitUntilActive: async (id: string, opts: { timeoutMs?: number; intervalMs?: number } = {}) => {
      const until = Date.now() + (opts.timeoutMs ?? 180_000);
      for (;;) {
        const s = await this.servers.get(id);
        if (s.status === 'active' || s.status === 'off') return s;
        if (s.status === 'failed') throw new PrgdError(500, 'server_failed', s.statusMessage ?? 'Server provisioning failed');
        if (Date.now() > until) throw new PrgdError(504, 'timeout', `Server ${id} is still ${s.status}`);
        await sleep(opts.intervalMs ?? 3000);
      }
    },
  };

  readonly deploys = {
    list: (project?: string) => this.request<List<Deployment>>('GET', '/v1/deploys', undefined, { project: project ?? this.opts.project }),
    get: (id: string) => this.request<Deployment>('GET', `/v1/deploys/${id}`),
    create: (body: { repoUrl?: string; installationId?: string; repo?: string; branch?: string; port?: number; size?: string; env?: Record<string, string>; name?: string; project?: string; gitToken?: string }) =>
      this.request<Deployment & { webhook: { url: string; secret: string } | null }>('POST', '/v1/deploys', { project: this.opts.project, ...body }),
    redeploy: (id: string) => this.request<{ id: string; status: string }>('POST', `/v1/deploys/${id}/redeploy`, {}),
    logs: (id: string) => this.request<{ id: string; status: string; commit: string | null; log: string; updatedAt: string | null; live: boolean }>('GET', `/v1/deploys/${id}/logs`),
  };

  readonly firewalls = {
    list: () => this.request<List<Firewall>>('GET', '/v1/firewalls'),
    get: (id: string) => this.request<Firewall>('GET', `/v1/firewalls/${id}`),
    create: (body: { name: string; rules: FirewallRule[]; project?: string }) => this.request<Firewall>('POST', '/v1/firewalls', { project: this.opts.project, ...body }),
    attach: (id: string, serverId: string) => this.request<void>('POST', `/v1/firewalls/${id}/servers`, { serverId }),
    detach: (id: string, serverId: string) => this.request<void>('DELETE', `/v1/firewalls/${id}/servers/${serverId}`),
    delete: (id: string) => this.request<void>('DELETE', `/v1/firewalls/${id}`),
  };

  readonly snapshots = {
    list: () => this.request<List<Snapshot>>('GET', '/v1/snapshots'),
    delete: (id: string) => this.request<void>('DELETE', `/v1/snapshots/${id}`),
  };

  readonly volumes = {
    list: (q?: { server?: string }) => this.request<List<Volume>>('GET', '/v1/volumes', undefined, { project: this.opts.project, ...q }),
    get: (id: string) => this.request<Volume>('GET', `/v1/volumes/${id}`),
    create: (body: { name: string; sizeGb: number; region?: string; project?: string; serverId?: string }) => this.request<Volume>('POST', '/v1/volumes', { project: this.opts.project, ...body }),
    attach: (id: string, serverId: string) => this.request<Volume>('POST', `/v1/volumes/${id}/attach`, { serverId }),
    detach: (id: string) => this.request<Volume>('POST', `/v1/volumes/${id}/detach`, {}),
    resize: (id: string, sizeGb: number) => this.request<Volume>('POST', `/v1/volumes/${id}/resize`, { sizeGb }),
    delete: (id: string) => this.request<void>('DELETE', `/v1/volumes/${id}`),
    /** Polls until the volume settles (available, attached or failed) or the timeout passes. */
    waitUntilSettled: async (id: string, timeoutMs = 300_000) => {
      const until = Date.now() + timeoutMs;
      for (;;) {
        const v = await this.volumes.get(id);
        if (['available', 'attached', 'failed'].includes(v.status) || Date.now() > until) return v;
        await sleep(2000);
      }
    },
  };

  readonly loadBalancers = {
    list: () => this.request<List<LoadBalancer>>('GET', '/v1/load-balancers', undefined, { project: this.opts.project }),
    get: (id: string) => this.request<LoadBalancer>('GET', `/v1/load-balancers/${id}`),
    create: (body: CreateLoadBalancer) => this.request<LoadBalancer>('POST', '/v1/load-balancers', { project: this.opts.project, ...body }),
    update: (id: string, body: Partial<Omit<CreateLoadBalancer, 'region' | 'project' | 'nodes' | 'serverIds'>>) => this.request<LoadBalancer>('PATCH', `/v1/load-balancers/${id}`, body),
    addServers: (id: string, serverIds: string[]) => this.request<LoadBalancer>('POST', `/v1/load-balancers/${id}/servers`, { serverIds }),
    removeServer: (id: string, serverId: string) => this.request<LoadBalancer>('DELETE', `/v1/load-balancers/${id}/servers/${serverId}`),
    delete: (id: string) => this.request<void>('DELETE', `/v1/load-balancers/${id}`),
    /** Polls until the load balancer is active or failed, or the timeout passes. */
    waitUntilActive: async (id: string, timeoutMs = 900_000) => {
      const until = Date.now() + timeoutMs;
      for (;;) {
        const lb = await this.loadBalancers.get(id);
        if (['active', 'failed'].includes(lb.status) || Date.now() > until) return lb;
        await sleep(3000);
      }
    },
  };

  readonly certificates = {
    list: () => this.request<List<Certificate>>('GET', '/v1/certificates', undefined, { project: this.opts.project }),
    create: (body: { name: string; type: 'custom' | 'letsencrypt'; certPem?: string; keyPem?: string; domains?: string[]; project?: string }) => this.request<Certificate>('POST', '/v1/certificates', { project: this.opts.project, ...body }),
    delete: (id: string) => this.request<{ id: string; deleted: boolean }>('DELETE', `/v1/certificates/${id}`),
  };

  readonly domains = {
    list: () => this.request<{ data: Domain[]; nameservers: string[] }>('GET', '/v1/domains', undefined, { project: this.opts.project }),
    get: (name: string) => this.request<Domain & { records: DnsRecord[] }>('GET', `/v1/domains/${name}`),
    create: (body: { name: string; ip?: string; project?: string }) => this.request<Domain & { records: DnsRecord[] }>('POST', '/v1/domains', { project: this.opts.project, ...body }),
    delete: (name: string) => this.request<{ name: string; deleted: boolean }>('DELETE', `/v1/domains/${name}`),
    zoneFile: (name: string) => this.request<string>('GET', `/v1/domains/${name}/zone-file`),
    addRecord: (name: string, body: { name: string; type: DnsRecordType; content: string; ttl?: number; priority?: number }) => this.request<DnsRecord>('POST', `/v1/domains/${name}/records`, body),
    updateRecord: (name: string, id: string, body: { name?: string; content?: string; ttl?: number; priority?: number }) => this.request<DnsRecord>('PATCH', `/v1/domains/${name}/records/${id}`, body),
    deleteRecord: (name: string, id: string) => this.request<{ id: string; deleted: boolean }>('DELETE', `/v1/domains/${name}/records/${id}`),
    setReverseDns: (publicIpId: string, hostname: string | null) => this.request<{ id: string; address: string; reverseDns: string | null; synced: boolean }>('PUT', `/v1/public-ips/${publicIpId}/reverse-dns`, { name: hostname }),
  };

  readonly buckets = {
    list: () => this.request<{ data: Bucket[]; endpoint: string; region: string }>('GET', '/v1/buckets', undefined, { project: this.opts.project }),
    get: (name: string) => this.request<Bucket>('GET', `/v1/buckets/${name}`),
    create: (body: { name: string; region?: string; public?: boolean; project?: string }) => this.request<Bucket>('POST', '/v1/buckets', { project: this.opts.project, ...body }),
    setPublic: (name: string, isPublic: boolean) => this.request<Bucket>('PATCH', `/v1/buckets/${name}`, { public: isPublic }),
    delete: (name: string) => this.request<{ name: string; deleted: boolean }>('DELETE', `/v1/buckets/${name}`),
    listObjects: (name: string, prefix = '', token?: string) => this.request<{ prefix: string; prefixes: string[]; objects: StorageObject[]; nextToken?: string }>('GET', `/v1/buckets/${name}/objects`, undefined, { prefix, token }),
    deleteObject: (name: string, key: string) => this.request<{ key: string; deleted: boolean }>('DELETE', `/v1/buckets/${name}/objects`, undefined, { key }),
    presign: (name: string, key: string, method: 'GET' | 'PUT' | 'DELETE' = 'GET', expiresSeconds = 900, contentType?: string) => this.request<{ url: string; method: string; key: string; expiresAt: string }>('POST', `/v1/buckets/${name}/presign`, { key, method, expiresSeconds, contentType }),
    /** Uploads a body through a presigned PUT. */
    upload: async (name: string, key: string, body: Blob | ArrayBuffer | Uint8Array | string, contentType = 'application/octet-stream') => {
      const { url } = await this.buckets.presign(name, key, 'PUT', 900, contentType);
      const r = await fetch(url, { method: 'PUT', body: body as BodyInit, headers: { 'content-type': contentType } });
      if (!r.ok) throw new PrgdError(r.status, 'upload_failed', `Upload of ${key} failed with ${r.status}`);
    },
  };

  readonly storageKeys = {
    list: () => this.request<{ data: StorageKey[]; endpoint: string; region: string }>('GET', '/v1/storage-keys', undefined, { project: this.opts.project }),
    create: (name: string) => this.request<StorageKey & { secretKey: string; endpoint: string; region: string }>('POST', '/v1/storage-keys', { name, project: this.opts.project }),
    revoke: (id: string) => this.request<{ id: string; revoked: boolean }>('DELETE', `/v1/storage-keys/${id}`),
  };

  readonly support = {
    /** Plan catalog with prices in the given currency. */
    plans: (currency: 'USD' | 'SAR' = 'USD') => this.request<List<SupportPlan>>('GET', '/v1/support/plans', undefined, { currency }),
    plan: () => this.request<{ plan: string; since: string | null; openTickets: number; details?: SupportPlan }>('GET', '/v1/support/plan'),
    setPlan: (plan: 'free' | 'developer' | 'standard' | 'premium') => this.request<{ plan: string; since: string | null; openTickets: number; details?: SupportPlan }>('PUT', '/v1/support/plan', { plan }),
    tickets: (q?: { status?: 'open' | 'answered' | 'closed' | 'all' }) => this.request<List<Ticket>>('GET', '/v1/support/tickets', undefined, q),
    ticket: (id: string) => this.request<Ticket>('GET', `/v1/support/tickets/${id}`),
    /** Opens a ticket. Priority must be allowed on the team's plan; `resource` is "server:<id>", "database:<id>" and so on. */
    open: (body: { subject: string; body: string; priority?: 'low' | 'normal' | 'high' | 'urgent'; resource?: string }) => this.request<Ticket>('POST', '/v1/support/tickets', body),
    reply: (id: string, body: string) => this.request<Ticket>('POST', `/v1/support/tickets/${id}/messages`, { body }),
    close: (id: string) => this.request<Ticket>('POST', `/v1/support/tickets/${id}/close`, {}),
  };

  /** App Platform: containers on shared hosts, sized and billed per instance. */
  readonly appPlatform = {
    sizes: () => this.request<List<{ id: string; memoryMb: number; cpus: number }>>('GET', '/v1/app-platform/sizes'),
    list: () => this.request<List<PlatformApp>>('GET', '/v1/app-platform/apps', undefined, { project: this.opts.project }),
    get: (id: string) => this.request<PlatformApp>('GET', `/v1/app-platform/apps/${id}`),
    /** Returns 202 with status `creating`; poll `get` or use `waitUntilLive`. */
    create: (body: { name: string; repoUrl?: string; installationId?: string; repo?: string; gitToken?: string; branch?: string; port?: number; size?: 'app-xs' | 'app-s' | 'app-m' | 'app-l'; instances?: number; env?: Record<string, string>; healthPath?: string; region?: string; project?: string }) => this.request<PlatformApp>('POST', '/v1/app-platform/apps', { project: this.opts.project, ...body }),
    /** Any change deploys again. `env` replaces the whole set. */
    update: (id: string, body: { branch?: string; port?: number; size?: 'app-xs' | 'app-s' | 'app-m' | 'app-l'; instances?: number; env?: Record<string, string>; healthPath?: string; gitToken?: string }) => this.request<PlatformApp>('PATCH', `/v1/app-platform/apps/${id}`, body),
    deploy: (id: string) => this.request<PlatformApp>('POST', `/v1/app-platform/apps/${id}/deploy`, {}),
    stop: (id: string) => this.request<PlatformApp>('POST', `/v1/app-platform/apps/${id}/stop`, {}),
    start: (id: string) => this.request<PlatformApp>('POST', `/v1/app-platform/apps/${id}/start`, {}),
    delete: (id: string) => this.request<{ id: string; status: string }>('DELETE', `/v1/app-platform/apps/${id}`),
    deploys: (id: string) => this.request<List<{ id: string; status: string; trigger: string; commit: string | null; startedAt: string; finishedAt: string | null; log: string | null }>>('GET', `/v1/app-platform/apps/${id}/deploys`),
    logs: (id: string, type: 'build' | 'runtime' = 'build') => this.request<{ id: string; type: string; log: string; live: boolean; updatedAt: string }>('GET', `/v1/app-platform/apps/${id}/logs`, undefined, { type }),
    addDomain: (id: string, domain: string) => this.request<PlatformApp>('POST', `/v1/app-platform/apps/${id}/domains`, { domain }),
    removeDomain: (id: string, domain: string) => this.request<PlatformApp>('DELETE', `/v1/app-platform/apps/${id}/domains/${domain}`),
    waitUntilLive: async (id: string, timeoutMs = 25 * 60_000, intervalMs = 5000) => {
      const until = Date.now() + timeoutMs;
      for (;;) {
        const a = await this.request<PlatformApp>('GET', `/v1/app-platform/apps/${id}`);
        if (a.status === 'live') return a;
        if (a.status === 'failed') throw new PrgdError(500, 'app_failed', a.statusMessage ?? 'Build failed');
        if (Date.now() > until) throw new PrgdError(504, 'timeout', `App ${id} is still ${a.status}`);
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    },
  };

  readonly kubernetes = {
    versions: () => this.request<List<{ version: string; default: boolean }>>('GET', '/v1/kubernetes/versions'),
    list: () => this.request<List<KubeCluster>>('GET', '/v1/kubernetes/clusters', undefined, { project: this.opts.project }),
    get: (id: string) => this.request<KubeCluster>('GET', `/v1/kubernetes/clusters/${id}`),
    /** Creates a cluster; returns 202 with status `creating`. Poll `get` until `active`. */
    create: (body: { name: string; version?: string; region?: string; project?: string; ha?: boolean; controlSize?: string; pools: { name: string; size: string; count: number; labels?: Record<string, string>; taints?: { key: string; value?: string; effect?: string }[] }[] }) => this.request<KubeCluster>('POST', '/v1/kubernetes/clusters', { project: this.opts.project, ...body }),
    update: (id: string, body: { name?: string }) => this.request<KubeCluster>('PATCH', `/v1/kubernetes/clusters/${id}`, body),
    delete: (id: string) => this.request<{ id: string; status: string }>('DELETE', `/v1/kubernetes/clusters/${id}`),
    /** The admin kubeconfig as YAML text. */
    kubeconfig: (id: string) => this.requestText('GET', `/v1/kubernetes/clusters/${id}/kubeconfig`),
    addPool: (id: string, body: { name: string; size: string; count: number; labels?: Record<string, string>; taints?: { key: string; value?: string; effect?: string }[] }) => this.request<KubeCluster>('POST', `/v1/kubernetes/clusters/${id}/pools`, body),
    scalePool: (id: string, poolId: string, count: number) => this.request<KubeCluster>('PATCH', `/v1/kubernetes/clusters/${id}/pools/${poolId}`, { count }),
    removePool: (id: string, poolId: string) => this.request<KubeCluster>('DELETE', `/v1/kubernetes/clusters/${id}/pools/${poolId}`),
    waitUntilActive: async (id: string, timeoutMs = 30 * 60_000, intervalMs = 10_000) => {
      const until = Date.now() + timeoutMs;
      for (;;) {
        const c = await this.request<KubeCluster>('GET', `/v1/kubernetes/clusters/${id}`);
        if (c.status === 'active') return c;
        if (c.status === 'failed') throw new PrgdError(500, 'kubernetes_failed', c.statusMessage ?? 'Cluster provisioning failed');
        if (Date.now() > until) throw new PrgdError(504, 'timeout', `Cluster ${id} is still ${c.status}`);
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    },
  };

  readonly databases = {
    list: () => this.request<List<DatabaseCluster>>('GET', '/v1/databases', undefined, { project: this.opts.project }),
    get: (id: string) => this.request<DatabaseCluster>('GET', `/v1/databases/${id}`),
    create: (body: { name: string; engine: 'postgres' | 'valkey' | 'mysql'; size: string; nodes?: 1 | 3; version?: string; region?: string; project?: string; trustedSources?: string[]; backupHourUtc?: number }) => this.request<DatabaseCluster>('POST', '/v1/databases', { project: this.opts.project, ...body }),
    update: (id: string, body: { trustedSources?: string[]; backupHourUtc?: number }) => this.request<DatabaseCluster>('PATCH', `/v1/databases/${id}`, body),
    delete: (id: string) => this.request<{ id: string; status: string }>('DELETE', `/v1/databases/${id}`),
    addUser: (id: string, name: string) => this.request<{ id: string; name: string; password: string }>('POST', `/v1/databases/${id}/users`, { name }),
    resetPassword: (id: string, userId: string) => this.request<{ id: string; name: string; password: string }>('POST', `/v1/databases/${id}/users/${userId}/reset-password`, {}),
    deleteUser: (id: string, userId: string) => this.request<{ id: string; deleted: boolean }>('DELETE', `/v1/databases/${id}/users/${userId}`),
    addDatabase: (id: string, name: string) => this.request<{ id: string; name: string }>('POST', `/v1/databases/${id}/dbs`, { name }),
    deleteDatabase: (id: string, dbId: string) => this.request<{ id: string; deleted: boolean }>('DELETE', `/v1/databases/${id}/dbs/${dbId}`),
    backups: (id: string) => this.request<List<{ id: string; kind: string; status: string; sizeBytes: number | null; startedAt: string; completedAt: string | null }>>('GET', `/v1/databases/${id}/backups`),
    backupNow: (id: string) => this.request<{ id: string; status: string }>('POST', `/v1/databases/${id}/backups`, {}),
    waitUntilActive: async (id: string, timeoutMs = 900_000) => {
      const until = Date.now() + timeoutMs;
      for (;;) {
        const c = await this.databases.get(id);
        if (['active', 'failed'].includes(c.status) || Date.now() > until) return c;
        await sleep(5000);
      }
    },
  };

  readonly billing = {
    balance: () => this.request<Balance>('GET', '/v1/billing/balance'),
    usage: (q?: { project?: string; from?: string; to?: string }) => this.request<List<{ resourceType: string; resourceId: string; unit: string; quantity: number; amountMinor: number; currency: string }>>('GET', '/v1/billing/usage', undefined, { project: this.opts.project, ...q }),
    invoices: () => this.request<List<{ id: string; number: string; status: string; totalMinor: number; currency: string; periodStart: string; dueAt: string | null }>>('GET', '/v1/billing/invoices'),
    topup: (amountMinor: number) => this.request<Checkout>('POST', '/v1/billing/topup', { amountMinor }),
    payInvoice: (id: string) => this.request<Checkout>('POST', `/v1/billing/invoices/${id}/pay`, {}),
  };

  readonly alerts = {
    list: () => this.request<List<AlertPolicy & { _count: { incidents: number } }>>('GET', '/v1/alerts'),
    get: (id: string) => this.request<AlertPolicy & { incidents: AlertIncident[] }>('GET', `/v1/alerts/${id}`),
    create: (body: { name: string; metric: AlertMetric; comparator?: 'above' | 'below'; threshold: number; windowMinutes?: number; serverIds?: string[]; tags?: string[]; emails?: string[]; enabled?: boolean }) => this.request<AlertPolicy>('POST', '/v1/alerts', body),
    update: (id: string, body: Partial<{ name: string; metric: AlertMetric; comparator: 'above' | 'below'; threshold: number; windowMinutes: number; serverIds: string[]; tags: string[]; emails: string[]; enabled: boolean }>) => this.request<AlertPolicy>('PATCH', `/v1/alerts/${id}`, body),
    delete: (id: string) => this.request<void>('DELETE', `/v1/alerts/${id}`),
    incidents: (open?: boolean) => this.request<List<AlertIncident & { policy: { name: string; metric: AlertMetric; threshold: number } }>>('GET', '/v1/alerts/incidents', undefined, { open: open ? 'true' : undefined }),
  };

  readonly approvals = {
    list: (status?: string) => this.request<{ data: Approval[]; pending: number }>('GET', '/v1/approvals', undefined, { status }),
    get: (id: string) => this.request<Approval>('GET', `/v1/approvals/${id}`),
    approve: (id: string) => this.request<Approval>('POST', `/v1/approvals/${id}/approve`, {}),
    deny: (id: string, reason?: string) => this.request<Approval>('POST', `/v1/approvals/${id}/deny`, { reason }),
    /** Polls a pending approval until it is decided or the timeout passes. */
    wait: async (id: string, timeoutMs = 600_000) => {
      const until = Date.now() + timeoutMs;
      for (;;) {
        const a = await this.approvals.get(id);
        if (a.status !== 'pending' || Date.now() > until) return a;
        await sleep(5000);
      }
    },
  };
}

function randomKey() {
  const g = globalThis.crypto as Crypto | undefined;
  return g?.randomUUID ? g.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
function safeJson(t: string) { try { return JSON.parse(t); } catch { return null; } }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
