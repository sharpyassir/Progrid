import type { Effort } from './catalog';

/**
 * The model layer every Connect run goes through. Messages use the Messages API block shapes
 * (text, tool_use, tool_result, thinking, ...) as the platform's canonical format; another
 * provider translates to and from them inside its own implementation. Assistant content is
 * opaque to the runtime and is passed back to the provider unchanged.
 */

export type Block = { type: string } & Record<string, unknown>;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: Block[];
}

export interface ModelTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  /** Strict tool use: the schema has additionalProperties false and required on every object. */
  strict?: boolean;
}

export interface ModelRequest {
  model: string;
  effort: Effort;
  /** Stable platform preamble, then the agent's instructions. Nothing per run goes here (prompt caching). */
  system: { preamble: string; instructions: string };
  /** Sent in a deterministic order (by name). */
  tools: ModelTool[];
  messages: ChatMessage[];
  maxTokens: number;
  /** Structured output: the final answer is JSON matching this schema. */
  outputSchema?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ModelResponse {
  content: Block[];
  /** end_turn, tool_use, max_tokens, pause_turn, refusal, stop_sequence, ... */
  stopReason: string;
  stopDetails?: unknown;
  usage: ModelUsage;
  /** The model that produced the answer (differs from the request after a server side fallback). */
  servedBy: string;
  fallbacks?: { from?: string; to?: string }[];
  requestId?: string;
}

export interface ModelProvider {
  readonly name: string;
  complete(req: ModelRequest): Promise<ModelResponse>;
}

/** A model call that failed. `code` lands on the run's error. */
export class ModelError extends Error {
  constructor(readonly code: string, message: string, readonly status?: number) {
    super(message);
  }
}

/** Text of the text blocks, joined. */
export function textOf(content: Block[]): string {
  return content.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text as string).join('');
}

export interface ToolUse {
  id: string;
  name: string;
  input: unknown;
}

export function toolUsesOf(content: Block[]): ToolUse[] {
  return content.filter((b) => b.type === 'tool_use').map((b) => ({ id: String(b.id), name: String(b.name), input: b.input }));
}

/**
 * The assistant content to send back on the next request. After a server side fallback, the
 * blocks before the last `fallback` marker are kept only when they are text (thinking and
 * tool_use from the declined attempt are omitted), as the fallback docs require.
 */
export function echoable(content: Block[]): Block[] {
  const last = content.map((b) => b.type).lastIndexOf('fallback');
  if (last < 0) return content;
  return [...content.slice(0, last).filter((b) => b.type === 'text'), ...content.slice(last + 1)];
}
