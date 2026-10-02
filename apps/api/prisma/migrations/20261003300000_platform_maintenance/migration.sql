-- CreateEnum
CREATE TYPE "prgd_platform_task_status" AS ENUM ('open', 'passed', 'attention', 'done', 'overdue');

-- CreateTable
CREATE TABLE "prgd_platform_task_runs" (
    "id" TEXT NOT NULL,
    "taskKey" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "prgd_platform_task_status" NOT NULL DEFAULT 'open',
    "checkStatus" TEXT,
    "checkSummary" TEXT,
    "checkDetails" JSONB,
    "checkedAt" TIMESTAMP(3),
    "note" TEXT,
    "evidence" TEXT,
    "minutes" INTEGER NOT NULL DEFAULT 0,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "overdueNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prgd_platform_task_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prgd_platform_task_runs_status_dueAt_idx" ON "prgd_platform_task_runs"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "prgd_platform_task_runs_taskKey_periodKey_key" ON "prgd_platform_task_runs"("taskKey", "periodKey");

