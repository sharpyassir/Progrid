-- CreateEnum
CREATE TYPE "prgd_affiliate_status" AS ENUM ('pending', 'approved', 'rejected', 'suspended');

-- CreateEnum
CREATE TYPE "prgd_referral_source" AS ENUM ('link', 'promo_code');

-- CreateEnum
CREATE TYPE "prgd_referral_status" AS ENUM ('active', 'blocked');

-- CreateEnum
CREATE TYPE "prgd_commission_status" AS ENUM ('pending', 'approved', 'paid', 'reversed');

-- CreateEnum
CREATE TYPE "prgd_affiliate_payout_status" AS ENUM ('requested', 'paid', 'cancelled');

-- AlterTable
ALTER TABLE "prgd_users" ADD COLUMN     "signupIp" TEXT;

-- AlterTable
ALTER TABLE "prgd_payments" ADD COLUMN     "cardFingerprint" TEXT,
ADD COLUMN     "disputedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "prgd_credit_applications" (
    "id" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "kind" "prgd_credit_kind" NOT NULL,
    "currency" "prgd_currency" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prgd_credit_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prgd_affiliates" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "prgd_affiliate_status" NOT NULL DEFAULT 'pending',
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "channels" TEXT[],
    "audienceSize" TEXT NOT NULL,
    "contentLanguage" TEXT NOT NULL,
    "promotionPlan" TEXT NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "termsAcceptedAt" TIMESTAMP(3) NOT NULL,
    "applicationIp" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "statusReason" TEXT,
    "payoutMethod" TEXT,
    "payoutDetails" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prgd_affiliates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prgd_affiliate_clicks" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "ipHash" TEXT NOT NULL,
    "landingPath" TEXT,
    "referrer" TEXT,
    "country" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prgd_affiliate_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prgd_referrals" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "prgd_referral_source" NOT NULL,
    "code" TEXT NOT NULL,
    "status" "prgd_referral_status" NOT NULL DEFAULT 'active',
    "blockedReason" TEXT,
    "signupIp" TEXT,
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "discountUntil" TIMESTAMP(3),
    "commissionUntil" TIMESTAMP(3) NOT NULL,
    "attributedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prgd_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prgd_affiliate_commissions" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "referralId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "currency" "prgd_currency" NOT NULL,
    "baseMinor" INTEGER NOT NULL,
    "rateBp" INTEGER NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "status" "prgd_commission_status" NOT NULL DEFAULT 'pending',
    "holdUntil" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "payoutId" TEXT,
    "paidAt" TIMESTAMP(3),
    "reversedMinor" INTEGER NOT NULL DEFAULT 0,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prgd_affiliate_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prgd_affiliate_payouts" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "currency" "prgd_currency" NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "status" "prgd_affiliate_payout_status" NOT NULL DEFAULT 'requested',
    "details" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,

    CONSTRAINT "prgd_affiliate_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prgd_affiliate_flags" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "prgd_affiliate_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prgd_affiliate_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "data" JSONB NOT NULL DEFAULT '{}',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prgd_affiliate_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prgd_credit_applications_invoiceId_idx" ON "prgd_credit_applications"("invoiceId");

-- CreateIndex
CREATE INDEX "prgd_credit_applications_creditId_idx" ON "prgd_credit_applications"("creditId");

-- CreateIndex
CREATE UNIQUE INDEX "prgd_affiliates_userId_key" ON "prgd_affiliates"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "prgd_affiliates_code_key" ON "prgd_affiliates"("code");

-- CreateIndex
CREATE INDEX "prgd_affiliates_status_createdAt_idx" ON "prgd_affiliates"("status", "createdAt");

-- CreateIndex
CREATE INDEX "prgd_affiliate_clicks_affiliateId_at_idx" ON "prgd_affiliate_clicks"("affiliateId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "prgd_affiliate_clicks_affiliateId_day_ipHash_key" ON "prgd_affiliate_clicks"("affiliateId", "day", "ipHash");

-- CreateIndex
CREATE UNIQUE INDEX "prgd_referrals_teamId_key" ON "prgd_referrals"("teamId");

-- CreateIndex
CREATE INDEX "prgd_referrals_affiliateId_attributedAt_idx" ON "prgd_referrals"("affiliateId", "attributedAt");

-- CreateIndex
CREATE INDEX "prgd_referrals_signupIp_idx" ON "prgd_referrals"("signupIp");

-- CreateIndex
CREATE INDEX "prgd_affiliate_commissions_affiliateId_status_currency_idx" ON "prgd_affiliate_commissions"("affiliateId", "status", "currency");

-- CreateIndex
CREATE INDEX "prgd_affiliate_commissions_status_holdUntil_idx" ON "prgd_affiliate_commissions"("status", "holdUntil");

-- CreateIndex
CREATE UNIQUE INDEX "prgd_affiliate_commissions_invoiceId_category_key" ON "prgd_affiliate_commissions"("invoiceId", "category");

-- CreateIndex
CREATE INDEX "prgd_affiliate_payouts_affiliateId_requestedAt_idx" ON "prgd_affiliate_payouts"("affiliateId", "requestedAt");

-- CreateIndex
CREATE INDEX "prgd_affiliate_payouts_status_idx" ON "prgd_affiliate_payouts"("status");

-- CreateIndex
CREATE INDEX "prgd_affiliate_flags_affiliateId_createdAt_idx" ON "prgd_affiliate_flags"("affiliateId", "createdAt");

-- CreateIndex
CREATE INDEX "prgd_affiliate_flags_resolvedAt_idx" ON "prgd_affiliate_flags"("resolvedAt");

-- CreateIndex
CREATE INDEX "prgd_payments_cardFingerprint_idx" ON "prgd_payments"("cardFingerprint");

-- AddForeignKey
ALTER TABLE "prgd_credit_applications" ADD CONSTRAINT "prgd_credit_applications_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "prgd_credits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_credit_applications" ADD CONSTRAINT "prgd_credit_applications_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "prgd_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_affiliates" ADD CONSTRAINT "prgd_affiliates_userId_fkey" FOREIGN KEY ("userId") REFERENCES "prgd_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_affiliate_clicks" ADD CONSTRAINT "prgd_affiliate_clicks_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "prgd_affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_referrals" ADD CONSTRAINT "prgd_referrals_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "prgd_affiliates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_referrals" ADD CONSTRAINT "prgd_referrals_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "prgd_teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_affiliate_commissions" ADD CONSTRAINT "prgd_affiliate_commissions_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "prgd_affiliates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_affiliate_commissions" ADD CONSTRAINT "prgd_affiliate_commissions_referralId_fkey" FOREIGN KEY ("referralId") REFERENCES "prgd_referrals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_affiliate_commissions" ADD CONSTRAINT "prgd_affiliate_commissions_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "prgd_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_affiliate_commissions" ADD CONSTRAINT "prgd_affiliate_commissions_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "prgd_affiliate_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_affiliate_payouts" ADD CONSTRAINT "prgd_affiliate_payouts_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "prgd_affiliates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_affiliate_flags" ADD CONSTRAINT "prgd_affiliate_flags_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "prgd_affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

