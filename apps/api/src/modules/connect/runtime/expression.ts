import { resolvePath, type TemplateContext } from './template';

/**
 * Safe evaluator for workflow conditions. No eval, no Function, no property calls: a small
 * recursive descent parser over this grammar
 *
 *   expr    := or
 *   or      := and ( "||" and )*
 *   and     := unary ( "&&" unary )*
 *   unary   := "!" unary | compare
 *   compare := primary ( ( "==" | "!=" | "===" | "!==" | ">" | ">=" | "<" | "<=" | "contains" ) primary )?
 *   primary := number | string | true | false | null | "(" expr ")" | {{ path }} | path
 *
 * Paths are template references (trigger.*, steps.<node>.output.*, vars.KEY). Conditions run in
 * prompt mode, so secret variables only compare as their placeholder.
 */

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'kw'; v: 'true' | 'false' | 'null' }
  | { t: 'ref'; v: string }
  | { t: 'op'; v: string }
  | { t: 'lp' }
  | { t: 'rp' };

type Node =
  | { k: 'lit'; v: unknown }
  | { k: 'ref'; path: string }
  | { k: 'not'; e: Node }
  | { k: 'and' | 'or'; l: Node; r: Node }
  | { k: 'cmp'; op: string; l: Node; r: Node };

export class ExpressionError extends Error {}

const MAX_LENGTH = 2000;
const MAX_DEPTH = 40;
const OPS = ['===', '!==', '==', '!=', '>=', '<=', '&&', '||', '>', '<', '!'];

export function tokenize(src: string): Tok[] {
  if (src.length > MAX_LENGTH) throw new ExpressionError(`expression is longer than ${MAX_LENGTH} characters`);
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (src.startsWith('{{', i)) {
      const end = src.indexOf('}}', i + 2);
      if (end < 0) throw new ExpressionError('unclosed {{');
      out.push({ t: 'ref', v: src.slice(i + 2, end).trim() });
      i = end + 2;
      continue;
    }
    if (c === '(') { out.push({ t: 'lp' }); i++; continue; }
    if (c === ')') { out.push({ t: 'rp' }); i++; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) { s += src[j + 1]; j += 2; continue; }
        s += src[j++];
      }
      if (j >= src.length) throw new ExpressionError('unclosed string');
      out.push({ t: 'str', v: s });
      i = j + 1;
      continue;
    }
    const num = /^-?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
    if (num && (c !== '-' || !out.length || ['op', 'lp'].includes(out[out.length - 1].t))) {
      out.push({ t: 'num', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) { out.push({ t: 'op', v: op }); i += op.length; continue; }
    const word = /^[A-Za-z_$][\w$.\-[\]]*/.exec(src.slice(i));
    if (word) {
      const w = word[0];
      if (w === 'true' || w === 'false' || w === 'null') out.push({ t: 'kw', v: w });
      else if (w === 'contains' || w === 'and' || w === 'or' || w === 'not') out.push({ t: 'op', v: w === 'and' ? '&&' : w === 'or' ? '||' : w === 'not' ? '!' : 'contains' });
      else out.push({ t: 'ref', v: w });
      i += w.length;
      continue;
    }
    throw new ExpressionError(`unexpected character "${c}" at ${i}`);
  }
  return out;
}

export function parse(src: string): Node {
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos];
  const isOp = (v: string) => peek()?.t === 'op' && (peek() as { v: string }).v === v;

  const expr = (d: number): Node => {
    if (d > MAX_DEPTH) throw new ExpressionError('expression is nested too deeply');
    let l = and(d + 1);
    while (isOp('||')) { pos++; l = { k: 'or', l, r: and(d + 1) }; }
    return l;
  };
  const and = (d: number): Node => {
    let l = unary(d + 1);
    while (isOp('&&')) { pos++; l = { k: 'and', l, r: unary(d + 1) }; }
    return l;
  };
  const unary = (d: number): Node => {
    if (d > MAX_DEPTH) throw new ExpressionError('expression is nested too deeply');
    if (isOp('!')) { pos++; return { k: 'not', e: unary(d + 1) }; }
    return compare(d + 1);
  };
  const compare = (d: number): Node => {
    const l = primary(d + 1);
    const t = peek();
    if (t?.t === 'op' && ['==', '!=', '===', '!==', '>', '>=', '<', '<=', 'contains'].includes(t.v)) {
      pos++;
      return { k: 'cmp', op: t.v, l, r: primary(d + 1) };
    }
    return l;
  };
  const primary = (d: number): Node => {
    const t = toks[pos++];
    if (!t) throw new ExpressionError('unexpected end of expression');
    switch (t.t) {
      case 'num':
      case 'str':
        return { k: 'lit', v: t.v };
      case 'kw':
        return { k: 'lit', v: t.v === 'true' ? true : t.v === 'false' ? false : null };
      case 'ref':
        return { k: 'ref', path: t.v };
      case 'lp': {
        const e = expr(d + 1);
        if (toks[pos++]?.t !== 'rp') throw new ExpressionError('missing )');
        return e;
      }
      default:
        throw new ExpressionError(`unexpected ${t.t === 'op' ? t.v : t.t}`);
    }
  };

  const tree = expr(0);
  if (pos !== toks.length) throw new ExpressionError('unexpected input after the expression');
  return tree;
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  if (typeof v === 'boolean') return null;
  return null;
}

function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === 'object') return Object.keys(v).length > 0;
  return !!v;
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || a === null) return b === undefined || b === null;
  const na = asNumber(a);
  const nb = asNumber(b);
  if (na !== null && nb !== null && (typeof a === 'number' || typeof b === 'number')) return na === nb;
  if (typeof a === 'object' && typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

function compareValues(op: string, a: unknown, b: unknown): boolean {
  switch (op) {
    case '==':
    case '===':
      return equal(a, b);
    case '!=':
    case '!==':
      return !equal(a, b);
    case 'contains':
      if (typeof a === 'string') return typeof b === 'string' || typeof b === 'number' ? a.toLowerCase().includes(String(b).toLowerCase()) : false;
      if (Array.isArray(a)) return a.some((x) => equal(x, b));
      return false;
  }
  const na = asNumber(a);
  const nb = asNumber(b);
  if (na !== null && nb !== null) {
    if (op === '>') return na > nb;
    if (op === '>=') return na >= nb;
    if (op === '<') return na < nb;
    if (op === '<=') return na <= nb;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    if (op === '>') return a > b;
    if (op === '>=') return a >= b;
    if (op === '<') return a < b;
    if (op === '<=') return a <= b;
  }
  return false;
}

function evalNode(n: Node, ctx: TemplateContext): unknown {
  switch (n.k) {
    case 'lit':
      return n.v;
    case 'ref':
      return resolvePath(ctx, n.path, 'prompt');
    case 'not':
      return !truthy(evalNode(n.e, ctx));
    case 'and':
      return truthy(evalNode(n.l, ctx)) && truthy(evalNode(n.r, ctx));
    case 'or':
      return truthy(evalNode(n.l, ctx)) || truthy(evalNode(n.r, ctx));
    case 'cmp':
      return compareValues(n.op, evalNode(n.l, ctx), evalNode(n.r, ctx));
  }
}

/** Evaluates a condition to a boolean. Throws ExpressionError on a syntax error. */
export function evaluate(src: string, ctx: TemplateContext): boolean {
  return truthy(evalNode(parse(src), ctx));
}

/** Null when the expression parses, otherwise the reason. */
export function checkSyntax(src: string): string | null {
  try {
    parse(src);
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}
