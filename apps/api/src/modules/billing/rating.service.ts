import { Injectable, Logger } from '@nestjs/common';
import { ResourceType } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { loadConfig } from '../../config/config';
import { rateHour, startOfHour, startOfMonth, BOOK_CURRENCY } from './pricing';
import { FxService } from './fx.service';

/**
 * Hourly roll-up: UsageEvent (per minute) → UsageRecord (per resource per hour, rated).
 * Idempotent: re-running for an hour upserts the same rows.
 */
@Injectable()
export class RatingService {
  private readonly log = new Logger(RatingService.name);

  constructor(private readonly prisma: PrismaService, private readonly fx: FxService) {}

  /** Rates the hour that ended most recently (called a few minutes past every hour). */
  async rollupPreviousHour(now = new Date()) {
    const hourStart = new Date(startOfHour(now).getTime() - 3_600_000);
    return this.rollupHour(hourStart);
  }

  async rollupHour(hourStart: Date) {
    const hourEnd = new Date(hourStart.getTime() + 3_600_000);
    const groups = await this.prisma.usageEvent.groupBy({
      by: ['projectId', 'resourceType', 'resourceId', 'unit'],
      where: { at: { gte: hourStart, lt: hourEnd } },
      _sum: { quantity: true },
      _count: { _all: true },
    });
    if (!groups.length) return 0;

    const projectIds = [...new Set(groups.map((g) => g.projectId))];
    const projects = await this.prisma.project.findMany({ where: { id: { in: projectIds } }, include: { team: { select: { currency: true } } } });
    const currencyOf = new Map(projects.map((p) => [p.id, p.team.currency]));

    const hoursPerMonth = loadConfig().BILLING_HOURS_PER_MONTH;
    let written = 0;

    for (const g of groups) {
      const currency = currencyOf.get(g.projectId) ?? 'USD';
      const sku = await this.skuFor(g.resourceType, g.resourceId);
      const price = sku ? await this.priceFor(g.resourceType, sku, hourEnd) : null;
      const fx = await this.fx.bookRate(currency, hourEnd); // price book → team currency at the hour's rate

      const minutes = g.unit === 'minute' ? g._count._all : g._count._all; // one event per minute either way
      const quantity = g._sum.quantity ?? 0;

      // Per-GB and per-node resources are priced per unit-month; scale monthly price by the average quantity in the hour.
      // Percent prices (backups, managed tier) are a share of the server's own plan price.
      if (g.resourceType === 'bandwidth') {
        const amountMinor = price ? await this.rateBandwidth(g.resourceId, hourStart, quantity, price.monthlyMinor * fx) : 0;
        await this.prisma.usageRecord.upsert({
          where: { resourceType_resourceId_hourStart: { resourceType: g.resourceType, resourceId: g.resourceId, hourStart } },
          create: { projectId: g.projectId, resourceType: g.resourceType, resourceId: g.resourceId, hourStart, quantity, unit: g.unit, priceId: price?.id, amountMinor, currency },
          update: { quantity, priceId: price?.id, amountMinor },
        });
        written++;
        continue;
      }

      let monthlyMinor = 0;
      if (price && price.unit === 'percent') monthlyMinor = Math.round(((await this.planPriceFor(g.resourceId, hourEnd)) * fx * price.monthlyMinor) / 100);
      else if (price) monthlyMinor = Math.round((g.unit === 'gb_minute' || g.unit === 'node_minute' || g.unit === 'instance_minute' ? price.monthlyMinor * (quantity / Math.max(minutes, 1)) : price.monthlyMinor) * fx);

      const charged = await this.prisma.usageRecord.aggregate({
        where: { resourceType: g.resourceType, resourceId: g.resourceId, hourStart: { gte: startOfMonth(hourStart), lt: hourStart } },
        _sum: { amountMinor: true },
      });

      const amountMinor = rateHour({ minutes, monthlyMinor, hoursPerMonth, chargedThisMonthMinor: charged._sum.amountMinor ?? 0 });

      await this.prisma.usageRecord.upsert({
        where: { resourceType_resourceId_hourStart: { resourceType: g.resourceType, resourceId: g.resourceId, hourStart } },
        create: { projectId: g.projectId, resourceType: g.resourceType, resourceId: g.resourceId, hourStart, quantity, unit: g.unit, priceId: price?.id, amountMinor, currency },
        update: { quantity, priceId: price?.id, amountMinor },
      });
      written++;
    }
    this.log.log(`rated ${written} resources for hour ${hourStart.toISOString()}`);
    return written;
  }

  /**
   * Outbound transfer of one server in one hour. Each size includes `transferTb` per calendar
   * month; bytes beyond it are charged per GB. The charge is the difference of the overage
   * cost after and before this hour, so it depends only on earlier hours and re-rating an
   * hour writes the same amount.
   */
  private async rateBandwidth(serverId: string, hourStart: Date, bytes: number, perGbMinor: number) {
    const server = await this.prisma.server.findUnique({ where: { id: serverId }, select: { size: { select: { transferTb: true } } } });
    const includedBytes = (server?.size.transferTb ?? 0) * 1e12;
    const before = await this.prisma.usageRecord.aggregate({
      where: { resourceType: 'bandwidth', resourceId: serverId, hourStart: { gte: startOfMonth(hourStart), lt: hourStart } },
      _sum: { quantity: true },
    });
    const prior = before._sum.quantity ?? 0;
    const cost = (total: number) => Math.round((Math.max(0, total - includedBytes) / 1e9) * perGbMinor);
    return cost(prior + bytes) - cost(prior);
  }

  private async skuFor(type: ResourceType, resourceId: string): Promise<string | null> {
    switch (type) {
      case 'server': {
        const s = await this.prisma.server.findUnique({ where: { id: resourceId }, select: { sizeId: true } });
        return s?.sizeId ?? null;
      }
      case 'public_ip':
        return 'public_ip';
      case 'snapshot':
        return 'snapshot_gb';
      case 'volume':
        return 'volume_gb';
      case 'load_balancer':
        return 'lb_node';
      case 'object_storage':
        return 'storage_gb';
      case 'database': {
        const c = await this.prisma.dbCluster.findUnique({ where: { id: resourceId }, select: { sizeId: true } });
        return c ? `db-${c.sizeId}` : null;
      }
      case 'bandwidth':
        return 'bandwidth_gb';
      case 'backup':
        return 'backups_pct';
      case 'managed_server': {
        const s = await this.prisma.server.findUnique({ where: { id: resourceId }, select: { sizeId: true } });
        return s ? `managed-${s.sizeId}` : null;
      }
      case 'kubernetes':
        return 'k8s-ha';
      case 'app_instance': {
        const a = await this.prisma.platformApp.findUnique({ where: { id: resourceId }, select: { size: true } });
        return a ? a.size : null;
      }
      case 'support': {
        const t = await this.prisma.team.findUnique({ where: { id: resourceId }, select: { supportPlan: true } });
        return t && t.supportPlan !== 'free' ? `support-${t.supportPlan}` : null;
      }
      default:
        return null;
    }
  }

  /** Monthly plan price of the server a percent-priced resource (backups) belongs to. */
  private async planPriceFor(serverId: string, hourEnd: Date) {
    const s = await this.prisma.server.findUnique({ where: { id: serverId }, select: { sizeId: true } });
    if (!s) return 0;
    return (await this.priceFor('server', s.sizeId, hourEnd))?.monthlyMinor ?? 0;
  }

  /** Newest book price that was valid at any point before the hour ended, so a price book change mid-hour still rates that hour. */
  private priceFor(resourceType: ResourceType, sku: string, hourEnd: Date) {
    return this.prisma.price.findFirst({
      where: { resourceType, sku, currency: BOOK_CURRENCY, validFrom: { lt: hourEnd }, OR: [{ validTo: null }, { validTo: { gte: hourEnd } }] },
      orderBy: { validFrom: 'desc' },
    });
  }
}
