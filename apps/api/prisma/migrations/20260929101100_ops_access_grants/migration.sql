-- DevOps console, step 4: access grants, the local SSH certificate authority key and the log of
-- issued certificates.

-- CreateEnum
CREATE TYPE "prgd_access_grant_status" AS ENUM ('REQUESTED', 'APPROVED', 'ACTIVE', 'DENIED', 'EXPIRED', 'REVOKED');

-- CreateTable
CREATE TABLE "prgd_access_grants" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "engineerId" TEXT,
    "contractId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "ticketId" TEXT,
    "maintenanceRunId" TEXT,
    "reason" TEXT NOT NULL,
    "requestedMinutes" INTEGER NOT NULL,
    "status" "prgd_access_grant_status" NOT NULL DEFAULT 'REQUESTED',
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "emergency" BOOLEAN NOT NULL DEFAULT false,
    "grantedMinutes" INTEGER,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "deniedById" TEXT,
    "denyReason" TEXT,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "extensions" INTEGER NOT NULL DEFAULT 0,
    "extendedAt" TIMESTAMP(3),
    "extensionReason" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokeReason" TEXT,
    "certSerial" TEXT,
    "principals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prgd_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prgd_ssh_ca_keys" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prgd_ssh_ca_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prgd_ssh_certificates" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "sessionId" TEXT,
    "serial" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "principals" TEXT[],
    "fingerprint" TEXT NOT NULL,
    "validAfter" TIMESTAMP(3) NOT NULL,
    "validBefore" TIMESTAMP(3) NOT NULL,
    "ca" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prgd_ssh_certificates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prgd_access_grants_userId_status_idx" ON "prgd_access_grants"("userId", "status");

-- CreateIndex
CREATE INDEX "prgd_access_grants_status_expiresAt_idx" ON "prgd_access_grants"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "prgd_access_grants_ticketId_idx" ON "prgd_access_grants"("ticketId");

-- CreateIndex
CREATE INDEX "prgd_access_grants_assetId_startsAt_idx" ON "prgd_access_grants"("assetId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "prgd_ssh_ca_keys_name_key" ON "prgd_ssh_ca_keys"("name");

-- CreateIndex
CREATE UNIQUE INDEX "prgd_ssh_certificates_serial_key" ON "prgd_ssh_certificates"("serial");

-- CreateIndex
CREATE INDEX "prgd_ssh_certificates_grantId_idx" ON "prgd_ssh_certificates"("grantId");

-- AddForeignKey
ALTER TABLE "prgd_access_grants" ADD CONSTRAINT "prgd_access_grants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "prgd_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_access_grants" ADD CONSTRAINT "prgd_access_grants_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "prgd_managed_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_access_grants" ADD CONSTRAINT "prgd_access_grants_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "prgd_managed_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_access_grants" ADD CONSTRAINT "prgd_access_grants_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "prgd_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_access_grants" ADD CONSTRAINT "prgd_access_grants_maintenanceRunId_fkey" FOREIGN KEY ("maintenanceRunId") REFERENCES "prgd_maintenance_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_ssh_certificates" ADD CONSTRAINT "prgd_ssh_certificates_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "prgd_access_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

