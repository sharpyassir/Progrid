-- DevOps console, step 8: monthly contractor payouts from approved worklogs and completed shifts.

-- CreateEnum
CREATE TYPE "prgd_contractor_payout_status" AS ENUM ('DRAFT', 'ISSUED', 'PAID');

-- AlterTable
ALTER TABLE "prgd_on_call_shifts" ADD COLUMN     "payoutId" TEXT;

-- AlterTable
ALTER TABLE "prgd_work_logs" ADD COLUMN     "payoutId" TEXT;

-- CreateTable
CREATE TABLE "prgd_contractor_payouts" (
    "id" TEXT NOT NULL,
    "engineerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "currency" "prgd_currency" NOT NULL,
    "hourlyRateMinor" INTEGER NOT NULL,
    "standbyFeeMinor" INTEGER NOT NULL,
    "nightMultiplier" DOUBLE PRECISION NOT NULL,
    "standbyShifts" INTEGER NOT NULL,
    "standbyMinor" INTEGER NOT NULL,
    "workedMinutes" INTEGER NOT NULL,
    "nightMinutes" INTEGER NOT NULL,
    "workMinor" INTEGER NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "lines" JSONB NOT NULL DEFAULT '{}',
    "status" "prgd_contractor_payout_status" NOT NULL DEFAULT 'DRAFT',
    "issuedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paidReference" TEXT,
    "paidById" TEXT,
    "statement" BYTEA,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prgd_contractor_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prgd_contractor_payouts_period_status_idx" ON "prgd_contractor_payouts"("period", "status");

-- CreateIndex
CREATE UNIQUE INDEX "prgd_contractor_payouts_engineerId_period_key" ON "prgd_contractor_payouts"("engineerId", "period");

-- AddForeignKey
ALTER TABLE "prgd_on_call_shifts" ADD CONSTRAINT "prgd_on_call_shifts_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "prgd_contractor_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_work_logs" ADD CONSTRAINT "prgd_work_logs_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "prgd_contractor_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_contractor_payouts" ADD CONSTRAINT "prgd_contractor_payouts_engineerId_fkey" FOREIGN KEY ("engineerId") REFERENCES "prgd_engineer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

