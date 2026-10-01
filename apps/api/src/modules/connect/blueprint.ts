import { validateGraph, type Graph, type GraphIssue } from './runtime/graph';
import { normalizeVariables, type VariableDef } from './runtime/spec';
import { EFFORTS, isKnownModel, type Effort } from './models/catalog';
import { isValidSchema } from './tools/schema';
import { CONNECTION_KINDS, TOOL_KINDS } from './dto';

/**
 * A blueprint is everything an agent is made of, before it exists: templates are blueprints,
 * and Build with AI returns one as its draft. In a blueprint, workflow nodes reference tools by
 * NAME (tool ids do not exist yet) and tools reference connections by a placeholder `ref` that
 * the user maps to a real connection when saving.
 */

export interface BlueprintTool {
  name: string;
  description: string;
  kind: (typeof TOOL_KINDS)[number];
  connectionRef?: string | null;
  requiresApproval?: boolean;
  enabled?: boolean;
  config: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
}

export interface ConnectionNeeded {
  ref: string;
  kind: (typeof CONNECTION_KINDS)[number];
  name: string;
  description: string;
}

export interface Blueprint {
  agent: { name: string; description: string; instructions: string; model?: string; effort?: Effort };
  tools: BlueprintTool[];
  workflow: Graph | null;
  variables: VariableDef[];
  connectionsNeeded: ConnectionNeeded[];
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Checks a blueprint from any source (template, model output, client) and returns a cleaned
 * copy plus every problem. `checkConfig` validates a tool config for its kind.
 */
export function validateBlueprint(raw: unknown, checkConfig: (kind: string, config: unknown) => string | null): { blueprint: Blueprint; issues: GraphIssue[] } {
  const issues: GraphIssue[] = [];
  const r = isObj(raw) ? raw : {};
  const a = isObj(r.agent) ? r.agent : {};
  const agent: Blueprint['agent'] = {
    name: String(a.name ?? '').trim().slice(0, 80),
    description: String(a.description ?? '').slice(0, 500),
    instructions: String(a.instructions ?? '').slice(0, 50_000),
  };
  if (!agent.name) issues.push({ path: 'agent.name', message: 'name is required' });
  if (a.model !== undefined && a.model !== null && a.model !== '') {
    if (typeof a.model === 'string' && isKnownModel(a.model)) agent.model = a.model;
    else issues.push({ path: 'agent.model', message: `unknown model ${String(a.model)}` });
  }
  if (a.effort !== undefined && a.effort !== null) {
    if (EFFORTS.includes(a.effort as Effort)) agent.effort = a.effort as Effort;
    else issues.push({ path: 'agent.effort', message: 'effort must be low, medium or high' });
  }

  const connectionsNeeded: ConnectionNeeded[] = [];
  const refs = new Set<string>();
  (Array.isArray(r.connectionsNeeded) ? r.connectionsNeeded : []).forEach((c, i) => {
    if (!isObj(c)) return issues.push({ path: `connectionsNeeded[${i}]`, message: 'must be an object' });
    const ref = String(c.ref ?? '');
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(ref)) return issues.push({ path: `connectionsNeeded[${i}].ref`, message: 'ref must be snake_case' });
    if (refs.has(ref)) return issues.push({ path: `connectionsNeeded[${i}].ref`, message: `duplicate ref ${ref}` });
    if (!CONNECTION_KINDS.includes(c.kind as never)) return issues.push({ path: `connectionsNeeded[${i}].kind`, message: `kind must be one of ${CONNECTION_KINDS.join(', ')}` });
    refs.add(ref);
    connectionsNeeded.push({ ref, kind: c.kind as ConnectionNeeded['kind'], name: String(c.name ?? ref).slice(0, 80), description: String(c.description ?? '').slice(0, 500) });
  });

  const tools: BlueprintTool[] = [];
  const names = new Set<string>();
  (Array.isArray(r.tools) ? r.tools : []).forEach((t, i) => {
    const path = `tools[${i}]`;
    if (!isObj(t)) return issues.push({ path, message: 'must be an object' });
    const name = String(t.name ?? '');
    if (!TOOL_NAME.test(name)) return issues.push({ path: `${path}.name`, message: 'name must be snake_case (max 64)' });
    if (names.has(name)) return issues.push({ path: `${path}.name`, message: `duplicate tool name ${name}` });
    names.add(name);
    if (!TOOL_KINDS.includes(t.kind as never)) return issues.push({ path: `${path}.kind`, message: `kind must be one of ${TOOL_KINDS.join(', ')}` });
    const config = isObj(t.config) ? t.config : {};
    const problem = checkConfig(String(t.kind), config);
    if (problem) issues.push({ path: `${path}.config`, message: `${name}: ${problem}` });
    let inputSchema: Record<string, unknown> | undefined;
    if (t.inputSchema !== undefined && t.inputSchema !== null) {
      const err = isValidSchema(t.inputSchema);
      if (err) issues.push({ path: `${path}.inputSchema`, message: `${name}: ${err}` });
      else inputSchema = t.inputSchema as Record<string, unknown>;
    }
    const connectionRef = typeof t.connectionRef === 'string' && t.connectionRef ? t.connectionRef : null;
    if (connectionRef && !refs.has(connectionRef)) issues.push({ path: `${path}.connectionRef`, message: `${name} uses connection ${connectionRef}, which is not in connectionsNeeded` });
    tools.push({ name, description: String(t.description ?? '').slice(0, 2000), kind: t.kind as BlueprintTool['kind'], connectionRef, requiresApproval: !!t.requiresApproval, enabled: t.enabled !== false, config, ...(inputSchema ? { inputSchema } : {}) });
  });

  let workflow: Graph | null = null;
  if (r.workflow !== undefined && r.workflow !== null) {
    const { graph, issues: gi } = validateGraph(r.workflow, { toolIds: names });
    issues.push(...gi.map((g) => ({ path: `workflow.${g.path}`, message: g.message })));
    workflow = graph;
  }
  return { blueprint: { agent, tools, workflow, variables: normalizeVariables(r.variables), connectionsNeeded }, issues };
}

/** Replaces tool names with ids inside a blueprint workflow (agent toolIds, tool node toolId). */
export function bindToolIds(graph: Graph, idByName: Map<string, string>): Graph {
  return {
    edges: graph.edges,
    nodes: graph.nodes.map((n) => {
      const data = { ...(n.data ?? {}) };
      if (n.type === 'tool' && typeof data.toolId === 'string') data.toolId = idByName.get(data.toolId) ?? data.toolId;
      if (n.type === 'agent' && Array.isArray(data.toolIds)) data.toolIds = (data.toolIds as string[]).map((t) => idByName.get(t) ?? t);
      return { ...n, data };
    }),
  };
}
