import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrentActor, Public, RequireScopes } from '../../common/auth/decorators';
import type { Actor } from '../../common/auth/actor';
import { ApiError } from '../../common/errors/api-error';
import { IamService } from '../iam/iam.service';
import { InvoicesService } from './invoices.service';
import { SpendService } from './spend.service';
import { FxService } from './fx.service';
import { BOOK_CURRENCY, VAT_RATE, displayPrice, startOfMonth, taxRateFor } from './pricing';
import { loadConfig } from '../../config/config';
import { publicEntity, vatFor, ZERO_RATED_NOTE } from '../../common/entities/entities';

const HOUR = 3_600_000;

@ApiTags('billing')
@ApiBearerAuth()
@Controller('v1/billing')
@RequireScopes('billing:read')
export class BillingController {
  constructor(private readonly prisma: PrismaService, private readonly invoices: InvoicesService, private readonly spend: SpendService, private readonly iam: IamService) {}

  @Get('balance')
  async balance(@CurrentActor() actor: Actor) {
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: actor.teamId }, include: { credits: true, projects: { select: { id: true } } } });
    const credit = team.credits.reduce((s, c) => s + (c.currency === team.currency && (!c.expiresAt || c.expiresAt > new Date()) ? c.remainingMinor : 0), 0);
    const now = new Date();
    const month = startOfMonth(now);
    const projects = team.projects.map((p) => p.id);
    const spent = async (from: Date, to?: Date) => (await this.prisma.usageRecord.aggregate({
      where: { projectId: { in: projects }, hourStart: { gte: from, ...(to ? { lt: to } : {}) }, currency: team.currency }, _sum: { amountMinor: true },
    }))._sum.amountMinor ?? 0;
    const [mtd, today, lastDay, lastMonth] = await Promise.all([
      spent(month),
      spent(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))),
      spent(new Date(now.getTime() - 24 * HOUR)),
      spent(startOfMonth(new Date(month.getTime() - 1)), month),
    ]);
    // The projection assumes the last 24 hours keep their pace until the month ends.
    const hoursLeft = (Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - now.getTime()) / HOUR;
    return {
      currency: team.currency,
      creditMinor: credit,
      monthToDateMinor: mtd,
      todayMinor: today,
      projectedMonthMinor: mtd + Math.round((lastDay / 24) * hoursLeft),
      lastMonthMinor: lastMonth,
      status: team.status,
      billingCountry: team.country,
      // The company that invoices this team (always Progrid Arabia), with the team's currency and
      // VAT treatment, shown on the billing page and in the console footer.
      billingEntity: publicEntity(team.billingEntity, team),
      // A country change into or out of Saudi Arabia changes the currency from the first day of next month.
      pendingChange: team.billingChangeAt && (team.pendingCurrency || team.pendingCountry)
        ? { country: team.pendingCountry ?? team.country, currency: team.pendingCurrency ?? team.currency, vat: vatFor(team.pendingCountry ?? team.country), billingEntity: publicEntity(team.billingEntity, { country: team.pendingCountry ?? team.country, currency: team.pendingCurrency ?? team.currency }), effectiveAt: team.billingChangeAt }
        : null,
    };
  }

  @Get('usage')
  async usage(@CurrentActor() actor: Actor, @Query('project') project?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const p = await this.iam.resolveProject(actor, project);
    const rows = await this.prisma.usageRecord.groupBy({
      by: ['resourceType', 'resourceId', 'unit', 'currency'],
      where: { projectId: p.id, hourStart: { gte: from ? new Date(from) : startOfMonth(new Date()), ...(to ? { lt: new Date(to) } : {}) } },
      _sum: { amountMinor: true, quantity: true },
    });
    return { data: rows.map((r) => ({ resourceType: r.resourceType, resourceId: r.resourceId, unit: r.unit, quantity: r._sum.quantity, amountMinor: r._sum.amountMinor, currency: r.currency })) };
  }

  @Get('invoices')
  async list(@CurrentActor() actor: Actor) {
    return { data: await this.invoices.list(actor.teamId) };
  }

  @Get('invoices/:id')
  async get(@CurrentActor() actor: Actor, @Param('id') id: string) {
    const inv = await this.invoices.get(actor.teamId, id);
    if (!inv) throw ApiError.notFound('invoice', id);
    return inv;
  }
}

/**
 * Public price list (no auth). The book is kept in SAR (BOOK_CURRENCY); asking for USD returns the
 * same list converted at the current exchange rate (the pegged 3.75), plus the rate used. Progrid
 * Arabia bills customers in Saudi Arabia in SAR with 15% VAT, everyone else in USD at 0%.
 */
@ApiTags('pricing')
@Controller('v1/pricing')
export class PricingController {
  constructor(private readonly prisma: PrismaService, private readonly fx: FxService) {}

  @Public() @Get()
  async prices(@Query('currency') currency: 'USD' | 'SAR' = loadConfig().DEFAULT_CURRENCY) {
    const prices = await this.prisma.price.findMany({ where: { currency: BOOK_CURRENCY, validTo: null }, include: { size: true } });
    const h = loadConfig().BILLING_HOURS_PER_MONTH;
    const rate = await this.fx.bookRate(currency);
    return {
      currency,
      baseCurrency: BOOK_CURRENCY,
      fxRate: rate,
      usdToSar: await this.fx.rate('SAR'),
      vatRate: VAT_RATE,
      // VAT follows the billing country, and so does the currency: SAR with 15% VAT in Saudi Arabia, USD at 0% elsewhere.
      taxRate: currency === 'SAR' ? taxRateFor('SA') : 0,
      vatNote: currency === 'SAR' ? 'Prices exclude VAT. Customers in Saudi Arabia pay 15% VAT, shown at checkout.' : `Prices in USD for customers outside Saudi Arabia, invoiced by Progrid Arabia at 0% VAT (${ZERO_RATED_NOTE.toLowerCase()}).`,
      hoursPerMonth: h,
      data: prices.map((p) => {
        const monthly = p.unit === 'percent' ? p.monthlyMinor : Math.round(p.monthlyMinor * rate);
        return { resourceType: p.resourceType, sku: p.sku, unit: p.unit, ...displayPrice(monthly, h), size: p.size };
      }),
    };
  }
}
