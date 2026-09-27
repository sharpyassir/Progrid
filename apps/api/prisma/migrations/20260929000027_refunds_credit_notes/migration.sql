-- Refunds, credit notes, void and manual payments. Credit note numbers come from their own sequence.
CREATE SEQUENCE IF NOT EXISTS "credit_note_number_seq" AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE;

-- AlterEnum
ALTER TYPE "InvoiceStatus" ADD VALUE 'credited';

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "creditedMinor" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "voidedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "refundRef" TEXT,
ADD COLUMN     "refundedAt" TIMESTAMP(3),
ADD COLUMN     "refundedMinor" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CreditNote" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "appliedToDueMinor" INTEGER NOT NULL DEFAULT 0,
    "creditId" TEXT,
    "reason" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditNote_number_key" ON "CreditNote"("number");

-- CreateIndex
CREATE INDEX "CreditNote_teamId_createdAt_idx" ON "CreditNote"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditNote_invoiceId_idx" ON "CreditNote"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_status_idx" ON "Payment"("invoiceId", "status");

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditNote" ADD CONSTRAINT "CreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

