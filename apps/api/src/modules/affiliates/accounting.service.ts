import { Injectable } from '@nestjs/common';
import type { Currency } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiError } from '../../common/errors/api-error';
import { BILLING_ENTITY, entityProfile } from '../../common/entities/entities';

/**
 * Books for the affiliate program (docs/affiliates-tax.md). Progrid Arabia pays every payout, in
 * SAR or USD. The US tax forms, backup withholding and Form 1099 report of Progrid Technologies
 * LLC are gone; their records stay in prgd_affiliate_tax_forms and on the old payouts.
 *
 * Saudi withholding tax on payments to partners outside Saudi Arabia is NOT applied: whether it
 * applies to affiliate commission, and at what rate, must be confirmed with the tax advisor.
 */
@Injectable()
export class AffiliateAccountingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Monthly journal for the books, per currency, from the affiliate ledger: commission earned
   * (expense accrued), reversed, and payouts, with the payable balance at the start and end of the
   * month. Withholding only appears on payouts of the US era (the LLC's backup withholding).
   */
  async accounting(month: string, currency: Currency) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw ApiError.invalid('month must look like 2026-10');
    const [y, m] = month.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 1));
    const sum = async (where: object) => {
      const g = await this.prisma.affiliateLedgerEntry.groupBy({ by: ['kind'], where: { currency, ...where }, _sum: { amountMinor: true, withheldMinor: true } });
      const k = (kind: string) => g.find((x) => x.kind === kind)?._sum;
      return { earned: k('earned')?.amountMinor ?? 0, reversed: k('reversed')?.amountMinor ?? 0, paid: k('paid')?.amountMinor ?? 0, withheld: k('paid')?.withheldMinor ?? 0 };
    };
    const before = await sum({ at: { lt: start } });
    const during = await sum({ at: { gte: start, lt: end } });
    const opening = before.earned - before.reversed - before.paid;
    const closing = opening + during.earned - during.reversed - during.paid;
    const date = new Date(end.getTime() - 1).toISOString().slice(0, 10);
    const company = entityProfile(BILLING_ENTITY).legalName;
    const lines: { date: string; account: string; debitMinor: number; creditMinor: number; memo: string }[] = [];
    const add = (account: string, debitMinor: number, creditMinor: number, memo: string) => { if (debitMinor || creditMinor) lines.push({ date, account, debitMinor, creditMinor, memo }); };
    add('Affiliate commissions (Sales & marketing expense)', during.earned, 0, 'Commission earned on paid customer invoices');
    add('Affiliate commissions payable', 0, during.earned, 'Commission earned on paid customer invoices');
    add('Affiliate commissions payable', during.reversed, 0, 'Commission reversed (refunds, credit notes, chargebacks)');
    add('Affiliate commissions (Sales & marketing expense)', 0, during.reversed, 'Commission reversed (refunds, credit notes, chargebacks)');
    add('Affiliate commissions payable', during.paid, 0, 'Affiliate payouts (gross)');
    add(`Cash (${company} bank, ${currency})`, 0, during.paid - during.withheld, 'Affiliate payouts sent');
    add('Withholding payable (US era, Progrid Technologies LLC)', 0, during.withheld, 'Withholding kept from payouts');
    return {
      month, currency,
      company,
      totals: { earnedMinor: during.earned, reversedMinor: during.reversed, paidGrossMinor: during.paid, withheldMinor: during.withheld, cashMinor: during.paid - during.withheld },
      payable: { openingMinor: opening, closingMinor: closing },
      lines,
    };
  }
}
