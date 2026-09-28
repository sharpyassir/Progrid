import type { Prisma } from '@prisma/client';

/**
 * Called by the invoice run inside its transaction, after the usage records were linked to the
 * new invoice: every worklog the managed billing hook counted for a month whose managed lines
 * are on this invoice gets the invoice id, so nothing is billed twice and each entry shows
 * where it was billed.
 */
export async function linkManagedWorkLogs(tx: Prisma.TransactionClient, invoiceId: string) {
  const lines = await tx.usageRecord.findMany({ where: { invoiceId, resourceType: { in: ['managed_plan', 'managed_overage'] } }, select: { resourceId: true, hourStart: true } });
  let linked = 0;
  const seen = new Set<string>();
  for (const l of lines) {
    const key = `${l.resourceId}:${l.hourStart.toISOString()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const r = await tx.workLog.updateMany({ where: { contractId: l.resourceId, billedPeriod: l.hourStart, billedInvoiceId: null }, data: { billedInvoiceId: invoiceId } });
    linked += r.count;
  }
  return linked;
}
