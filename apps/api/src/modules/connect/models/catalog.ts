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

export function findModel(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

export function isKnownModel(id: string): boolean {
  return !!findModel(id);
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * Provider cost of some usage in micro dollars. $X per million tokens is X micro dollars per
 * token, so this is a plain dot product. Unknown models cost 0 (the fake provider).
 */
export function providerCostMicroUsd(modelId: string, u: TokenUsage): number {
  const m = findModel(modelId);
  if (!m) return 0;
  const p = m.price;
  return Math.round(u.inputTokens * p.inputPerMTokUsd + u.outputTokens * p.outputPerMTokUsd + u.cacheReadTokens * p.cacheReadPerMTokUsd + u.cacheWriteTokens * p.cacheWritePerMTokUsd);
}
