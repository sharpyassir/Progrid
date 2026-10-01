import type { ConnectToolKind } from '@prisma/client';
import type { Effort } from '../models/catalog';
import type { Graph } from './graph';

/** What a run executes: the agent's draft or a deployed version's snapshot, frozen at run start. */

export interface VariableDef {
  key: string;
  description: string;
  required: boolean;
  secret: boolean;
}

export interface Limits {
  maxSteps: number;
  maxTokensPerRun: number;
  timeoutSeconds: number;
}

export const DEFAULT_LIMITS: Limits = { maxSteps: 25, maxTokensPerRun: 200_000, timeoutSeconds: 120 };
export const LIMIT_BOUNDS: Record<keyof Limits, [number, number]> = {
  maxSteps: [1, 200],
  maxTokensPerRun: [1_000, 2_000_000],
  timeoutSeconds: [5, 900],
};

export function normalizeLimits(raw: unknown): Limits {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_LIMITS };
  for (const k of Object.keys(LIMIT_BOUNDS) as (keyof Limits)[]) {
    const v = Number(r[k]);
    if (Number.isFinite(v)) out[k] = Math.round(Math.min(Math.max(v, LIMIT_BOUNDS[k][0]), LIMIT_BOUNDS[k][1]));
  }
  return out;
}

export function normalizeVariables(raw: unknown): VariableDef[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: VariableDef[] = [];
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue;
    const key = String((v as { key?: unknown }).key ?? '');
    if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, description: String((v as { description?: unknown }).description ?? '').slice(0, 500), required: !!(v as { required?: unknown }).required, secret: !!(v as { secret?: unknown }).secret });
  }
  return out;
}

export interface ToolSpec {
  id: string;
  name: string;
  description: string;
  kind: ConnectToolKind;
  connectionId: string | null;
  enabled: boolean;
  requiresApproval: boolean;
  config: Record<string, unknown>;
  inputSchema: Record<string, unknown>;
}

export interface AgentSpec {
  agentId: string;
  teamId: string;
  projectId: string;
  createdById: string;
  name: string;
  description: string;
  instructions: string;
  model: string;
  effort: Effort;
  variables: VariableDef[];
  limits: Limits;
  tools: ToolSpec[];
  workflow: Graph | null;
  /** Deployed version the run pins, or null for the draft. */
  version: number | null;
}

/** The part of a spec stored in an AgentVersion snapshot. */
export type Snapshot = Pick<AgentSpec, 'name' | 'description' | 'instructions' | 'model' | 'effort' | 'variables' | 'limits' | 'tools' | 'workflow'>;
