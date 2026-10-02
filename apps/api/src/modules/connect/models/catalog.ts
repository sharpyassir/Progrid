/**
 * Model catalog. Lives in code (and config for the default), not in the database, so adding a
 * model is one entry here. Prices are the provider's list prices in US dollars per million
 * tokens; they feed the internal cost basis of each run (margin reporting), never the price a
 * customer pays, which comes from the price book (prgd_prices, set by staff).
 */

export type Effort = 'low' | 'medium' | 'high';
export const EFFORTS: Effort[] = ['low', 'medium', 'high'];

export interface ModelPrice {
  inputPerMTokUsd: number;
  outputPerMTokUsd: number;
  cacheReadPerMTokUsd: number;
  /** Five minute cache writes. */
  cacheWritePerMTokUsd: number;
}

export interface ModelInfo {
  id: string;
  label: string;
  description: string;
  provider: 'anthropic';
  /** output_config.effort is sent (adaptive thinking models). Haiku 4.5 takes neither effort nor adaptive thinking. */
  supportsEffort: boolean;
  /** Server side refusal fallbacks (fallbacks: "default"). */
  supportsFallbacks: boolean;
  contextWindow: number;
  maxOutputTokens: number;
  price: ModelPrice;
}

export const MODELS: ModelInfo[] = [
  {
    id: 'claude-opus-5-5',
    label: 'Claude Opus 5.5',
    description: 'Most capable. Best for multistep agents, careful tool use and analysis.',
    provider: 'anthropic',
    supportsEffort: true,
    supportsFallbacks: true,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    price: { inputPerMTokUsd: 4, outputPerMTokUsd: 20, cacheReadPerMTokUsd: 0.2, cacheWritePerMTokUsd: 5 },
  },
  {
    id: 'claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5',
    description: 'Fast and capable at half the price of Opus. A good default for high volume agents.',
    provider: 'anthropic',
    supportsEffort: true,
    supportsFallbacks: false,
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    price: { inputPerMTokUsd: 2, outputPerMTokUsd: 10, cacheReadPerMTokUsd: 0.2, cacheWritePerMTokUsd: 2.5 },
  },
  {
    id: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
    description: 'Fastest and cheapest. Best for simple routing, extraction and short answers.',
    provider: 'anthropic',
    supportsEffort: false,
    supportsFallbacks: false,
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    price: { inputPerMTokUsd: 1, outputPerMTokUsd: 5, cacheReadPerMTokUsd: 0.1, cacheWritePerMTokUsd: 1.25 },
  },
];

/**
 * Models Connect never sends but can be billed for: Anthropic's server side refusal fallbacks
 * from Claude Opus 5.5 answer on Claude Opus 5 or Claude Opus 4.8. Not selectable for agents.
 * List prices: $5 input, $25 output, $0.50 cache read (0.1x input), $6.25 five minute cache
 * write (1.25x input).
 */
export interface PricedModel {
  id: string;
  label: string;
  price: ModelPrice;
}

export const BILLING_ONLY_MODELS: PricedModel[] = [
  { id: 'claude-opus-5', label: 'Claude Opus 5', price: { inputPerMTokUsd: 5, outputPerMTokUsd: 25, cacheReadPerMTokUsd: 0.5, cacheWritePerMTokUsd: 6.25 } },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', price: { inputPerMTokUsd: 5, outputPerMTokUsd: 25, cacheReadPerMTokUsd: 0.5, cacheWritePerMTokUsd: 6.25 } },
];

/** Every model with a price: the selectable ones, then the billing only ones. */
export const PRICED_MODELS: PricedModel[] = [...MODELS, ...BILLING_ONLY_MODELS];

/** A selectable model. */
export function findModel(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

export function isKnownModel(id: string): boolean {
  return !!findModel(id);
}

/** The priced catalog model for an id the API returned: exact, or a dated snapshot (claude-haiku-4-5-20251001). */
export function pricedModel(id: string | null | undefined): PricedModel | undefined {
  if (!id) return undefined;
  return PRICED_MODELS.find((m) => m.id === id) ?? PRICED_MODELS.find((m) => id.startsWith(`${m.id}-`) && /^\d{8}$/.test(id.slice(m.id.length + 1)));
}

/**
 * The catalog model tokens are billed as: the priced model that ran them (fallback models
 * included, dated ids mapped to their catalog id). A model with no price at all is billed as
 * the model the agent asked for, so every token has a price.
 */
export function billingModel(servedBy: string | null | undefined, requested: string): string {
  return pricedModel(servedBy)?.id ?? requested;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** All cache writes, five minute and one hour. */
  cacheWriteTokens: number;
  /** The one hour part of cacheWriteTokens (2x input). */
  cacheWrite1hTokens?: number;
}

/**
 * Provider cost of some usage in micro dollars. $X per million tokens is X micro dollars per
 * token, so this is a plain dot product. Dated ids map to their catalog model; models with no
 * price cost 0 (the fake provider).
 */
export function providerCostMicroUsd(modelId: string | null | undefined, u: TokenUsage): number {
  const m = pricedModel(modelId);
  if (!m) return 0;
  const p = m.price;
  const write1h = Math.min(u.cacheWrite1hTokens ?? 0, u.cacheWriteTokens);
  return Math.round(u.inputTokens * p.inputPerMTokUsd + u.outputTokens * p.outputPerMTokUsd + u.cacheReadTokens * p.cacheReadPerMTokUsd + (u.cacheWriteTokens - write1h) * p.cacheWritePerMTokUsd + write1h * 2 * p.inputPerMTokUsd);
}
