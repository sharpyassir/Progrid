import type { ConnectConnectionKind } from '@prisma/client';
import type { Actor } from '../../../common/auth/actor';
import type { NetPolicy } from '../net/guard';
import type { Redactor } from '../runtime/redact';

/**
 * A tool kind is one ToolExecutor plus one config schema. Executors receive validated input
 * (checked against the tool's inputSchema before they run) and an opened connection; they are
 * the only code that ever sees decrypted credentials.
 */

export interface OpenConnection {
  id: string;
  name: string;
  kind: ConnectConnectionKind;
  config: Record<string, unknown>;
  /** Decrypted secret fields. Never logged, never returned, never sent to the model. */
  secrets: Record<string, string>;
  access: ConnectionAccess;
}

export interface ConnectionAccess {
  readOnly?: boolean;
  allowedTables?: string[];
  allowedCollections?: string[];
  allowedHosts?: string[];
}

export interface ToolContext {
  teamId: string;
  projectId: string;
  agentId: string;
  agentName: string;
  runId: string;
  /** Acts as the agent's creator inside the team, limited to the agent's project. */
  actor: Actor;
  connection: OpenConnection | null;
  vars: Record<string, string>;
  secrets: Record<string, string>;
  redactor: Redactor;
  policy: NetPolicy;
  /** Counts outbound API calls for the run's usage. */
  countApiCall(): void;
  signal?: AbortSignal;
  /** True when a person approved this exact call (destructive Progrid actions run only then). */
  approved?: boolean;
}

export interface ToolExecutor {
  kind: string;
  /** JSON Schema for the tool's config (validated on create and update). */
  configSchema: Record<string, unknown>;
  /** Connection kinds this tool accepts; empty means it takes none. */
  connectionKinds: ConnectConnectionKind[];
  connectionRequired: boolean;
  /** Input schema offered to the model when the tool has none of its own. */
  defaultInputSchema(config: Record<string, unknown>): Record<string, unknown>;
  /** True when this call changes something a person must approve first (beyond tool.requiresApproval). */
  needsApproval?(config: Record<string, unknown>, input: unknown): boolean;
  /** One line for the approval request. */
  summarize?(config: Record<string, unknown>, input: unknown): string;
  execute(input: unknown, config: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
}

/** A tool failure the model should see (tool_result with is_error). */
export class ToolError extends Error {
  constructor(message: string, readonly code = 'tool_error') {
    super(message);
  }
}
