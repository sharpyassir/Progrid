import { describe, expect, it } from 'vitest';
import { checkSyntax, evaluate, ExpressionError, parse } from './expression';
import { parsePath, references, render, renderString, renderText, resolvePath, SECRET_PLACEHOLDER, type TemplateContext } from './template';
import { implicitGraph, isCron, topoOrder, validateGraph } from './graph';
import { capPayload, clip, Redactor, STEP_FIELD_CAP } from './redact';
import { normalizeLimits, normalizeVariables, DEFAULT_LIMITS } from './spec';
import { runPrompt } from './prompt';

const ctx: TemplateContext = {
  trigger: { body: { email: 'a@b.co', items: [{ name: 'x' }, { name: 'y' }], n: '42' }, source: 'webhook' },
  steps: { qualify: { output: { score: 85, reason: 'fit', tags: ['vip', 'eu'], ok: true } }, empty: { output: {} } },
  vars: { LIMIT: '100', NAME: 'Acme' },
  secrets: { API_KEY: 'sk-live-123456' },
};

describe('expression evaluator', () => {
  it('compares numbers from references', () => {
    expect(evaluate('{{steps.qualify.output.score}} >= 80', ctx)).toBe(true);
    expect(evaluate('{{steps.qualify.output.score}} < 80', ctx)).toBe(false);
    expect(evaluate('steps.qualify.output.score == 85', ctx)).toBe(true);
  });

  it('coerces numeric strings against numbers, including variables', () => {
    expect(evaluate('{{trigger.body.n}} == 42', ctx)).toBe(true);
    expect(evaluate('{{steps.qualify.output.score}} > {{vars.LIMIT}}', ctx)).toBe(false);
    expect(evaluate('{{vars.LIMIT}} > 99.5', ctx)).toBe(true);
  });

  it('handles strings, booleans, null and !', () => {
    expect(evaluate('{{steps.qualify.output.reason}} == "fit"', ctx)).toBe(true);
    expect(evaluate("{{steps.qualify.output.reason}} != 'fit'", ctx)).toBe(false);
    expect(evaluate('{{steps.qualify.output.ok}} == true', ctx)).toBe(true);
    expect(evaluate('!{{steps.qualify.output.ok}}', ctx)).toBe(false);
    expect(evaluate('{{steps.qualify.output.missing}} == null', ctx)).toBe(true);
    expect(evaluate('!{{steps.empty.output}}', ctx)).toBe(true);
  });

  it('supports && || and parentheses with precedence', () => {
    expect(evaluate('{{steps.qualify.output.score}} > 90 || {{steps.qualify.output.ok}}', ctx)).toBe(true);
    expect(evaluate('{{steps.qualify.output.score}} > 90 || {{steps.qualify.output.ok}} && false', ctx)).toBe(false);
    expect(evaluate('({{steps.qualify.output.score}} > 90 || true) && true', ctx)).toBe(true);
    expect(evaluate('true and not false', ctx)).toBe(true);
  });

  it('supports contains on strings and arrays', () => {
    expect(evaluate('{{steps.qualify.output.tags}} contains "vip"', ctx)).toBe(true);
    expect(evaluate('{{trigger.body.email}} contains "B.CO"', ctx)).toBe(true);
    expect(evaluate('{{steps.qualify.output.tags}} contains "us"', ctx)).toBe(false);
  });

  it('reads array items and negative numbers', () => {
    expect(evaluate('{{trigger.body.items[1].name}} == "y"', ctx)).toBe(true);
    expect(evaluate('-5 < {{steps.qualify.output.score}}', ctx)).toBe(true);
  });

  it('never executes code and rejects junk', () => {
    expect(() => parse('process.exit(1)')).toThrow(ExpressionError);
    expect(() => parse('{{steps.x}} >= ')).toThrow(ExpressionError);
    expect(() => parse('a = 1')).toThrow(ExpressionError);
    expect(() => parse('"unterminated')).toThrow(ExpressionError);
    expect(() => parse('(true')).toThrow(ExpressionError);
    expect(checkSyntax('x'.repeat(3000))).toMatch(/longer than/);
    expect(checkSyntax('1 >= 2')).toBeNull();
    // A prototype walk resolves to nothing instead of reaching Object internals.
    expect(evaluate('{{trigger.constructor}} == null', ctx)).toBe(true);
    expect(evaluate('{{trigger.__proto__}} == null', ctx)).toBe(true);
  });

  it('compares secrets only as placeholders (conditions run in prompt mode)', () => {
    expect(evaluate('{{vars.API_KEY}} == "sk-live-123456"', ctx)).toBe(false);
  });

  it('limits nesting depth', () => {
    expect(() => parse('('.repeat(60) + '1' + ')'.repeat(60))).toThrow(/deeply/);
  });
});

describe('template renderer', () => {
  it('parses paths', () => {
    expect(parsePath('steps.a.output.items[0].name')).toEqual(['steps', 'a', 'output', 'items', 0, 'name']);
    expect(parsePath('a..b')).toBeNull();
    expect(parsePath('a.')).toBeNull();
    expect(parsePath('a b')).toBeNull();
  });

  it('keeps types for a whole reference and interpolates inside text', () => {
    expect(renderString('{{steps.qualify.output.score}}', ctx, 'prompt')).toBe(85);
    expect(renderString('Score: {{steps.qualify.output.score}}!', ctx, 'prompt')).toBe('Score: 85!');
    expect(renderString('{{steps.qualify.output.tags}}', ctx, 'prompt')).toEqual(['vip', 'eu']);
    expect(renderString('T: {{steps.qualify.output.tags}}', ctx, 'prompt')).toBe('T: ["vip","eu"]');
    expect(renderString('Missing: [{{steps.nope.output}}]', ctx, 'prompt')).toBe('Missing: []');
  });

  it('renders nested JSON templates', () => {
    expect(render({ to: '{{trigger.body.email}}', n: '{{steps.qualify.output.score}}', list: ['{{vars.NAME}}', 3] }, ctx, 'tool')).toEqual({ to: 'a@b.co', n: 85, list: ['Acme', 3] });
  });

  it('renders secret variables only in tool mode', () => {
    expect(renderText('key={{vars.API_KEY}}', ctx, 'tool')).toBe('key=sk-live-123456');
    expect(renderText('key={{vars.API_KEY}}', ctx, 'prompt')).toBe(`key=${SECRET_PLACEHOLDER('API_KEY')}`);
    expect(resolvePath(ctx, 'vars.UNKNOWN', 'tool')).toBeUndefined();
  });

  it('blocks prototype access and unknown roots', () => {
    expect(resolvePath(ctx, 'trigger.__proto__', 'tool')).toBeUndefined();
    expect(resolvePath(ctx, 'trigger.constructor.name', 'tool')).toBeUndefined();
    expect(resolvePath(ctx, 'process.env', 'tool')).toBeUndefined();
    expect(render({ __proto__: { polluted: 1 }, a: 1 } as unknown, ctx, 'tool')).toEqual({ a: 1 });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('lists references', () => {
    expect(references({ a: '{{ trigger.body }} and {{vars.X}}', b: ['{{steps.s.output}}'] })).toEqual(['trigger.body', 'vars.X', 'steps.s.output']);
  });

  it('reads the input root inside tool configs', () => {
    expect(renderString('{{input.city}}', { input: { city: 'Riyadh' } }, 'tool')).toBe('Riyadh');
  });
});

describe('graph validator', () => {
  const good = {
    nodes: [
      { id: 'trigger', type: 'trigger', data: { source: 'webhook' } },
      { id: 'qualify', type: 'agent', data: { prompt: 'Qualify {{trigger.body}}', toolIds: ['t1'] } },
      { id: 'check', type: 'condition', data: { expression: '{{steps.qualify.output.score}} >= 80' } },
      { id: 'crm', type: 'tool', data: { toolId: 't1', input: { a: '{{trigger.body.a}}' } } },
      { id: 'mail', type: 'action', data: { kind: 'notify', config: { channel: 'progrid_console' } } },
      { id: 'end', type: 'end', data: {} },
    ],
    edges: [
      { id: 'e1', source: 'trigger', target: 'qualify' },
      { id: 'e2', source: 'qualify', target: 'check' },
      { id: 'e3', source: 'check', target: 'crm', sourceHandle: 'true' },
      { id: 'e4', source: 'check', target: 'mail', sourceHandle: 'false' },
      { id: 'e5', source: 'crm', target: 'end' },
      { id: 'e6', source: 'mail', target: 'end' },
    ],
  };

  it('accepts a valid graph and orders it', () => {
    const { graph, issues } = validateGraph(good, { toolIds: new Set(['t1']) });
    expect(issues).toEqual([]);
    const order = topoOrder(graph)!;
    expect(order[0]).toBe('trigger');
    expect(order.indexOf('check')).toBeLessThan(order.indexOf('crm'));
    expect(order[order.length - 1]).toBe('end');
  });

  it('needs exactly one trigger', () => {
    const two = { ...good, nodes: [...good.nodes, { id: 'trigger2', type: 'trigger', data: {} }], edges: [...good.edges, { id: 'x', source: 'trigger2', target: 'end' }] };
    expect(validateGraph(two).issues.map((i) => i.message).join()).toMatch(/exactly one trigger/);
    expect(validateGraph({ nodes: [], edges: [] }).issues.length).toBeGreaterThan(0);
  });

  it('finds cycles', () => {
    const cyc = { nodes: [{ id: 'trigger', type: 'trigger' }, { id: 'a', type: 'transform', data: { template: 1 } }, { id: 'b', type: 'transform', data: { template: 1 } }], edges: [{ id: '1', source: 'trigger', target: 'a' }, { id: '2', source: 'a', target: 'b' }, { id: '3', source: 'b', target: 'a' }] };
    expect(validateGraph(cyc).issues.map((i) => i.message)).toContain('the workflow has a cycle');
  });

  it('rejects unknown types, bad ids, bad edges and unknown tools', () => {
    const bad = {
      nodes: [{ id: 'trigger', type: 'trigger' }, { id: '1bad', type: 'agent' }, { id: 'x', type: 'teleport' }, { id: 't', type: 'tool', data: { toolId: 'nope' } }],
      edges: [{ id: 'e', source: 'trigger', target: 'ghost' }, { id: 'e2', source: 'trigger', target: 't' }],
    };
    const msgs = validateGraph(bad, { toolIds: new Set(['t1']) }).issues.map((i) => i.message).join('\n');
    expect(msgs).toMatch(/id must start with a letter/);
    expect(msgs).toMatch(/unknown node type teleport/);
    expect(msgs).toMatch(/unknown target node ghost/);
    expect(msgs).toMatch(/unknown tool nope/);
  });

  it('requires true/false handles after a condition and a valid expression', () => {
    const g = { nodes: [{ id: 'trigger', type: 'trigger' }, { id: 'c', type: 'condition', data: { expression: 'a >= ' } }, { id: 'end', type: 'end' }], edges: [{ id: '1', source: 'trigger', target: 'c' }, { id: '2', source: 'c', target: 'end' }] };
    const msgs = validateGraph(g).issues.map((i) => i.message).join('\n');
    expect(msgs).toMatch(/sourceHandle "true" or "false"/);
    expect(msgs).toMatch(/expression:/);
  });

  it('flags unreachable nodes, edges into the trigger and out of an end', () => {
    const g = { nodes: [{ id: 'trigger', type: 'trigger' }, { id: 'end', type: 'end' }, { id: 'lost', type: 'end' }], edges: [{ id: '1', source: 'trigger', target: 'end' }, { id: '2', source: 'end', target: 'trigger' }] };
    const msgs = validateGraph(g).issues.map((i) => i.message).join('\n');
    expect(msgs).toMatch(/nothing can lead into the trigger/);
    expect(msgs).toMatch(/end node has no outgoing/);
  });

  it('checks schedule triggers have a valid cron', () => {
    expect(isCron('0 9 * * 1-5')).toBe(true);
    expect(isCron('*/15 * * * *')).toBe(true);
    expect(isCron('61 * * * *')).toBe(false);
    expect(isCron('* * *')).toBe(false);
    const g = { nodes: [{ id: 'trigger', type: 'trigger', data: { source: 'schedule', cron: 'often' } }], edges: [] };
    expect(validateGraph(g).issues.map((i) => i.message).join()).toMatch(/cron/);
  });

  it('builds the implicit single agent graph', () => {
    const { issues } = validateGraph(implicitGraph());
    expect(issues).toEqual([]);
  });
});

describe('redaction and retention', () => {
  it('removes secrets and their encodings from text and JSON', () => {
    const r = new Redactor();
    r.add('s3cr3t-token-value', 'ab'); // too short values are ignored
    expect(r.text('Bearer s3cr3t-token-value')).toBe('Bearer [REDACTED]');
    expect(r.value({ h: { auth: Buffer.from('s3cr3t-token-value').toString('base64') }, ab: 'ab' })).toEqual({ h: { auth: '[REDACTED]' }, ab: 'ab' });
  });

  it('caps step payloads at 64 KB per field', () => {
    const big = { data: 'x'.repeat(STEP_FIELD_CAP + 10) };
    const capped = capPayload(big) as { truncated: boolean; preview: string; originalBytes: number };
    expect(capped.truncated).toBe(true);
    expect(capped.preview.length).toBeLessThan(STEP_FIELD_CAP);
    expect(capped.originalBytes).toBeGreaterThan(STEP_FIELD_CAP);
    expect(capPayload({ small: 1 })).toEqual({ small: 1 });
    expect(clip('abcdef', 3)).toMatch(/^abc\n\[truncated: 3 more/);
  });
});

describe('specs and prompts', () => {
  it('clamps limits and cleans variables', () => {
    expect(normalizeLimits({ maxSteps: 10_000, timeoutSeconds: 1 })).toEqual({ ...DEFAULT_LIMITS, maxSteps: 200, timeoutSeconds: 5 });
    expect(normalizeVariables([{ key: 'OK_1', secret: true }, { key: 'bad' }, { key: 'OK_1' }])).toEqual([{ key: 'OK_1', description: '', required: false, secret: true }]);
  });

  it('wraps webhook payloads as untrusted input', () => {
    expect(runPrompt('webhook', { a: 1 })).toMatch(/<untrusted_input>[\s\S]*"a": 1[\s\S]*<\/untrusted_input>/);
    expect(runPrompt('api', 'hello')).toBe('hello');
    expect(runPrompt('test', { q: 1 }, 'Check this')).toMatch(/^Check this\n\nInput:/);
    expect(runPrompt('api', undefined)).toBe('Run your task now.');
  });
});
