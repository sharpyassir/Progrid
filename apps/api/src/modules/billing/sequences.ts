import type { Prisma } from '@prisma/client';

/** The document number sequences (migrations 20261004100000_billing_entities); nothing else may be read. */
export const DOCUMENT_SEQUENCES = ['prgd_invoice_number_sa_seq', 'prgd_invoice_number_us_seq', 'prgd_credit_note_number_sa_seq', 'prgd_credit_note_number_us_seq'] as const;
export type DocumentSequence = (typeof DOCUMENT_SEQUENCES)[number];

/** Next value of an invoice or credit note number sequence: whitelisted name, bound as a parameter. */
export async function nextDocumentNumber(tx: Prisma.TransactionClient, name: DocumentSequence): Promise<bigint> {
  if (!(DOCUMENT_SEQUENCES as readonly string[]).includes(name)) throw new Error(`unknown document sequence ${String(name)}`);
  const [{ seq }] = await tx.$queryRaw<{ seq: bigint }[]>`SELECT nextval(${name}::regclass) AS seq`;
  return seq;
}
