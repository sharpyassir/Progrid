import { promises as dns } from 'node:dns';
import { Client as PgClient } from 'pg';
import * as mysql from 'mysql2/promise';
import { MongoClient } from 'mongodb';
import { resolveSafeHost, NetBlockedError, type NetPolicy } from '../net/guard';
import { checkMongo, checkSql } from './sql-guard';
import { ToolError, type OpenConnection, type ToolExecutor } from './types';

/**
 * database_query: SQL on PostgreSQL and MySQL, find / aggregate / countDocuments on MongoDB.
 *
 * Read only is the default (connection.access.readOnly unless it is explicitly false) and is
 * enforced twice: the SQL guard refuses writes before sending, and the database refuses them
 * inside the transaction (PostgreSQL BEGIN READ ONLY, MySQL START TRANSACTION READ ONLY).
 * Statements have a 10 s server side timeout (statement_timeout, MAX_EXECUTION_TIME,
 * maxTimeMS) and connections a 10 s connect timeout. At most maxRows rows (default 200,
 * max 1000) come back. Hosts pass the same private range guard as HTTP tools unless they are a
 * Progrid managed database of the same team, and are connected to by the checked IP.
 */

export const DEFAULT_MAX_ROWS = 200;
export const MAX_ROWS = 1000;
const STATEMENT_TIMEOUT_MS = 10_000;
const CONNECT_TIMEOUT_MS = 10_000;
/** Characters of result JSON the model sees. */
const MODEL_RESULT_CHARS = 20_000;

export interface DbDeps {
  /** True when host is the address of a managed database the team owns (exempt from the private range guard). */
  isManagedHost(teamId: string, host: string): Promise<boolean>;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

async function targetHost(host: string, teamId: string, policy: NetPolicy, deps: DbDeps): Promise<string> {
  if (!host) throw new ToolError('the connection has no host');
  if (await deps.isManagedHost(teamId, host)) return host;
  try {
    return (await resolveSafeHost(host, policy)).address;
  } catch (err) {
    if (err instanceof NetBlockedError) throw new ToolError(`Blocked: ${err.message}`, 'network_blocked');
    throw err;
  }
}

/** Keeps the result small enough for the model while saying how much was dropped. */
export function shapeRows(rows: unknown[], maxRows: number) {
  let out = rows.slice(0, maxRows);
  const truncated = rows.length > maxRows;
  while (out.length > 1 && JSON.stringify(out, jsonSafe).length > MODEL_RESULT_CHARS) out = out.slice(0, Math.ceil(out.length / 2));
  return { rowCount: rows.length, returned: out.length, truncated: truncated || out.length < Math.min(rows.length, maxRows), rows: JSON.parse(JSON.stringify(out, jsonSafe)) as unknown[] };
}

function jsonSafe(_: string, v: unknown) {
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Buffer) return `<${v.length} bytes>`;
  return v;
}

async function runPostgres(c: OpenConnection, host: string, sql: string, params: unknown[], readOnly: boolean, maxRows: number) {
  const port = Number(c.config.port ?? 5432);
  const ssl = c.config.ssl ? { servername: String(c.config.host), rejectUnauthorized: c.config.sslVerify !== false } : false;
  const client = new PgClient({ host, port, database: String(c.config.database ?? ''), user: String(c.config.user ?? ''), password: c.secrets.password, ssl, connectionTimeoutMillis: CONNECT_TIMEOUT_MS, query_timeout: STATEMENT_TIMEOUT_MS + 5000 });
  client.on('error', () => undefined);
  await client.connect();
  try {
    await client.query(readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
    await client.query(`SET LOCAL statement_timeout = ${STATEMENT_TIMEOUT_MS}`);
    const res = await client.query({ text: sql, values: params });
    await client.query(readOnly ? 'ROLLBACK' : 'COMMIT');
    const rows = Array.isArray(res.rows) ? res.rows : [];
    return { ...shapeRows(rows, maxRows), command: res.command, affectedRows: readOnly ? 0 : res.rowCount ?? 0 };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function runMysql(c: OpenConnection, host: string, sql: string, params: unknown[], readOnly: boolean, maxRows: number) {
  const ssl = c.config.ssl ? { rejectUnauthorized: c.config.sslVerify !== false, servername: String(c.config.host) } : undefined;
  const conn = await mysql.createConnection({ host, port: Number(c.config.port ?? 3306), user: String(c.config.user ?? ''), password: c.secrets.password, database: String(c.config.database ?? ''), ssl, connectTimeout: CONNECT_TIMEOUT_MS, multipleStatements: false });
  conn.on('error', () => undefined);
  try {
    // MAX_EXECUTION_TIME is MySQL; MariaDB names it max_statement_time (seconds). One of them applies.
    await conn.query(`SET SESSION MAX_EXECUTION_TIME = ${STATEMENT_TIMEOUT_MS}`).catch(() => conn.query(`SET SESSION max_statement_time = ${STATEMENT_TIMEOUT_MS / 1000}`).catch(() => undefined));
    await conn.query(readOnly ? 'START TRANSACTION READ ONLY' : 'START TRANSACTION');
    const [rows] = await conn.query({ sql, timeout: STATEMENT_TIMEOUT_MS + 5000 }, params);
    await conn.query(readOnly ? 'ROLLBACK' : 'COMMIT');
    if (Array.isArray(rows)) return shapeRows(rows as unknown[], maxRows);
    return { rowCount: 0, returned: 0, truncated: false, rows: [], affectedRows: readOnly ? 0 : (rows as { affectedRows?: number }).affectedRows ?? 0 };
  } catch (err) {
    await conn.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await conn.end().catch(() => undefined);
  }
}

/** Mongo connection string with the password filled in (secret `uri` wins when present). */
export function mongoUri(c: OpenConnection): string {
  if (c.secrets.uri) return c.secrets.uri;
  const raw = String(c.config.uri ?? '');
  if (!raw) throw new ToolError('the connection has no uri');
  const u = new URL(raw);
  if (c.secrets.password) u.password = encodeURIComponent(c.secrets.password);
  return u.toString();
}

/** Checks every host a Mongo URI names (SRV targets too). Best effort: the driver resolves again on connect. */
async function checkMongoHosts(uri: string, teamId: string, policy: NetPolicy, deps: DbDeps) {
  const m = /^mongodb(\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)/.exec(uri);
  if (!m) throw new ToolError('not a mongodb:// or mongodb+srv:// URI');
  const hosts = m[2].split(',').map((h) => h.replace(/:\d+$/, ''));
  if (m[1]) {
    const srv = await dns.resolveSrv(`_mongodb._tcp.${hosts[0]}`).catch(() => []);
    if (!srv.length) throw new ToolError(`no SRV records for ${hosts[0]}`);
    for (const r of srv) await targetHost(r.name, teamId, policy, deps);
    return;
  }
  for (const h of hosts) await targetHost(h, teamId, policy, deps);
}

async function runMongo(c: OpenConnection, input: Record<string, unknown>, maxRows: number) {
  const client = new MongoClient(mongoUri(c), { serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS, connectTimeoutMS: CONNECT_TIMEOUT_MS, maxPoolSize: 1 });
  try {
    await client.connect();
    const db = client.db(typeof c.config.database === 'string' && c.config.database ? c.config.database : undefined);
    const coll = db.collection(String(input.collection));
    const limit = Math.min(Number(input.limit ?? maxRows) || maxRows, maxRows);
    if (input.operation === 'countDocuments') {
      const count = await coll.countDocuments(isObj(input.filter) ? input.filter : {}, { maxTimeMS: STATEMENT_TIMEOUT_MS });
      return { count };
    }
    if (input.operation === 'aggregate') {
      const pipeline = [...(input.pipeline as Record<string, unknown>[]), { $limit: limit + 1 }];
      const rows = await coll.aggregate(pipeline, { maxTimeMS: STATEMENT_TIMEOUT_MS }).toArray();
      return shapeRows(rows, limit);
    }
    const rows = await coll
      .find(isObj(input.filter) ? input.filter : {}, { projection: isObj(input.projection) ? input.projection : undefined, sort: isObj(input.sort) ? (input.sort as Record<string, 1 | -1>) : undefined, maxTimeMS: STATEMENT_TIMEOUT_MS })
      .limit(limit + 1)
      .toArray();
    return shapeRows(rows, limit);
  } finally {
    await client.close().catch(() => undefined);
  }
}

export function databaseExecutor(deps: DbDeps): ToolExecutor {
  return {
    kind: 'database_query',
    connectionKinds: ['postgres', 'mysql', 'mongodb'],
    connectionRequired: true,
    configSchema: {
      type: 'object',
      properties: {
        mode: { enum: ['sql', 'mongo_find', 'mongo_aggregate'] },
        maxRows: { type: 'integer', minimum: 1, maximum: MAX_ROWS },
        collection: { type: 'string' },
      },
    },
    defaultInputSchema(config) {
      if (config.mode === 'mongo_find') {
        return {
          type: 'object',
          properties: {
            collection: { type: 'string', description: 'Collection to read' },
            filter: { type: 'object', description: 'MongoDB filter document' },
            projection: { type: 'object' },
            sort: { type: 'object' },
            limit: { type: 'integer' },
          },
          required: ['collection'],
        };
      }
      if (config.mode === 'mongo_aggregate') {
        return { type: 'object', properties: { collection: { type: 'string' }, pipeline: { type: 'array', items: { type: 'object' }, description: 'Aggregation stages ($out and $merge are refused)' } }, required: ['collection', 'pipeline'] };
      }
      return {
        type: 'object',
        properties: {
          sql: { type: 'string', description: 'One SQL statement. Use $1, $2 (PostgreSQL) or ? (MySQL) placeholders for values.' },
          params: { type: 'array', items: { type: ['string', 'number', 'boolean', 'null'] }, description: 'Values for the placeholders' },
        },
        required: ['sql'],
      };
    },
    summarize(config, input) {
      return `Run a ${String(config.mode ?? 'sql')} query: ${JSON.stringify(input).slice(0, 200)}`;
    },
    async execute(input, config, ctx) {
      const c = ctx.connection!;
      const readOnly = c.access.readOnly !== false;
      const maxRows = Math.min(Number(config.maxRows ?? DEFAULT_MAX_ROWS) || DEFAULT_MAX_ROWS, MAX_ROWS);
      const inp = isObj(input) ? input : {};
      try {
        if (c.kind === 'mongodb') {
          const operation = config.mode === 'mongo_aggregate' ? 'aggregate' : inp.operation === 'countDocuments' ? 'countDocuments' : 'find';
          const query = { ...inp, operation, collection: String(inp.collection ?? config.collection ?? '') };
          const check = checkMongo({ operation, collection: query.collection, filter: inp.filter, pipeline: operation === 'aggregate' ? inp.pipeline ?? [] : undefined }, { readOnly, allowedCollections: c.access.allowedCollections });
          if (!check.ok) throw new ToolError(check.reason!, 'query_refused');
          await checkMongoHosts(mongoUri(c), ctx.teamId, ctx.policy, deps);
          return await runMongo(c, { ...query, pipeline: operation === 'aggregate' ? inp.pipeline ?? [] : undefined }, maxRows);
        }
        const sql = typeof inp.sql === 'string' ? inp.sql : '';
        if (!sql.trim()) throw new ToolError('sql is required');
        const check = checkSql(sql, { readOnly, allowedTables: c.access.allowedTables });
        if (!check.ok) throw new ToolError(check.reason!, 'query_refused');
        const params = Array.isArray(inp.params) ? inp.params : [];
        const host = await targetHost(String(c.config.host ?? ''), ctx.teamId, ctx.policy, deps);
        if (c.kind === 'postgres') return await runPostgres(c, host, sql, params, readOnly, maxRows);
        if (c.kind === 'mysql') return await runMysql(c, host, sql, params, readOnly, maxRows);
        throw new ToolError(`database_query does not support ${c.kind} connections`);
      } catch (err) {
        if (err instanceof ToolError) throw err;
        throw new ToolError(`Database error: ${(err as Error).message}`, 'database_error');
      }
    },
  };
}

/** Connects and runs a trivial query; used by POST /connections/:id/test. */
export async function testDatabase(c: OpenConnection, teamId: string, policy: NetPolicy, deps: DbDeps): Promise<void> {
  if (c.kind === 'mongodb') {
    await checkMongoHosts(mongoUri(c), teamId, policy, deps);
    const client = new MongoClient(mongoUri(c), { serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS, connectTimeoutMS: CONNECT_TIMEOUT_MS, maxPoolSize: 1 });
    try {
      await client.connect();
      await client.db(typeof c.config.database === 'string' && c.config.database ? c.config.database : 'admin').command({ ping: 1 });
    } finally {
      await client.close().catch(() => undefined);
    }
    return;
  }
  const host = await targetHost(String(c.config.host ?? ''), teamId, policy, deps);
  if (c.kind === 'postgres') await runPostgres(c, host, 'SELECT 1 AS ok', [], true, 1);
  else await runMysql(c, host, 'SELECT 1 AS ok', [], true, 1);
}
