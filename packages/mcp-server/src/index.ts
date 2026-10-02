#!/usr/bin/env node
/**
 * prgd MCP server. Exposes the public API as tools so Claude Code, Cursor, Windsurf or
 * any MCP client can create servers, deploy repositories and read billing.
 *
 * Every call carries the agent token from PRGD_TOKEN (or ~/.config/prgd/config.json).
 * The API enforces the token's scopes, monthly spending cap and approval rules, so the
 * agent can never exceed what the account owner allowed. Errors such as
 * spend_limit_reached come back to the agent as plain text it can act on.
 *
 *   claude mcp add prgd -e PRGD_TOKEN=prgd_... -- npx -y prgd-mcp
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const VERSION = '0.1.0';

/* ───────────────────────── config ───────────────────────── */

function loadConfig(): { apiUrl: string; token: string } {
  let apiUrl = process.env.PRGD_API_URL ?? '';
  let token = process.env.PRGD_TOKEN ?? '';
  if (!token || !apiUrl) {
    try {
      const path = process.env.XDG_CONFIG_HOME ? join(process.env.XDG_CONFIG_HOME, 'prgd', 'config.json') : join(homedir(), '.config', 'prgd', 'config.json');
      const cfg = JSON.parse(readFileSync(path, 'utf8')) as { api_url?: string; token?: string };
      apiUrl ||= cfg.api_url ?? '';
      token ||= cfg.token ?? '';
    } catch {
      /* no CLI config; env vars must carry everything */
    }
  }
  if (!token) {
    process.stderr.write('prgd-mcp: set PRGD_TOKEN (an agent token from the console or `prgd tokens create NAME --agent --cap 15`)\n');
    process.exit(1);
  }
  return { apiUrl: (apiUrl || 'https://api.progrid.co').replace(/\/$/, ''), token };
}

const cfg = loadConfig();

/* ───────────────────────── http ───────────────────────── */

class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

/** Like api, for endpoints that answer with text (the kubeconfig). */
async function apiText(method: string, path: string): Promise<string> {
  const res = await fetch(cfg.apiUrl + path, { method, headers: { authorization: `Bearer ${cfg.token}`, accept: '*/*', 'user-agent': `prgd-mcp/${VERSION}` } });
  const text = await res.text();
  if (!res.ok) {
    let e: { code?: string; message?: string; details?: unknown } = { code: 'http_error', message: res.statusText };
    try { e = JSON.parse(text)?.error ?? e; } catch { /* plain text error */ }
    throw new ApiError(res.status, e.code ?? 'http_error', e.message ?? res.statusText, e.details);
  }
  return text;
}

async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(cfg.apiUrl + path, {
    method,
    headers: {
      authorization: `Bearer ${cfg.token}`,
      accept: 'application/json',
      'user-agent': `prgd-mcp/${VERSION}`,
      ...(body ? { 'content-type': 'application/json', 'idempotency-key': `mcp-${Date.now()}-${Math.random().toString(36).slice(2)}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const e = json?.error ?? { code: 'http_error', message: res.statusText };
    throw new ApiError(res.status, e.code, e.message, e.details);
  }
  return json as T;
}

/** Turns a result or an error into MCP text content. Errors are returned, not thrown, so the agent can read and adapt. */
async function run(fn: () => Promise<unknown>) {
  try {
    const out = await fn();
    return { content: [{ type: 'text' as const, text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) }] };
  } catch (err) {
    if (err instanceof ApiError) {
      const hint: Record<string, string> = {
        spend_limit_reached: 'This token has a monthly spending cap. Pick a smaller size, delete unused servers, or ask the account owner to raise the cap.',
        forbidden: /scope/.test(err.message)
          ? 'This token was not given that scope. Ask the account owner for a token with the scope, or skip this step.'
          : 'This token requires a human to approve this action in the console. Tell the user what you wanted to do and why.',
        approval_required: 'The request was parked for a person to approve in the console. Tell the user what you asked for and the approval id; call get_approval to see the decision, or continue with other work.',
        quota_exceeded: 'The project quota or region capacity is exhausted. Ask the account owner to raise the quota or try a smaller size.',
        verification_required: 'The account owner must verify their phone number or add credit before servers can be created.',
        invalid_state: 'The server is busy with another operation. Check its status and retry when it is active or off.',
      };
      const text = `Error ${err.code} (HTTP ${err.status}): ${err.message}${err.details ? '\nDetails: ' + JSON.stringify(err.details) : ''}${hint[err.code] ? '\n' + hint[err.code] : ''}`;
      return { content: [{ type: 'text' as const, text }], isError: true };
    }
    return { content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }], isError: true };
  }
}

const money = (minor: number, currency: string) => `${(minor / 100).toFixed(2)} ${currency}`;

/* ───────────────────────── tools ───────────────────────── */

const server = new McpServer({ name: 'prgd', version: VERSION });

server.registerTool('list_servers', {
  title: 'List servers',
  description: 'List the servers in a project with status, public IP, size and image.',
  inputSchema: { project: z.string().optional().describe('Project id or slug. Defaults to "default".') },
}, async ({ project }) => run(async () => {
  const r = await api<{ data: any[] }>('GET', `/v1/servers${project ? `?project=${encodeURIComponent(project)}` : ''}`);
  return r.data.map((s) => ({ id: s.id, name: s.name, status: s.status, ip: s.networks?.v4?.[0]?.ipAddress ?? null, size: s.size?.id, image: s.image?.name, createdAt: s.createdAt }));
}));

server.registerTool('get_server', {
  title: 'Get server',
  description: 'Get one server by id, including status, IPs, size, image and recent actions.',
  inputSchema: { id: z.string() },
}, async ({ id }) => run(async () => {
  const [s, a] = await Promise.all([api('GET', `/v1/servers/${id}`), api<{ data: any[] }>('GET', `/v1/servers/${id}/actions`)]);
  return { ...(s as object), recentActions: a.data.slice(0, 5) };
}));

server.registerTool('list_sizes', {
  title: 'List sizes',
  description: 'Available server sizes with vCPU, memory, disk and price. Prices are in USD unless you pass currency=SAR.',
  inputSchema: { currency: z.enum(['USD', 'SAR']).optional() },
}, async ({ currency }) => run(async () => {
  const p = await api<{ currency: string; fxRate: number; data: any[] }>('GET', `/v1/pricing?currency=${currency ?? 'USD'}`);
  return {
    currency: p.currency,
    exchangeRate: p.fxRate,
    sizes: p.data.filter((x) => x.size).sort((a, b) => a.monthlyMinor - b.monthlyMinor).map((x) => ({ id: x.sku, vcpu: x.size.vcpu, memoryMb: x.size.memoryMb, diskGb: x.size.diskGb, monthly: money(x.monthlyMinor, p.currency), hourly: money(x.hourlyMinor, p.currency) })),
    extras: p.data.filter((x) => !x.size).map((x) => ({ sku: x.sku, unit: x.unit, monthly: x.unit === 'percent' ? `${x.monthlyMinor}% of plan` : money(x.monthlyMinor, p.currency) })),
  };
}));

server.registerTool('list_images', {
  title: 'List images and apps',
  description: 'Operating system images and one click marketplace apps you can create a server from. Use the id (for images) or slug (for apps) as the image argument of create_server.',
  inputSchema: {},
}, async () => run(async () => {
  const [i, a] = await Promise.all([api<{ data: any[] }>('GET', '/v1/images?kind=distribution'), api<{ data: any[] }>('GET', '/v1/apps')]);
  return {
    images: i.data.map((x) => ({ id: x.id, name: x.name })),
    apps: a.data.map((x) => ({ slug: x.slug, name: x.name, category: x.category, minSize: x.minSizeId, variables: x.variables })),
  };
}));

server.registerTool('create_server', {
  title: 'Create server',
  description: 'Create a server. Returns immediately with status "new"; it becomes "active" in about a minute. Call get_server to check. The token\'s monthly spending cap is enforced; a spend_limit_reached error means the plan is too expensive for the remaining cap.',
  inputSchema: {
    name: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/).describe('Hostname label, lowercase letters, digits and hyphens'),
    size: z.string().default('s-1vcpu-2gb').describe('Size id from list_sizes'),
    image: z.string().default('ubuntu-24-04').describe('Image id or marketplace app slug from list_images'),
    snapshotId: z.string().optional().describe('Create a copy of a server from one of its snapshots instead of an image; image is then ignored'),
    project: z.string().optional(),
    userData: z.string().optional().describe('cloud-init user data'),
    appVariables: z.record(z.string()).optional().describe('Variables for a marketplace app, e.g. { admin_email: "..." }'),
    tags: z.array(z.string()).optional(),
    backups: z.boolean().optional().describe('Enable backups at 20% of the plan price'),
    managed: z.boolean().optional().describe('Managed tier: patched, hardened and watched by the care agent, daily backups included, 30% of the plan price plus backups'),
    wait: z.boolean().default(true).describe('Wait up to 2 minutes for the server to become active'),
  },
}, async ({ wait, image, ...body }) => run(async () => {
  const keys = await api<{ data: { id: string }[] }>('GET', '/v1/ssh-keys').catch(() => ({ data: [] }));
  let s = await api<any>('POST', '/v1/servers', { ...body, ...(body.snapshotId ? {} : { image }), sshKeys: keys.data.map((k) => k.id) });
  if (wait) {
    const until = Date.now() + 120_000;
    while (Date.now() < until && !['active', 'failed', 'off'].includes(s.status)) {
      await new Promise((r) => setTimeout(r, 3000));
      s = await api<any>('GET', `/v1/servers/${s.id}`);
    }
  }
  return { id: s.id, name: s.name, status: s.status, ip: s.networks?.v4?.[0]?.ipAddress ?? null, statusMessage: s.statusMessage, ssh: s.networks?.v4?.[0] ? `ssh root@${s.networks.v4[0].ipAddress}` : undefined };
}));

server.registerTool('server_action', {
  title: 'Server action',
  description: 'Start, stop, reboot, resize, rebuild or snapshot a server. Some actions (resize down, rebuild) may require a human to approve them depending on the token.',
  inputSchema: {
    id: z.string(),
    action: z.enum(['start', 'stop', 'reboot', 'resize', 'rebuild', 'snapshot']),
    size: z.string().optional().describe('For resize: target size id'),
    image: z.string().optional().describe('For rebuild: image id'),
    name: z.string().optional().describe('For snapshot: a name'),
  },
}, async ({ id, action, ...rest }) => run(() => api('POST', `/v1/servers/${id}/actions`, { type: action, ...rest })));

server.registerTool('restore_server', {
  title: 'Restore server from snapshot',
  description: 'Roll a server back to one of its own snapshots: it powers off, the disk returns to the snapshot and it powers on again. Everything written since the snapshot is lost, so ask the user first.',
  inputSchema: { id: z.string(), snapshotId: z.string(), confirm: z.literal(true).describe('Must be true. Ask the user before calling.') },
}, async ({ id, snapshotId }) => run(() => api('POST', `/v1/servers/${id}/restore`, { snapshotId })));

server.registerTool('delete_server', {
  title: 'Delete server',
  description: 'Permanently delete a server. Most agent tokens require a human to approve this; if so the API returns an error explaining that.',
  inputSchema: { id: z.string(), confirm: z.literal(true).describe('Must be true. Ask the user before calling.') },
}, async ({ id }) => run(() => api('DELETE', `/v1/servers/${id}`)));

server.registerTool('deploy_repository', {
  title: 'Deploy a Git repository',
  description: 'Create a server that clones a repository, builds it (Dockerfile or docker-compose.yml) and serves it on port 80. Give repoUrl for a public repository, or installationId plus repo ("owner/name") from list_github_repos for any repository the GitHub App can see; app deployments redeploy on every push with no webhook setup.',
  inputSchema: {
    repoUrl: z.string().url().optional().describe('Public https repository URL'),
    installationId: z.string().optional().describe('From list_github_repos'),
    repo: z.string().optional().describe('"owner/name", with installationId'),
    branch: z.string().default('main'),
    port: z.number().int().min(1).max(65535).default(3000).describe('Port the app listens on inside the container'),
    size: z.string().optional(),
    env: z.record(z.string()).optional(),
    name: z.string().optional(),
    project: z.string().optional(),
  },
}, async (body) => run(() => api('POST', '/v1/deploys', body)));

server.registerTool('list_deployments', {
  title: 'List deployments',
  description: 'List Git deployments with status, URL and last commit.',
  inputSchema: { project: z.string().optional() },
}, async ({ project }) => run(async () => (await api<{ data: unknown[] }>('GET', `/v1/deploys${project ? `?project=${encodeURIComponent(project)}` : ''}`)).data));

server.registerTool('redeploy', {
  title: 'Redeploy',
  description: 'Pull the latest commit and rebuild a deployment now.',
  inputSchema: { id: z.string() },
}, async ({ id }) => run(() => api('POST', `/v1/deploys/${id}/redeploy`, {})));

server.registerTool('deploy_logs', {
  title: 'Deployment build log',
  description: 'Tail of the last build log of a deployment plus its status and commit. Use it to see why a build failed.',
  inputSchema: { id: z.string() },
}, async ({ id }) => run(async () => {
  const l = await api<{ status: string; commit: string | null; log: string; live: boolean }>('GET', `/v1/deploys/${id}/logs`);
  return `status: ${l.status}${l.commit ? ` commit: ${l.commit.slice(0, 7)}` : ''}${l.live ? '' : ' (cached)'}\n\n${l.log || '(no build log yet)'}`;
}));

server.registerTool('list_github_repos', {
  title: 'List GitHub repositories',
  description: 'Repositories reachable through the team\'s GitHub App installations, for deploy_repository with installationId and repo. Empty when the team has not connected GitHub.',
  inputSchema: {},
}, async () => run(async () => {
  const inst = await api<{ data: { id: string; accountLogin: string }[] }>('GET', '/v1/github/installations');
  const out: unknown[] = [];
  for (const i of inst.data) {
    const r = await api<{ data: { fullName: string; private: boolean; defaultBranch: string }[] }>('GET', `/v1/github/installations/${i.id}/repos`);
    out.push({ installationId: i.id, account: i.accountLogin, repos: r.data.map((x) => ({ repo: x.fullName, private: x.private, defaultBranch: x.defaultBranch })) });
  }
  return out;
}));

server.registerTool('get_billing', {
  title: 'Billing balance',
  description: 'Credit balance, month to date spend and the account status. Also useful to know what this token can still spend.',
  inputSchema: {},
}, async () => run(async () => {
  const [b, me] = await Promise.all([api<any>('GET', '/v1/billing/balance'), api<any>('GET', '/v1/account')]);
  const tokens = await api<{ data: any[] }>('GET', '/v1/tokens').catch(() => ({ data: [] }));
  const mine = tokens.data.find((t) => t.isAgent && t.spendCapMinor != null);
  return {
    currency: b.currency,
    credit: money(b.creditMinor, b.currency),
    monthToDate: money(b.monthToDateMinor, b.currency),
    accountStatus: b.status,
    team: me.team?.slug,
    scopes: me.scopes,
    tokenCap: mine ? { cap: money(mine.spendCapMinor, b.currency), spent: money(mine.spentThisMonthMinor, b.currency), requiresApprovalFor: mine.requireApprovalFor } : 'not visible with this token',
  };
}));

server.registerTool('get_approval', {
  title: 'Check an approval',
  description: 'Check whether a person has approved a parked request (from an approval_required error). With wait=true, polls for up to 10 minutes. Status is pending, approved, denied, expired or failed; an approved request has already run.',
  inputSchema: { id: z.string(), wait: z.boolean().default(false) },
}, async ({ id, wait }) => run(async () => {
  const until = Date.now() + 10 * 60_000;
  let a = await api<any>('GET', `/v1/approvals/${id}`);
  while (wait && a.status === 'pending' && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 5000));
    a = await api<any>('GET', `/v1/approvals/${id}`);
  }
  return { id: a.id, status: a.status, summary: a.summary, reason: a.reason, decidedBy: a.decidedBy?.name ?? null, result: a.result ?? null, expiresAt: a.expiresAt };
}));

server.registerTool('list_firewalls', {
  title: 'List firewalls',
  description: 'Firewalls in the project with their rules and attached servers.',
  inputSchema: { project: z.string().optional() },
}, async ({ project }) => run(async () => (await api<{ data: unknown[] }>('GET', `/v1/firewalls${project ? `?project=${encodeURIComponent(project)}` : ''}`)).data));

server.registerTool('list_volumes', {
  title: 'List volumes',
  description: 'Block volumes in the project: size, status and which server each is attached to.',
  inputSchema: { project: z.string().optional(), server: z.string().optional().describe('Only volumes attached to this server id') },
}, async ({ project, server: srv }) => run(async () => (await api<{ data: unknown[] }>('GET', `/v1/volumes?${new URLSearchParams({ ...(project ? { project } : {}), ...(srv ? { server: srv } : {}) })}`)).data));

server.registerTool('create_volume', {
  title: 'Create a volume',
  description: 'Creates a block volume (10 GB to 16 TB, billed per GB per month) and optionally attaches it to a server in the same region. The guest sees it at the returned device path; format and mount it there.',
  inputSchema: { name: z.string().regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/), sizeGb: z.number().int().min(10).max(16384), serverId: z.string().optional(), project: z.string().optional() },
}, async (input) => run(() => api('POST', '/v1/volumes', input)));

server.registerTool('volume_action', {
  title: 'Attach, detach, resize or delete a volume',
  description: 'attach needs serverId; resize needs sizeGb (grow only, live when attached); delete needs the volume detached and destroys its data.',
  inputSchema: { volumeId: z.string(), action: z.enum(['attach', 'detach', 'resize', 'delete']), serverId: z.string().optional(), sizeGb: z.number().int().min(10).max(16384).optional() },
}, async ({ volumeId, action, serverId, sizeGb }) => run(async () => {
  if (action === 'delete') return api('DELETE', `/v1/volumes/${volumeId}`);
  if (action === 'attach') return api('POST', `/v1/volumes/${volumeId}/attach`, { serverId });
  if (action === 'resize') return api('POST', `/v1/volumes/${volumeId}/resize`, { sizeGb });
  return api('POST', `/v1/volumes/${volumeId}/detach`, {});
}));

server.registerTool('list_load_balancers', {
  title: 'List load balancers',
  description: 'Load balancers in the project with their IP, forwarding rules and target health.',
  inputSchema: { project: z.string().optional() },
}, async ({ project }) => run(async () => (await api<{ data: unknown[] }>('GET', `/v1/load-balancers${project ? `?project=${encodeURIComponent(project)}` : ''}`)).data));

server.registerTool('create_load_balancer', {
  title: 'Create a load balancer',
  description: 'Creates a managed HAProxy load balancer with its own public IP in front of servers. Each forwarding rule maps an entry port (http, https with a certificateId, or tcp) to a target port. Billed per node per month. Point DNS at the returned ip.',
  inputSchema: {
    name: z.string().regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/),
    forwardingRules: z.array(z.object({ entryProtocol: z.enum(['http', 'https', 'tcp']), entryPort: z.number().int(), targetProtocol: z.enum(['http', 'tcp']), targetPort: z.number().int(), certificateId: z.string().optional() })).min(1),
    serverIds: z.array(z.string()).optional(), tag: z.string().optional().describe('Servers with this tag become targets automatically'),
    nodes: z.number().int().min(1).max(3).optional(), algorithm: z.enum(['round_robin', 'least_conn']).optional(), redirectHttpToHttps: z.boolean().optional(),
    healthCheck: z.object({ protocol: z.enum(['http', 'tcp']).optional(), port: z.number().int().optional(), path: z.string().optional() }).optional(),
    project: z.string().optional(),
  },
}, async (input) => run(() => api('POST', '/v1/load-balancers', input)));

server.registerTool('load_balancer_servers', {
  title: 'Add or remove load balancer targets',
  description: 'add attaches servers to the load balancer; remove detaches one.',
  inputSchema: { loadBalancerId: z.string(), action: z.enum(['add', 'remove']), serverIds: z.array(z.string()).min(1) },
}, async ({ loadBalancerId, action, serverIds }) => run(async () => {
  if (action === 'add') return api('POST', `/v1/load-balancers/${loadBalancerId}/servers`, { serverIds });
  for (const s of serverIds) await api('DELETE', `/v1/load-balancers/${loadBalancerId}/servers/${s}`);
  return api('GET', `/v1/load-balancers/${loadBalancerId}`);
}));

server.registerTool('delete_load_balancer', {
  title: 'Delete a load balancer',
  description: 'Deletes the load balancer, its nodes and releases its IP. Target servers are untouched.',
  inputSchema: { loadBalancerId: z.string() },
}, async ({ loadBalancerId }) => run(() => api('DELETE', `/v1/load-balancers/${loadBalancerId}`)));

server.registerTool('list_domains', {
  title: 'List DNS zones',
  description: 'Hosted DNS zones in the project and the nameservers to set at the registrar. Pass name to get one zone with its records.',
  inputSchema: { name: z.string().optional(), project: z.string().optional() },
}, async ({ name, project }) => run(() => name ? api('GET', `/v1/domains/${name}`) : api('GET', `/v1/domains${project ? `?project=${encodeURIComponent(project)}` : ''}`)));

server.registerTool('create_domain', {
  title: 'Add a DNS zone',
  description: 'Hosts a domain on prgd nameservers (free). Optionally creates an apex A record pointing at ip, for example a server or load balancer address.',
  inputSchema: { name: z.string(), ip: z.string().optional(), project: z.string().optional() },
}, async (input) => run(() => api('POST', '/v1/domains', input)));

server.registerTool('dns_record', {
  title: 'Add, change or delete a DNS record',
  description: 'add needs type and content (A: IPv4, AAAA: IPv6, CNAME/MX/NS: hostname, TXT: text, SRV: "weight port target", CAA: "flags tag value"); update and delete need recordId. Name is relative to the zone, "@" for the apex. Changes are live within seconds.',
  inputSchema: { zone: z.string(), action: z.enum(['add', 'update', 'delete']), recordId: z.string().optional(), name: z.string().optional(), type: z.enum(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA']).optional(), content: z.string().optional(), ttl: z.number().int().optional(), priority: z.number().int().optional() },
}, async ({ zone, action, recordId, ...body }) => run(async () => {
  if (action === 'add') return api('POST', `/v1/domains/${zone}/records`, body);
  if (!recordId) throw new Error('recordId is required');
  if (action === 'delete') return api('DELETE', `/v1/domains/${zone}/records/${recordId}`);
  return api('PATCH', `/v1/domains/${zone}/records/${recordId}`, body);
}));

server.registerTool('list_buckets', {
  title: 'List object storage buckets',
  description: 'S3 compatible buckets in the project with size, object count and the S3 endpoint. Pass name and an optional prefix to list objects in one bucket.',
  inputSchema: { name: z.string().optional(), prefix: z.string().optional(), project: z.string().optional() },
}, async ({ name, prefix, project }) => run(() => name ? api('GET', `/v1/buckets/${name}/objects?prefix=${encodeURIComponent(prefix ?? '')}`) : api('GET', `/v1/buckets${project ? `?project=${encodeURIComponent(project)}` : ''}`)));

server.registerTool('create_bucket', {
  title: 'Create a bucket',
  description: 'Creates an S3 compatible bucket (name is global, 3 to 63 lowercase letters, digits and hyphens). Billed per GB per month. public makes objects readable by anyone.',
  inputSchema: { name: z.string().regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/), public: z.boolean().optional(), project: z.string().optional() },
}, async (input) => run(() => api('POST', '/v1/buckets', input)));

server.registerTool('bucket_presign', {
  title: 'Presigned URL for an object',
  description: 'Returns a short lived URL to GET, PUT or DELETE one object without S3 keys. Use PUT to upload a file, GET to hand a download link to the user.',
  inputSchema: { bucket: z.string(), key: z.string(), method: z.enum(['GET', 'PUT', 'DELETE']).optional(), expiresSeconds: z.number().int().min(60).max(604800).optional(), contentType: z.string().optional() },
}, async ({ bucket, ...body }) => run(() => api('POST', `/v1/buckets/${bucket}/presign`, body)));

server.registerTool('create_storage_key', {
  title: 'Create S3 access key',
  description: 'Creates an access key pair for every bucket in the project. The secret is returned once; give it to the user, never store it in the conversation longer than needed.',
  inputSchema: { name: z.string(), project: z.string().optional() },
}, async (input) => run(() => api('POST', '/v1/storage-keys', input)));

server.registerTool('support_ticket', {
  title: 'Open or read a support ticket',
  description: 'Talk to prgd support on behalf of the user. action "open" creates a ticket (priority must be allowed on the team\'s support plan; free allows low and normal). "list" shows tickets, "get" returns one thread, "reply" adds a message, "close" closes it. Use this when something on the platform looks broken rather than retrying forever.',
  inputSchema: { action: z.enum(['open', 'list', 'get', 'reply', 'close']), id: z.string().optional(), subject: z.string().optional(), body: z.string().optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(), resource: z.string().optional().describe('"server:<id>", "database:<id>", "load_balancer:<id>", "domain:<id>", "bucket:<id>" or "invoice:<id>"') },
}, async ({ action, id, subject, body, priority, resource }) => run(async () => {
  switch (action) {
    case 'open': return api('POST', '/v1/support/tickets', { subject, body, priority, resource });
    case 'list': return api('GET', '/v1/support/tickets');
    case 'get': return api('GET', `/v1/support/tickets/${id}`);
    case 'reply': return api('POST', `/v1/support/tickets/${id}/messages`, { body });
    case 'close': return api('POST', `/v1/support/tickets/${id}/close`, {});
  }
}));

server.registerTool('list_platform_apps', {
  title: 'List App Platform apps',
  description: 'Apps running on the App Platform (containers on shared hosts) with status, URL, size, instances and recent deploys. Pass id for one app with its environment and domains.',
  inputSchema: { id: z.string().optional(), project: z.string().optional() },
}, async ({ id, project }) => run(() => id ? api('GET', `/v1/app-platform/apps/${id}`) : api('GET', `/v1/app-platform/apps${project ? `?project=${encodeURIComponent(project)}` : ''}`)));

server.registerTool('create_platform_app', {
  title: 'Create an App Platform app',
  description: 'Push code, get a URL. Builds the repository (Dockerfile, or a detected Node, Python, Go or static project) and runs it in containers on shared hosts with TLS at https://<name>.<apps domain>. Cheaper than a server for small apps: sizes app-xs (512 MB), app-s (1 GB), app-m (2 GB), app-l (4 GB), billed per instance. Poll list_platform_apps with the id until status is live; on failed, read platform_app_admin logs.',
  inputSchema: { name: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/), repoUrl: z.string().url().optional(), installationId: z.string().optional(), repo: z.string().optional(), branch: z.string().optional(), port: z.number().int().optional(), size: z.enum(['app-xs', 'app-s', 'app-m', 'app-l']).optional(), instances: z.number().int().min(1).max(5).optional(), env: z.record(z.string()).optional(), healthPath: z.string().optional(), project: z.string().optional() },
}, async (input) => run(() => api('POST', '/v1/app-platform/apps', input)));

server.registerTool('platform_app_admin', {
  title: 'Manage an App Platform app',
  description: 'deploy starts a new build; logs returns the build or runtime log; update changes branch, port, size, instances, env (whole set) or healthPath and deploys; stop and start pause and resume billing; add_domain and remove_domain manage custom domains; delete removes the app.',
  inputSchema: { id: z.string(), action: z.enum(['deploy', 'logs', 'update', 'stop', 'start', 'add_domain', 'remove_domain', 'delete']), type: z.enum(['build', 'runtime']).optional(), domain: z.string().optional(), update: z.object({ branch: z.string().optional(), port: z.number().int().optional(), size: z.enum(['app-xs', 'app-s', 'app-m', 'app-l']).optional(), instances: z.number().int().optional(), env: z.record(z.string()).optional(), healthPath: z.string().optional() }).optional() },
}, async ({ id, action, type, domain, update }) => run(async () => {
  const base = `/v1/app-platform/apps/${id}`;
  switch (action) {
    case 'deploy': return api('POST', `${base}/deploy`, {});
    case 'logs': return api('GET', `${base}/logs?type=${type ?? 'build'}`);
    case 'update': return api('PATCH', base, update ?? {});
    case 'stop': return api('POST', `${base}/stop`, {});
    case 'start': return api('POST', `${base}/start`, {});
    case 'add_domain': return api('POST', `${base}/domains`, { domain });
    case 'remove_domain': return api('DELETE', `${base}/domains/${domain}`);
    case 'delete': return api('DELETE', base);
  }
}));

server.registerTool('list_kubernetes', {
  title: 'List Kubernetes clusters',
  description: 'Managed Kubernetes clusters in the project. Pass id for one cluster with its node pools, node readiness, endpoint, and the load balancers and volumes its Services and claims created. The kubeconfig comes from kubernetes_admin.',
  inputSchema: { id: z.string().optional(), project: z.string().optional() },
}, async ({ id, project }) => run(() => id ? api('GET', `/v1/kubernetes/clusters/${id}`) : api('GET', `/v1/kubernetes/clusters${project ? `?project=${encodeURIComponent(project)}` : ''}`)));

server.registerTool('create_kubernetes', {
  title: 'Create a Kubernetes cluster',
  description: 'Creates a managed Kubernetes cluster: one control plane node (included) or three (flat fee) behind one address, plus worker pools sized like servers (at least 2 GB of memory, billed as servers). Ready in about ten minutes; poll list_kubernetes with the id until status is active. Services of type LoadBalancer and PersistentVolumeClaims with the prgd-block class get platform resources on their own.',
  inputSchema: { name: z.string().regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/), version: z.string().optional(), ha: z.boolean().optional(), pools: z.array(z.object({ name: z.string(), size: z.string(), count: z.number().int().min(1).max(50), labels: z.record(z.string()).optional() })).min(1), project: z.string().optional() },
}, async (input) => run(() => api('POST', '/v1/kubernetes/clusters', input)));

server.registerTool('kubernetes_admin', {
  title: 'Manage a Kubernetes cluster',
  description: 'kubeconfig returns the admin kubeconfig (hand it to the user, do not paste it elsewhere). add_pool, scale_pool and remove_pool change worker pools; delete_cluster removes the cluster with its nodes, load balancers and volumes.',
  inputSchema: { id: z.string(), action: z.enum(['kubeconfig', 'add_pool', 'scale_pool', 'remove_pool', 'delete_cluster']), poolId: z.string().optional(), name: z.string().optional(), size: z.string().optional(), count: z.number().int().optional() },
}, async ({ id, action, poolId, name, size, count }) => run(async () => {
  const base = `/v1/kubernetes/clusters/${id}`;
  switch (action) {
    case 'kubeconfig': return { kubeconfig: await apiText('GET', `${base}/kubeconfig`) };
    case 'add_pool': return api('POST', `${base}/pools`, { name, size, count });
    case 'scale_pool': return api('PATCH', `${base}/pools/${poolId}`, { count });
    case 'remove_pool': return api('DELETE', `${base}/pools/${poolId}`);
    case 'delete_cluster': return api('DELETE', base);
  }
}));

server.registerTool('list_databases', {
  title: 'List managed databases',
  description: 'Managed database clusters in the project. Pass id to get one cluster with its connection string and passwords (hand those to the user, do not echo them needlessly).',
  inputSchema: { id: z.string().optional(), project: z.string().optional() },
}, async ({ id, project }) => run(() => id ? api('GET', `/v1/databases/${id}`) : api('GET', `/v1/databases${project ? `?project=${encodeURIComponent(project)}` : ''}`)));

server.registerTool('create_database', {
  title: 'Create a managed database',
  description: 'Creates a managed database cluster we operate: postgres (pgvector included), valkey or mysql; 1 node, or 3 nodes with automatic failover. size is a server size id with at least 1 GB of memory; billed per node per month. Ready in a few minutes; poll list_databases with the id until status is active.',
  inputSchema: { name: z.string().regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/), engine: z.enum(['postgres', 'valkey', 'mysql']).optional(), size: z.string(), nodes: z.union([z.literal(1), z.literal(3)]).optional(), trustedSources: z.array(z.string()).optional(), project: z.string().optional() },
}, async (input) => run(() => api('POST', '/v1/databases', { ...input, engine: input.engine ?? 'postgres' })));

server.registerTool('database_admin', {
  title: 'Manage users, databases, trusted sources or backups of a cluster',
  description: 'action add_user or add_database needs name; delete_user needs userId; delete_database needs dbId; set_trusted_sources needs trustedSources; backup_now takes nothing; delete_cluster destroys the cluster.',
  inputSchema: { databaseId: z.string(), action: z.enum(['add_user', 'delete_user', 'add_database', 'delete_database', 'set_trusted_sources', 'backup_now', 'delete_cluster']), name: z.string().optional(), userId: z.string().optional(), dbId: z.string().optional(), trustedSources: z.array(z.string()).optional() },
}, async ({ databaseId, action, name, userId, dbId, trustedSources }) => run(async () => {
  const base = `/v1/databases/${databaseId}`;
  switch (action) {
    case 'add_user': return api('POST', `${base}/users`, { name });
    case 'delete_user': return api('DELETE', `${base}/users/${userId}`);
    case 'add_database': return api('POST', `${base}/dbs`, { name });
    case 'delete_database': return api('DELETE', `${base}/dbs/${dbId}`);
    case 'set_trusted_sources': return api('PATCH', base, { trustedSources });
    case 'backup_now': return api('POST', `${base}/backups`, {});
    case 'delete_cluster': return api('DELETE', base);
  }
}));

/* ───────────────────────── start ───────────────────────── */

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`prgd-mcp ${VERSION} connected to ${cfg.apiUrl}\n`);
