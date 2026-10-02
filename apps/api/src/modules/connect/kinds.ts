/** Enumerations shared by DTOs, blueprints and the builder (kept free of decorators). */
export const EFFORT_VALUES = ['low', 'medium', 'high'] as const;
export const TOOL_KINDS = ['http_request', 'database_query', 'send_email', 'notify', 'webhook_out', 'progrid'] as const;
export const CONNECTION_KINDS = ['rest_api', 'postgres', 'mysql', 'mongodb', 'smtp', 'webhook_out', 'custom'] as const;
export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'waiting_approval', 'cancelled'] as const;
export const RUN_SOURCES = ['api', 'webhook', 'test', 'schedule', 'manual'] as const;
