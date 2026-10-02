import type { ResourceType } from '@prisma/client';
import { MODELS } from './models/catalog';

/**
 * Progrid Connect price book shape and rating math. Pure (no I/O) so it can be unit tested and
 * imported by prisma/seed.ts.
 *
 * SKUs
 *  - connect-executions and connect-tool-calls: one price each, per 1,000.
 *  - AI tokens: one SKU per token kind per model, "<base>:<model id>", for example
 *    connect-ai-input-tokens:claude-opus-5-5. Token prices are stored per 10M tokens so every
 *    approved price is a whole number of halalas (Haiku 4.5 cache writes are SAR 5.625 per 1M).
 *    The API shows them per 1M.
 *
 * Metering writes one UsageRecord per SKU per agent per hour. Token rows use the resourceId
 * "<agent id>:<model id>", so the unique (resourceType, resourceId, hourStart) holds one row per
 * model. Executions and tool calls keep resourceId = agent id.
 *
 * Plans with included allowances can be added later on top of this: they would subtract an
 * allowance from these quantities before pricing, without changing the SKUs.
 */

export type TokenKind = 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'cacheWrite1h';
export const TOKEN_KINDS: TokenKind[] = ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheWrite1h'];

/** Tokens one model used. cacheWrite is five minute cache writes only; cacheWrite1h the one hour ones. */
export type ModelTokens = Record<TokenKind, number>;
/** Tokens per model id that answered. */
export type TokensByModel = Record<string, ModelTokens>;

export interface ConnectUsage {
  executions: number;
  toolCalls: number;
  models: TokensByModel;
}

export interface FlatSku {
  sku: string;
  resourceType: ResourceType;
  per: number;
  unit: 'execution' | 'call';
  priceUnit: 'per_1k';
}

export interface TokenSku {
  kind: TokenKind;
  base: string;
  resourceType: ResourceType;
}

export const FLAT_SKUS: FlatSku[] = [
  { sku: 'connect-executions', resourceType: 'connect_execution', per: 1_000, unit: 'execution', priceUnit: 'per_1k' },
  { sku: 'connect-tool-calls', resourceType: 'connect_tool_call', per: 1_000, unit: 'call', priceUnit: 'per_1k' },
];

export const TOKEN_SKUS: TokenSku[] = [
  { kind: 'input', base: 'connect-ai-input-tokens', resourceType: 'connect_ai_input' },
  { kind: 'output', base: 'connect-ai-output-tokens', resourceType: 'connect_ai_output' },
  { kind: 'cacheRead', base: 'connect-ai-cache-read-tokens', resourceType: 'connect_ai_cache_read' },
  { kind: 'cacheWrite', base: 'connect-ai-cache-write-tokens', resourceType: 'connect_ai_cache_write' },
  { kind: 'cacheWrite1h', base: 'connect-ai-cache-write-1h-tokens', resourceType: 'connect_ai_cache_write_1h' },
];

/** Token prices are stored per this many tokens (Price.unit "per_10m"). */
export const TOKENS_PER_PRICE = 10_000_000;
export const TOKEN_PRICE_UNIT = 'per_10m';
/** Every Connect SKU starts with this; the price lookup uses it. */
export const CONNECT_SKU_PREFIX = 'connect-';

export function tokenSku(base: string, model: string) {
  return `${base}:${model}`;
}

/** "<agent id>:<model id>" for token usage rows. */
export function tokenResourceId(agentId: string, model: string) {
  return `${agentId}:${model}`;
}

/** Splits a UsageRecord resourceId into agent and model ("<agent id>:<model id>" for token rows). */
export function parseTokenResourceId(resourceId: string): { agentId: string; model: string | null } {
  const i = resourceId.indexOf(':');
  return i < 0 ? { agentId: resourceId, model: null } : { agentId: resourceId.slice(0, i), model: resourceId.slice(i + 1) };
}

export function emptyTokens(): ModelTokens {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 };
}

/** Adds `add` into `into[model]`. */
export function addTokens(into: TokensByModel, model: string, add: Partial<ModelTokens>) {
  const t = (into[model] ??= emptyTokens());
  for (const k of TOKEN_KINDS) t[k] += add[k] ?? 0;
  return into;
}

/** Reads a stored modelUsage JSON value, ignoring anything malformed. */
export function parseTokensByModel(v: unknown): TokensByModel {
  const out: TokensByModel = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [model, t] of Object.entries(v as Record<string, unknown>)) {
    if (!t || typeof t !== 'object') continue;
    const r = t as Record<string, unknown>;
    addTokens(out, model, Object.fromEntries(TOKEN_KINDS.map((k) => [k, Number(r[k]) || 0])));
  }
  return out;
}

export interface UsageLine {
  sku: string;
  resourceType: ResourceType;
  /** Units per priced quantity (1,000 or 10M). */
  per: number;
  quantity: number;
  unit: 'execution' | 'call' | 'token';
  model?: string;
}

/** Every billable quantity in some usage, one line per SKU (zero quantities left out). */
export function usageLines(u: ConnectUsage): UsageLine[] {
  const out: UsageLine[] = [];
  const flat: Record<string, number> = { 'connect-executions': u.executions, 'connect-tool-calls': u.toolCalls };
  for (const s of FLAT_SKUS) if (flat[s.sku] > 0) out.push({ sku: s.sku, resourceType: s.resourceType, per: s.per, quantity: flat[s.sku], unit: s.unit });
  for (const [model, t] of Object.entries(u.models)) {
    for (const s of TOKEN_SKUS) if (t[s.kind] > 0) out.push({ sku: tokenSku(s.base, model), resourceType: s.resourceType, per: TOKENS_PER_PRICE, quantity: t[s.kind], unit: 'token', model });
  }
  return out;
}

/** Price of one line in book minor units (not rounded). */
export function linePrice(l: UsageLine, prices: Record<string, number>) {
  return (l.quantity * (prices[l.sku] ?? 0)) / l.per;
}

/** Price of some usage in book minor units, from stored prices (sku -> minor per 1,000 or per 10M). Not rounded. */
export function priceUsage(u: ConnectUsage, prices: Record<string, number>): number {
  return usageLines(u).reduce((sum, l) => sum + linePrice(l, prices), 0);
}

/** A stored token price (per 10M) as a price per 1M tokens, in the same minor units. */
export function perMillion(storedPer10M: number) {
  return storedPer10M / (TOKENS_PER_PRICE / 1_000_000);
}

// ───────────── launch price list ─────────────

/**
 * Owner approved launch prices, in riyals excluding 15% VAT. Pay as you go. AI tokens are the
 * Anthropic list price plus 20%, at 3.75 SAR per USD, per 1M tokens. Five minute cache writes
 * are 1.25x input; one hour cache writes 2x input. A unit test checks these against the model
 * catalog's list prices.
 */
export const LIST_MARKUP = 1.2;
export const LAUNCH_EXECUTION_SAR = 0.04;
export const LAUNCH_TOOL_CALL_SAR = 0.02;
export const LAUNCH_TOKEN_SAR_PER_M: Record<string, ModelTokens> = {
  'claude-opus-5-5': { input: 18, output: 90, cacheRead: 0.9, cacheWrite: 22.5, cacheWrite1h: 36 },
  'claude-sonnet-5-5': { input: 9, output: 45, cacheRead: 0.9, cacheWrite: 11.25, cacheWrite1h: 18 },
  'claude-haiku-4-5': { input: 4.5, output: 22.5, cacheRead: 0.45, cacheWrite: 5.625, cacheWrite1h: 9 },
};

export interface LaunchPrice {
  sku: string;
  resourceType: ResourceType;
  unit: string;
  /** Halalas per 1,000 (executions, tool calls) or per 10M tokens. */
  monthlyMinor: number;
}

/** The launch price rows for the book (SAR). */
export function launchPrices(): LaunchPrice[] {
  const halalas = (sar: number) => Math.round(sar * 100);
  const rows: LaunchPrice[] = [
    { sku: 'connect-executions', resourceType: 'connect_execution', unit: 'per_1k', monthlyMinor: halalas(LAUNCH_EXECUTION_SAR * 1_000) },
    { sku: 'connect-tool-calls', resourceType: 'connect_tool_call', unit: 'per_1k', monthlyMinor: halalas(LAUNCH_TOOL_CALL_SAR * 1_000) },
  ];
  for (const m of MODELS) {
    const p = LAUNCH_TOKEN_SAR_PER_M[m.id];
    if (!p) continue;
    for (const s of TOKEN_SKUS) rows.push({ sku: tokenSku(s.base, m.id), resourceType: s.resourceType, unit: TOKEN_PRICE_UNIT, monthlyMinor: halalas(p[s.kind] * (TOKENS_PER_PRICE / 1_000_000)) });
  }
  return rows;
}
