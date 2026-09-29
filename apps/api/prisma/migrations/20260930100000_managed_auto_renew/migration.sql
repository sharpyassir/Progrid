-- AlterTable
ALTER TABLE "prgd_managed_contracts" ADD COLUMN     "autoRenew" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "cancelAt" TIMESTAMP(3),
ADD COLUMN     "renewalNoticeAt" TIMESTAMP(3);
