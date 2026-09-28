-- DevOps console, step 5 (API side): terminal sessions through prgd-gateway with recording
-- metadata, and the local encrypted secret store.

-- CreateEnum
CREATE TYPE "prgd_terminal_session_status" AS ENUM ('PENDING', 'ACTIVE', 'ENDED', 'KILLED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "prgd_terminal_sessions" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "ticketId" TEXT,
    "maintenanceRunId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "tokenUsedAt" TIMESTAMP(3),
    "status" "prgd_terminal_session_status" NOT NULL DEFAULT 'PENDING',
    "gatewayId" TEXT,
    "clientIp" TEXT,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),
    "bytesIn" BIGINT NOT NULL DEFAULT 0,
    "bytesOut" BIGINT NOT NULL DEFAULT 0,
    "recordingKey" TEXT,
    "recordingSize" BIGINT,
    "recordingStoredAt" TIMESTAMP(3),
    "recordingExpiredAt" TIMESTAMP(3),
    "certSerial" TEXT,
    "killedById" TEXT,
    "killReason" TEXT,
    "endReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prgd_terminal_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prgd_ops_secrets" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "values" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prgd_ops_secrets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prgd_terminal_sessions_tokenHash_key" ON "prgd_terminal_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "prgd_terminal_sessions_userId_startedAt_idx" ON "prgd_terminal_sessions"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "prgd_terminal_sessions_status_idx" ON "prgd_terminal_sessions"("status");

-- CreateIndex
CREATE INDEX "prgd_terminal_sessions_grantId_idx" ON "prgd_terminal_sessions"("grantId");

-- CreateIndex
CREATE INDEX "prgd_terminal_sessions_assetId_startedAt_idx" ON "prgd_terminal_sessions"("assetId", "startedAt");

-- CreateIndex
CREATE INDEX "prgd_terminal_sessions_recordingExpiredAt_startedAt_idx" ON "prgd_terminal_sessions"("recordingExpiredAt", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "prgd_ops_secrets_ref_key" ON "prgd_ops_secrets"("ref");

-- AddForeignKey
ALTER TABLE "prgd_terminal_sessions" ADD CONSTRAINT "prgd_terminal_sessions_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "prgd_access_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_terminal_sessions" ADD CONSTRAINT "prgd_terminal_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "prgd_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

