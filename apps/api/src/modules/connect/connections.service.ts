import { Injectable } from '@nestjs/common';
import { Prisma, type ConnectConnection, type ConnectConnectionKind } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiError } from '../../common/errors/api-error';
import { open, seal } from '../../common/crypto/secretbox';
import type { Actor } from '../../common/auth/actor';
import { loadConfig } from '../../config/config';
import { EventsService } from '../events/events.service';
import { checkUrl, checkedAddresses, safeFetch, NetBlockedError } from './net/guard';
import { connectionAuth } from './tools/http.executor';
import { testDatabase } from './tools/database.executor';
import { testSmtp } from './tools/messaging.executor';
import { ToolRegistry } from './tools/registry.service';
import { schemaErrors } from './tools/schema';
import type { ConnectionAccess, OpenConnection, ToolContext } from './tools/types';
import type { CreateConnectionDto, UpdateConnectionDto } from './dto';
import { Redactor } from './runtime/redact';

/**
 * Connections hold credentials. Secrets are write only: they are sealed with the platform key
 * on the way in (common/crypto/secretbox), decrypted only by `openConnection` for a tool
 * executor or a connection test, and every response carries field names and hints only.
 */

const SECRET_FIELDS: Record<ConnectConnectionKind, string[] | null> = {
  rest_api: ['token', 'username', 'password', 'value'],
  postgres: ['password'],
  mysql: ['password'],
  mongodb: ['password', 'uri'],
  smtp: ['password'],
  webhook_out: ['signingSecret'],
  custom: null, // any field names
};

const str = { type: 'string', maxLength: 2000 };
const CONFIG_SCHEMAS: Record<ConnectConnectionKind, Record<string, unknown>> = {
  rest_api: {
    type: 'object',
    properties: {
      baseUrl: str,
      auth: { type: 'object', properties: { type: { enum: ['none', 'bearer', 'basic', 'header', 'query'] }, headerName: str, queryName: str, username: str }, required: ['type'] },
      defaultHeaders: { type: 'object', additionalProperties: { type: 'string' } },
      testPath: str,
    },
    required: ['baseUrl'],
  },
  postgres: { type: 'object', properties: { host: str, port: { type: 'integer', minimum: 1, maximum: 65535 }, database: str, user: str, ssl: { type: 'boolean' }, sslVerify: { type: 'boolean' } }, required: ['host', 'database', 'user'] },
  mysql: { type: 'object', properties: { host: str, port: { type: 'integer', minimum: 1, maximum: 65535 }, database: str, user: str, ssl: { type: 'boolean' }, sslVerify: { type: 'boolean' } }, required: ['host', 'database', 'user'] },
  mongodb: { type: 'object', properties: { uri: str, database: str } },
  smtp: { type: 'object', properties: { host: str, port: { type: 'integer', minimum: 1, maximum: 65535 }, user: str, from: str, secure: { type: 'boolean' } }, required: ['host', 'from'] },
  webhook_out: { type: 'object', properties: { url: str, headers: { type: 'object', additionalProperties: { type: 'string' } } }, required: ['url'] },
  custom: { type: 'object' },
};

const SECRETISH = /pass(word)?|secret|token|api[_-]?key|private[_-]?key|credential/i;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function hint(value: string): string {
  return value.length >= 8 ? `••••${value.slice(-4)}` : '••••';
}

export function presentConnection(c: ConnectConnection) {
  return {
    id: c.id,
    name: c.name,
    kind: c.kind,
    config: c.config,
    secretFields: c.secretFields,
    secretHints: c.secretHints,
    access: c.access,
    status: c.status,
    lastTestedAt: c.lastTestedAt,
    lastError: c.lastError,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function normalizeAccess(kind: ConnectConnectionKind, raw: unknown, prev?: ConnectionAccess): ConnectionAccess {
  const r = isObj(raw) ? raw : {};
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim()).slice(0, 200) : undefined);
  const isDb = kind === 'postgres' || kind === 'mysql' || kind === 'mongodb';
  const out: ConnectionAccess = { ...(prev ?? {}) };
  if (isDb) out.readOnly = typeof r.readOnly === 'boolean' ? r.readOnly : prev?.readOnly ?? true;
  for (const k of ['allowedTables', 'allowedCollections', 'allowedHosts'] as const) {
    const v = list(r[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

@Injectable()
export class ConnectionsService {
  constructor(private readonly prisma: PrismaService, private readonly events: EventsService, private readonly tools: ToolRegistry) {}

  async list(actor: Actor) {
    const rows = await this.prisma.connectConnection.findMany({ where: { teamId: actor.teamId }, orderBy: { createdAt: 'desc' } });
    return { data: rows.map(presentConnection) };
  }

  async get(actor: Actor, id: string) {
    return presentConnection(await this.own(actor, id));
  }

  async own(actor: { teamId: string }, id: string) {
    const c = await this.prisma.connectConnection.findFirst({ where: { id, teamId: actor.teamId } });
    if (!c) throw ApiError.notFound('connection', id);
    return c;
  }

  private validate(kind: ConnectConnectionKind, config: Record<string, unknown>, secrets: Record<string, string>) {
    const problems = schemaErrors(CONFIG_SCHEMAS[kind], config);
    if (problems) throw ApiError.invalid(`config: ${problems}`);
    for (const [k, v] of Object.entries(config)) {
      if (SECRETISH.test(k) && typeof v === 'string' && v) throw ApiError.invalid(`config.${k} looks like a secret; send it in secrets so it is stored encrypted`);
    }
    const allowed = SECRET_FIELDS[kind];
    for (const k of Object.keys(secrets)) {
      if (allowed && !allowed.includes(k)) throw ApiError.invalid(`secrets.${k} is not used by ${kind} connections (use ${allowed.join(', ')})`);
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(k)) throw ApiError.invalid(`secrets.${k} is not a valid field name`);
    }
    if (Object.keys(secrets).length > 20) throw ApiError.invalid('at most 20 secret fields');
    if (kind === 'rest_api' || kind === 'webhook_out') {
      const url = String(kind === 'rest_api' ? config.baseUrl : config.url);
      try {
        checkUrl(url);
      } catch (err) {
        throw ApiError.invalid(`${kind === 'rest_api' ? 'baseUrl' : 'url'}: ${(err as Error).message}`);
      }
    }
    if (kind === 'mongodb' && typeof config.uri === 'string' && config.uri) {
      if (!/^mongodb(\+srv)?:\/\//.test(config.uri)) throw ApiError.invalid('config.uri must start with mongodb:// or mongodb+srv://');
      try {
        if (new URL(config.uri).password) throw ApiError.invalid('config.uri must not contain the password; send it in secrets.password');
      } catch (err) {
        if (err instanceof ApiError) throw err;
      }
    }
    if (kind === 'mongodb' && !config.uri && !secrets.uri) throw ApiError.invalid('a mongodb connection needs config.uri or secrets.uri');
  }

  async create(actor: Actor, dto: CreateConnectionDto) {
    const count = await this.prisma.connectConnection.count({ where: { teamId: actor.teamId } });
    if (count >= loadConfig().CONNECT_MAX_CONNECTIONS_PER_TEAM) throw ApiError.quota(`Your team can have ${loadConfig().CONNECT_MAX_CONNECTIONS_PER_TEAM} connections; delete one first`);
    const config = isObj(dto.config) ? dto.config : {};
    const secrets = cleanSecrets(dto.secrets);
    this.validate(dto.kind, config, secrets);
    const row = await this.prisma.connectConnection.create({
      data: {
        teamId: actor.teamId,
        name: dto.name.trim(),
        kind: dto.kind,
        config: config as Prisma.InputJsonValue,
        secret: Object.keys(secrets).length ? seal(JSON.stringify(secrets)) : null,
        secretFields: Object.keys(secrets).sort(),
        secretHints: Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, hint(v)])),
        access: normalizeAccess(dto.kind, dto.access) as Prisma.InputJsonValue,
        createdById: actor.userId,
      },
    });
    // Field names only in the audit log; values never leave this service.
    await this.events.emit('connect.connection_created', { connectionId: row.id, kind: row.kind, name: row.name, secretFields: row.secretFields }, { actor, resource: `connect_connection:${row.id}` });
    return presentConnection(row);
  }

  async update(actor: Actor, id: string, dto: UpdateConnectionDto) {
    const cur = await this.own(actor, id);
    const config = isObj(dto.config) ? dto.config : (cur.config as Record<string, unknown>);
    const stored = cur.secret ? (JSON.parse(open(cur.secret)) as Record<string, string>) : {};
    const changes = isObj(dto.secrets) ? dto.secrets : {};
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === '') delete stored[k];
      else if (typeof v === 'string') stored[k] = v;
    }
    this.validate(cur.kind, config, stored);
    const row = await this.prisma.connectConnection.update({
      where: { id },
      data: {
        name: dto.name?.trim() ?? undefined,
        config: config as Prisma.InputJsonValue,
        secret: Object.keys(stored).length ? seal(JSON.stringify(stored)) : null,
        secretFields: Object.keys(stored).sort(),
        secretHints: Object.fromEntries(Object.entries(stored).map(([k, v]) => [k, hint(v)])),
        access: normalizeAccess(cur.kind, dto.access, cur.access as ConnectionAccess) as Prisma.InputJsonValue,
        // A changed connection has to be tested again.
        ...(dto.config || dto.secrets ? { status: 'untested', lastError: null } : {}),
      },
    });
    await this.events.emit('connect.connection_updated', { connectionId: id, changed: Object.keys(dto).filter((k) => (dto as Record<string, unknown>)[k] !== undefined), secretFieldsChanged: Object.keys(changes) }, { actor, resource: `connect_connection:${id}` });
    return presentConnection(row);
  }

  async remove(actor: Actor, id: string) {
    const cur = await this.own(actor, id);
    const inUse = await this.prisma.connectTool.count({ where: { connectionId: id, agent: { deletedAt: null } } });
    if (inUse) throw ApiError.conflict('connection_in_use', `${inUse} tool(s) use this connection; change or delete them first`);
    await this.prisma.connectConnection.delete({ where: { id } });
    await this.events.emit('connect.connection_deleted', { connectionId: id, kind: cur.kind, name: cur.name }, { actor, resource: `connect_connection:${id}` });
  }

  /** Decrypts a connection for a tool executor. Only executors and tests call this. */
  async openConnection(teamId: string, id: string): Promise<OpenConnection> {
    const c = await this.prisma.connectConnection.findFirst({ where: { id, teamId } });
    if (!c) throw new ApiError(404, 'not_found', `connection ${id} not found`);
    return {
      id: c.id,
      name: c.name,
      kind: c.kind,
      config: c.config as Record<string, unknown>,
      secrets: c.secret ? (JSON.parse(open(c.secret)) as Record<string, string>) : {},
      access: (c.access ?? {}) as ConnectionAccess,
    };
  }

  /** Reaches the service with the stored credentials and records the result. */
  async test(actor: Actor, id: string) {
    await this.own(actor, id);
    const conn = await this.openConnection(actor.teamId, id);
    const redactor = new Redactor();
    redactor.add(...Object.values(conn.secrets));
    const started = Date.now();
    let error: string | null = null;
    try {
      await this.probe(conn, actor);
    } catch (err) {
      error = redactor.text(err instanceof NetBlockedError ? `Blocked: ${err.message}` : (err as Error).message || 'test failed').slice(0, 500);
    }
    const now = new Date();
    await this.prisma.connectConnection.update({ where: { id }, data: { status: error ? 'error' : 'ok', lastTestedAt: now, lastError: error } });
    await this.events.emit('connect.connection_tested', { connectionId: id, ok: !error }, { actor, resource: `connect_connection:${id}` });
    return { ok: !error, status: error ? 'error' : 'ok', error, durationMs: Date.now() - started, testedAt: now };
  }

  private async probe(conn: OpenConnection, actor: Actor) {
    const policy = this.tools.policy;
    switch (conn.kind) {
      case 'rest_api': {
        const base = String(conn.config.baseUrl ?? '');
        const path = typeof conn.config.testPath === 'string' ? conn.config.testPath : '';
        const url = new URL(path ? base.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '') : base);
        const ctx = { connection: conn } as ToolContext;
        const auth = connectionAuth(ctx);
        for (const [k, v] of Object.entries(auth.query)) url.searchParams.set(k, v);
        const res = await safeFetch(url.toString(), { method: 'GET', headers: { accept: 'application/json', 'user-agent': 'Progrid-Connect/1.0', ...auth.headers } }, { policy, allowedHosts: conn.access.allowedHosts?.length ? conn.access.allowedHosts : [new URL(base).hostname], maxBytes: 64 * 1024 });
        if (res.status === 401 || res.status === 403) throw new Error(`the API rejected the credentials (HTTP ${res.status})`);
        if (res.status >= 500) throw new Error(`the API answered HTTP ${res.status}`);
        return;
      }
      case 'postgres':
      case 'mysql':
      case 'mongodb':
        return testDatabase(conn, actor.teamId, policy, { isManagedHost: async (teamId, host) => (await this.prisma.dbCluster.count({ where: { deletedAt: null, project: { teamId }, publicIp: { address: host } } })) > 0 });
      case 'smtp':
        return testSmtp(conn, policy);
      case 'webhook_out': {
        const url = checkUrl(String(conn.config.url ?? ''), conn.access.allowedHosts);
        await checkedAddresses(url.hostname, policy);
        return;
      }
      case 'custom':
        return;
    }
  }
}

function cleanSecrets(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) if (typeof v === 'string' && v !== '') out[k] = v.slice(0, 20_000);
  return out;
}
