-- Progrid Connect: agents, versions, tools, workflows, connections, variables, webhooks, agent keys,
-- runs and run steps, plus the Connect usage resource types. See docs/connect.md.
-- Run step payloads are capped at 64 KB per field by the application before they are written.
-- The Connect price book rows (no price) are created by prisma/seed.ts, since a new enum value
-- cannot be used in the transaction that adds it.

-- CreateEnum
CREATE TYPE "prgd_connect_agent_status" AS ENUM ('draft', 'deployed', 'paused');

-- CreateEnum
CREATE TYPE "prgd_connect_run_status" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'waiting_approval', 'cancelled');

-- CreateEnum
CREATE TYPE "prgd_connect_run_source" AS ENUM ('api', 'webhook', 'test', 'schedule', 'manual');

-- CreateEnum
CREATE TYPE "prgd_connect_connection_kind" AS ENUM ('rest_api', 'postgres', 'mysql', 'mongodb', 'smtp', 'webhook_out', 'custom');

-- CreateEnum
CREATE TYPE "prgd_connect_tool_kind" AS ENUM ('http_request', 'database_query', 'send_email', 'notify', 'webhook_out', 'progrid');

-- CreateEnum
CREATE TYPE "prgd_connect_step_type" AS ENUM ('node', 'model', 'tool', 'condition', 'approval');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "prgd_resource_type" ADD VALUE 'connect_execution';
ALTER TYPE "prgd_resource_type" ADD VALUE 'connect_ai_input';
ALTER TYPE "prgd_resource_type" ADD VALUE 'connect_ai_output';
ALTER TYPE "prgd_resource_type" ADD VALUE 'connect_ai_cache_read';
ALTER TYPE "prgd_resource_type" ADD VALUE 'connect_tool_call';

-- CreateTable
CREATE TABLE "prgd_connect_agents" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "instructions" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL,
    "effort" TEXT NOT NULL DEFAULT 'medium',
    "status" "prgd_connect_agent_status" NOT NULL DEFAULT 'draft',
    "currentVersion" INTEGER,
    "deployedVersion" INTEGER,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "limits" JSONB NOT NULL DEFAULT '{}',
    "templateSlug" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prgd_connect_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prgd_connect_agent_versions" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "snapshot" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prgd_connect_agent_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prgd_connect_tools" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "kind" "prgd_connect_tool_kind" NOT NULL,
    "connectionId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "inputSchema" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prgd_connect_tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prgd_connect_workflows" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "graph" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prgd_connect_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prgd_connect_connections" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "prgd_connect_connection_kind" NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secret" TEXT,
    "secretFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "secretHints" JSONB NOT NULL DEFAULT '{}',
    "access" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'untested',
    "lastTestedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prgd_connect_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prgd_connect_variables" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "secret" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prgd_connect_variables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prgd_connect_webhooks" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenHint" TEXT NOT NULL,
    "signingSecret" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastCalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prgd_connect_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prgd_connect_agent_keys" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prgd_connect_agent_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prgd_connect_runs" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "version" INTEGER,
    "source" "prgd_connect_run_source" NOT NULL,
    "status" "prgd_connect_run_status" NOT NULL DEFAULT 'queued',
    "input" JSONB,
    "output" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "toolCalls" INTEGER NOT NULL DEFAULT 0,
    "apiCalls" INTEGER NOT NULL DEFAULT 0,
    "stepCount" INTEGER NOT NULL DEFAULT 0,
    "costEstimateMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" "prgd_currency" NOT NULL DEFAULT 'SAR',
    "providerCostMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "workflow" BOOLEAN NOT NULL DEFAULT false,
    "keyId" TEXT,
    "idempotencyKey" TEXT,
    "state" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prgd_connect_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prgd_connect_run_steps" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "type" "prgd_connect_step_type" NOT NULL,
    "nodeId" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "input" JSONB,
    "output" JSONB,
    "error" JSONB,
    "tokens" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER,

    CONSTRAINT "prgd_connect_run_steps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prgd_connect_agents_teamId_deletedAt_idx" ON "prgd_connect_agents"("teamId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "prgd_connect_agent_versions_agentId_version_key" ON "prgd_connect_agent_versions"("agentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "prgd_connect_tools_agentId_name_key" ON "prgd_connect_tools"("agentId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "prgd_connect_workflows_agentId_key" ON "prgd_connect_workflows"("agentId");

-- CreateIndex
CREATE INDEX "prgd_connect_connections_teamId_idx" ON "prgd_connect_connections"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "prgd_connect_variables_agentId_key_key" ON "prgd_connect_variables"("agentId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "prgd_connect_webhooks_tokenHash_key" ON "prgd_connect_webhooks"("tokenHash");

-- CreateIndex
CREATE INDEX "prgd_connect_webhooks_agentId_idx" ON "prgd_connect_webhooks"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "prgd_connect_agent_keys_hash_key" ON "prgd_connect_agent_keys"("hash");

-- CreateIndex
CREATE INDEX "prgd_connect_agent_keys_agentId_idx" ON "prgd_connect_agent_keys"("agentId");

-- CreateIndex
CREATE INDEX "prgd_connect_runs_agentId_createdAt_idx" ON "prgd_connect_runs"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "prgd_connect_runs_teamId_createdAt_idx" ON "prgd_connect_runs"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "prgd_connect_runs_teamId_status_createdAt_idx" ON "prgd_connect_runs"("teamId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "prgd_connect_runs_status_createdAt_idx" ON "prgd_connect_runs"("status", "createdAt");

-- CreateIndex
CREATE INDEX "prgd_connect_runs_finishedAt_idx" ON "prgd_connect_runs"("finishedAt");

-- CreateIndex
CREATE INDEX "prgd_connect_run_steps_runId_index_idx" ON "prgd_connect_run_steps"("runId", "index");

-- AddForeignKey
ALTER TABLE "prgd_connect_agents" ADD CONSTRAINT "prgd_connect_agents_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "prgd_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_connect_agent_versions" ADD CONSTRAINT "prgd_connect_agent_versions_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "prgd_connect_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_connect_tools" ADD CONSTRAINT "prgd_connect_tools_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "prgd_connect_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_connect_tools" ADD CONSTRAINT "prgd_connect_tools_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "prgd_connect_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_connect_workflows" ADD CONSTRAINT "prgd_connect_workflows_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "prgd_connect_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_connect_connections" ADD CONSTRAINT "prgd_connect_connections_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "prgd_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_connect_variables" ADD CONSTRAINT "prgd_connect_variables_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "prgd_connect_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_connect_webhooks" ADD CONSTRAINT "prgd_connect_webhooks_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "prgd_connect_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_connect_agent_keys" ADD CONSTRAINT "prgd_connect_agent_keys_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "prgd_connect_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_connect_runs" ADD CONSTRAINT "prgd_connect_runs_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "prgd_connect_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prgd_connect_run_steps" ADD CONSTRAINT "prgd_connect_run_steps_runId_fkey" FOREIGN KEY ("runId") REFERENCES "prgd_connect_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

