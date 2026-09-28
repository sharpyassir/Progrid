import { slow } from './proxies';

export interface PayoutRunInput {
  /** "2026-09": the month paid. */
  period: string;
}

/**
 * Started on the 3rd of every month for the previous month: generates each external engineer's
 * payout from APPROVED worklogs and completed shifts (night minutes in contract local time),
 * renders the PDF statements and issues them to the engineers. Full staff pay outside the
 * platform and mark each payout PAID with the transfer reference.
 */
export async function opsPayoutRun(input: PayoutRunInput): Promise<string> {
  const r = await slow.opsPayoutRunMonthly(input.period);
  return `${r.payouts} payouts, ${r.issued} issued`;
}
