-- Restores: a cluster status while one runs, and the engine side name of each backup.
ALTER TYPE "DbClusterStatus" ADD VALUE 'restoring';
ALTER TABLE "DbBackup" ADD COLUMN "ref" TEXT;
