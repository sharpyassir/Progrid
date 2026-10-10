import { Prisma } from '@prisma/client';

/**
 * SAR figures printed on every invoice of Progrid Arabia. ZATCA requires the VAT amount in SAR on
 * an invoice in another currency, with the exchange rate used. `rate` is SAR per one unit of the
 * invoice currency (1 for SAR, the USD to SAR rate from FxService for USD), stored with 6 decimals.
 */
export function sarFigures(rate: number, a: { subtotalMinor: number; taxMinor: number; totalMinor: number }) {
  const r = Math.round(rate * 1e6) / 1e6;
  return {
    fxRateSar: new Prisma.Decimal(r.toFixed(6)),
    subtotalSarMinor: Math.round(a.subtotalMinor * r),
    taxSarMinor: Math.round(a.taxMinor * r),
    totalSarMinor: Math.round(a.totalMinor * r),
  };
}

/** The same for a credit note: its amount and the VAT in it, at the rate of the invoice it reverses. */
export function sarCreditFigures(rate: Prisma.Decimal | number | null, a: { amountMinor: number; taxMinor: number }) {
  if (rate === null) return { fxRateSar: null, amountSarMinor: null, taxSarMinor: null };
  const r = Number(rate);
  return { fxRateSar: new Prisma.Decimal(r.toFixed(6)), amountSarMinor: Math.round(a.amountMinor * r), taxSarMinor: Math.round(a.taxMinor * r) };
}
