import { createHmac } from 'node:crypto';
import { safeFetch, NetBlockedError, type SafeResponse } from '../net/guard';
import { render, type TemplateContext } from '../runtime/template';
import { clip } from '../runtime/redact';
import { ToolError, type ToolContext, type ToolExecutor } from './types';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
/** What the model sees of a response body. The full 1 MB stays out of the conversation. */
export const MODEL_BODY_CHARS = 20_000;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function tplCtx(ctx: ToolContext, input: unknown): TemplateContext {
  return { input, vars: ctx.vars, secrets: ctx.secrets };
}

/** Auth headers and query parameters from a rest_api connection. */
export function connectionAuth(ctx: ToolContext): { headers: Record<string, string>; query: Record<string, string> } {
  const c = ctx.connection;
  const headers: Record<string, string> = {};
  const query: Record<string, string> = {};
  if (!c) return { headers, query };
  const defaults = isObj(c.config.defaultHeaders) ? c.config.defaultHeaders : {};
  for (const [k, v] of Object.entries(defaults)) if (typeof v === 'string') headers[k] = v;
  const auth = isObj(c.config.auth) ? c.config.auth : { type: 'none' };
  switch (auth.type) {
    case 'bearer':
      if (c.secrets.token) headers.Authorization = `Bearer ${c.secrets.token}`;
      break;
    case 'basic': {
      const user = c.secrets.username ?? (typeof auth.username === 'string' ? auth.username : '');
      headers.Authorization = `Basic ${Buffer.from(`${user}:${c.secrets.password ?? ''}`).toString('base64')}`;
      break;
    }
    case 'header':
      if (typeof auth.headerName === 'string' && c.secrets.value) headers[auth.headerName] = c.secrets.value;
      break;
    case 'query':
      if (typeof auth.queryName === 'string' && c.secrets.value) query[auth.queryName] = c.secrets.value;
      break;
  }
  return { headers, query };
}

/** Parses a response for the model and the logs. */
export function presentResponse(res: SafeResponse) {
  const type = res.headers['content-type'] ?? '';
  let body: unknown = res.body;
  if (/json/i.test(type)) {
    try {
      body = JSON.parse(res.body);
    } catch {
      body = clip(res.body, MODEL_BODY_CHARS);
    }
  } else {
    body = clip(res.body, MODEL_BODY_CHARS);
  }
  if (typeof body !== 'string' && JSON.stringify(body).length > MODEL_BODY_CHARS) body = clip(JSON.stringify(body), MODEL_BODY_CHARS);
  return { status: res.status, ok: res.status >= 200 && res.status < 300, contentType: type || null, body, truncated: res.truncated, redirects: res.redirects };
}

function fail(err: unknown): never {
  if (err instanceof ToolError) throw err;
  if (err instanceof NetBlockedError) throw new ToolError(`Blocked: ${err.message}`, 'network_blocked');
  throw new ToolError(`Request failed: ${(err as Error).message}`, 'request_failed');
}

/**
 * http_request: a REST call through a rest_api connection (path relative to its baseUrl, auth
 * from its secrets) or, without a connection, to an absolute URL within config.allowedHosts.
 */
export const httpRequestExecutor: ToolExecutor = {
  kind: 'http_request',
  connectionKinds: ['rest_api', 'custom'],
  connectionRequired: false,
  configSchema: {
    type: 'object',
    properties: {
      method: { enum: METHODS },
      path: { type: 'string', maxLength: 2000 },
      url: { type: 'string', maxLength: 2000 },
      query: { type: 'object' },
      headers: { type: 'object' },
      bodyTemplate: {},
      allowedHosts: { type: 'array', items: { type: 'string' } },
      timeoutSeconds: { type: 'integer', minimum: 1, maximum: 15 },
    },
    required: ['method'],
  },
  defaultInputSchema(config) {
    const params = [...String(config.path ?? config.url ?? '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    const props: Record<string, unknown> = {};
    for (const p of params) props[p] = { type: 'string', description: `Value for {${p}} in the path` };
    if (['POST', 'PUT', 'PATCH'].includes(String(config.method)) && config.bodyTemplate === undefined) props.body = { type: 'object', description: 'JSON body to send' };
    if (config.query === undefined && ['GET', 'DELETE'].includes(String(config.method))) props.query = { type: 'object', description: 'Query string parameters', additionalProperties: { type: 'string' } };
    return { type: 'object', properties: props, required: params };
  },
  summarize(config, input) {
    return `${config.method} ${config.path ?? config.url ?? ''} with ${JSON.stringify(input).slice(0, 200)}`;
  },
  async execute(input, config, ctx) {
    const method = String(config.method ?? 'GET').toUpperCase();
    if (!METHODS.includes(method)) throw new ToolError(`method must be one of ${METHODS.join(', ')}`);
    const inp = isObj(input) ? input : {};
    const t = tplCtx(ctx, inp);
    let target: string;
    let allowedHosts: string[] | undefined;
    if (ctx.connection) {
      const base = String(ctx.connection.config.baseUrl ?? '');
      if (!base) throw new ToolError('the connection has no baseUrl');
      // {{...}} references first (variables, input), then {param} placeholders from the input.
      const rawPath = String(render(String(config.path ?? ''), t, 'tool') ?? '');
      const path = rawPath.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(String(inp[k] ?? '')));
      if (/^[a-z]+:\/\//i.test(path)) throw new ToolError('path must be relative to the connection base URL');
      target = base.replace(/\/+$/, '') + (path ? `/${path.replace(/^\/+/, '')}` : '');
      const baseHost = new URL(base).hostname;
      allowedHosts = ctx.connection.access.allowedHosts?.length ? ctx.connection.access.allowedHosts : [baseHost];
    } else {
      const url = String(render(String(config.url ?? ''), t, 'tool') ?? '');
      if (!url) throw new ToolError('this tool has no connection, so config.url is required');
      allowedHosts = Array.isArray(config.allowedHosts) ? (config.allowedHosts as string[]) : undefined;
      if (!allowedHosts?.length) throw new ToolError('a tool without a connection needs config.allowedHosts');
      target = url.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(String(inp[k] ?? '')));
    }

    const url = new URL(target);
    const auth = connectionAuth(ctx);
    const templQuery = isObj(config.query) ? (render(config.query, t, 'tool') as Record<string, unknown>) : isObj(inp.query) ? inp.query : {};
    for (const [k, v] of Object.entries({ ...templQuery, ...auth.query })) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = { accept: 'application/json, text/plain;q=0.9, */*;q=0.5', 'user-agent': 'Progrid-Connect/1.0', ...auth.headers };
    if (isObj(config.headers)) for (const [k, v] of Object.entries(render(config.headers, t, 'tool') as Record<string, unknown>)) if (v !== undefined && v !== null) headers[k] = String(v);

    let body: string | undefined;
    if (!['GET', 'DELETE'].includes(method) || config.bodyTemplate !== undefined) {
      const raw = config.bodyTemplate !== undefined ? render(config.bodyTemplate, t, 'tool') : inp.body ?? Object.fromEntries(Object.entries(inp).filter(([k]) => !String(config.path ?? '').includes(`{${k}}`)));
      if (raw !== undefined) {
        body = typeof raw === 'string' ? raw : JSON.stringify(raw);
        if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['content-type'] = typeof raw === 'string' ? 'text/plain' : 'application/json';
      }
    }
    ctx.countApiCall();
    try {
      const res = await safeFetch(url.toString(), { method, headers, body }, { policy: ctx.policy, allowedHosts, timeoutMs: Math.min(Number(config.timeoutSeconds ?? 15), 15) * 1000 });
      const out = presentResponse(res);
      if (!out.ok) throw new ToolError(`HTTP ${res.status}: ${clip(typeof out.body === 'string' ? out.body : JSON.stringify(out.body), 2000)}`, 'http_error');
      return out;
    } catch (err) {
      fail(err);
    }
  },
};

/** Signature header value for outbound webhooks: t=<unix>,v1=<hex hmac of "t.body">. */
export function signPayload(secret: string, body: string, now = Date.now()) {
  const t = Math.floor(now / 1000).toString();
  return { timestamp: t, signature: `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}` };
}

/** webhook_out: POST a JSON event to an outbound webhook connection, signed when it has a signing secret. */
export const webhookOutExecutor: ToolExecutor = {
  kind: 'webhook_out',
  connectionKinds: ['webhook_out'],
  connectionRequired: true,
  configSchema: { type: 'object', properties: { event: { type: 'string', maxLength: 100 }, payloadTemplate: {} } },
  defaultInputSchema() {
    return { type: 'object', properties: { data: { type: 'object', description: 'Event data to send' } }, required: ['data'] };
  },
  summarize(config) {
    return `Send the ${String(config.event ?? 'agent.event')} webhook`;
  },
  async execute(input, config, ctx) {
    const c = ctx.connection!;
    const url = String(c.config.url ?? '');
    const data = config.payloadTemplate !== undefined ? render(config.payloadTemplate, tplCtx(ctx, input), 'tool') : isObj(input) && 'data' in input ? input.data : input;
    return postWebhook(url, { event: String(config.event ?? 'agent.event'), data }, ctx, c.secrets.signingSecret, isObj(c.config.headers) ? (c.config.headers as Record<string, string>) : {});
  },
};

export async function postWebhook(url: string, payload: { event: string; data: unknown }, ctx: ToolContext, signingSecret?: string, extraHeaders: Record<string, string> = {}) {
  const body = JSON.stringify({ event: payload.event, agentId: ctx.agentId, runId: ctx.runId, sentAt: new Date().toISOString(), data: payload.data });
  const headers: Record<string, string> = { 'content-type': 'application/json', 'user-agent': 'Progrid-Connect/1.0', ...extraHeaders };
  if (signingSecret) {
    const sig = signPayload(signingSecret, body);
    headers['x-prgd-signature'] = sig.signature;
    headers['x-prgd-timestamp'] = sig.timestamp;
  }
  ctx.countApiCall();
  try {
    const res = await safeFetch(url, { method: 'POST', headers, body }, { policy: ctx.policy, allowedHosts: ctx.connection?.access.allowedHosts });
    const out = presentResponse(res);
    if (!out.ok) throw new ToolError(`Webhook answered HTTP ${res.status}`, 'http_error');
    return { delivered: true, status: res.status };
  } catch (err) {
    fail(err);
  }
}
