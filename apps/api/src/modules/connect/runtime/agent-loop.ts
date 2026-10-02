import { echoable, textOf, toolUsesOf, type Block, type ChatMessage, type ModelProvider, type ModelRequest, type ModelResponse, type ToolUse } from '../models/provider';
import { schemaErrors } from '../tools/schema';

/**
 * The agent loop, written by hand so every model call and every tool call becomes its own
 * timed step. One iteration:
 *
 *   model call -> stop_reason
 *     refusal      fail the run (model_refused) with the stop details
 *     max_tokens   fail gracefully (max_tokens), keeping the partial text
 *     pause_turn   send the assistant turn back unchanged and call again
 *     tool_use     run every tool_use block concurrently and return ALL results in ONE user
 *                  message; a failed tool is a tool_result with is_error: true
 *     end_turn     done (with an output schema, the text must be JSON matching it)
 *
 * A tool that needs a person's approval pauses the loop: the conversation and the results that
 * are already in are saved in the state, and `resume` continues once every pending call has a
 * result. Assistant content is passed back exactly as the provider returned it.
 */

export type ToolOutcome =
  | { kind: 'result'; content: string; isError: boolean }
  | { kind: 'approval'; approvalId: string; summary: string };

export interface PendingCall {
  toolUseId: string;
  name: string;
  input: unknown;
  approvalId: string;
  /** Filled in when a person decides. */
  result?: { content: string; isError: boolean };
}

export interface AgentLoopState {
  messages: ChatMessage[];
  /** Results of the paused turn that are already in, in tool_use order. */
  results?: Block[];
  pending?: PendingCall[];
  /** tool_use ids of the paused turn, to keep the result order. */
  order?: string[];
  pauses?: number;
}

export interface LoopDeps {
  provider: ModelProvider;
  request: Omit<ModelRequest, 'messages'>;
  executeTool(call: ToolUse): Promise<ToolOutcome>;
  /** Called before each model call; throws to stop (limits, cancellation, timeout). */
  beforeModelCall(): Promise<void>;
  onModelResponse(res: ModelResponse, durationMs: number): Promise<void>;
}

export type LoopResult =
  | { status: 'done'; text: string; json?: unknown; state: AgentLoopState }
  | { status: 'waiting'; state: AgentLoopState; approvals: string[] }
  | { status: 'failed'; code: string; message: string; details?: unknown; text?: string; state: AgentLoopState };

const MAX_PAUSES = 5;

export function initialState(prompt: string): AgentLoopState {
  return { messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }] };
}

function resultBlock(id: string, r: { content: string; isError: boolean }): Block {
  return { type: 'tool_result', tool_use_id: id, content: r.content, ...(r.isError ? { is_error: true } : {}) };
}

export async function runAgentLoop(deps: LoopDeps, start: AgentLoopState): Promise<LoopResult> {
  const state: AgentLoopState = { ...start, messages: [...start.messages] };

  // Resume a paused turn: every pending call must have its result by now.
  if (state.pending?.length) {
    if (state.pending.some((p) => !p.result)) return { status: 'waiting', state, approvals: state.pending.filter((p) => !p.result).map((p) => p.approvalId) };
    const byId = new Map<string, Block>();
    for (const b of state.results ?? []) byId.set(String(b.tool_use_id), b);
    for (const p of state.pending) byId.set(p.toolUseId, resultBlock(p.toolUseId, p.result!));
    const ordered = (state.order ?? [...byId.keys()]).map((id) => byId.get(id)).filter((b): b is Block => !!b);
    state.messages.push({ role: 'user', content: ordered });
    state.pending = undefined;
    state.results = undefined;
    state.order = undefined;
  }

  for (;;) {
    await deps.beforeModelCall();
    const t0 = Date.now();
    const res = await deps.provider.complete({ ...deps.request, messages: state.messages });
    await deps.onModelResponse(res, Date.now() - t0);

    if (res.stopReason === 'refusal') {
      return { status: 'failed', code: 'model_refused', message: 'The model declined this request.', details: res.stopDetails ?? null, state };
    }
    const content = echoable(res.content);
    if (res.stopReason === 'max_tokens') {
      return { status: 'failed', code: 'max_tokens', message: 'The model reached its output limit before finishing. Shorten the task or raise the limits.', text: textOf(content), state };
    }
    if (res.stopReason === 'model_context_window_exceeded') {
      return { status: 'failed', code: 'context_window_exceeded', message: 'The conversation no longer fits the model context window.', state };
    }
    state.messages.push({ role: 'assistant', content });

    if (res.stopReason === 'pause_turn') {
      state.pauses = (state.pauses ?? 0) + 1;
      if (state.pauses > MAX_PAUSES) return { status: 'failed', code: 'too_many_pauses', message: 'The model paused too many times.', state };
      continue;
    }

    const uses = toolUsesOf(content);
    if (res.stopReason === 'tool_use' && uses.length) {
      const outcomes = await Promise.all(
        uses.map((u) =>
          deps.executeTool(u).catch((err): ToolOutcome => ({ kind: 'result', content: `Tool failed: ${(err as Error).message}`, isError: true })),
        ),
      );
      const results: Block[] = [];
      const pending: PendingCall[] = [];
      uses.forEach((u, i) => {
        const o = outcomes[i];
        if (o.kind === 'approval') pending.push({ toolUseId: u.id, name: u.name, input: u.input, approvalId: o.approvalId });
        else results.push(resultBlock(u.id, o));
      });
      if (pending.length) {
        state.results = results;
        state.pending = pending;
        state.order = uses.map((u) => u.id);
        return { status: 'waiting', state, approvals: pending.map((p) => p.approvalId) };
      }
      state.messages.push({ role: 'user', content: results });
      continue;
    }

    const text = textOf(content);
    if (deps.request.outputSchema) {
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return { status: 'failed', code: 'invalid_output', message: 'The model answer is not valid JSON for the output schema.', text, state };
      }
      const problems = schemaErrors(deps.request.outputSchema, json);
      if (problems) return { status: 'failed', code: 'invalid_output', message: `The model answer does not match the output schema: ${problems}`, text, state };
      return { status: 'done', text, json, state };
    }
    return { status: 'done', text, state };
  }
}
