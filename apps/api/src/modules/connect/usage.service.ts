import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Currency, type ResourceType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FxService } from '../billing/fx.service';
import { BOOK_CURRENCY, startOfHour } from '../billing/pricing';
import type { Actor } from '../../common/auth/actor';

/**
 * Connect usage and money.
 *
 *  - Price book: five SKUs (connect-executions, connect-ai-input-tokens, connect-ai-output-tokens,
 *    connect-ai-cache-read-tokens, connect-tool-calls) live in prgd_prices with no price until
 *    staff set one (POST /admin/v1/prices). Prices are per 1,000 (executions, tool calls) or
 *    per 1M tokens, in the book currency. Nothing here hard codes a customer price.
 *  - Metering: every hour, finished runs are summed per agent and written as UsageRecord rows
 *    (one per resource type per agent per hour) that the invoice run picks up like any usage.
 *    Cache writes are metered as input tokens.
 *  - Estimates: the same math gives each run's costEstimateMinor and the usage page's
 *    estimatedCostMinor.
 */

export interface ConnectSku {
  sku: string;
  resourceType: ResourceType;
  /** Units per priced quantity: 1,000 or 1,000,000. */
  per: number;
}

export const CONNECT_SKUS: ConnectSku[] = [
  { sku: 'connect-executions', resourceType: 'connect_execution', per: 1_000 },
  { sku: 'connect-ai-input-tokens', resourceType: 'connect_ai_input', per: 1_000_000 },
  { sku: 'connect-ai-output-tokens', resourceType: 'connect_ai_output', per: 1_000_000 },
  { sku: 'connect-ai-cache-read-tokens', resourceType: 'connect_ai_cache_read', per: 1_000_000 },
  { sku: 'connect-tool-calls', resourceType: 'connect_tool_call', per: 1_000 },
];

export interface UsageTotals {
  executions: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  toolCalls: number;
}

/** Quantity of each SKU for some usage. */
export function quantities(u: UsageTotals): Record<string, number> {
  return {
    'connect-executions': u.executions,
    'connect-ai-input-tokens': u.inputTokens + u.cacheWriteTokens,
    'connect-ai-output-tokens': u.outputTokens,
    'connect-ai-cache-read-tokens': u.cacheReadTokens,
    'connect-tool-calls': u.toolCalls,
  };
}

/** Price of some usage in book minor units, from per unit prices (sku -> minor per 1k / 1M). Pure, for tests. */
export function priceUsage(u: UsageTotals, prices: Record<string, number>): number {
  const q = quantities(u);
  let total = 0;
  for (const s of CONNECT_SKUS) total += ((q[s.sku] ?? 0) / s.per) * (prices[s.sku] ?? 0);
  return total;
}

function monthRange(period: string) {
  const [y, m] = period.split('-').map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
}

export function currentPeriod(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

@Injectable()
export class ConnectUsageService {
  private readonly log = new Logger(ConnectUsageService.name);
  private cache: { at: number; prices: Record<string, { id: string; amount: number }> } | null = null;

  constructor(private readonly prisma: PrismaService, private readonly fx: FxService) {}

  /** Current book prices per SKU (0 when unset). Cached for a minute. */
  async prices(at = new Date()): Promise<Record<string, { id: string; amount: number }>> {
    if (this.cache && Date.now() - this.cache.at < 60_000) return this.cache.prices;
    const rows = await this.prisma.price.findMany({
      where: { sku: { in: CONNECT_SKUS.map((s) => s.sku) }, currency: BOOK_CURRENCY, validFrom: { lte: at }, OR: [{ validTo: null }, { validTo: { gt: at } }] },
      orderBy: { validFrom: 'desc' },
    });
    const prices: Record<string, { id: string; amount: number }> = {};
    for (const r of rows) if (!prices[r.sku]) prices[r.sku] = { id: r.id, amount: r.monthlyMinor };
    this.cache = { at: Date.now(), prices };
    return prices;
  }

  async pricingConfigured() {
    const p = await this.prices();
    return Object.values(p).some((x) => x.amount > 0);
  }

  /** Estimated price of some usage in the given currency's minor units. */
  async estimate(u: UsageTotals, currency: Currency): Promise<number> {
    const p = await this.prices();
    const book = priceUsage(u, Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.amount])));
    if (!book) return 0;
    return this.fx.convert(Math.round(book), currency);
  }

  /** GET /v1/connect/usage */
  async usage(actor: Actor, period = currentPeriod()) {
    const { start, end } = monthRange(period);
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: actor.teamId }, select: { currency: true } });
    const where: Prisma.ConnectRunWhereInput = { teamId: actor.teamId, createdAt: { gte: start, lt: end } };
    const sum = { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true, toolCalls: true, apiCalls: true, durationMs: true } as const;
    const [byAgentRows, workflowRuns, failedByAgent, days, storage] = await Promise.all([
      this.prisma.connectRun.groupBy({ by: ['agentId'], where, _count: { _all: true }, _sum: sum }),
      this.prisma.connectRun.count({ where: { ...where, workflow: true } }),
      this.prisma.connectRun.groupBy({ by: ['agentId'], where: { ...where, status: 'failed' }, _count: { _all: true } }),
      this.prisma.$queryRaw<{ day: Date; executions: bigint; failed: bigint; input: bigint | null; output: bigint | null; cache_read: bigint | null; tool_calls: bigint | null }[]>`
        SELECT date_trunc('day', "createdAt") AS day, count(*) AS executions, count(*) FILTER (WHERE status = 'failed') AS failed,
               sum("inputTokens") AS input, sum("outputTokens") AS output, sum("cacheReadTokens") AS cache_read, sum("toolCalls") AS tool_calls
        FROM "prgd_connect_runs" WHERE "teamId" = ${actor.teamId} AND "createdAt" >= ${start} AND "createdAt" < ${end}
        GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<{ bytes: bigint | null }[]>`
        SELECT sum(coalesce(pg_column_size(s."input"), 0) + coalesce(pg_column_size(s."output"), 0) + coalesce(pg_column_size(s."error"), 0)) AS bytes
        FROM "prgd_connect_run_steps" s JOIN "prgd_connect_runs" r ON r.id = s."runId" WHERE r."teamId" = ${actor.teamId}`,
    ]);
    const agents = await this.prisma.connectAgent.findMany({ where: { id: { in: byAgentRows.map((r) => r.agentId) } }, select: { id: true, name: true, deletedAt: true } });
    const nameOf = new Map(agents.map((a) => [a.id, a]));
    const failedOf = new Map(failedByAgent.map((f) => [f.agentId, f._count._all]));
    const prices = await this.prices();
    const priceMap = Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, v.amount]));
    const rate = await this.fx.bookRate(team.currency);
    const money = (u: UsageTotals) => Math.round(priceUsage(u, priceMap) * rate);

    const totals = { executions: 0, workflowExecutions: workflowRuns, aiInputTokens: 0, aiOutputTokens: 0, aiCacheReadTokens: 0, aiCacheWriteTokens: 0, toolCalls: 0, apiCalls: 0, computeSeconds: 0, storageBytes: Number(storage[0]?.bytes ?? 0) };
    const byAgent = byAgentRows.map((r) => {
      const u: UsageTotals = { executions: r._count._all, inputTokens: r._sum.inputTokens ?? 0, outputTokens: r._sum.outputTokens ?? 0, cacheReadTokens: r._sum.cacheReadTokens ?? 0, cacheWriteTokens: r._sum.cacheWriteTokens ?? 0, toolCalls: r._sum.toolCalls ?? 0 };
      totals.executions += u.executions;
      totals.aiInputTokens += u.inputTokens;
      totals.aiOutputTokens += u.outputTokens;
      totals.aiCacheReadTokens += u.cacheReadTokens;
      totals.aiCacheWriteTokens += u.cacheWriteTokens;
      totals.toolCalls += u.toolCalls;
      totals.apiCalls += r._sum.apiCalls ?? 0;
      totals.computeSeconds += Math.round((r._sum.durationMs ?? 0) / 1000);
      const a = nameOf.get(r.agentId);
      return { agentId: r.agentId, agentName: a?.name ?? null, deleted: !!a?.deletedAt, executions: u.executions, failed: failedOf.get(r.agentId) ?? 0, aiInputTokens: u.inputTokens, aiOutputTokens: u.outputTokens, aiCacheReadTokens: u.cacheReadTokens, toolCalls: u.toolCalls, apiCalls: r._sum.apiCalls ?? 0, estimatedCostMinor: money(u) };
    }).sort((a, b) => b.executions - a.executions);
    const all: UsageTotals = { executions: totals.executions, inputTokens: totals.aiInputTokens, outputTokens: totals.aiOutputTokens, cacheReadTokens: totals.aiCacheReadTokens, cacheWriteTokens: totals.aiCacheWriteTokens, toolCalls: totals.toolCalls };
    return {
      period,
      totals,
      byAgent,
      byDay: days.map((d) => ({ date: d.day.toISOString().slice(0, 10), executions: Number(d.executions), failed: Number(d.failed), aiInputTokens: Number(d.input ?? 0), aiOutputTokens: Number(d.output ?? 0), aiCacheReadTokens: Number(d.cache_read ?? 0), toolCalls: Number(d.tool_calls ?? 0) })),
      estimatedCostMinor: money(all),
      currency: team.currency,
      pricingConfigured: Object.values(priceMap).some((x) => x > 0),
      prices: CONNECT_SKUS.map((s) => ({ sku: s.sku, per: s.per, amountMinor: Math.round((priceMap[s.sku] ?? 0) * rate), currency: team.currency })),
    };
  }

  /** Meters the hour that ended most recently. Called a few minutes past every hour. */
  async meterPreviousHour(now = new Date()) {
    return this.meterHour(new Date(startOfHour(now).getTime() - 3_600_000));
  }

  /**
   * Sums runs that finished in the hour per agent into UsageRecord rows. Idempotent: re-running
   * an hour rewrites the same rows; rows already on an invoice are never touched.
   */
  async meterHour(hourStart: Date) {
    const hourEnd = new Date(hourStart.getTime() + 3_600_000);
    const groups = await this.prisma.connectRun.groupBy({
      by: ['projectId', 'agentId'],
      where: { finishedAt: { gte: hourStart, lt: hourEnd } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true, toolCalls: true },
    });
    if (!groups.length) return 0;
    const projects = await this.prisma.project.findMany({ where: { id: { in: [...new Set(groups.map((g) => g.projectId))] } }, include: { team: { select: { currency: true } } } });
    const currencyOf = new Map(projects.map((p) => [p.id, p.team.currency]));
    const prices = await this.prices(hourEnd);
    let written = 0;
    for (const g of groups) {
      const currency = currencyOf.get(g.projectId);
      if (!currency) continue;
      const rate = await this.fx.bookRate(currency, hourEnd);
      const q = quantities({ executions: g._count._all, inputTokens: g._sum.inputTokens ?? 0, outputTokens: g._sum.outputTokens ?? 0, cacheReadTokens: g._sum.cacheReadTokens ?? 0, cacheWriteTokens: g._sum.cacheWriteTokens ?? 0, toolCalls: g._sum.toolCalls ?? 0 });
      for (const s of CONNECT_SKUS) {
        const quantity = q[s.sku] ?? 0;
        if (quantity <= 0) continue;
        const price = prices[s.sku];
        const amountMinor = price ? Math.round((quantity / s.per) * price.amount * rate) : 0;
        const key = { resourceType_resourceId_hourStart: { resourceType: s.resourceType, resourceId: g.agentId, hourStart } };
        const existing = await this.prisma.usageRecord.findUnique({ where: key, select: { invoiceId: true } });
        if (existing?.invoiceId) continue;
        await this.prisma.usageRecord.upsert({
          where: key,
          create: { projectId: g.projectId, resourceType: s.resourceType, resourceId: g.agentId, hourStart, quantity, unit: s.sku.endsWith('tokens') ? 'token' : s.sku === 'connect-executions' ? 'execution' : 'call', priceId: price?.id, amountMinor, currency },
          update: { quantity, priceId: price?.id, amountMinor },
        });
        written++;
      }
    }
    this.log.log(`metered ${written} Connect usage rows for ${hourStart.toISOString()}`);
    return written;
  }
}
