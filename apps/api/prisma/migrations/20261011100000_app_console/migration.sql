-- App Platform: pre-deploy command, console runs and attached managed databases.

-- Runs once per deploy from the new image before it replaces the running version (migrations).
ALTER TABLE "prgd_platform_apps" ADD COLUMN "preDeployCommand" TEXT;

-- One off commands in a temporary container from the app's live image.
CREATE TYPE "prgd_app_run_status" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'timed_out', 'canceled');

CREATE TABLE "prgd_app_runs" (
  "id" TEXT NOT NULL,
  "appId" TEXT NOT NULL,
  "hostId" TEXT,
  "command" TEXT NOT NULL,
  "status" "prgd_app_run_status" NOT NULL DEFAULT 'queued',
  "exitCode" INTEGER,
  "output" TEXT,
  "timeoutSeconds" INTEGER NOT NULL,
  "userId" TEXT,
  "tokenId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "prgd_app_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "prgd_app_runs_appId_createdAt_idx" ON "prgd_app_runs"("appId", "createdAt");
CREATE INDEX "prgd_app_runs_status_idx" ON "prgd_app_runs"("status");
ALTER TABLE "prgd_app_runs" ADD CONSTRAINT "prgd_app_runs_appId_fkey" FOREIGN KEY ("appId") REFERENCES "prgd_platform_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A managed database attached to an app: a dedicated user and database whose URL is put into
-- the app's environment at push time. The password stays sealed on the user (prgd_db_users).
CREATE TABLE "prgd_app_database_links" (
  "id" TEXT NOT NULL,
  "appId" TEXT NOT NULL,
  "clusterId" TEXT NOT NULL,
  "envName" TEXT NOT NULL DEFAULT 'DATABASE_URL',
  "dbName" TEXT,
  "dbUser" TEXT NOT NULL,
  "createdDb" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "prgd_app_database_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prgd_app_database_links_appId_envName_key" ON "prgd_app_database_links"("appId", "envName");
CREATE INDEX "prgd_app_database_links_clusterId_idx" ON "prgd_app_database_links"("clusterId");
ALTER TABLE "prgd_app_database_links" ADD CONSTRAINT "prgd_app_database_links_appId_fkey" FOREIGN KEY ("appId") REFERENCES "prgd_platform_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prgd_app_database_links" ADD CONSTRAINT "prgd_app_database_links_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "prgd_db_clusters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Trusted sources the platform added for app hosts (the rest of trustedSources is the
-- customer's own), and deleted users whose roles the agent disables on the cluster.
ALTER TABLE "prgd_db_clusters" ADD COLUMN "systemSources" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "prgd_db_clusters" ADD COLUMN "retiredUsers" TEXT[] DEFAULT ARRAY[]::TEXT[];
