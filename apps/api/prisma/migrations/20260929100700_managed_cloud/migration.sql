-- Managed cloud: plans, contracts, onboarding, assets, responsibility matrix, alerts, on call,
-- paging, maintenance, engineer worklogs, runbooks, monthly reports and holidays. Managed
-- tickets extend the support Ticket and TicketMessage tables.
-- CreateEnum
CREATE TYPE "ManagedCoverage" AS ENUM ('BUSINESS_HOURS', 'TWENTY_FOUR_SEVEN');

-- CreateEnum
CREATE TYPE "ManagedContractStatus" AS ENUM ('DRAFT', 'ONBOARDING', 'ACTIVE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ManagedCalendar" AS ENUM ('SA', 'TR');

-- CreateEnum
CREATE TYPE "ManagedPriority" AS ENUM ('P1', 'P2', 'P3', 'P4');

-- CreateEnum
CREATE TYPE "ManagedAssetKind" AS ENUM ('PLATFORM_SERVER', 'EXTERNAL_SERVER', 'SITE');

-- CreateEnum
CREATE TYPE "ManagedAssetStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ManagedAssetHealth" AS ENUM ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNHEALTHY');

-- CreateEnum
CREATE TYPE "ResponsibilityOwner" AS ENUM ('PROGRID', 'CUSTOMER', 'SHARED');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('CRITICAL', 'WARNING', 'INFO');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('FIRING', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "OnCallRole" AS ENUM ('PRIMARY', 'SECONDARY');

-- CreateEnum
CREATE TYPE "PageChannel" AS ENUM ('SMS', 'WHATSAPP', 'PUSH', 'EMAIL');

-- CreateEnum
CREATE TYPE "MaintenanceKind" AS ENUM ('PATCHING', 'BACKUP_TEST', 'CUSTOM');

-- CreateEnum
CREATE TYPE "MaintenanceRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "MonthlyReportStatus" AS ENUM ('DRAFT', 'SENT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ResourceType" ADD VALUE 'managed_plan';
ALTER TYPE "ResourceType" ADD VALUE 'managed_overage';

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "assetId" TEXT,
ADD COLUMN     "assigneeId" TEXT,
ADD COLUMN     "breachedAt" TIMESTAMP(3),
ADD COLUMN     "contractId" TEXT,
ADD COLUMN     "managedPriority" "ManagedPriority",
ADD COLUMN     "resolveBreached" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "resolveDueAt" TIMESTAMP(3),
ADD COLUMN     "responseBreached" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "responseDueAt" TIMESTAMP(3),
ADD COLUMN     "source" TEXT,
ADD COLUMN     "warnedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TicketMessage" ADD COLUMN     "internal" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pagingChannel" "PageChannel",
ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "ManagedPlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceMinor" INTEGER,
    "currency" "Currency" NOT NULL DEFAULT 'SAR',
    "maxAssets" INTEGER,
    "coverage" "ManagedCoverage" NOT NULL,
    "includedEngineerMinutes" INTEGER NOT NULL DEFAULT 0,
    "hourlyRateMinor" INTEGER NOT NULL,
    "responseTargets" JSONB NOT NULL,
    "resolveTargets" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagedPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagedContract" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "ManagedContractStatus" NOT NULL DEFAULT 'DRAFT',
    "calendar" "ManagedCalendar" NOT NULL DEFAULT 'SA',
    "currency" "Currency" NOT NULL,
    "priceOverrideMinor" INTEGER,
    "includedMinutesOverride" INTEGER,
    "maxAssetsOverride" INTEGER,
    "liabilityCapMinor" INTEGER,
    "signedByName" TEXT,
    "signedAt" TIMESTAMP(3),
    "signedById" TEXT,
    "onCallOverride" BOOLEAN NOT NULL DEFAULT false,
    "termMonths" INTEGER NOT NULL DEFAULT 12,
    "termEndsAt" TIMESTAMP(3),
    "renewedAt" TIMESTAMP(3),
    "requestedById" TEXT,
    "notes" TEXT,
    "onboardingStartedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "suspensions" JSONB NOT NULL DEFAULT '[]',
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagedContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnboardingItem" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "doneById" TEXT,
    "doneAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagedAsset" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "kind" "ManagedAssetKind" NOT NULL,
    "serverId" TEXT,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "managementAddress" TEXT,
    "provider" TEXT,
    "os" TEXT,
    "status" "ManagedAssetStatus" NOT NULL DEFAULT 'PENDING',
    "monitoringEnabled" BOOLEAN NOT NULL DEFAULT true,
    "backupEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastHeartbeatAt" TIMESTAMP(3),
    "health" "ManagedAssetHealth" NOT NULL DEFAULT 'UNKNOWN',
    "heartbeatReport" JSONB,
    "heartbeatTokenHash" TEXT,
    "requestedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "notes" TEXT,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Responsibility" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "owner" "ResponsibilityOwner" NOT NULL,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Responsibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "openKey" TEXT,
    "name" TEXT NOT NULL,
    "summary" TEXT,
    "severity" "AlertSeverity" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'FIRING',
    "source" TEXT NOT NULL DEFAULT 'alertmanager',
    "labels" JSONB NOT NULL DEFAULT '{}',
    "annotations" JSONB NOT NULL DEFAULT '{}',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "lastReceivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ticketId" TEXT,
    "acknowledgedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnCallShift" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OnCallRole" NOT NULL DEFAULT 'PRIMARY',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnCallShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "alertId" TEXT,
    "ticketId" TEXT,
    "userId" TEXT NOT NULL,
    "channel" "PageChannel" NOT NULL,
    "provider" TEXT NOT NULL,
    "urgency" TEXT NOT NULL DEFAULT 'high',
    "message" TEXT NOT NULL,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "ackAt" TIMESTAMP(3),
    "ackById" TEXT,
    "escalatedAt" TIMESTAMP(3),
    "escalatedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceTask" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "assetId" TEXT,
    "kind" "MaintenanceKind" NOT NULL,
    "name" TEXT NOT NULL,
    "cron" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Riyadh',
    "playbook" TEXT NOT NULL,
    "vars" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceRun" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "status" "MaintenanceRunStatus" NOT NULL DEFAULT 'QUEUED',
    "trigger" TEXT NOT NULL DEFAULT 'schedule',
    "startedById" TEXT,
    "runner" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "log" TEXT NOT NULL DEFAULT '',
    "error" TEXT,
    "ticketId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaintenanceRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkLog" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "ticketId" TEXT,
    "userId" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "workedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "billedPeriod" TIMESTAMP(3),
    "billedInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Runbook" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Runbook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyReport" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" "MonthlyReportStatus" NOT NULL DEFAULT 'DRAFT',
    "data" JSONB NOT NULL,
    "recommendations" TEXT NOT NULL DEFAULT '',
    "pdf" BYTEA,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "sentById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonthlyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "country" "ManagedCalendar" NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManagedPlan_code_key" ON "ManagedPlan"("code");

-- CreateIndex
CREATE INDEX "ManagedContract_teamId_status_idx" ON "ManagedContract"("teamId", "status");

-- CreateIndex
CREATE INDEX "ManagedContract_status_idx" ON "ManagedContract"("status");

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingItem_contractId_key_key" ON "OnboardingItem"("contractId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ManagedAsset_heartbeatTokenHash_key" ON "ManagedAsset"("heartbeatTokenHash");

-- CreateIndex
CREATE INDEX "ManagedAsset_contractId_status_idx" ON "ManagedAsset"("contractId", "status");

-- CreateIndex
CREATE INDEX "ManagedAsset_status_kind_lastHeartbeatAt_idx" ON "ManagedAsset"("status", "kind", "lastHeartbeatAt");

-- CreateIndex
CREATE UNIQUE INDEX "Responsibility_contractId_area_key" ON "Responsibility"("contractId", "area");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_openKey_key" ON "Alert"("openKey");

-- CreateIndex
CREATE INDEX "Alert_contractId_status_idx" ON "Alert"("contractId", "status");

-- CreateIndex
CREATE INDEX "Alert_assetId_startsAt_idx" ON "Alert"("assetId", "startsAt");

-- CreateIndex
CREATE INDEX "Alert_status_severity_idx" ON "Alert"("status", "severity");

-- CreateIndex
CREATE INDEX "OnCallShift_startsAt_endsAt_idx" ON "OnCallShift"("startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "OnCallShift_userId_startsAt_idx" ON "OnCallShift"("userId", "startsAt");

-- CreateIndex
CREATE INDEX "Page_userId_ackAt_idx" ON "Page"("userId", "ackAt");

-- CreateIndex
CREATE INDEX "Page_alertId_idx" ON "Page"("alertId");

-- CreateIndex
CREATE INDEX "Page_ticketId_idx" ON "Page"("ticketId");

-- CreateIndex
CREATE INDEX "MaintenanceTask_enabled_nextRunAt_idx" ON "MaintenanceTask"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "MaintenanceTask_contractId_idx" ON "MaintenanceTask"("contractId");

-- CreateIndex
CREATE INDEX "MaintenanceRun_taskId_createdAt_idx" ON "MaintenanceRun"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "MaintenanceRun_status_idx" ON "MaintenanceRun"("status");

-- CreateIndex
CREATE INDEX "WorkLog_contractId_workedAt_idx" ON "WorkLog"("contractId", "workedAt");

-- CreateIndex
CREATE INDEX "WorkLog_contractId_billedPeriod_idx" ON "WorkLog"("contractId", "billedPeriod");

-- CreateIndex
CREATE UNIQUE INDEX "Runbook_slug_key" ON "Runbook"("slug");

-- CreateIndex
CREATE INDEX "Runbook_title_idx" ON "Runbook"("title");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyReport_contractId_period_key" ON "MonthlyReport"("contractId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_country_date_key" ON "Holiday"("country", "date");

-- CreateIndex
CREATE INDEX "Ticket_contractId_status_idx" ON "Ticket"("contractId", "status");

-- CreateIndex
CREATE INDEX "Ticket_assigneeId_status_idx" ON "Ticket"("assigneeId", "status");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "ManagedContract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "ManagedAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedContract" ADD CONSTRAINT "ManagedContract_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedContract" ADD CONSTRAINT "ManagedContract_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ManagedPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedContract" ADD CONSTRAINT "ManagedContract_signedById_fkey" FOREIGN KEY ("signedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingItem" ADD CONSTRAINT "OnboardingItem_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "ManagedContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnboardingItem" ADD CONSTRAINT "OnboardingItem_doneById_fkey" FOREIGN KEY ("doneById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedAsset" ADD CONSTRAINT "ManagedAsset_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "ManagedContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagedAsset" ADD CONSTRAINT "ManagedAsset_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Responsibility" ADD CONSTRAINT "Responsibility_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "ManagedContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "ManagedAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "ManagedContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnCallShift" ADD CONSTRAINT "OnCallShift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Page" ADD CONSTRAINT "Page_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceTask" ADD CONSTRAINT "MaintenanceTask_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "ManagedContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceTask" ADD CONSTRAINT "MaintenanceTask_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "ManagedAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRun" ADD CONSTRAINT "MaintenanceRun_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "MaintenanceTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceRun" ADD CONSTRAINT "MaintenanceRun_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLog" ADD CONSTRAINT "WorkLog_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "ManagedContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLog" ADD CONSTRAINT "WorkLog_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLog" ADD CONSTRAINT "WorkLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLog" ADD CONSTRAINT "WorkLog_billedInvoiceId_fkey" FOREIGN KEY ("billedInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Runbook" ADD CONSTRAINT "Runbook_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyReport" ADD CONSTRAINT "MonthlyReport_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "ManagedContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
