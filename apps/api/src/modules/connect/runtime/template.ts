/**
 * Template references for workflows and tool configs:
 *
 *   {{trigger.body.email}}             the run's trigger payload
 *   {{steps.qualify.output.score}}     the output of an earlier node
 *   {{vars.API_BASE}}                  an agent variable
 *
 * Paths are dotted, with [n] for array items. Only own properties are read, so a template
 * can never reach __proto__ or constructor. There is no code execution of any kind.
 *
 * Secret variables are rendered only in `tool` mode (requests sent to an API, a database or a
 * mail server). In `prompt` mode, which feeds the model, they render as a placeholder, so a
 * secret never reaches the model.
 */

export interface TemplateContext {
  trigger?: unknown;
  /** The tool call's input, inside tool configs ({{input.city}}). */
  input?: unknown;
  steps?: Record<string, { output?: unknown } | undefined>;
  /** Plain variables. */
  vars?: Record<string, string>;
  /** Secret variables; only rendered in tool mode. */
  secrets?: Record<string, string>;
}

export type RenderMode = 'prompt' | 'tool';

const REF = /\{\{\s*([^{}]+?)\s*\}\}/g;
const WHOLE = /^\{\{\s*([^{}]+?)\s*\}\}$/;
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_DEPTH = 32;

export const SECRET_PLACEHOLDER = (key: string) => `[secret ${key}]`;

/** Splits "a.b[0].c" into ["a", "b", 0, "c"]. Returns null for a malformed path. */
export function parsePath(path: string): (string | number)[] | null {
  const out: (string | number)[] = [];
  const re = /([A-Za-z_$][\w$-]*)|\[(\d+)\]|\["([^"\]]*)"\]|\.|\s+/y;
  let i = 0;
  let expectSegment = true;
  while (i < path.length) {
    re.lastIndex = i;
    const m = re.exec(path);
    if (!m || m[0].length === 0) return null;
    i = re.lastIndex;
    if (m[1] !== undefined) {
      if (!expectSegment) return null;
      out.push(m[1]);
      expectSegment = false;
    } else if (m[2] !== undefined) {
      out.push(Number(m[2]));
      expectSegment = false;
    } else if (m[3] !== undefined) {
      out.push(m[3]);
      expectSegment = false;
    } else if (m[0] === '.') {
      if (expectSegment) return null;
      expectSegment = true;
    } else if (/^\s+$/.test(m[0])) {
      return null;
    }
  }
  return out.length && !expectSegment ? out : null;
}

/** Reads a path from the context. Undefined when any part is missing. */
export function resolvePath(ctx: TemplateContext, path: string, mode: RenderMode): unknown {
  const parts = parsePath(path.trim());
  if (!parts) return undefined;
  const [root, ...rest] = parts;
  if (root === 'vars') {
    const key = rest[0];
    if (typeof key !== 'string' || rest.length !== 1) return undefined;
    if (ctx.vars && Object.prototype.hasOwnProperty.call(ctx.vars, key)) return ctx.vars[key];
    if (ctx.secrets && Object.prototype.hasOwnProperty.call(ctx.secrets, key)) return mode === 'tool' ? ctx.secrets[key] : SECRET_PLACEHOLDER(key);
    return undefined;
  }
  let cur: unknown;
  if (root === 'trigger') cur = ctx.trigger;
  else if (root === 'steps') cur = ctx.steps;
  else if (root === 'input') cur = ctx.input;
  else return undefined;
  for (const p of rest) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof p === 'string' && FORBIDDEN.has(p)) return undefined;
    if (typeof cur !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(cur, p)) return undefined;
    cur = (cur as Record<string | number, unknown>)[p];
  }
  return cur;
}

function stringify(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

/** Renders one string. A string that is exactly one reference keeps the value's type. */
export function renderString(tpl: string, ctx: TemplateContext, mode: RenderMode): unknown {
  const whole = WHOLE.exec(tpl);
  if (whole) return resolvePath(ctx, whole[1], mode);
  return tpl.replace(REF, (_, path: string) => stringify(resolvePath(ctx, path, mode)));
}

/** Renders strings inside any JSON value (objects, arrays), keeping the structure. */
export function render(value: unknown, ctx: TemplateContext, mode: RenderMode, depth = 0): unknown {
  if (depth > MAX_DEPTH) throw new Error('template is nested too deeply');
  if (typeof value === 'string') return renderString(value, ctx, mode);
  if (Array.isArray(value)) return value.map((v) => render(v, ctx, mode, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN.has(k)) continue;
      out[k] = render(v, ctx, mode, depth + 1);
    }
    return out;
  }
  return value;
}

/** Renders to text (prompts, email bodies). */
export function renderText(tpl: string, ctx: TemplateContext, mode: RenderMode): string {
  return stringify(renderString(tpl, ctx, mode));
}

/** Every reference in a template value, e.g. ["trigger.body", "vars.KEY"]. */
export function references(value: unknown, acc: string[] = []): string[] {
  if (typeof value === 'string') {
    for (const m of value.matchAll(REF)) acc.push(m[1].trim());
  } else if (Array.isArray(value)) {
    for (const v of value) references(v, acc);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) references(v, acc);
  }
  return acc;
}
