import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessageParam, MessageCreateParamsNonStreaming, BetaToolUnion, BetaOutputConfig } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { findModel } from './catalog';
import { ModelError, type Block, type ModelProvider, type ModelRequest, type ModelResponse } from './provider';

export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/**
 * Claude through the official SDK, non streaming, one call per agent loop step.
 *
 *  - thinking is never sent: Opus 5.5 and Sonnet 5.5 think adaptively and refuse a disabled or
 *    budgeted `thinking`. Depth is `output_config.effort`, always set from the agent's effort
 *    (Opus 5.5 would otherwise default to medium). Haiku 4.5 gets neither.
 *  - tool_choice is always auto (forced tool choice is a 400 on Opus 5.5 / Sonnet 5.5); tools
 *    whose schema allows it are sent with strict: true
 *  - prompt caching: the system prompt is [stable platform preamble, agent instructions] with
 *    a breakpoint on the last system block (tools render before it, sorted by name), plus
 *    top level automatic caching for the growing conversation
 *  - refusal fallbacks: on models that support it, `fallbacks: "default"` under the
 *    server-side-fallback-2026-07-01 beta (CONNECT_MODEL_FALLBACKS)
 *  - retries: the SDK retries 429 and 5xx with backoff (maxRetries); typed errors map to codes
 *  - no premium features: fast mode (`speed: "fast"`) and server tools (web search, web fetch,
 *    code execution, ...) cost more than the Connect token prices, so they are never sent.
 *    assertPricedParams checks every request before it leaves.
 */
export class AnthropicProvider implements ModelProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(apiKey: string, private readonly opts: { fallbacks: boolean; maxRetries?: number; baseURL?: string }) {
    this.client = new Anthropic({ apiKey, maxRetries: opts.maxRetries ?? 3, timeout: 10 * 60_000, ...(opts.baseURL ? { baseURL: opts.baseURL } : {}) });
  }

  buildParams(req: ModelRequest): MessageCreateParamsNonStreaming {
    const info = findModel(req.model);
    if (!info) throw new ModelError('model_unknown', `Unknown model ${req.model}`);
    const tools = [...req.tools]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as { type: 'object' }, ...(t.strict ? { strict: true } : {}) })) as BetaToolUnion[];
    const output_config: BetaOutputConfig = {};
    if (info.supportsEffort) output_config.effort = req.effort;
    if (req.outputSchema) output_config.format = { type: 'json_schema', schema: req.outputSchema };
    const params: MessageCreateParamsNonStreaming = {
      model: info.id,
      max_tokens: Math.min(req.maxTokens, info.maxOutputTokens),
      system: [
        { type: 'text', text: req.system.preamble },
        { type: 'text', text: req.system.instructions.trim() || 'No additional instructions.', cache_control: { type: 'ephemeral' } },
      ],
      messages: req.messages as unknown as BetaMessageParam[],
      cache_control: { type: 'ephemeral' },
      ...(tools.length ? { tools, tool_choice: { type: 'auto' as const } } : {}),
      ...(Object.keys(output_config).length ? { output_config } : {}),
    };
    if (info.supportsFallbacks && this.opts.fallbacks) {
      params.betas = [FALLBACK_BETA];
      params.fallbacks = 'default';
    }
    assertPricedParams(params);
    return params;
  }

  async complete(req: ModelRequest): Promise<ModelResponse> {
    const params = this.buildParams(req);
    try {
      const res = await this.client.beta.messages.create(params, { signal: req.signal });
      const content = res.content as unknown as Block[];
      return {
        content,
        stopReason: res.stop_reason ?? 'end_turn',
        stopDetails: res.stop_details ?? undefined,
        usage: {
          inputTokens: res.usage.input_tokens ?? 0,
          outputTokens: res.usage.output_tokens ?? 0,
          cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
          cacheWrite1hTokens: res.usage.cache_creation?.ephemeral_1h_input_tokens ?? 0,
        },
        servedBy: res.model,
        fallbacks: content.filter((b) => b.type === 'fallback').map((b) => ({ from: (b.from as { model?: string })?.model, to: (b.to as { model?: string })?.model })),
        requestId: (res as { _request_id?: string | null })._request_id ?? undefined,
      };
    } catch (err) {
      throw mapError(err);
    }
  }
}

/**
 * Connect prices cover standard speed tokens and the platform's own tools only. Fast mode
 * (`speed: "fast"`, on the request or on a fallback hop) and Anthropic server tools such as web
 * search are billed by Anthropic above those prices, so a request that carries any of them is
 * refused before it is sent.
 */
export function assertPricedParams(params: object) {
  const p = params as { speed?: unknown; fallbacks?: unknown; tools?: unknown; betas?: unknown };
  if (p.speed !== undefined && p.speed !== null && p.speed !== 'standard') throw new ModelError('model_bad_request', 'Fast mode is not available in Connect.');
  if (Array.isArray(p.fallbacks) && p.fallbacks.some((f) => f && typeof f === 'object' && (f as { speed?: unknown }).speed === 'fast')) throw new ModelError('model_bad_request', 'Fast mode is not available in Connect.');
  if (Array.isArray(p.betas) && p.betas.some((b) => typeof b === 'string' && b.startsWith('fast-mode'))) throw new ModelError('model_bad_request', 'Fast mode is not available in Connect.');
  if (Array.isArray(p.tools)) {
    for (const t of p.tools as { type?: unknown; name?: unknown; input_schema?: unknown }[]) {
      // Client tools have an input schema and no type (or "custom"). Anything else is a server tool.
      const server = (t.type !== undefined && t.type !== null && t.type !== 'custom') || !t.input_schema;
      if (server) throw new ModelError('model_bad_request', `Server tools such as web search are not available in Connect (${String(t.type ?? t.name)}).`);
    }
  }
}

/** Typed SDK errors to run error codes. Never matches on message text. */
export function mapError(err: unknown): ModelError {
  if (err instanceof ModelError) return err;
  if (err instanceof Anthropic.RateLimitError) return new ModelError('model_rate_limited', 'The model provider is rate limiting requests. Try again shortly.', 429);
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return new ModelError('model_auth_failed', 'The model provider rejected the platform credentials.', err.status);
  if (err instanceof Anthropic.BadRequestError) return new ModelError('model_bad_request', `The model provider rejected the request: ${err.message}`, 400);
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new ModelError('model_timeout', 'The model call timed out.');
  if (err instanceof Anthropic.APIConnectionError) return new ModelError('model_unavailable', 'The model provider could not be reached.');
  if (err instanceof Anthropic.InternalServerError) return new ModelError('model_unavailable', 'The model provider is unavailable. Try again shortly.', err.status);
  if (err instanceof Anthropic.APIUserAbortError) return new ModelError('cancelled', 'The run was cancelled.');
  if (err instanceof Anthropic.APIError) return new ModelError('model_error', `Model error ${err.status ?? ''}: ${err.message}`, err.status);
  return new ModelError('model_error', (err as Error)?.message ?? 'model call failed');
}
