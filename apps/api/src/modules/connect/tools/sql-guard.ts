/**
 * Best effort SQL checks that run before a database_query tool sends anything. They are the
 * first of two layers: the database itself enforces read only (PostgreSQL BEGIN READ ONLY,
 * MySQL START TRANSACTION READ ONLY), so a statement that slips past this parser still cannot
 * write. The parser exists to give the model a clear error early and to enforce the
 * connection's allowedTables, which the database cannot know about.
 *
 * Limits (documented in docs/connect.md): table extraction understands FROM, JOIN, INTO,
 * UPDATE, TABLE and comma lists, quoted and schema qualified names, CTE names and subqueries.
 * It does not follow views, functions or dynamic SQL; that is why functions in FROM and the
 * system catalogs are refused when allowedTables is set.
 */

export interface SqlCheck {
  ok: boolean;
  reason?: string;
  tables: string[];
}

/** Words that write or run code. Statement starts are covered by READ_STARTS; these catch writes inside a read (data modifying CTEs, EXPLAIN ANALYZE). */
const WRITE_WORDS = [
  'insert', 'update', 'delete', 'merge', 'upsert', 'drop', 'alter', 'create', 'truncate', 'grant', 'revoke', 'copy', 'call', 'execute', 'exec',
  'prepare', 'lock', 'vacuum', 'analyze', 'analyse', 'refresh', 'reindex', 'cluster', 'notify', 'listen', 'outfile', 'dumpfile',
];
const DANGEROUS_FUNCTIONS = [
  'pg_read_file', 'pg_read_binary_file', 'pg_ls_dir', 'pg_stat_file', 'lo_import', 'lo_export', 'lo_get', 'dblink', 'dblink_exec', 'pg_sleep', 'pg_terminate_backend',
  'pg_cancel_backend', 'set_config', 'pg_reload_conf', 'pg_rotate_logfile', 'query_to_xml', 'load_file', 'sleep', 'benchmark', 'sys_exec', 'sys_eval', 'nextval', 'setval', 'txid_current',
];
const READ_STARTS = ['select', 'with', 'show', 'explain', 'describe', 'desc', 'values', 'table'];
const SYSTEM_SCHEMAS = ['information_schema', 'pg_catalog', 'mysql', 'performance_schema', 'sys'];

interface Token {
  kind: 'word' | 'ident' | 'punct' | 'str' | 'num';
  value: string;
}

/** Tokenizes SQL, dropping comments and keeping string literals as single tokens. */
export function tokenizeSql(sql: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (/\s/.test(c)) { i++; continue; }
    if (sql.startsWith('--', i) || c === '#') { const j = sql.indexOf('\n', i); i = j < 0 ? sql.length : j + 1; continue; }
    if (sql.startsWith('/*', i)) {
      // MySQL executable comments (/*! ... */) run their content: refuse them outright.
      if (sql[i + 2] === '!' || sql[i + 2] === '+') throw new Error('executable comments are not allowed');
      const j = sql.indexOf('*/', i + 2);
      if (j < 0) throw new Error('unclosed comment');
      i = j + 2;
      continue;
    }
    if (c === "'" || (c === 'E' && sql[i + 1] === "'") || (c === 'e' && sql[i + 1] === "'")) {
      let j = c === "'" ? i + 1 : i + 2;
      let v = '';
      while (j < sql.length) {
        if (sql[j] === '\\' && j + 1 < sql.length) { v += sql[j + 1]; j += 2; continue; }
        if (sql[j] === "'") { if (sql[j + 1] === "'") { v += "'"; j += 2; continue; } break; }
        v += sql[j++];
      }
      if (j >= sql.length) throw new Error('unclosed string literal');
      out.push({ kind: 'str', value: v });
      i = j + 1;
      continue;
    }
    if (c === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        if (end < 0) throw new Error('unclosed dollar quoted string');
        out.push({ kind: 'str', value: sql.slice(i + tag[0].length, end) });
        i = end + tag[0].length;
        continue;
      }
    }
    if (c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c;
      let j = i + 1;
      let v = '';
      while (j < sql.length) {
        if (sql[j] === close) { if (sql[j + 1] === close) { v += close; j += 2; continue; } break; }
        v += sql[j++];
      }
      if (j >= sql.length) throw new Error('unclosed quoted identifier');
      out.push({ kind: 'ident', value: v });
      i = j + 1;
      continue;
    }
    const num = /^\d+(\.\d+)?/.exec(sql.slice(i));
    if (num) { out.push({ kind: 'num', value: num[0] }); i += num[0].length; continue; }
    const word = /^[A-Za-z_][\w$]*/.exec(sql.slice(i));
    if (word) { out.push({ kind: 'word', value: word[0] }); i += word[0].length; continue; }
    out.push({ kind: 'punct', value: c });
    i++;
  }
  return out;
}

const lower = (t: Token | undefined) => (t && t.kind === 'word' ? t.value.toLowerCase() : '');

/** Reads a possibly qualified name ("schema"."table") starting at i. Returns the name and the next index. */
function readName(tokens: Token[], i: number): { name: string; next: number } | null {
  const parts: string[] = [];
  let j = i;
  for (;;) {
    const t = tokens[j];
    if (!t || (t.kind !== 'word' && t.kind !== 'ident')) break;
    parts.push(t.kind === 'word' ? t.value.toLowerCase() : t.value.toLowerCase());
    j++;
    if (tokens[j]?.kind === 'punct' && tokens[j].value === '.') { j++; continue; }
    break;
  }
  return parts.length ? { name: parts.join('.'), next: j } : null;
}

/**
 * Checks one SQL statement. `readOnly` refuses anything that is not a read; `allowedTables`
 * (lower case, "table" or "schema.table") refuses every other table.
 */
export function checkSql(sql: string, opts: { readOnly: boolean; allowedTables?: string[] }): SqlCheck {
  let tokens: Token[];
  try {
    tokens = tokenizeSql(sql);
  } catch (err) {
    return { ok: false, reason: (err as Error).message, tables: [] };
  }
  // One statement only: a single trailing semicolon is fine.
  const semis = tokens.map((t, i) => (t.kind === 'punct' && t.value === ';' ? i : -1)).filter((i) => i >= 0);
  if (semis.some((i) => i !== tokens.length - 1)) return { ok: false, reason: 'only one statement per query', tables: [] };
  if (semis.length) tokens = tokens.slice(0, -1);
  if (!tokens.length) return { ok: false, reason: 'empty query', tables: [] };

  const words = tokens.filter((t) => t.kind === 'word').map((t) => t.value.toLowerCase());
  if (opts.readOnly) {
    if (!READ_STARTS.includes(words[0])) return { ok: false, reason: `this connection is read only; ${words[0]?.toUpperCase() ?? 'the statement'} is not a read`, tables: [] };
    // A word followed by "(" is a function call and one after "." is a qualified column, not a statement.
    const bad = tokens.find((t, i) => t.kind === 'word' && WRITE_WORDS.includes(t.value.toLowerCase()) && !(tokens[i + 1]?.kind === 'punct' && tokens[i + 1].value === '(') && !(tokens[i - 1]?.kind === 'punct' && tokens[i - 1].value === '.'))?.value.toLowerCase();
    // EXPLAIN ANALYZE executes the statement; "analyze" is in WRITE_WORDS for that reason.
    if (bad) return { ok: false, reason: `this connection is read only; ${bad.toUpperCase()} is not allowed`, tables: [] };
    for (let i = 0; i < tokens.length - 1; i++) {
      if (lower(tokens[i]) === 'for' && ['update', 'share', 'no'].includes(lower(tokens[i + 1]))) return { ok: false, reason: 'row locks (FOR UPDATE / FOR SHARE) are not allowed', tables: [] };
      if (lower(tokens[i]) === 'into') return { ok: false, reason: 'SELECT INTO is not allowed on a read only connection', tables: [] };
    }
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    const w = lower(tokens[i]);
    if (w && DANGEROUS_FUNCTIONS.includes(w) && tokens[i + 1].kind === 'punct' && tokens[i + 1].value === '(') return { ok: false, reason: `${w}() is not allowed`, tables: [] };
  }

  // Tables: names after FROM / JOIN / INTO / UPDATE / TABLE, and comma lists after FROM.
  const cte = new Set<string>();
  for (let i = 0; i < tokens.length - 2; i++) {
    const w = lower(tokens[i]);
    if ((w === 'with' || (tokens[i].kind === 'punct' && tokens[i].value === ',')) && (tokens[i + 1].kind === 'word' || tokens[i + 1].kind === 'ident')) {
      const n = readName(tokens, i + 1);
      if (n && (lower(tokens[n.next]) === 'as' || (tokens[n.next]?.kind === 'punct' && tokens[n.next].value === '('))) cte.add(n.name);
    }
    if (w === 'recursive') {
      const n = readName(tokens, i + 1);
      if (n) cte.add(n.name);
    }
  }
  const tables = new Set<string>();
  const functionsInFrom: string[] = [];
  let depthFrom = false;
  for (let i = 0; i < tokens.length; i++) {
    const w = lower(tokens[i]);
    const isSource = w === 'from' || w === 'join' || w === 'into' || w === 'update' || (w === 'table' && i === 0);
    if (isSource || (depthFrom && tokens[i].kind === 'punct' && tokens[i].value === ',')) {
      if (isSource) depthFrom = w === 'from';
      const n = readName(tokens, i + 1);
      if (!n) continue; // a subquery: FROM ( SELECT ... )
      if (tokens[n.next]?.kind === 'punct' && tokens[n.next].value === '(') {
        functionsInFrom.push(n.name);
        continue;
      }
      if (!cte.has(n.name)) tables.add(n.name);
      continue;
    }
    if (['where', 'group', 'order', 'limit', 'having', 'union', 'on', 'select', 'offset', 'fetch', 'window', 'using'].includes(w)) depthFrom = false;
  }
  // FROM lists stop at aliases: "FROM a x, b y" -> a and b. Aliases after a name are skipped by readName only reading one name.

  const list = [...tables];
  if (opts.allowedTables?.length) {
    const allowed = opts.allowedTables.map((t) => t.trim().toLowerCase()).filter(Boolean);
    const ok = (t: string) => allowed.includes(t) || (t.includes('.') && allowed.includes(t.split('.').pop()!) && !SYSTEM_SCHEMAS.includes(t.split('.')[0]));
    if (functionsInFrom.length) return { ok: false, reason: `functions in FROM (${functionsInFrom.join(', ')}) are not allowed when the connection limits tables`, tables: list };
    const sys = list.find((t) => SYSTEM_SCHEMAS.includes(t.split('.')[0]) && !allowed.includes(t));
    if (sys) return { ok: false, reason: `${sys} is not in the connection's allowed tables`, tables: list };
    const denied = list.filter((t) => !ok(t));
    if (denied.length) return { ok: false, reason: `not in the connection's allowed tables: ${denied.join(', ')}`, tables: list };
  }
  return { ok: true, tables: list };
}

export type MongoOp = 'find' | 'aggregate' | 'countDocuments';

const MONGO_BLOCKED_STAGES = ['$out', '$merge'];
const MONGO_BLOCKED_OPERATORS = ['$where', '$function', '$accumulator'];

/**
 * MongoDB queries: only find, aggregate and countDocuments; no $out or $merge stages and no
 * server side JavaScript ($where, $function, $accumulator). allowedCollections covers the
 * queried collection and every collection a $lookup, $graphLookup or $unionWith reads.
 */
export function checkMongo(input: { operation: string; collection: string; filter?: unknown; pipeline?: unknown }, opts: { readOnly: boolean; allowedCollections?: string[] }): { ok: boolean; reason?: string } {
  if (!['find', 'aggregate', 'countDocuments'].includes(input.operation)) return { ok: false, reason: `operation must be find, aggregate or countDocuments (got ${input.operation})` };
  if (typeof input.collection !== 'string' || !input.collection) return { ok: false, reason: 'collection is required' };
  const collections = new Set([input.collection]);
  let bad: string | undefined;
  const walk = (v: unknown, depth: number) => {
    if (bad || depth > 50) return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (MONGO_BLOCKED_STAGES.includes(k)) bad = `${k} writes data and is not allowed`;
        else if (MONGO_BLOCKED_OPERATORS.includes(k)) bad = `${k} runs server side code and is not allowed`;
        if ((k === '$lookup' || k === '$graphLookup') && x && typeof x === 'object' && typeof (x as { from?: unknown }).from === 'string') collections.add((x as { from: string }).from);
        if (k === '$unionWith') collections.add(typeof x === 'string' ? x : String((x as { coll?: unknown })?.coll ?? ''));
        walk(x, depth + 1);
      }
    }
  };
  walk(input.filter, 0);
  walk(input.pipeline, 0);
  if (bad) return { ok: false, reason: bad };
  if (input.pipeline !== undefined && !Array.isArray(input.pipeline)) return { ok: false, reason: 'pipeline must be a list of stages' };
  if (opts.allowedCollections?.length) {
    const allowed = new Set(opts.allowedCollections.map((c) => c.trim()));
    const denied = [...collections].filter((c) => !allowed.has(c));
    if (denied.length) return { ok: false, reason: `not in the connection's allowed collections: ${denied.join(', ')}` };
  }
  return { ok: true };
}
