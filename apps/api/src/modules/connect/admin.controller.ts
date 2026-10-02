import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequireScopes, StaffAreas } from '../../common/auth/decorators';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiError } from '../../common/errors/api-error';
import { FxService } from '../billing/fx.service';
import { currentPeriod } from './usage.service';

/**
 * Back office view of Connect: usage per team, the busiest agents, error rates, and the
 * internal model cost (list price x tokens) next to what was metered to customers.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/v1/connect')
@RequireScopes('admin')
export class ConnectAdminController {
  constructor(private readonly prisma: PrismaService, private readonly fx: FxService) {}

  @StaffAreas('finance', 'support')
  @Get('overview')
  async overview(@Query('period') period?: string) {
    const p = period ?? currentPeriod();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) throw ApiError.invalid('period must look like 2026-10');
    const [y, m] = p.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 1));
    const range = { gte: start, lt: end };

    const [byTeam, failedByTeam, topAgents, failedByAgent, metered] = await Promise.all([
      this.prisma.connectRun.groupBy({ by: ['teamId'], where: { createdAt: range }, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true, toolCalls: true, providerCostMicroUsd: true } }),
      this.prisma.connectRun.groupBy({ by: ['teamId'], where: { createdAt: range, status: 'failed' }, _count: { _all: true } }),
      this.prisma.connectRun.groupBy({ by: ['agentId'], where: { createdAt: range }, _count: { _all: true }, _sum: { providerCostMicroUsd: true, inputTokens: true, outputTokens: true }, orderBy: { _count: { agentId: 'desc' } }, take: 20 }),
      this.prisma.connectRun.groupBy({ by: ['agentId'], where: { createdAt: range, status: 'failed' }, _count: { _all: true } }),
      this.prisma.usageRecord.groupBy({ by: ['projectId', 'currency'], where: { hourStart: range, resourceType: { in: ['connect_execution', 'connect_ai_input', 'connect_ai_output', 'connect_ai_cache_read', 'connect_ai_cache_write', 'connect_ai_cache_write_1h', 'connect_tool_call'] } }, _sum: { amountMinor: true } }),
    ]);
    const teams = await this.prisma.team.findMany({ where: { id: { in: byTeam.map((t) => t.teamId) } }, select: { id: true, name: true, slug: true, currency: true, projects: { select: { id: true } } } });
    const agents = await this.prisma.connectAgent.findMany({ where: { id: { in: topAgents.map((a) => a.agentId) } }, select: { id: true, name: true, teamId: true, model: true, status: true } });
    const usdToSar = await this.fx.rate('SAR');
    // Metered amounts are in the team currency; the comparison column is in US dollars.
    const meteredUsd = (projectIds: string[]) => metered.filter((r) => projectIds.includes(r.projectId)).reduce((s, r) => s + (r.currency === 'SAR' ? (r._sum.amountMinor ?? 0) / usdToSar : r._sum.amountMinor ?? 0), 0) / 100;

    const teamRows = byTeam.map((t) => {
      const team = teams.find((x) => x.id === t.teamId);
      const runs = t._count._all;
      const failed = failedByTeam.find((f) => f.teamId === t.teamId)?._count._all ?? 0;
      return {
        teamId: t.teamId,
        name: team?.name ?? null,
        slug: team?.slug ?? null,
        runs,
        failed,
        errorRate: runs ? failed / runs : 0,
        inputTokens: t._sum.inputTokens ?? 0,
        outputTokens: t._sum.outputTokens ?? 0,
        cacheReadTokens: t._sum.cacheReadTokens ?? 0,
        cacheWriteTokens: t._sum.cacheWriteTokens ?? 0,
        toolCalls: t._sum.toolCalls ?? 0,
        internalCostUsd: (t._sum.providerCostMicroUsd ?? 0) / 1e6,
        meteredUsd: meteredUsd(team?.projects.map((p) => p.id) ?? []),
      };
    }).sort((a, b) => b.runs - a.runs);
    const totals = teamRows.reduce((s, t) => ({ runs: s.runs + t.runs, failed: s.failed + t.failed, internalCostUsd: s.internalCostUsd + t.internalCostUsd, meteredUsd: s.meteredUsd + t.meteredUsd, inputTokens: s.inputTokens + t.inputTokens, outputTokens: s.outputTokens + t.outputTokens }), { runs: 0, failed: 0, internalCostUsd: 0, meteredUsd: 0, inputTokens: 0, outputTokens: 0 });
    return {
      period: p,
      totals: { ...totals, teams: teamRows.length, errorRate: totals.runs ? totals.failed / totals.runs : 0, marginUsd: totals.meteredUsd - totals.internalCostUsd },
      teams: teamRows,
      topAgents: topAgents.map((a) => {
        const ag = agents.find((x) => x.id === a.agentId);
        const failed = failedByAgent.find((f) => f.agentId === a.agentId)?._count._all ?? 0;
        return { agentId: a.agentId, name: ag?.name ?? null, teamId: ag?.teamId ?? null, model: ag?.model ?? null, status: ag?.status ?? null, runs: a._count._all, failed, errorRate: a._count._all ? failed / a._count._all : 0, inputTokens: a._sum.inputTokens ?? 0, outputTokens: a._sum.outputTokens ?? 0, internalCostUsd: (a._sum.providerCostMicroUsd ?? 0) / 1e6 };
      }),
    };
  }
}
