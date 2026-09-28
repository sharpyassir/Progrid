-- DevOps console, step 3: work timers and the worklog review states. Worklogs written before this
-- migration were entered by staff in the back office and are already counted by billing, so they
-- become APPROVED; new entries start as DRAFT.

-- CreateEnum
CREATE TYPE "prgd_work_log_status" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID');

-- CreateEnum
CREATE TYPE "prgd_work_log_source" AS ENUM ('TIMER', 'MANUAL');

-- AlterTable
ALTER TABLE "prgd_work_logs" ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "engineerId" TEXT,
ADD COLUMN     "flagged" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maintenanceRunId" TEXT,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "reviewComment" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "sessionMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "source" "prgd_work_log_source" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "startedAt" TIMESTAMP(3),
ADD COLUMN     "status" "prgd_work_log_status" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "submittedAt" TIMESTAMP(3);

UPDATE "prgd_work_logs" SET "status" = 'APPROVED', "reviewedAt" = "createdAt";

-- CreateTable
CREATE TABLE "prgd_work_timers" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "engineerId" TEXT,
    "contractId" TEXT NOT NULL,
    "ticketId" TEXT,
    "maintenanceRunId" TEXT,
    "note" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "promptedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "stopReason" TEXT,
    "workLogId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prgd_work_timers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prgd_work_timers_workLogId_key" ON "prgd_work_timers"("workLogId");

-- CreateIndex
CREATE INDEX "prgd_work_timers_userId_stoppedAt_idx" ON "prgd_work_timers"("userId", "stoppedAt");

-- CreateIndex
CREATE INDEX "prgd_work_logs_userId_workedAt_idx" ON "prgd_work_logs"("userId", "workedAt");

-- CreateIndex
CREATE INDEX "prgd_work_logs_status_userId_idx" ON "prgd_work_logs"("status", "userId");

-- AddForeignKey
ALTER TABLE "prgd_work_logs" ADD CONSTRAINT "prgd_work_logs_engineerId_fkey" FOREIGN KEY ("engineerId") REFERENCES "prgd_engineer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_work_logs" ADD CONSTRAINT "prgd_work_logs_maintenanceRunId_fkey" FOREIGN KEY ("maintenanceRunId") REFERENCES "prgd_maintenance_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_work_timers" ADD CONSTRAINT "prgd_work_timers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "prgd_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_work_timers" ADD CONSTRAINT "prgd_work_timers_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "prgd_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_work_timers" ADD CONSTRAINT "prgd_work_timers_maintenanceRunId_fkey" FOREIGN KEY ("maintenanceRunId") REFERENCES "prgd_maintenance_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_work_timers" ADD CONSTRAINT "prgd_work_timers_workLogId_fkey" FOREIGN KEY ("workLogId") REFERENCES "prgd_work_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- One running timer per engineer.
CREATE UNIQUE INDEX "prgd_work_timers_one_running_key" ON "prgd_work_timers"("userId") WHERE "stoppedAt" IS NULL;
