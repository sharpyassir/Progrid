import type { ResourceType } from '@prisma/client';

/**
 * Product categories that carry their own commission rate (docs/affiliates.md). Every billable
 * resource type maps to exactly one; a new resource type fails to compile until it is added here.
 */
export const COMMISSION_CATEGORIES = ['web_hosting', 'connect', 'servers', 'managed_cloud', 'ai_usage', 'support'] as const;
export type CommissionCategory = (typeof COMMISSION_CATEGORIES)[number];

export const CATEGORY_OF: Record<ResourceType, CommissionCategory> = {
  // Web hosting: App Platform and one click Marketplace apps.
  app_instance: 'web_hosting',
  app: 'web_hosting',
  // Servers and the infrastructure around them.
  server: 'servers',
  snapshot: 'servers',
  backup: 'servers',
  volume: 'servers',
  public_ip: 'servers',
  bandwidth: 'servers',
  load_balancer: 'servers',
  object_storage: 'servers',
  database: 'servers',
  managed_server: 'servers',
  kubernetes: 'servers',
  managed_plan: 'managed_cloud',
  managed_overage: 'managed_cloud',
  connect_execution: 'connect',
  connect_tool_call: 'connect',
  // AI model tokens are passed through near cost: no commission by default.
  connect_ai_input: 'ai_usage',
  connect_ai_output: 'ai_usage',
  connect_ai_cache_read: 'ai_usage',
  connect_ai_cache_write: 'ai_usage',
  connect_ai_cache_write_1h: 'ai_usage',
  support: 'support',
};
