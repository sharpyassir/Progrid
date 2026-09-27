-- Overdue reminders at 3, 7 and 14 days, and suspension that powers servers off and back on.
-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "lastReminderAt" TIMESTAMP(3),
ADD COLUMN     "reminderStage" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Server" ADD COLUMN     "suspendedPoweredOff" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspensionReason" TEXT;

-- CreateIndex
CREATE INDEX "Invoice_status_dueAt_idx" ON "Invoice"("status", "dueAt");

