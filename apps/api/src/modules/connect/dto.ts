import { Allow, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Matches, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationQuery } from '../../common/pagination';

export const EFFORT_VALUES = ['low', 'medium', 'high'] as const;
export const TOOL_KINDS = ['http_request', 'database_query', 'send_email', 'notify', 'webhook_out', 'progrid'] as const;
export const CONNECTION_KINDS = ['rest_api', 'postgres', 'mysql', 'mongodb', 'smtp', 'webhook_out', 'custom'] as const;
export const RUN_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'waiting_approval', 'cancelled'] as const;
export const RUN_SOURCES = ['api', 'webhook', 'test', 'schedule', 'manual'] as const;
const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;

export class CreateAgentDto {
  @IsString() @Length(1, 80) name: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() @MaxLength(50_000) instructions?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsIn(EFFORT_VALUES) effort?: (typeof EFFORT_VALUES)[number];
  @IsOptional() @IsString() templateSlug?: string;
  /** Project id or slug the agent's usage is billed to; the default project when omitted. */
  @IsOptional() @IsString() project?: string;
}

export class UpdateAgentDto {
  @IsOptional() @IsString() @Length(1, 80) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() @MaxLength(50_000) instructions?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsIn(EFFORT_VALUES) effort?: (typeof EFFORT_VALUES)[number];
  @IsOptional() @IsArray() variables?: unknown[];
  @IsOptional() @IsObject() limits?: Record<string, unknown>;
}

export class SetVariableDto {
  @IsString() @MaxLength(10_000) value: string;
}

export class CreateVersionDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class DeployDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) version?: number;
}

export class TestRunDto {
  @Allow() input?: unknown;
  @IsOptional() @IsString() @MaxLength(20_000) message?: string;
  /** Run the current draft (default) instead of the deployed version. */
  @IsOptional() @IsBoolean() useDraft?: boolean;
}

export class ListRunsQuery extends PaginationQuery {
  @IsOptional() @IsIn(RUN_STATUSES) status?: (typeof RUN_STATUSES)[number];
  @IsOptional() @IsIn(RUN_SOURCES) source?: (typeof RUN_SOURCES)[number];
}

export class LogsQuery extends PaginationQuery {
  @IsOptional() @IsString() agentId?: string;
  @IsOptional() @IsIn(RUN_STATUSES) status?: (typeof RUN_STATUSES)[number];
  @IsOptional() @IsIn(RUN_SOURCES) source?: (typeof RUN_SOURCES)[number];
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
}

export class CreateToolDto {
  @Matches(TOOL_NAME, { message: 'name must be snake_case: lowercase letters, digits and _, starting with a letter (max 64)' }) name: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsIn(TOOL_KINDS) kind: (typeof TOOL_KINDS)[number];
  @IsOptional() @IsString() connectionId?: string | null;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() requiresApproval?: boolean;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
  @IsOptional() @IsObject() inputSchema?: Record<string, unknown>;
}

export class UpdateToolDto {
  @IsOptional() @Matches(TOOL_NAME, { message: 'name must be snake_case: lowercase letters, digits and _, starting with a letter (max 64)' }) name?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @Allow() connectionId?: string | null;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() requiresApproval?: boolean;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
  @IsOptional() @IsObject() inputSchema?: Record<string, unknown>;
}

export class TestToolDto {
  @Allow() input?: unknown;
}

export class PutWorkflowDto {
  @IsObject() graph: Record<string, unknown>;
}

export class CreateWebhookDto {
  @IsString() @Length(1, 80) name: string;
  @IsOptional() @Matches(/^[a-z0-9][a-z0-9-]{0,62}$/, { message: 'path must be lowercase letters, digits and dashes' }) path?: string;
  /** Require an X-Prgd-Signature HMAC on every call. The signing secret is returned once. */
  @IsOptional() @IsBoolean() signing?: boolean;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class UpdateWebhookDto {
  @IsOptional() @IsString() @Length(1, 80) name?: string;
  @IsOptional() @Matches(/^[a-z0-9][a-z0-9-]{0,62}$/, { message: 'path must be lowercase letters, digits and dashes' }) path?: string;
  @IsOptional() @IsBoolean() signing?: boolean;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class CreateKeyDto {
  @IsString() @Length(1, 80) name: string;
}

export class CreateConnectionDto {
  @IsString() @Length(1, 80) name: string;
  @IsIn(CONNECTION_KINDS) kind: (typeof CONNECTION_KINDS)[number];
  @IsOptional() @IsObject() config?: Record<string, unknown>;
  /** Write only. Never returned; responses carry secretFields and secretHints. */
  @IsOptional() @IsObject() secrets?: Record<string, unknown>;
  @IsOptional() @IsObject() access?: Record<string, unknown>;
}

export class UpdateConnectionDto {
  @IsOptional() @IsString() @Length(1, 80) name?: string;
  @IsOptional() @IsObject() config?: Record<string, unknown>;
  /** Fields given replace the stored ones; a null value removes that secret. */
  @IsOptional() @IsObject() secrets?: Record<string, unknown>;
  @IsOptional() @IsObject() access?: Record<string, unknown>;
}

export class GenerateDto {
  @IsString() @Length(10, 4000) prompt: string;
}

export class FromDraftDto {
  @IsObject() draft: Record<string, unknown>;
  /** Maps the draft's connectionsNeeded refs to existing connection ids. */
  @IsOptional() @IsObject() connections?: Record<string, string>;
}

export class PublicRunDto {
  @Allow() input?: unknown;
  @IsOptional() @IsBoolean() async?: boolean;
  @IsOptional() @IsString() @Length(1, 200) idempotencyKey?: string;
}

export class UsageQuery {
  @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'period must look like 2026-10' }) period?: string;
}
