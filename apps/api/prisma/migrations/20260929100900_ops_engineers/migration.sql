-- DevOps console, step 1: engineer profiles and contract assignments, contract residency policy,
-- ops console sessions (audience column), WebAuthn credentials, ops settings and root cause notes.

-- CreateEnum
CREATE TYPE "prgd_engineer_kind" AS ENUM ('EXTERNAL', 'INTERNAL');

-- CreateEnum
CREATE TYPE "prgd_engineer_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'OFFBOARDED');

-- CreateEnum
CREATE TYPE "prgd_contract_access_policy" AS ENUM ('ANY', 'SAUDI_ONLY', 'TURKIYE_ONLY');

-- AlterTable
ALTER TABLE "prgd_managed_contracts" ADD COLUMN     "accessPolicy" "prgd_contract_access_policy" NOT NULL DEFAULT 'ANY';

-- AlterTable
ALTER TABLE "prgd_sessions" ADD COLUMN     "audience" TEXT NOT NULL DEFAULT 'console',
ADD COLUMN     "secondFactor" TEXT,
ALTER COLUMN "teamId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "prgd_ticket_messages" ADD COLUMN     "rootCause" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "prgd_engineer_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "prgd_engineer_kind" NOT NULL DEFAULT 'EXTERNAL',
    "status" "prgd_engineer_status" NOT NULL DEFAULT 'ACTIVE',
    "country" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Riyadh',
    "hourlyRateMinor" INTEGER,
    "standbyFeeMinor" INTEGER,
    "currency" "prgd_currency" NOT NULL DEFAULT 'USD',
    "nightMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "ipAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "statusReason" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "offboardedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prgd_engineer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prgd_engineer_assignments" (
    "id" TEXT NOT NULL,
    "engineerId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prgd_engineer_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prgd_webauthn_credentials" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deviceType" TEXT,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "prgd_webauthn_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prgd_ops_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "data" JSONB NOT NULL DEFAULT '{}',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prgd_ops_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prgd_engineer_profiles_userId_key" ON "prgd_engineer_profiles"("userId");

-- CreateIndex
CREATE INDEX "prgd_engineer_profiles_status_idx" ON "prgd_engineer_profiles"("status");

-- CreateIndex
CREATE INDEX "prgd_engineer_assignments_contractId_idx" ON "prgd_engineer_assignments"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "prgd_engineer_assignments_engineerId_contractId_key" ON "prgd_engineer_assignments"("engineerId", "contractId");

-- CreateIndex
CREATE UNIQUE INDEX "prgd_webauthn_credentials_credentialId_key" ON "prgd_webauthn_credentials"("credentialId");

-- CreateIndex
CREATE INDEX "prgd_webauthn_credentials_userId_idx" ON "prgd_webauthn_credentials"("userId");

-- CreateIndex
CREATE INDEX "prgd_sessions_userId_audience_createdAt_idx" ON "prgd_sessions"("userId", "audience", "createdAt");

-- AddForeignKey
ALTER TABLE "prgd_engineer_profiles" ADD CONSTRAINT "prgd_engineer_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "prgd_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_engineer_assignments" ADD CONSTRAINT "prgd_engineer_assignments_engineerId_fkey" FOREIGN KEY ("engineerId") REFERENCES "prgd_engineer_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_engineer_assignments" ADD CONSTRAINT "prgd_engineer_assignments_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "prgd_managed_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_webauthn_credentials" ADD CONSTRAINT "prgd_webauthn_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "prgd_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

