-- Two contracting companies (docs/domains-and-entities.md): Progrid Arabia invoices teams whose
-- billing country is Saudi Arabia, Progrid Technologies LLC invoices everyone else.

-- CreateEnum
CREATE TYPE "prgd_billing_entity" AS ENUM ('progrid_arabia', 'progrid_llc');

-- AlterEnum: Stripe takes card payments for the LLC.
ALTER TYPE "prgd_payment_provider" ADD VALUE 'stripe';

-- Teams: the entity follows the billing country. A staff approved change waits in the pending
-- columns until the start of the next billing period.
ALTER TABLE "prgd_teams" ALTER COLUMN "country" SET DEFAULT 'US';
ALTER TABLE "prgd_teams" ADD COLUMN "billingEntity" "prgd_billing_entity" NOT NULL DEFAULT 'progrid_llc';
ALTER TABLE "prgd_teams" ADD COLUMN "pendingCountry" TEXT;
ALTER TABLE "prgd_teams" ADD COLUMN "pendingBillingEntity" "prgd_billing_entity";
ALTER TABLE "prgd_teams" ADD COLUMN "billingChangeAt" TIMESTAMP(3);
UPDATE "prgd_teams" SET "billingEntity" = CASE WHEN "country" = 'SA' THEN 'progrid_arabia'::"prgd_billing_entity" ELSE 'progrid_llc'::"prgd_billing_entity" END;
CREATE INDEX "prgd_teams_billingEntity_idx" ON "prgd_teams"("billingEntity");

-- Invoices and credit notes record the company that issued them. Everything issued before this
-- migration was issued by the Saudi company, the only one that existed, and keeps its number.
ALTER TABLE "prgd_invoices" ADD COLUMN "billingEntity" "prgd_billing_entity" NOT NULL DEFAULT 'progrid_arabia';
CREATE INDEX "prgd_invoices_billingEntity_createdAt_idx" ON "prgd_invoices"("billingEntity", "createdAt");
ALTER TABLE "prgd_credit_notes" ADD COLUMN "billingEntity" "prgd_billing_entity" NOT NULL DEFAULT 'progrid_arabia';

-- One number series per company: PRGD-SA-2026-00001 and PRGD-US-2026-00001 (CN-SA-, CN-US- for
-- credit notes). The old prgd_invoice_number_seq and prgd_credit_note_number_seq stay for history.
CREATE SEQUENCE IF NOT EXISTS "prgd_invoice_number_sa_seq" START 1;
CREATE SEQUENCE IF NOT EXISTS "prgd_invoice_number_us_seq" START 1;
CREATE SEQUENCE IF NOT EXISTS "prgd_credit_note_number_sa_seq" START 1;
CREATE SEQUENCE IF NOT EXISTS "prgd_credit_note_number_us_seq" START 1;
