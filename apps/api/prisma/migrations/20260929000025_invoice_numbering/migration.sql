-- Invoice numbers come from one global sequence (PG-2026-000123) instead of a count, and a
-- team gets at most one invoice per billing period.
CREATE SEQUENCE IF NOT EXISTS "invoice_number_seq" AS BIGINT START WITH 1 INCREMENT BY 1 NO CYCLE;

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_teamId_periodStart_periodEnd_key" ON "Invoice"("teamId", "periodStart", "periodEnd");
