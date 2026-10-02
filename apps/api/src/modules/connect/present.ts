import type { ConnectAgent, ConnectAgentKey, ConnectRun, ConnectTool, ConnectWebhook, ConnectWorkflow } from '@prisma/client';
import { loadConfig } from '../../config/config';
import { normalizeLimits, normalizeVariables } from './runtime/spec';
import { parseTokensByModel } from './pricing';

/** Response shapes (see the Connect contract). Nothing here ever includes a secret value. */

export function publicBase() {
  const c = loadConfig();
  return (c.CONNECT_PUBLIC_BASE_URL ?? c.PUBLIC_API_URL).replace(/\/+$/, '');
}

export function runEndpoint(agentId: string) {
  return `${publicBase()}/v1/connect/agents/${agentId}/run`;
}

export function presentAgent(a: ConnectAgent & { tools?: Pick<ConnectTool, 'id'>[]; workflow?: Pick<ConnectWorkflow, 'id'> | null }, values: { key: string; value?: string; secret: boolean }[] = []) {
  return {
    id: a.id,
    name: a.name,
    slug: a.slug,
    description: a.description,
    instructions: a.instructions,
    model: a.model,
    effort: a.effort,
    status: a.status,
    currentVersion: a.currentVersion,
    deployedVersion: a.deployedVersion,
    toolIds: (a.tools ?? []).map((t) => t.id),
    workflowId: a.workflow?.id ?? null,
    variables: normalizeVariables(a.variables).map((v) => {
      const set = values.find((x) => x.key === v.key);
      return { ...v, hasValue: !!set, ...(set && !v.secret && set.value !== undefined ? { value: set.value } : {}) };
    }),
    limits: normalizeLimits(a.limits),
    runEndpoint: runEndpoint(a.id),
    templateSlug: a.templateSlug,
    projectId: a.projectId,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    lastRunAt: a.lastRunAt,
  };
}

export function presentTool(t: ConnectTool) {
  return {
    id: t.id,
    agentId: t.agentId,
    name: t.name,
    description: t.description,
    kind: t.kind,
    connectionId: t.connectionId,
    enabled: t.enabled,
    requiresApproval: t.requiresApproval,
    config: t.config,
    inputSchema: t.inputSchema,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

export function presentWorkflow(w: ConnectWorkflow | null) {
  if (!w) return null;
  return { id: w.id, agentId: w.agentId, graph: w.graph, updatedAt: w.updatedAt };
}

export function hookUrl(id: string, token?: string) {
  return `${publicBase()}/v1/connect/hooks/${id}/${token ?? '{token}'}`;
}

export function presentWebhook(h: ConnectWebhook, token?: string) {
  return {
    id: h.id,
    agentId: h.agentId,
    name: h.name,
    path: h.path,
    // The token is stored hashed: the full URL is only known when it is created or rotated.
    url: hookUrl(h.id, token),
    secretHint: `••••${h.tokenHint}`,
    signing: h.signingSecret ? { header: 'X-Prgd-Signature', algo: 'hmac-sha256' } : null,
    enabled: h.enabled,
    lastCalledAt: h.lastCalledAt,
    createdAt: h.createdAt,
  };
}

export function presentKey(k: ConnectAgentKey) {
  return { id: k.id, agentId: k.agentId, name: k.name, prefix: k.prefix, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt };
}

export function presentRun(r: ConnectRun, extra: Record<string, unknown> = {}) {
  return {
    id: r.id,
    agentId: r.agentId,
    version: r.version,
    source: r.source,
    status: r.status,
    input: r.input,
    output: r.output,
    error: r.errorCode ? { code: r.errorCode, message: r.errorMessage ?? '' } : null,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    durationMs: r.durationMs,
    usage: {
      model: r.model,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      cacheReadTokens: r.cacheReadTokens,
      cacheWriteTokens: r.cacheWriteTokens,
      toolCalls: r.toolCalls,
      apiCalls: r.apiCalls,
      steps: r.stepCount,
      /** Tokens per model that was billed: {model: {input, output, cacheRead, cacheWrite, cacheWrite1h}}. */
      byModel: parseTokensByModel(r.modelUsage),
    },
    costEstimateMinor: r.costEstimateMinor,
    currency: r.currency,
    workflow: r.workflow,
    createdAt: r.createdAt,
    ...extra,
  };
}
