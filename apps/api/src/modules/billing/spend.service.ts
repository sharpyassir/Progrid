import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiError } from '../../common/errors/api-error';
import { EventsService } from '../events/events.service';
import { loadConfig } from '../../config/config';
import { BOOK_CURRENCY } from './pricing';
import { FxService } from './fx.service';
import { TrustService } from '../trust/trust.service';
import { startOfMonth } from './pricing';
import type { Actor } from '../../common/auth/actor';

/**
 * Spend controls checked *before* a workflow that adds cost is started:
 *  - team must have credit or a payment method (prepaid credit, or an active account)
 *  - a new team must top up once before running postpaid (TrustService.assertPrepaidBeforePostpaid)
 *  - project hard limit (`Project.spendLimitMinor`)
 *  - agent token hard cap (`ApiToken.spendCapMinor`)
 */
@Injectable()
export class SpendService {
  constructor(private readonly prisma: PrismaService, private readonly events: EventsService, private readonly fx: FxService, private readonly trust: TrustService) {}

  /** Projected monthly cost of a resource in the team currency (USD book, converted at today's rate). */
  async monthlyPriceMinor(resourceType: 'server' | 'public_ip' | 'snapshot' | 'backup' | 'volume' | 'load_balancer' | 'object_storage' | 'database' | 'managed_server' | 'support' | 'kubernetes' | 'app_instance', sku: string, currency: 'USD' | 'SAR') {
    const price = await this.prisma.price.findFirst({
      where: { resourceType, sku, currency: BOOK_CURRENCY, validTo: null },
      orderBy: { validFrom: 'desc' },
    });
    if (!price) return 0;
    return price.unit === 'percent' ? price.monthlyMinor : this.fx.convert(price.monthlyMinor, currency);
  }

  async assertCanSpend(actor: Actor, projectId: string, addedMonthlyMinor: number) {
    const [team, project, monthToDate] = await Promise.all([
      this.prisma.team.findUniqueOrThrow({ where: { id: actor.teamId }, include: { credits: true } }),
      this.prisma.project.findUniqueOrThrow({ where: { id: projectId } }),
      this.monthToDate(projectId),
    ]);

    // Prepaid / promo balance
    const balance = team.credits.reduce((s, c) => s + (!c.expiresAt || c.expiresAt > new Date() ? c.remainingMinor : 0), 0);
    if (team.status === 'pending_verification' && balance <= 0) {
      throw ApiError.spendLimit('Add credit or a payment method before creating billable resources');
    }
    if (addedMonthlyMinor > 0) await this.trust.assertPrepaidBeforePostpaid(team.id, addedMonthlyMinor);

    if (project.spendLimitMinor != null && monthToDate + addedMonthlyMinor > project.spendLimitMinor) {
      await this.events.emit('spend.limit_reached', { projectId, limitMinor: project.spendLimitMinor }, { actor });
      throw ApiError.spendLimit('This project would exceed its monthly spend limit', {
        limitMinor: project.spendLimitMinor,
        monthToDateMinor: monthToDate,
        addedMonthlyMinor,
      });
    }

    if (actor.tokenId) {
      const token = await this.prisma.apiToken.findUniqueOrThrow({ where: { id: actor.tokenId } });
      if (token.spendCapMinor != null && token.spentThisMonthMinor + addedMonthlyMinor > token.spendCapMinor) {
        await this.events.emit('spend.limit_reached', { tokenId: token.id, capMinor: token.spendCapMinor }, { actor });
        throw ApiError.spendLimit('This token would exceed its spend cap', {
          capMinor: token.spendCapMinor,
          spentMinor: token.spentThisMonthMinor,
          addedMonthlyMinor,
        });
      }
      await this.prisma.apiToken.update({ where: { id: token.id }, data: { spentThisMonthMinor: { increment: addedMonthlyMinor } } });
    }
  }

  /** Rated usage so far this month plus the projected cost of running resources. */
  async monthToDate(projectId: string): Promise<number> {
    const agg = await this.prisma.usageRecord.aggregate({
      where: { projectId, hourStart: { gte: startOfMonth(new Date()) } },
      _sum: { amountMinor: true },
    });
    return agg._sum.amountMinor ?? 0;
  }

  /** Called on the 1st of each month. */
  async resetTokenCounters() {
    await this.prisma.apiToken.updateMany({ data: { spentThisMonthMinor: 0 } });
  }

  get hoursPerMonth() {
    return loadConfig().BILLING_HOURS_PER_MONTH;
  }
}
