import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Currency } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FxService } from '../billing/fx.service';
import { BOOK_CURRENCY, startOfHour } from '../billing/pricing';
import type { Actor } from '../../common/auth/actor';
import { MODELS, PRICED_MODELS, pricedModel } from './models/catalog';
import { CONNECT_SKU_PREFIX, FLAT_SKUS, TOKEN_SKUS, addTokens, linePrice, perMillion, priceUsage, tokenResourceId, tokenSku, usageLines, type ConnectUsage, type ModelTokens, type TokensByModel } from './pricing';

/**
 * Connect usage and money.
 *
 *  - Price book: connect-executions and connect-tool-calls (per 1,000), plus five token SKUs per
 *    model, "<base>:<model id>" (input, output, cache read, five minute cache write, one hour
 *    cache write), per 10M tokens. All live in prgd_prices in the book currency (riyals). The
 *    seed creates the approved launch prices once; staff change them with POST /admin/v1/prices.
 *    The shapes and math are in pricing.ts.
 *  - Metering: every hour, finished runs are summed per agent (and per model for tokens) and
 *    written as UsageRecord rows that the invoice run picks up like any usage.
 *  - Estimates: the same math gives each run's costEstimateMinor and the usage page's
 *    estimatedCostMinor.
 */

export { priceUsage } from './pricing';

type PriceBook = Record<string, { id: string; amount: number }>;

const amounts = (p: PriceBook) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v.amount]));

interface ModelRow {
  agentId: string;
  model: string;
  input: bigint | null;
  output: bigint | null;
  cache_read: bigint | null;
  cache_write: bigint | null;
  cache_write_1h: bigint | null;
}

const rowTokens = (r: ModelRow): ModelTokens => ({ input: Number(r.input ?? 0), output: Number(r.output ?? 0), cacheRead: Number(r.cache_read ?? 0), cacheWrite: Number(r.cache_write ?? 0), cacheWrite1h: Number(r.cache_write_1h ?? 0) });

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
  private cache: { at: number; prices: PriceBook } | null = null;

  constructor(private readonly prisma: PrismaService, private readonly fx: FxService) {}

  /** Book prices per Connect SKU valid at `at` (missing when unset). The current book is cached for a minute. */
  async prices(at?: Date): Promise<PriceBook> {
    const now = !at;
    if (now && this.cache && Date.now() - this.cache.at < 60_000) return this.cache.prices;
    const when = at ?? new Date();
    const rows = await this.prisma.price.findMany({
      where: { sku: { startsWith: CONNECT_SKU_PREFIX }, currency: BOOK_CURRENCY, validFrom: { lte: when }, OR: [{ validTo: null }, { validTo: { gt: when } }] },
      orderBy: { validFrom: 'desc' },
    });
    const prices: PriceBook = {};
    for (const r of rows) if (!prices[r.sku]) prices[r.sku] = { id: r.id, amount: r.monthlyMinor };
    if (now) this.cache = { at: Date.now(), prices };
    return prices;
  }

  async pricingConfigured() {
    const p = await this.prices();
    return Object.values(p).some((x) => x.amount > 0);
  }

  /** Estimated price of some usage in the given currency's minor units. */
  async estimate(u: ConnectUsage, currency: Currency): Promise<number> {
    const book = priceUsage(u, amounts(await this.prices()));
    if (!book) return 0;
    return Math.round(book * (await this.fx.bookRate(currency)));
  }

  /**
   * Current Connect prices in `currency`: per execution and per tool call, and per 1M tokens for
   * each catalog model. Minor units, not rounded (Haiku 4.5 cache writes are 562.5 halalas per 1M).
   */
  async priceList(currency: Currency) {
    const p = amounts(await this.prices());
    const rate = await this.fx.bookRate(currency);
    const round4 = (v: number) => Math.round(v * 10_000) / 10_000;
    const perUnit = (sku: string) => round4(((p[sku] ?? 0) / 1_000) * rate);
    const token = (base: string, model: string) => round4(perMillion(p[tokenSku(base, model)] ?? 0) * rate);
    const base = Object.fromEntries(TOKEN_SKUS.map((s) => [s.kind, s.base]));
    return {
      currency,
      configured: Object.values(p).some((x) => x > 0),
      executionMinor: perUnit('connect-executions'),
      toolCallMinor: perUnit('connect-tool-calls'),
      models: Object.fromEntries(MODELS.map((m) => [m.id, {
        inputPerMTokMinor: token(base.input, m.id),
        outputPerMTokMinor: token(base.output, m.id),
        cacheReadPerMTokMinor: token(base.cacheRead, m.id),
        cacheWritePerMTokMinor: token(base.cacheWrite, m.id),
        cacheWrite1hPerMTokMinor: token(base.cacheWrite1h, m.id),
      }])),
    };
  }

  /** GET /v1/connect/usage */
  async usage(actor: Actor, period = currentPeriod()) {
    const { start, end } = monthRange(period);
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: actor.teamId }, select: { currency: true } });
    const where: Prisma.ConnectRunWhereInput = { teamId: actor.teamId, createdAt: { gte: start, lt: end } };
    const sum = { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true, toolCalls: true, apiCalls: true, durationMs: true } as const;
    const [byAgentRows, workflowRuns, failedByAgent, days, storage, modelRows] = await Promise.all([
      this.prisma.connectRun.groupBy({ by: ['agentId'], where, _count: { _all: true }, _sum: sum }),
      this.prisma.connectRun.count({ where: { ...where, workflow: true } }),
      this.prisma.connectRun.groupBy({ by: ['agentId'], where: { ...where, status: 'failed' }, _count: { _all: true } }),
      this.prisma.$queryRaw<{ day: Date; executions: bigint; failed: bigint; input: bigint | null; output: bigint | null; cache_read: bigint | null; cache_write: bigint | null; tool_calls: bigint | null }[]>`
        SELECT date_trunc('day', "createdAt") AS day, count(*) AS executions, count(*) FILTER (WHERE status = 'failed') AS failed,
               sum("inputTokens") AS input, sum("outputTokens") AS output, sum("cacheReadTokens") AS cache_read, sum("cacheWriteTokens") AS cache_write, sum("toolCalls") AS tool_calls
        FROM "prgd_connect_runs" WHERE "teamId" = ${actor.teamId} AND "createdAt" >= ${start} AND "createdAt" < ${end}
        GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<{ bytes: bigint | null }[]>`
        SELECT sum(coalesce(pg_column_size(s."input"), 0) + coalesce(pg_column_size(s."output"), 0) + coalesce(pg_column_size(s."error"), 0)) AS bytes
        FROM "prgd_connect_run_steps" s JOIN "prgd_connect_runs" r ON r.id = s."runId" WHERE r."teamId" = ${actor.teamId}`,
      this.prisma.$queryRaw<ModelRow[]>`
        SELECT r."agentId" AS "agentId", m.key AS model,
               sum((m.value->>'input')::bigint) AS input, sum((m.value->>'output')::bigint) AS output, sum((m.value->>'cacheRead')::bigint) AS cache_read,
               sum((m.value->>'cacheWrite')::bigint) AS cache_write, sum((m.value->>'cacheWrite1h')::bigint) AS cache_write_1h
        FROM "prgd_connect_runs" r CROSS JOIN LATERAL jsonb_each(r."modelUsage") m
        WHERE r."teamId" = ${actor.teamId} AND r."createdAt" >= ${start} AND r."createdAt" < ${end} AND jsonb_typeof(m.value) = 'object'
        GROUP BY 1, 2`,
    ]);
    const agents = await this.prisma.connectAgent.findMany({ where: { id: { in: byAgentRows.map((r) => r.agentId) } }, select: { id: true, name: true, deletedAt: true } });
    const nameOf = new Map(agents.map((a) => [a.id, a]));
    const failedOf = new Map(failedByAgent.map((f) => [f.agentId, f._count._all]));
    const priceMap = amounts(await this.prices());
    const rate = await this.fx.bookRate(team.currency);
    const money = (u: ConnectUsage) => Math.round(priceUsage(u, priceMap) * rate);

    // Tokens per agent per model, and per model for the whole team.
    const modelsOf = new Map<string, TokensByModel>();
    const teamModels: TokensByModel = {};
    for (const r of modelRows) {
      const t = rowTokens(r);
      addTokens((modelsOf.get(r.agentId) ?? modelsOf.set(r.agentId, {}).get(r.agentId))!, r.model, t);
      addTokens(teamModels, r.model, t);
    }

    const totals = { executions: 0, workflowExecutions: workflowRuns, aiInputTokens: 0, aiOutputTokens: 0, aiCacheReadTokens: 0, aiCacheWriteTokens: 0, toolCalls: 0, apiCalls: 0, computeSeconds: 0, storageBytes: Number(storage[0]?.bytes ?? 0) };
    const byAgent = byAgentRows.map((r) => {
      const u: ConnectUsage = { executions: r._count._all, toolCalls: r._sum.toolCalls ?? 0, models: modelsOf.get(r.agentId) ?? {} };
      totals.executions += u.executions;
      totals.aiInputTokens += r._sum.inputTokens ?? 0;
      totals.aiOutputTokens += r._sum.outputTokens ?? 0;
      totals.aiCacheReadTokens += r._sum.cacheReadTokens ?? 0;
      totals.aiCacheWriteTokens += r._sum.cacheWriteTokens ?? 0;
      totals.toolCalls += u.toolCalls;
      totals.apiCalls += r._sum.apiCalls ?? 0;
      totals.computeSeconds += Math.round((r._sum.durationMs ?? 0) / 1000);
      const a = nameOf.get(r.agentId);
      return { agentId: r.agentId, agentName: a?.name ?? null, deleted: !!a?.deletedAt, executions: u.executions, failed: failedOf.get(r.agentId) ?? 0, aiInputTokens: r._sum.inputTokens ?? 0, aiOutputTokens: r._sum.outputTokens ?? 0, aiCacheReadTokens: r._sum.cacheReadTokens ?? 0, aiCacheWriteTokens: r._sum.cacheWriteTokens ?? 0, toolCalls: u.toolCalls, apiCalls: r._sum.apiCalls ?? 0, estimatedCostMinor: money(u) };
    }).sort((a, b) => b.executions - a.executions);
    const all: ConnectUsage = { executions: totals.executions, toolCalls: totals.toolCalls, models: teamModels };
    const byModel = Object.entries(teamModels).map(([model, t]) => ({
      model,
      label: pricedModel(model)?.label ?? model,
      aiInputTokens: t.input,
      aiOutputTokens: t.output,
      aiCacheReadTokens: t.cacheRead,
      aiCacheWriteTokens: t.cacheWrite + t.cacheWrite1h,
      estimatedCostMinor: money({ executions: 0, toolCalls: 0, models: { [model]: t } }),
    })).sort((a, b) => b.estimatedCostMinor - a.estimatedCostMinor || a.model.localeCompare(b.model));
    const flat = FLAT_SKUS.map((s) => ({ sku: s.sku, per: s.per, amountMinor: Math.round((priceMap[s.sku] ?? 0) * rate * 10_000) / 10_000, currency: team.currency }));
    const tokens = PRICED_MODELS.flatMap((m) => TOKEN_SKUS.map((s) => {
      const sku = tokenSku(s.base, m.id);
      return { sku, model: m.id, kind: s.kind, per: 1_000_000, amountMinor: Math.round(perMillion(priceMap[sku] ?? 0) * rate * 10_000) / 10_000, currency: team.currency };
    }));
    return {
      period,
      totals,
      byAgent,
      byModel,
      byDay: days.map((d) => ({ date: d.day.toISOString().slice(0, 10), executions: Number(d.executions), failed: Number(d.failed), aiInputTokens: Number(d.input ?? 0), aiOutputTokens: Number(d.output ?? 0), aiCacheReadTokens: Number(d.cache_read ?? 0), aiCacheWriteTokens: Number(d.cache_write ?? 0), toolCalls: Number(d.tool_calls ?? 0) })),
      estimatedCostMinor: money(all),
      currency: team.currency,
      pricingConfigured: Object.values(priceMap).some((x) => x > 0),
      prices: [...flat, ...tokens],
    };
  }

  /** Meters the hour that ended most recently. Called a few minutes past every hour. */
  async meterPreviousHour(now = new Date()) {
    return this.meterHour(new Date(startOfHour(now).getTime() - 3_600_000));
  }

  /**
   * Sums runs that finished in the hour into UsageRecord rows: executions and tool calls per
   * agent (resourceId = agent id), tokens per agent and model (resourceId = "<agent id>:<model>").
   * Idempotent: re-running an hour rewrites the same rows; rows already on an invoice are never touched.
   */
  async meterHour(hourStart: Date) {
    const hourEnd = new Date(hourStart.getTime() + 3_600_000);
    const [groups, modelRows] = await Promise.all([
      this.prisma.connectRun.groupBy({ by: ['projectId', 'agentId'], where: { finishedAt: { gte: hourStart, lt: hourEnd } }, _count: { _all: true }, _sum: { toolCalls: true } }),
      this.prisma.$queryRaw<ModelRow[]>`
        SELECT r."agentId" AS "agentId", m.key AS model,
               sum((m.value->>'input')::bigint) AS input, sum((m.value->>'output')::bigint) AS output, sum((m.value->>'cacheRead')::bigint) AS cache_read,
               sum((m.value->>'cacheWrite')::bigint) AS cache_write, sum((m.value->>'cacheWrite1h')::bigint) AS cache_write_1h
        FROM "prgd_connect_runs" r CROSS JOIN LATERAL jsonb_each(r."modelUsage") m
        WHERE r."finishedAt" >= ${hourStart} AND r."finishedAt" < ${hourEnd} AND jsonb_typeof(m.value) = 'object'
        GROUP BY 1, 2`,
    ]);
    if (!groups.length) return 0;
    const projects = await this.prisma.project.findMany({ where: { id: { in: [...new Set(groups.map((g) => g.projectId))] } }, include: { team: { select: { currency: true } } } });
    const currencyOf = new Map(projects.map((p) => [p.id, p.team.currency]));
    const modelsOf = new Map<string, TokensByModel>();
    for (const r of modelRows) addTokens((modelsOf.get(r.agentId) ?? modelsOf.set(r.agentId, {}).get(r.agentId))!, r.model, rowTokens(r));
    const prices = await this.prices(hourEnd);
    const amount = amounts(prices);
    let written = 0;
    for (const g of groups) {
      const currency = currencyOf.get(g.projectId);
      if (!currency) continue;
      const rate = await this.fx.bookRate(currency, hourEnd);
      const lines = usageLines({ executions: g._count._all, toolCalls: g._sum.toolCalls ?? 0, models: modelsOf.get(g.agentId) ?? {} });
      for (const l of lines) {
        const price = prices[l.sku];
        const amountMinor = price ? Math.round(linePrice(l, amount) * rate) : 0;
        const resourceId = l.model ? tokenResourceId(g.agentId, l.model) : g.agentId;
        const key = { resourceType_resourceId_hourStart: { resourceType: l.resourceType, resourceId, hourStart } };
        const existing = await this.prisma.usageRecord.findUnique({ where: key, select: { invoiceId: true } });
        if (existing?.invoiceId) continue;
        await this.prisma.usageRecord.upsert({
          where: key,
          create: { projectId: g.projectId, resourceType: l.resourceType, resourceId, hourStart, quantity: l.quantity, unit: l.unit, priceId: price?.id, amountMinor, currency },
          update: { quantity: l.quantity, priceId: price?.id, amountMinor },
        });
        written++;
      }
    }
    this.log.log(`metered ${written} Connect usage rows for ${hourStart.toISOString()}`);
    return written;
  }
}
