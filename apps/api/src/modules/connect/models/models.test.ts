import { describe, expect, it } from 'vitest';
import { FakeProvider, sample } from './fake.provider';
import { AnthropicProvider, FALLBACK_BETA } from './anthropic.provider';
import { MODELS, providerCostMicroUsd } from './catalog';
import { echoable, type ModelProvider, type ModelRequest, type ModelResponse, type ModelTool, type ToolUse } from './provider';
import { initialState, runAgentLoop, type ToolOutcome } from '../runtime/agent-loop';
import { priceUsage, quantities } from '../usage.service';

const tool = (name: string, extra: Record<string, unknown> = {}): ModelTool => ({ name, description: `${name} tool`, input_schema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'], additionalProperties: false, ...extra } });

function loop(provider: ModelProvider, tools: ModelTool[], execute: (c: ToolUse) => Promise<ToolOutcome>, extra: Partial<ModelRequest> = {}) {
  const steps: ModelResponse[] = [];
  return {
    steps,
    run: (prompt: string) =>
      runAgentLoop(
        {
          provider,
          request: { model: 'claude-opus-5-5', effort: 'medium', system: { preamble: 'p', instructions: 'i' }, tools, maxTokens: 1000, ...extra },
          executeTool: execute,
          beforeModelCall: async () => undefined,
          onModelResponse: async (r) => void steps.push(r),
        },
        initialState(prompt),
      ),
  };
}

describe('fake provider agent loop', () => {
  it('calls the first tool once when asked, then answers', async () => {
    const calls: ToolUse[] = [];
    const l = loop(new FakeProvider(), [tool('weather'), tool('other')], async (c) => {
      calls.push(c);
      return { kind: 'result', content: '{"temp":31}', isError: false };
    });
    const res = await l.run('Please check the weather. ```json\n{"city":"Riyadh"}\n```');
    expect(res.status).toBe('done');
    expect(calls).toEqual([{ id: expect.any(String), name: 'weather', input: { city: 'Riyadh' } }]);
    expect(l.steps.map((s) => s.stopReason)).toEqual(['tool_use', 'end_turn']);
    if (res.status === 'done') expect(res.text).toMatch(/I used weather.*temp/);
    // The second request carries the assistant tool_use turn and ONE user message with the result.
    const msgs = res.state.messages;
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(msgs[2].content).toEqual([{ type: 'tool_result', tool_use_id: calls[0].id, content: '{"temp":31}' }]);
  });

  it('runs parallel tool calls concurrently and returns all results in one message, with is_error for failures', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const l = loop(new FakeProvider(), [tool('a'), tool('b'), tool('c')], async (c) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      if (c.name === 'b') throw new Error('boom');
      if (c.name === 'c') return { kind: 'result', content: 'bad input', isError: true };
      return { kind: 'result', content: 'ok', isError: false };
    });
    const res = await l.run('Use all tools in parallel for {"city":"Jeddah"}');
    expect(res.status).toBe('done');
    expect(maxInFlight).toBe(3);
    const results = res.state.messages[2].content;
    expect(results).toHaveLength(3);
    expect(results[0]).toMatchObject({ type: 'tool_result', content: 'ok' });
    expect(results[0].is_error).toBeUndefined();
    expect(results[1]).toMatchObject({ type: 'tool_result', is_error: true, content: expect.stringMatching(/boom/) });
    expect(results[2]).toMatchObject({ type: 'tool_result', is_error: true });
    if (res.status === 'done') expect(res.text).toMatch(/2 failed/);
  });

  it('answers without tools when the message does not ask for an action', async () => {
    const l = loop(new FakeProvider(), [tool('a')], async () => ({ kind: 'result', content: 'x', isError: false }));
    const res = await l.run('Hello there');
    expect(res.status).toBe('done');
    expect(l.steps).toHaveLength(1);
  });

  it('fails the run on a refusal and keeps the stop details', async () => {
    const res = await loop(new FakeProvider(), [], async () => ({ kind: 'result', content: '', isError: false })).run('fake:refuse please');
    expect(res).toMatchObject({ status: 'failed', code: 'model_refused', details: { category: 'test' } });
  });

  it('fails gracefully at max_tokens and keeps the partial text', async () => {
    const res = await loop(new FakeProvider(), [], async () => ({ kind: 'result', content: '', isError: false })).run('fake:max_tokens');
    expect(res).toMatchObject({ status: 'failed', code: 'max_tokens', text: 'This answer was cut off' });
  });

  it('pauses for approval and resumes with the decided result', async () => {
    const provider = new FakeProvider();
    const l = loop(provider, [tool('power'), tool('list')], async (c) => (c.name === 'power' ? { kind: 'approval', approvalId: 'appr_1', summary: 'power' } : { kind: 'result', content: 'listed', isError: false }));
    const first = await l.run('Use all tools now');
    expect(first.status).toBe('waiting');
    if (first.status !== 'waiting') return;
    expect(first.approvals).toEqual(['appr_1']);
    expect(first.state.results).toHaveLength(1);
    // Not decided yet: still waiting.
    const again = await runAgentLoop({ provider, request: { model: 'claude-opus-5-5', effort: 'low', system: { preamble: 'p', instructions: 'i' }, tools: [tool('power'), tool('list')], maxTokens: 1000 }, executeTool: async () => ({ kind: 'result', content: '', isError: false }), beforeModelCall: async () => undefined, onModelResponse: async () => undefined }, first.state);
    expect(again.status).toBe('waiting');
    first.state.pending![0].result = { content: 'powered off', isError: false };
    const resumed = await runAgentLoop({ provider, request: { model: 'claude-opus-5-5', effort: 'low', system: { preamble: 'p', instructions: 'i' }, tools: [tool('power'), tool('list')], maxTokens: 1000 }, executeTool: async () => ({ kind: 'result', content: '', isError: false }), beforeModelCall: async () => undefined, onModelResponse: async () => undefined }, first.state);
    expect(resumed.status).toBe('done');
    const toolMsg = resumed.state.messages[2];
    expect(toolMsg.content.map((b) => b.content)).toEqual(['powered off', 'listed']);
  });

  it('returns JSON matching an output schema', async () => {
    const schema = { type: 'object', properties: { score: { type: 'integer' }, reason: { type: 'string' } }, required: ['score', 'reason'], additionalProperties: false };
    const res = await loop(new FakeProvider(), [], async () => ({ kind: 'result', content: '', isError: false }), { outputSchema: schema }).run('Qualify this lead:\n```json\n{"score": 91, "reason": "fit"}\n```');
    expect(res).toMatchObject({ status: 'done', json: { score: 91, reason: 'fit' } });
  });

  it('fails with invalid_output when the answer does not match the schema', async () => {
    const bad: ModelProvider = { name: 'x', complete: async () => ({ content: [{ type: 'text', text: '{"score":"high"}' }], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, servedBy: 'm' }) };
    const res = await loop(bad, [], async () => ({ kind: 'result', content: '', isError: false }), { outputSchema: { type: 'object', properties: { score: { type: 'integer' } }, required: ['score'] } }).run('x');
    expect(res).toMatchObject({ status: 'failed', code: 'invalid_output' });
  });

  it('resends pause_turn content and continues, with a cap', async () => {
    let n = 0;
    const pausing: ModelProvider = { name: 'x', complete: async () => ({ content: [{ type: 'text', text: `part ${n}` }], stopReason: n++ < 2 ? 'pause_turn' : 'end_turn', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, servedBy: 'm' }) };
    const res = await loop(pausing, [], async () => ({ kind: 'result', content: '', isError: false })).run('x');
    expect(res.status).toBe('done');
    expect(res.state.messages.filter((m) => m.role === 'assistant')).toHaveLength(3);
  });

  it('builds tool inputs from schemas', () => {
    expect(sample({ type: 'object', properties: { a: { type: 'string' }, b: { type: 'integer' }, c: { enum: ['x', 'y'] }, d: { type: 'string' } }, required: ['a', 'b', 'c'] }, { a: 'given' }, 0)).toEqual({ a: 'given', b: 1, c: 'x' });
  });
});

describe('fallback echo', () => {
  it('keeps only text before the last fallback marker', () => {
    const content = [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'a' }, { type: 'tool_use', id: '1' }, { type: 'fallback', from: { model: 'x' }, to: { model: 'y' } }, { type: 'thinking', thinking: '' }, { type: 'tool_use', id: '2' }];
    expect(echoable(content).map((b) => b.type)).toEqual(['text', 'thinking', 'tool_use']);
    expect(echoable([{ type: 'text', text: 'x' }])).toEqual([{ type: 'text', text: 'x' }]);
  });
});

describe('Anthropic request shape', () => {
  const p = new AnthropicProvider('sk-test', { fallbacks: true, maxRetries: 0 });
  const base: ModelRequest = { model: 'claude-opus-5-5', effort: 'high', system: { preamble: 'PRE', instructions: 'INS' }, tools: [{ ...tool('zeta'), strict: true }, tool('alpha', { additionalProperties: undefined })], messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], maxTokens: 16_000 };

  it('sets effort, never thinking, auto tool choice, strict tools in name order and cache breakpoints', () => {
    const params = p.buildParams(base) as unknown as Record<string, unknown>;
    expect(params.model).toBe('claude-opus-5-5');
    expect(params.thinking).toBeUndefined();
    expect(params.output_config).toEqual({ effort: 'high' });
    expect(params.tool_choice).toEqual({ type: 'auto' });
    expect((params.tools as { name: string }[]).map((t) => t.name)).toEqual(['alpha', 'zeta']);
    expect((params.tools as { strict?: boolean }[]).map((t) => t.strict)).toEqual([undefined, true]);
    const system = params.system as { text: string; cache_control?: unknown }[];
    expect(system.map((s) => s.text)).toEqual(['PRE', 'INS']);
    expect(system[0].cache_control).toBeUndefined();
    expect(system[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(params.cache_control).toEqual({ type: 'ephemeral' });
    expect(params.max_tokens).toBe(16_000);
  });

  it('enables server side refusal fallbacks on Opus 5.5 only', () => {
    const opus = p.buildParams(base) as unknown as Record<string, unknown>;
    expect(opus.betas).toEqual([FALLBACK_BETA]);
    expect(opus.fallbacks).toBe('default');
    const sonnet = p.buildParams({ ...base, model: 'claude-sonnet-5-5' }) as unknown as Record<string, unknown>;
    expect(sonnet.betas).toBeUndefined();
    expect(sonnet.output_config).toEqual({ effort: 'high' });
    const off = new AnthropicProvider('sk-test', { fallbacks: false }).buildParams(base) as unknown as Record<string, unknown>;
    expect(off.betas).toBeUndefined();
  });

  it('sends neither effort nor thinking to Haiku 4.5, and adds structured output format', () => {
    const haiku = p.buildParams({ ...base, model: 'claude-haiku-4-5', tools: [], outputSchema: { type: 'object' } }) as unknown as Record<string, unknown>;
    expect(haiku.output_config).toEqual({ format: { type: 'json_schema', schema: { type: 'object' } } });
    expect(haiku.thinking).toBeUndefined();
    expect(haiku.tools).toBeUndefined();
    expect(haiku.tool_choice).toBeUndefined();
  });

  it('refuses unknown models', () => {
    expect(() => p.buildParams({ ...base, model: 'gpt-4' })).toThrow(/Unknown model/);
  });
});

describe('cost', () => {
  it('computes the provider cost basis from list prices', () => {
    // Opus 5.5: $4 in, $20 out, $0.20 cache read, $5 cache write per 1M tokens.
    expect(providerCostMicroUsd('claude-opus-5-5', { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 500_000, cacheWriteTokens: 10_000 })).toBe(4_000_000 + 2_000_000 + 100_000 + 50_000);
    expect(providerCostMicroUsd('claude-haiku-4-5', { inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(6000);
    expect(providerCostMicroUsd('fake', { inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(0);
    expect(MODELS.map((m) => m.id)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5']);
  });

  it('prices usage from per unit book prices and is 0 without prices', () => {
    const u = { executions: 2000, inputTokens: 3_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 1_000_000, toolCalls: 500 };
    expect(quantities(u)['connect-ai-input-tokens']).toBe(4_000_000);
    expect(priceUsage(u, {})).toBe(0);
    expect(priceUsage(u, { 'connect-executions': 100, 'connect-ai-input-tokens': 1500, 'connect-ai-output-tokens': 7500, 'connect-tool-calls': 20 })).toBe(2 * 100 + 4 * 1500 + 7500 + 0.5 * 20);
  });
});
