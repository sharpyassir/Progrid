-- CreateEnum
CREATE TYPE "prgd_oauth_provider" AS ENUM ('google', 'microsoft');

-- AlterTable
ALTER TABLE "prgd_users" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "prgd_oauth_identities" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "prgd_oauth_provider" NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "tenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "prgd_oauth_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prgd_oauth_identities_userId_idx" ON "prgd_oauth_identities"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "prgd_oauth_identities_provider_subject_key" ON "prgd_oauth_identities"("provider", "subject");

-- AddForeignKey
ALTER TABLE "prgd_oauth_identities" ADD CONSTRAINT "prgd_oauth_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "prgd_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

