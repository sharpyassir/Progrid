import { Injectable } from '@nestjs/common';
import type { Currency, ManagedContract, ManagedPlan } from '@prisma/client';
import { FxService } from '../../billing/fx.service';
import { BOOK_CURRENCY } from '../../billing/pricing';
import { CALENDARS } from '../sla/sla-calculator';
import { parseTargets } from '../managed.constants';

/** What a contract actually costs and includes: plan values with the contract overrides, in the contract currency. */
export interface ContractTerms {
  currency: Currency;
  /** null for a custom plan without a price override yet. */
  monthlyFeeMinor: number | null;
  hourlyRateMinor: number;
  includedEngineerMinutes: number;
  maxAssets: number | null;
  coverage: ManagedPlan['coverage'];
}

@Injectable()
export class ContractTermsService {
  constructor(private readonly fx: FxService) {}

  /** Converts minor units between currencies through the price book currency at `at`. */
  async convert(amountMinor: number, from: Currency, to: Currency, at = new Date()) {
    if (from === to) return amountMinor;
    const inBook = from === BOOK_CURRENCY ? amountMinor : amountMinor / (await this.fx.bookRate(from, at));
    return Math.round(to === BOOK_CURRENCY ? inBook : inBook * (await this.fx.bookRate(to, at)));
  }

  async terms(c: ManagedContract & { plan: ManagedPlan }, at = new Date()): Promise<ContractTerms> {
    const fee = c.priceOverrideMinor ?? (c.plan.priceMinor === null ? null : await this.convert(c.plan.priceMinor, c.plan.currency, c.currency, at));
    return {
      currency: c.currency,
      monthlyFeeMinor: fee,
      hourlyRateMinor: await this.convert(c.plan.hourlyRateMinor, c.plan.currency, c.currency, at),
      includedEngineerMinutes: c.includedMinutesOverride ?? c.plan.includedEngineerMinutes,
      maxAssets: c.maxAssetsOverride ?? c.plan.maxAssets,
      coverage: c.plan.coverage,
    };
  }

  /** The SLA block shown on a contract. */
  sla(c: ManagedContract & { plan: ManagedPlan }) {
    const cal = CALENDARS[c.calendar];
    return {
      coverage: c.plan.coverage,
      calendar: c.calendar,
      timeZone: cal.timeZone,
      businessHours: c.plan.coverage === 'BUSINESS_HOURS' ? { workdays: cal.workdays, start: `${String(cal.startHour).padStart(2, '0')}:00`, end: `${String(cal.endHour).padStart(2, '0')}:00` } : null,
      responseTargets: parseTargets(c.plan.responseTargets, 'responseTargets'),
      resolveTargets: parseTargets(c.plan.resolveTargets, 'resolveTargets'),
    };
  }
}
