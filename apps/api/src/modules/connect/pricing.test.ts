import { describe, expect, it } from 'vitest';
import { BILLING_ONLY_MODELS, MODELS, PRICED_MODELS } from './models/catalog';
import { ConnectUsageService } from './usage.service';
import { LAUNCH_TOKEN_SAR_PER_M, LIST_MARKUP, TOKENS_PER_PRICE, addTokens, launchPrices, parseTokenResourceId, parseTokensByModel, perMillion, priceUsage, usageLines, type ConnectUsage } from './pricing';

const book = Object.fromEntries(launchPrices().map((p) => [p.sku, p.monthlyMinor]));

describe('Connect launch prices', () => {
  it('are the owner approved SAR prices, stored per 1,000 and per 10M tokens', () => {
    expect(book['connect-executions']).toBe(4_000); // SAR 0.04 per execution
    expect(book['connect-tool-calls']).toBe(2_000); // SAR 0.02 per tool call
    const perM = (sku: string) => perMillion(book[sku]) / 100; // SAR per 1M
    expect(perM('connect-ai-input-tokens:claude-opus-5-5')).toBe(18);
    expect(perM('connect-ai-output-tokens:claude-opus-5-5')).toBe(90);
    expect(perM('connect-ai-cache-read-tokens:claude-opus-5-5')).toBe(0.9);
    expect(perM('connect-ai-cache-write-tokens:claude-opus-5-5')).toBe(22.5);
    expect(perM('connect-ai-cache-write-1h-tokens:claude-opus-5-5')).toBe(36);
    expect(perM('connect-ai-input-tokens:claude-sonnet-5-5')).toBe(9);
    expect(perM('connect-ai-output-tokens:claude-sonnet-5-5')).toBe(45);
    expect(perM('connect-ai-cache-read-tokens:claude-sonnet-5-5')).toBe(0.9);
    expect(perM('connect-ai-cache-write-tokens:claude-sonnet-5-5')).toBe(11.25);
    expect(perM('connect-ai-input-tokens:claude-haiku-4-5')).toBe(4.5);
    expect(perM('connect-ai-output-tokens:claude-haiku-4-5')).toBe(22.5);
    expect(perM('connect-ai-cache-read-tokens:claude-haiku-4-5')).toBe(0.45);
    expect(book['connect-ai-cache-write-tokens:claude-haiku-4-5']).toBe(5_625); // SAR 5.625 per 1M, a whole number of halalas per 10M
    expect(launchPrices().every((p) => Number.isInteger(p.monthlyMinor) && p.monthlyMinor > 0)).toBe(true);
    // Billing only fallback models (Claude Opus 5 and Opus 4.8): list $5 / $25 / $0.50 plus 20%.
    for (const id of ['claude-opus-5', 'claude-opus-4-8']) {
      expect([perM(`connect-ai-input-tokens:${id}`), perM(`connect-ai-output-tokens:${id}`), perM(`connect-ai-cache-read-tokens:${id}`), perM(`connect-ai-cache-write-tokens:${id}`), perM(`connect-ai-cache-write-1h-tokens:${id}`)]).toEqual([22.5, 112.5, 2.25, 28.125, 45]);
    }
    expect(launchPrices()).toHaveLength(2 + 5 * PRICED_MODELS.length);
    expect(PRICED_MODELS).toHaveLength(5);
  });

  it('are the catalog list price plus 20% at 3.75 SAR per USD, with cache writes at 1.25x and 2x input', () => {
    for (const m of PRICED_MODELS) {
      const sar = LAUNCH_TOKEN_SAR_PER_M[m.id];
      const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-9);
      close(sar.input, m.price.inputPerMTokUsd * LIST_MARKUP * 3.75);
      close(sar.output, m.price.outputPerMTokUsd * LIST_MARKUP * 3.75);
      close(sar.cacheRead, m.price.cacheReadPerMTokUsd * LIST_MARKUP * 3.75);
      close(sar.cacheWrite, m.price.cacheWritePerMTokUsd * LIST_MARKUP * 3.75);
      close(sar.cacheWrite, sar.input * 1.25);
      close(sar.cacheWrite1h, sar.input * 2);
    }
    // The catalog's Anthropic list prices the markup is applied to.
    expect(MODELS.map((m) => [m.id, m.price.inputPerMTokUsd, m.price.outputPerMTokUsd, m.price.cacheReadPerMTokUsd])).toEqual([
      ['claude-opus-5-5', 4, 20, 0.2],
      ['claude-sonnet-5-5', 2, 10, 0.2],
      ['claude-haiku-4-5', 1, 5, 0.1],
    ]);
    expect(BILLING_ONLY_MODELS.map((m) => [m.id, m.price.inputPerMTokUsd, m.price.outputPerMTokUsd, m.price.cacheReadPerMTokUsd, m.price.cacheWritePerMTokUsd])).toEqual([
      ['claude-opus-5', 5, 25, 0.5, 6.25],
      ['claude-opus-4-8', 5, 25, 0.5, 6.25],
    ]);
  });
});

describe('Connect rating', () => {
  const run = (model: string): ConnectUsage => ({ executions: 1, toolCalls: 2, models: { [model]: { input: 12_000, output: 1_500, cacheRead: 40_000, cacheWrite: 8_000, cacheWrite1h: 0 } } });

  it('prices tokens per model, cache writes included', () => {
    // Opus 5.5: 4 + 2 x 2 + 12k x 18 + 1.5k x 90 + 40k x 0.9 + 8k x 22.5 SAR per 1M = 64.7 halalas.
    expect(priceUsage(run('claude-opus-5-5'), book)).toBeCloseTo(4 + 4 + 21.6 + 13.5 + 3.6 + 18, 9);
    expect(priceUsage(run('claude-sonnet-5-5'), book)).toBeCloseTo(4 + 4 + 10.8 + 6.75 + 3.6 + 9, 9);
    expect(priceUsage(run('claude-haiku-4-5'), book)).toBeCloseTo(4 + 4 + 5.4 + 3.375 + 1.8 + 4.5, 9);
  });

  it('bills cache writes on their own SKU, never as input', () => {
    const writesOnly: ConnectUsage = { executions: 0, toolCalls: 0, models: { 'claude-opus-5-5': { input: 0, output: 0, cacheRead: 0, cacheWrite: 1_000_000, cacheWrite1h: 1_000_000 } } };
    const lines = usageLines(writesOnly);
    expect(lines.map((l) => [l.sku, l.resourceType, l.quantity, l.per])).toEqual([
      ['connect-ai-cache-write-tokens:claude-opus-5-5', 'connect_ai_cache_write', 1_000_000, TOKENS_PER_PRICE],
      ['connect-ai-cache-write-1h-tokens:claude-opus-5-5', 'connect_ai_cache_write_1h', 1_000_000, TOKENS_PER_PRICE],
    ]);
    expect(priceUsage(writesOnly, book)).toBeCloseTo(2_250 + 3_600, 9);
  });

  it('mixes models in one run and leaves out zero quantities', () => {
    const u: ConnectUsage = { executions: 1, toolCalls: 0, models: {} };
    addTokens(u.models, 'claude-opus-5-5', { input: 1_000_000 });
    addTokens(u.models, 'claude-haiku-4-5', { output: 1_000_000 });
    addTokens(u.models, 'claude-opus-5-5', { input: 1_000_000 });
    expect(usageLines(u).map((l) => [l.sku, l.quantity])).toEqual([
      ['connect-executions', 1],
      ['connect-ai-input-tokens:claude-opus-5-5', 2_000_000],
      ['connect-ai-output-tokens:claude-haiku-4-5', 1_000_000],
    ]);
    expect(priceUsage(u, book)).toBeCloseTo(4 + 3_600 + 2_250, 9);
  });

  it('is 0 without prices and for models with no price', () => {
    expect(priceUsage(run('claude-opus-5-5'), {})).toBe(0);
    expect(priceUsage({ executions: 0, toolCalls: 0, models: { 'other-model': { input: 1e6, output: 1e6, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 } } }, book)).toBe(0);
  });

  it('reads stored model usage and token resource ids', () => {
    expect(parseTokensByModel({ 'claude-opus-5-5': { input: 3, output: '4', cacheWrite: 5 }, bad: 7 })).toEqual({ 'claude-opus-5-5': { input: 3, output: 4, cacheRead: 0, cacheWrite: 5, cacheWrite1h: 0 } });
    expect(parseTokensByModel(null)).toEqual({});
    expect(parseTokenResourceId('agent1:claude-opus-5-5')).toEqual({ agentId: 'agent1', model: 'claude-opus-5-5' });
    expect(parseTokenResourceId('agent1')).toEqual({ agentId: 'agent1', model: null });
  });
});

describe('ConnectUsageService.estimate', () => {
  const rows = launchPrices().map((p, i) => ({ id: `p${i}`, sku: p.sku, monthlyMinor: p.monthlyMinor, validFrom: new Date(0) }));
  const prisma = { price: { findMany: async () => rows } };
  const fx = { bookRate: async (c: string) => (c === 'SAR' ? 1 : 1 / 3.75) };
  const svc = new ConnectUsageService(prisma as never, fx as never);
  const run: ConnectUsage = { executions: 1, toolCalls: 2, models: { 'claude-opus-5-5': { input: 12_000, output: 1_500, cacheRead: 40_000, cacheWrite: 8_000, cacheWrite1h: 0 } } };

  it('gives a run its price in the team currency from the per model book', async () => {
    expect(await svc.estimate(run, 'SAR')).toBe(65); // 64.7 halalas
    expect(await svc.estimate(run, 'USD')).toBe(17); // 64.7 / 3.75 = 17.25 cents
    expect(await svc.estimate({ executions: 0, toolCalls: 0, models: {} }, 'SAR')).toBe(0);
  });

  it('lists per 1M token prices per model for the model picker', async () => {
    const sar = await svc.priceList('SAR');
    expect(sar).toMatchObject({ currency: 'SAR', configured: true, executionMinor: 4, toolCallMinor: 2 });
    expect(sar.models['claude-opus-5-5']).toEqual({ inputPerMTokMinor: 1800, outputPerMTokMinor: 9000, cacheReadPerMTokMinor: 90, cacheWritePerMTokMinor: 2250, cacheWrite1hPerMTokMinor: 3600 });
    expect(sar.models['claude-haiku-4-5'].cacheWritePerMTokMinor).toBe(562.5);
    const usd = await svc.priceList('USD');
    expect(usd.models['claude-opus-5-5'].inputPerMTokMinor).toBe(480); // $4.80 = list $4 + 20%
  });
});
