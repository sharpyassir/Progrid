-- CreateEnum
CREATE TYPE "prgd_affiliate_tax_form_type" AS ENUM ('W9', 'W8BEN', 'W8BENE');

-- CreateEnum
CREATE TYPE "prgd_affiliate_tax_form_status" AS ENUM ('active', 'superseded', 'invalid');

-- CreateEnum
CREATE TYPE "prgd_affiliate_ledger_kind" AS ENUM ('earned', 'reversed', 'paid');

-- AlterTable
ALTER TABLE "prgd_affiliate_payouts" ADD COLUMN     "taxFormId" TEXT,
ADD COLUMN     "withheldMinor" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "prgd_affiliate_tax_forms" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "formType" "prgd_affiliate_tax_form_type" NOT NULL,
    "status" "prgd_affiliate_tax_form_status" NOT NULL DEFAULT 'active',
    "revision" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "businessName" TEXT,
    "taxClassification" TEXT,
    "exemptPayeeCode" TEXT,
    "fatcaCode" TEXT,
    "fatcaStatus" TEXT,
    "tinType" TEXT NOT NULL,
    "tin" TEXT,
    "tinLast4" TEXT,
    "citizenshipCountry" TEXT,
    "dateOfBirth" TEXT,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "region" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL,
    "mailingAddress" TEXT,
    "backupWithholding" BOOLEAN NOT NULL DEFAULT false,
    "backupWithholdingReason" TEXT,
    "servicesOutsideUs" BOOLEAN NOT NULL DEFAULT false,
    "signatureName" TEXT NOT NULL,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "signedIp" TEXT,
    "certificationText" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "statusReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prgd_affiliate_tax_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prgd_affiliate_ledger" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "currency" "prgd_currency" NOT NULL,
    "kind" "prgd_affiliate_ledger_kind" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "withheldMinor" INTEGER NOT NULL DEFAULT 0,
    "commissionId" TEXT,
    "payoutId" TEXT,
    "invoiceId" TEXT,
    "memo" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prgd_affiliate_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prgd_affiliate_tax_forms_affiliateId_status_idx" ON "prgd_affiliate_tax_forms"("affiliateId", "status");

-- CreateIndex
CREATE INDEX "prgd_affiliate_ledger_currency_at_idx" ON "prgd_affiliate_ledger"("currency", "at");

-- CreateIndex
CREATE INDEX "prgd_affiliate_ledger_affiliateId_at_idx" ON "prgd_affiliate_ledger"("affiliateId", "at");

-- AddForeignKey
ALTER TABLE "prgd_affiliate_payouts" ADD CONSTRAINT "prgd_affiliate_payouts_taxFormId_fkey" FOREIGN KEY ("taxFormId") REFERENCES "prgd_affiliate_tax_forms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_affiliate_tax_forms" ADD CONSTRAINT "prgd_affiliate_tax_forms_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "prgd_affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_affiliate_ledger" ADD CONSTRAINT "prgd_affiliate_ledger_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "prgd_affiliates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Backfill the ledger from commissions and payouts recorded before it existed.
INSERT INTO "prgd_affiliate_ledger" ("id", "affiliateId", "currency", "kind", "amountMinor", "commissionId", "invoiceId", "memo", "at")
SELECT 'bfe_' || "id", "affiliateId", "currency", 'earned', "amountMinor", "id", "invoiceId", "category", "createdAt"
FROM "prgd_affiliate_commissions" WHERE "amountMinor" > 0;

INSERT INTO "prgd_affiliate_ledger" ("id", "affiliateId", "currency", "kind", "amountMinor", "commissionId", "invoiceId", "memo", "at")
SELECT 'bfr_' || "id", "affiliateId", "currency", 'reversed', "reversedMinor", "id", "invoiceId", "reversalReason", COALESCE("reversedAt", "createdAt")
FROM "prgd_affiliate_commissions" WHERE "amountMinor" > 0 AND "reversedMinor" > 0;

INSERT INTO "prgd_affiliate_ledger" ("id", "affiliateId", "currency", "kind", "amountMinor", "payoutId", "memo", "at")
SELECT 'bfp_' || "id", "affiliateId", "currency", 'paid', "amountMinor", "id", "reference", "paidAt"
FROM "prgd_affiliate_payouts" WHERE "status" = 'paid' AND "paidAt" IS NOT NULL;
