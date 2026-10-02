-- Progrid Connect per model pricing. AI tokens are metered per model (SKU "<base>:<model id>",
-- UsageRecord resourceId "<agent id>:<model id>") and prompt cache writes get their own SKUs.
-- The launch prices are created by prisma/seed.ts, since a new enum value cannot be used in
-- the transaction that adds it. See docs/connect.md, Billing.

-- AlterEnum
ALTER TYPE "prgd_resource_type" ADD VALUE 'connect_ai_cache_write';
ALTER TYPE "prgd_resource_type" ADD VALUE 'connect_ai_cache_write_1h';

-- AlterTable
ALTER TABLE "prgd_connect_runs" ADD COLUMN "modelUsage" JSONB NOT NULL DEFAULT '{}';

-- Backfill: runs before this migration used one model, the agent's.
UPDATE "prgd_connect_runs"
SET "modelUsage" = jsonb_build_object("model", jsonb_build_object(
  'input', "inputTokens", 'output', "outputTokens", 'cacheRead', "cacheReadTokens", 'cacheWrite', "cacheWriteTokens", 'cacheWrite1h', 0))
WHERE "inputTokens" + "outputTokens" + "cacheReadTokens" + "cacheWriteTokens" > 0;
