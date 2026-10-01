/**
 * Progrid Connect: types and small helpers for the agent and automation API under /v1/connect.
 * Shapes follow the shared Connect API contract. Secrets are write-only: responses carry names and
 * masked hints, never values.
 */
import { API_URL, api, getToken } from './api';

export type Effort = 'low' | 'medium' | 'high';
export type AgentStatus = 'draft' | 'deployed' | 'paused';
export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'waiting_approval' | 'cancelled';
export type RunSource = 'api' | 'webhook' | 'test' | 'schedule' | 'manual';

export interface Variable { key: string; description: string; required: boolean; secret: boolean; hasValue: boolean }
export interface Limits { maxSteps: number; maxTokensPerRun: number; timeoutSeconds: number }

export interface Agent {
  id: string; name: string; slug: string; description: string; instructions: string; model: string; effort: Effort; status: AgentStatus;
  currentVersion: number | null; deployedVersion: number | null; toolIds: string[]; workflowId: string | null;
  variables: Variable[]; limits: Limits; runEndpoint: string; createdAt: string; updatedAt: string; lastRunAt: string | null;
}
export interface AgentDetail extends Agent { tools: Tool[]; workflow: Workflow | null; webhooks: Webhook[]; keys: AgentKey[] }

export interface AgentVersion { version: number; createdAt: string; createdBy: string; note: string; snapshot: Record<string, unknown> }

export type ConnectionKind = 'rest_api' | 'postgres' | 'mysql' | 'mongodb' | 'smtp' | 'webhook_out' | 'custom';
export const CONNECTION_KINDS: ConnectionKind[] = ['rest_api', 'postgres', 'mysql', 'mongodb', 'smtp', 'webhook_out', 'custom'];
export const DB_KINDS: ConnectionKind[] = ['postgres', 'mysql', 'mongodb'];
export interface Connection {
  id: string; name: string; kind: ConnectionKind; config: Record<string, unknown>; secretFields: string[]; secretHints: Record<string, string>;
  access: { readOnly: boolean; allowedTables?: string[]; allowedCollections?: string[]; allowedHosts?: string[] };
  status: 'ok' | 'error' | 'untested'; lastTestedAt: string | null; lastError: string | null; createdAt: string;
}

export type ToolKind = 'http_request' | 'database_query' | 'send_email' | 'notify' | 'webhook_out' | 'progrid';
export const TOOL_KINDS: ToolKind[] = ['http_request', 'database_query', 'send_email', 'notify', 'webhook_out', 'progrid'];
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export const PROGRID_ACTIONS = ['list_servers', 'server_metrics', 'server_power', 'list_databases', 'database_status', 'list_buckets', 'list_apps', 'app_logs', 'create_ticket'] as const;
/** Progrid actions that change something; these always go through the approvals queue. */
export const DESTRUCTIVE_ACTIONS = ['server_power'];
export interface Tool {
  id: string; agentId: string; name: string; description: string; kind: ToolKind; connectionId: string | null; enabled: boolean; requiresApproval: boolean;
  config: Record<string, unknown>; inputSchema: Record<string, unknown>;
}
export type ToolDraft = Omit<Tool, 'id' | 'agentId' | 'enabled' | 'requiresApproval'> & { enabled?: boolean; requiresApproval?: boolean };

export type NodeType = 'trigger' | 'agent' | 'tool' | 'condition' | 'action' | 'transform' | 'end';
export const NODE_TYPES: NodeType[] = ['trigger', 'agent', 'tool', 'condition', 'action', 'transform', 'end'];
export interface GraphNode { id: string; type: NodeType; position: { x: number; y: number }; data: Record<string, unknown> }
export interface GraphEdge { id: string; source: string; target: string; sourceHandle?: string | null; label?: string }
export interface Graph { nodes: GraphNode[]; edges: GraphEdge[] }
export interface Workflow { id: string; agentId: string; graph: Graph; updatedAt: string }

export interface Usage { model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; toolCalls: number; apiCalls: number; steps: number }
export interface Run {
  id: string; agentId: string; version: number | null; source: RunSource; status: RunStatus; input: unknown; output: unknown;
  error: { code: string; message: string } | null; startedAt: string; finishedAt: string | null; durationMs: number | null;
  usage: Usage | null; costEstimateMinor: number | null; currency: string; steps?: RunStep[];
}
export interface RunStep {
  id: string; runId: string; index: number; type: 'node' | 'model' | 'tool' | 'condition' | 'approval'; nodeId?: string; name: string; status: string;
  input: unknown; output: unknown; error: { code?: string; message: string } | null; startedAt: string; durationMs: number | null;
  tokens?: { input?: number; output?: number } | null;
}

export interface Webhook { id: string; agentId: string; name: string; path: string; url: string; secretHint: string; signing?: { header: string; algo: string } | null; lastCalledAt: string | null; enabled: boolean }
export interface AgentKey { id: string; agentId: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null }

export interface Model { id: string; label: string; default?: boolean }
export interface Template { slug: string; name: string; description: string; category: string; instructions: string; tools: ToolDraft[]; workflow: Graph | null; variables: Omit<Variable, 'hasValue'>[] }

export interface Draft {
  agent: { name: string; description?: string; instructions: string; model?: string; effort?: Effort };
  tools: ToolDraft[]; workflow: Graph | null; variables: Omit<Variable, 'hasValue'>[];
  connectionsNeeded: { kind: ConnectionKind | string; name: string; reason?: string; usedBy?: string[] }[];
}

export interface Overview {
  agents: number; deployed: number; runs24h: number; failed24h: number; recentRuns: Run[];
  usageThisPeriod?: { executions?: number; aiInputTokens?: number; aiOutputTokens?: number; estimatedCostMinor?: number; currency?: string; pricingConfigured?: boolean } | null;
}

export interface UsageReport {
  period: string;
  totals: { executions: number; workflowExecutions: number; aiInputTokens: number; aiOutputTokens: number; aiCacheReadTokens: number; toolCalls: number; apiCalls: number; computeSeconds: number; storageBytes: number };
  byAgent: { agentId: string; name?: string; executions: number; aiInputTokens?: number; aiOutputTokens?: number; toolCalls?: number; estimatedCostMinor?: number }[];
  byDay: { date: string; executions: number; aiInputTokens?: number }[];
  estimatedCostMinor: number; currency: string; pricingConfigured: boolean;
}

export interface Docs { endpoint: string; auth: unknown; requestSchema: unknown; responseSchema: unknown; examples: { curl: string; javascript: string; python: string; php: string } }

export interface Page<T> { data: T[]; meta?: { next_cursor: string | null; count?: number } }

/** Shorthand for /v1/connect calls. */
export const capi = <T,>(path: string, init?: Parameters<typeof api>[1]) => api<T>(`/v1/connect${path}`, init);
export const post = <T,>(path: string, body?: unknown) => capi<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
export const patch = <T,>(path: string, body: unknown) => capi<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const put = <T,>(path: string, body: unknown) => capi<T>(path, { method: 'PUT', body: JSON.stringify(body) });
export const del = (path: string) => capi<null>(path, { method: 'DELETE' });

/** Every agent with its tools, webhooks and keys: the contract has no cross agent list for webhooks and keys. */
export async function loadAgentDetails(): Promise<AgentDetail[]> {
  const list = await capi<{ data: Agent[] }>('/agents');
  return Promise.all(list.data.map((a) => capi<AgentDetail>(`/agents/${a.id}`)));
}

/**
 * Follow a run's live step stream (SSE). Uses fetch with the session header rather than
 * EventSource so the session token never lands in a URL. Calls onStep for each RunStep update
 * and onRun for run status updates. Returns a function that stops listening.
 */
export function streamRun(runId: string, on: { step: (s: RunStep) => void; run: (r: Run) => void; end: () => void; error: (e: unknown) => void }) {
  const ctrl = new AbortController();
  (async () => {
    const headers: Record<string, string> = { accept: 'text/event-stream' };
    const token = getToken();
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await fetch(`${API_URL}/v1/connect/runs/${runId}/events`, { headers, signal: ctrl.signal });
    if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
        const chunk = buf.slice(0, i);
        buf = buf.slice(i).replace(/^\r?\n\r?\n/, '');
        let event = 'message';
        const data: string[] = [];
        for (const line of chunk.split(/\r?\n/)) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
        if (event === 'end' || event === 'done') { on.end(); ctrl.abort(); return; }
        let parsed: unknown;
        try { parsed = JSON.parse(data.join('\n')); } catch { continue; }
        if (!parsed || typeof parsed !== 'object') continue;
        const o = parsed as Record<string, unknown>;
        // Accept named events or infer from the shape: steps carry an index, runs carry agentId.
        if (event === 'step' || (typeof o.index === 'number' && 'runId' in o)) on.step(o as unknown as RunStep);
        else if (event === 'run' || 'agentId' in o) on.run(o as unknown as Run);
      }
    }
    on.end();
  })().catch((e) => { if (!ctrl.signal.aborted) on.error(e); });
  return () => ctrl.abort();
}

export const FINISHED: RunStatus[] = ['succeeded', 'failed', 'cancelled'];

/** Merge a streamed step into the list, keyed by id, kept in index order. */
export function upsertStep(steps: RunStep[], s: RunStep) {
  const out = steps.filter((x) => x.id !== s.id);
  out.push(s);
  return out.sort((a, b) => a.index - b.index);
}

export const fmtMs = (ms: number | null | undefined) => (ms == null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`);
export const fmtNum = (n: number | null | undefined, locale = 'en') => (n == null ? '—' : new Intl.NumberFormat(locale === 'ar' ? 'ar-SA-u-nu-latn' : locale).format(n));
export const fmtDate = (iso: string | null | undefined, locale = 'en') => (iso ? new Date(iso).toLocaleString(locale === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : locale, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const pretty = (v: unknown) => JSON.stringify(v, null, 2);

/** Parse a JSON text field; returns undefined on bad JSON so forms can show an error. */
export function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  if (!text.trim()) return { ok: true, value: undefined };
  try { return { ok: true, value: JSON.parse(text) }; } catch { return { ok: false }; }
}

export const SNAKE = /^[a-z][a-z0-9_]{0,63}$/;
export const toSnake = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 't_$1').slice(0, 64);
