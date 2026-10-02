import type { Block, ChatMessage, ModelProvider, ModelRequest, ModelResponse, ModelTool } from './provider';

/**
 * Deterministic stand in for a real model, used by tests, CI and local development without an
 * API key. Same input, same output:
 *
 *  - when the user message asks for an action (use, call, check, list, get, fetch, send,
 *    search, query, run, lookup, tool) and no tool has run yet, it calls the FIRST tool it was
 *    given, once, with an input built from the tool's schema (values from a JSON block in the
 *    message when the keys match). "parallel" or "all tools" calls every tool in one turn.
 *  - after tool results arrive, it answers with a short summary naming the tools and errors
 *  - with an output schema, the answer is JSON built from the schema
 *  - "fake:refuse" in the message returns stop_reason refusal; "fake:max_tokens" returns
 *    max_tokens, so the failure paths can be tested
 *  - token usage is derived from character counts (about 4 characters per token): the system
 *    prompt is a cache write on the first call and a cache read after it
 *  - "fake:usage=IN,OUT,CACHE_READ,CACHE_WRITE" in the message makes every call report exactly
 *    those token counts, so billing can be tested with known numbers
 *  - "fake:fallback" makes every call a refusal fallback: a declined attempt on the requested
 *    model and the answer from claude-opus-5, each with the usage above (two attempts)
 */
export class FakeProvider implements ModelProvider {
  readonly name = 'fake';
  calls = 0;

  async complete(req: ModelRequest): Promise<ModelResponse> {
    this.calls++;
    const prompt = firstUserText(req.messages);
    const results = toolResults(req.messages);
    const systemChars = req.system.preamble.length + req.system.instructions.length + JSON.stringify(req.tools).length;
    const convoChars = JSON.stringify(req.messages).length;
    const first = req.messages.length === 1;
    const fixed = /fake:usage=(\d+),(\d+),(\d+),(\d+)/i.exec(prompt);
    const usageFor = (outText: string) =>
      fixed
        ? { inputTokens: Number(fixed[1]), outputTokens: Number(fixed[2]), cacheReadTokens: Number(fixed[3]), cacheWriteTokens: Number(fixed[4]) }
        : {
            inputTokens: Math.ceil(convoChars / 4),
            outputTokens: Math.ceil(outText.length / 4) + 8,
            cacheReadTokens: first ? 0 : Math.ceil(systemChars / 4),
            cacheWriteTokens: first ? Math.ceil(systemChars / 4) : 0,
          };

    if (/fake:fallback/i.test(prompt)) {
      const inner = await this.complete({ ...req, messages: req.messages.map((m, i) => (i === 0 ? { ...m, content: m.content.map((b) => (b.type === 'text' ? { ...b, text: String(b.text).replace(/fake:fallback/gi, '') } : b)) } : m)) });
      this.calls--;
      const each = inner.usage;
      const usage = { inputTokens: each.inputTokens * 2, outputTokens: each.outputTokens * 2, cacheReadTokens: each.cacheReadTokens * 2, cacheWriteTokens: each.cacheWriteTokens * 2 };
      return { ...inner, content: [{ type: 'fallback', from: { model: req.model }, to: { model: 'claude-opus-5' } }, ...inner.content], usage, servedBy: 'claude-opus-5', fallbacks: [{ from: req.model, to: 'claude-opus-5' }], attempts: [{ model: req.model, usage: each }, { model: 'claude-opus-5', usage: each }] };
    }
    if (/fake:refuse/i.test(prompt)) {
      return { content: [], stopReason: 'refusal', stopDetails: { type: 'refusal', category: 'test', explanation: 'The fake model refuses when asked to (fake:refuse).' }, usage: usageFor(''), servedBy: req.model };
    }
    if (/fake:max_tokens/i.test(prompt)) {
      const text = 'This answer was cut off';
      return { content: [{ type: 'text', text }], stopReason: 'max_tokens', usage: usageFor(text), servedBy: req.model };
    }

    if (req.tools.length && !results.length && asksForAction(prompt)) {
      const chosen = /\bparallel\b|\ball tools\b/i.test(prompt) ? req.tools : [req.tools[0]];
      const seed = jsonIn(prompt);
      const content: Block[] = [{ type: 'text', text: `I will use ${chosen.map((t) => t.name).join(' and ')}.` }];
      chosen.forEach((t, i) => content.push({ type: 'tool_use', id: `toolu_fake_${this.calls}_${i}`, name: t.name, input: inputFor(t, seed) }));
      return { content, stopReason: 'tool_use', usage: usageFor(JSON.stringify(content)), servedBy: req.model };
    }

    let text: string;
    if (req.outputSchema) {
      text = JSON.stringify(sample(req.outputSchema, jsonIn(prompt) ?? {}, 0));
    } else if (results.length) {
      const names = results.map((r) => r.name ?? 'a tool');
      const errors = results.filter((r) => r.isError).length;
      const preview = results.map((r) => r.content).join(' | ').slice(0, 400);
      text = `Done. I used ${[...new Set(names)].join(', ')}${errors ? ` (${errors} failed)` : ''}. Result: ${preview}`;
    } else {
      text = `Fake model answer: ${prompt.replace(/\s+/g, ' ').trim().slice(0, 200)}`;
    }
    return { content: [{ type: 'text', text }], stopReason: 'end_turn', usage: usageFor(text), servedBy: req.model };
  }
}

function firstUserText(messages: ChatMessage[]): string {
  const m = messages.find((x) => x.role === 'user');
  return (m?.content ?? []).filter((b) => b.type === 'text').map((b) => String(b.text)).join('\n');
}

function toolResults(messages: ChatMessage[]): { name?: string; content: string; isError: boolean }[] {
  const names = new Map<string, string>();
  for (const m of messages) for (const b of m.content) if (b.type === 'tool_use') names.set(String(b.id), String(b.name));
  const out: { name?: string; content: string; isError: boolean }[] = [];
  for (const m of messages) {
    for (const b of m.content) {
      if (b.type !== 'tool_result') continue;
      const c = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
      out.push({ name: names.get(String(b.tool_use_id)), content: c, isError: !!b.is_error });
    }
  }
  return out;
}

function asksForAction(prompt: string) {
  return /\b(use|call|run|check|look ?up|fetch|get|list|query|search|send|tool|tools|notify|create|power|status)\b/i.test(prompt);
}

/** The first JSON object found in the text (a fenced block or the whole text). */
function jsonIn(text: string): Record<string, unknown> | undefined {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  for (const candidate of [fenced?.[1], text]) {
    if (!candidate) continue;
    try {
      const v = JSON.parse(candidate.trim());
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      /* not JSON */
    }
  }
  return undefined;
}

function inputFor(tool: ModelTool, seed?: Record<string, unknown>) {
  return sample(tool.input_schema, seed ?? {}, 0);
}

/** A value that satisfies a (simple) JSON schema, preferring values from `seed` for matching keys. */
export function sample(schema: unknown, seed: unknown, depth: number): unknown {
  const s = (schema ?? {}) as Record<string, unknown>;
  if (depth > 6) return null;
  if (s.const !== undefined) return s.const;
  if (Array.isArray(s.enum) && s.enum.length) return seed !== undefined && s.enum.includes(seed) ? seed : s.enum[0];
  if (s.default !== undefined && seed === undefined) return s.default;
  if (Array.isArray(s.anyOf) && s.anyOf.length) return sample(s.anyOf[0], seed, depth + 1);
  const type = Array.isArray(s.type) ? s.type.find((t) => t !== 'null') : s.type;
  switch (type) {
    case 'object':
    case undefined: {
      if (type === undefined && !s.properties) return seed ?? {};
      const props = (s.properties ?? {}) as Record<string, unknown>;
      const required = Array.isArray(s.required) ? (s.required as string[]) : Object.keys(props);
      const src = seed && typeof seed === 'object' && !Array.isArray(seed) ? (seed as Record<string, unknown>) : {};
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(props)) {
        if (!required.includes(k) && !(k in src)) continue;
        out[k] = sample(props[k], src[k], depth + 1);
      }
      return out;
    }
    case 'array':
      return Array.isArray(seed) ? seed.map((x) => sample(s.items, x, depth + 1)) : [];
    case 'string':
      return typeof seed === 'string' ? seed : typeof seed === 'number' ? String(seed) : s.format === 'email' ? 'someone@example.com' : 'test';
    case 'integer':
      return typeof seed === 'number' ? Math.round(seed) : typeof s.minimum === 'number' ? s.minimum : 1;
    case 'number':
      return typeof seed === 'number' ? seed : typeof s.minimum === 'number' ? s.minimum : 1;
    case 'boolean':
      return typeof seed === 'boolean' ? seed : false;
    case 'null':
      return null;
    default:
      return null;
  }
}
