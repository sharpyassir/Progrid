-- One contracting company (docs/domains-and-entities.md): Progrid Arabia sells and invoices
-- everything. Teams whose billing country is Saudi Arabia pay in SAR with 15% VAT, everyone else
-- pays in USD with 0% VAT (zero-rated export of services, to be confirmed by the tax advisor).
-- The progrid_llc enum value, the PRGD-US / CN-US sequences and every invoice and credit note
-- issued by Progrid Technologies LLC stay for history; nothing assigns progrid_llc any more.

-- Teams: a scheduled change is now a change of currency (pendingCurrency), at billingChangeAt
-- (the first day of a month), when the billing country moves into or out of Saudi Arabia.
ALTER TABLE "prgd_teams" ADD COLUMN IF NOT EXISTS "pendingCurrency" "prgd_currency";
ALTER TABLE "prgd_teams" ALTER COLUMN "billingEntity" SET DEFAULT 'progrid_arabia';

-- Invoices: VAT category and note, and the SAR amounts with the exchange rate used (ZATCA wants
-- the VAT amount in SAR on invoices in another currency). Null on invoices issued before this.
ALTER TABLE "prgd_invoices" ADD COLUMN IF NOT EXISTS "vatCategory" TEXT;
ALTER TABLE "prgd_invoices" ADD COLUMN IF NOT EXISTS "taxNote" TEXT;
ALTER TABLE "prgd_invoices" ADD COLUMN IF NOT EXISTS "fxRateSar" DECIMAL(18,6);
ALTER TABLE "prgd_invoices" ADD COLUMN IF NOT EXISTS "subtotalSarMinor" INTEGER;
ALTER TABLE "prgd_invoices" ADD COLUMN IF NOT EXISTS "taxSarMinor" INTEGER;
ALTER TABLE "prgd_invoices" ADD COLUMN IF NOT EXISTS "totalSarMinor" INTEGER;

-- Credit notes: the VAT part of the amount, and the same SAR figures, at the invoice's rate.
ALTER TABLE "prgd_credit_notes" ADD COLUMN IF NOT EXISTS "taxMinor" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "prgd_credit_notes" ADD COLUMN IF NOT EXISTS "vatCategory" TEXT;
ALTER TABLE "prgd_credit_notes" ADD COLUMN IF NOT EXISTS "taxNote" TEXT;
ALTER TABLE "prgd_credit_notes" ADD COLUMN IF NOT EXISTS "fxRateSar" DECIMAL(18,6);
ALTER TABLE "prgd_credit_notes" ADD COLUMN IF NOT EXISTS "amountSarMinor" INTEGER;
ALTER TABLE "prgd_credit_notes" ADD COLUMN IF NOT EXISTS "taxSarMinor" INTEGER;

-- BEGIN single_entity data
-- (test/integration/entities.it.ts runs this block in a transaction it rolls back.)

-- 1. Pending changes of company are void: there is no other company to move to.
UPDATE "prgd_teams" SET "pendingCountry" = NULL, "pendingCurrency" = NULL, "billingChangeAt" = NULL
WHERE "pendingCountry" IS NOT NULL OR "pendingCurrency" IS NOT NULL OR "billingChangeAt" IS NOT NULL;

-- 2. The currency follows the billing country (SA: SAR, else USD). A team whose currency is
-- different moves from the first day of next month, so this month is invoiced in one currency.
-- Teams that still hold money in their current currency keep it: unexpired credit left, or an
-- unpaid invoice. Staff move them later (back office, "Billing country and currency").
UPDATE "prgd_teams" t
SET "pendingCurrency" = (CASE WHEN t."country" = 'SA' THEN 'SAR' ELSE 'USD' END)::"prgd_currency",
    "billingChangeAt" = date_trunc('month', timezone('UTC', now())) + interval '1 month'
WHERE t."currency" <> (CASE WHEN t."country" = 'SA' THEN 'SAR' ELSE 'USD' END)::"prgd_currency"
  AND NOT EXISTS (
    SELECT 1 FROM "prgd_credits" c
    WHERE c."teamId" = t."id" AND c."remainingMinor" > 0 AND c."currency" = t."currency"
      AND (c."expiresAt" IS NULL OR c."expiresAt" > timezone('UTC', now()))
  )
  AND NOT EXISTS (
    SELECT 1 FROM "prgd_invoices" i
    WHERE i."teamId" = t."id" AND i."currency" = t."currency"
      AND i."status" IN ('draft', 'open', 'uncollectible') AND i."totalMinor" - i."creditedMinor" > 0
  );

-- 3. Every team is a customer of Progrid Arabia.
UPDATE "prgd_teams" SET "billingEntity" = 'progrid_arabia' WHERE "billingEntity" = 'progrid_llc';

-- END single_entity data

-- The old scheduled change of company is gone (cleared above).
ALTER TABLE "prgd_teams" DROP COLUMN IF EXISTS "pendingBillingEntity";
