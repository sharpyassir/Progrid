-- AlterTable
ALTER TABLE "prgd_invoices" ADD COLUMN     "affiliateCheckedAt" TIMESTAMP(3),
ADD COLUMN     "discountMinor" INTEGER NOT NULL DEFAULT 0;

