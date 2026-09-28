import 'reflect-metadata';
import { Logger, ValidationPipe, type INestApplication, type INestApplicationContext, type LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DefaultLogger, NativeConnection, Runtime, Worker } from '@temporalio/worker';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { AppModule } from '../../src/app.module';
import { WorkerModule } from '../../src/worker.module';
import { createActivities } from '../../src/workflows/activities';
import { loadConfig } from '../../src/config/config';
import { MailService, type Mail } from '../../src/common/mail/mail.service';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { FakePlatformAgents } from '../../src/drivers/fake-platform-agents';
import { totpCode } from '../../src/common/auth/totp';
import { SchedulerService } from '../../src/modules/scheduler/scheduler.service';
import { MeteringService } from '../../src/modules/billing/metering.service';
import { MetricsService } from '../../src/modules/monitoring/metrics.service';
import { AlertsService } from '../../src/modules/monitoring/alerts.service';

/**
 * The system under test, booted once per suite run: the Nest API on a random port and a
 * Temporal worker with the real workflows and activities, both using the fake driver. The
 * scheduled jobs are stopped; tests run the jobs they need themselves, so nothing happens
 * behind a test's back.
 */
export interface Sut {
  api: INestApplication;
  worker: INestApplicationContext;
  baseUrl: string;
  prisma: PrismaService;
  agents: FakePlatformAgents;
  outbox: Mail[];
  /** A service from the API process. */
  get<T>(token: abstract new (...args: never[]) => T): T;
}

let booting: Promise<Sut> | undefined;

export function sut(): Promise<Sut> {
  booting ??= boot();
  return booting;
}

async function boot(): Promise<Sut> {
  const cfg = loadConfig();
  const logger: LogLevel[] = process.env.IT_LOG === 'debug' ? ['error', 'warn', 'log', 'debug'] : process.env.IT_LOG === 'log' ? ['error', 'warn', 'log'] : ['error'];
  Logger.overrideLogger(logger);

  const api = await NestFactory.create(AppModule, { rawBody: true, logger });
  api.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false }));
  await api.init();
  for (const job of api.get(SchedulerRegistry).getCronJobs().values()) job.stop();
  await api.listen(0, '127.0.0.1');
  const port = (api.getHttpServer().address() as AddressInfo).port;

  const worker = await NestFactory.createApplicationContext(WorkerModule, { logger });
  // The NATS consumers the worker process runs (no-ops when NATS is not reachable).
  worker.get(SchedulerService).listenHeartbeats();
  worker.get(MeteringService).listen();
  worker.get(MetricsService).listen();
  worker.get(AlertsService).listen();
  Runtime.install({ logger: new DefaultLogger(process.env.IT_LOG ? 'INFO' : 'WARN') });
  const connection = await NativeConnection.connect({ address: cfg.TEMPORAL_ADDRESS });
  const temporalWorker = await Worker.create({
    connection,
    namespace: cfg.TEMPORAL_NAMESPACE,
    taskQueue: cfg.TEMPORAL_TASK_QUEUE,
    workflowsPath: require.resolve('../../src/workflows/workflows.ts'),
    activities: createActivities(worker),
    maxConcurrentActivityTaskExecutions: 50,
  });
  void temporalWorker.run().catch((err) => console.error('temporal worker stopped', err));

  // Every mail either process sends lands here, so tests can follow verification links.
  const outbox: Mail[] = [];
  for (const ctx of [api, worker]) {
    const mail = ctx.get(MailService);
    const send = mail.send.bind(mail);
    mail.send = async (m: Mail) => {
      outbox.push(m);
      return send(m);
    };
  }

  return {
    api,
    worker,
    baseUrl: `http://127.0.0.1:${port}`,
    prisma: api.get(PrismaService),
    agents: api.get(FakePlatformAgents),
    outbox,
    get: (token) => api.get(token as never),
  };
}

// ---- HTTP ----

export interface Res<T = any> {
  status: number;
  body: T;
  text: string;
  headers: Headers;
}

/** A client for the public API. Each client has an address of its own for the per IP rate limits. */
export class Client {
  readonly ip = `100.${64 + rnd(63)}.${rnd(255)}.${1 + rnd(253)}`;

  constructor(readonly baseUrl: string, public token?: string) {}

  async req<T = any>(method: string, path: string, body?: unknown, opts: { token?: string | null; redirect?: 'follow' | 'manual' } = {}): Promise<Res<T>> {
    const token = opts.token === null ? undefined : opts.token ?? this.token;
    const r = await fetch(this.baseUrl + path, {
      method,
      headers: { 'x-forwarded-for': this.ip, 'user-agent': 'prgd-integration', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: opts.redirect ?? 'follow',
    });
    const text = await r.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    return { status: r.status, body: parsed as T, text, headers: r.headers };
  }

  get<T = any>(path: string, opts?: { token?: string | null }) {
    return this.req<T>('GET', path, undefined, opts);
  }
  post<T = any>(path: string, body: unknown = {}, opts?: { token?: string | null }) {
    return this.req<T>('POST', path, body, opts);
  }
  patch<T = any>(path: string, body: unknown = {}) {
    return this.req<T>('PATCH', path, body);
  }
  del<T = any>(path: string) {
    return this.req<T>('DELETE', path);
  }

  /** Like req, but fails the test with the response when the status is not the expected one. */
  async ok<T = any>(method: string, path: string, body?: unknown, expect: number | number[] = [200, 201, 202, 204]): Promise<T> {
    const r = await this.req<T>(method, path, body);
    const want = Array.isArray(expect) ? expect : [expect];
    if (!want.includes(r.status)) throw new Error(`${method} ${path} answered ${r.status}: ${r.text.slice(0, 800)}`);
    return r.body;
  }
}

function rnd(n: number) {
  return Math.floor(Math.random() * (n + 1));
}

// ---- teams ----

export interface Team {
  client: Client;
  email: string;
  password: string;
  userId: string;
  teamId: string;
  projectId: string;
}

/** A new account through the public API: sign up, confirm the email from the mail it sends. */
export async function signup(s: Sut, opts: { verify?: boolean; country?: string } = {}): Promise<Team> {
  const client = new Client(s.baseUrl);
  const email = `it-${randomBytes(6).toString('hex')}@example.test`;
  const password = `pw-${randomBytes(9).toString('base64url')}`;
  const r = await client.ok('POST', '/v1/auth/signup', { email, password, name: 'Integration Test', teamName: `it ${email.slice(3, 15)}`, country: opts.country ?? 'SA' }, 201);
  client.token = r.session;
  if (opts.verify !== false) await verifyEmail(s, client, email);
  const me = await client.ok('GET', '/v1/account');
  return { client, email, password, userId: r.user.id, teamId: r.team.id, projectId: me.team.projects[0].id };
}

export async function verifyEmail(s: Sut, client: Client, email: string) {
  const mail = await waitFor(async () => [...s.outbox].reverse().find((m) => m.to === email && /verify\?token=/.test(m.text)), { what: `verification mail to ${email}`, timeoutMs: 10_000 });
  const token = /verify\?token=([A-Za-z0-9_-]+)/.exec(mail.text)![1];
  await client.ok('POST', '/v1/auth/verify', { token }, 200);
}

/** Card top up through the built in test payment page, so the prepaid gate passes. */
export async function topUp(s: Sut, team: Team, amountMinor = 50_000) {
  const start = await team.client.ok('POST', '/v1/billing/topup', { amountMinor }, 201);
  const ref = new URL(start.redirectUrl).searchParams.get('ref')!;
  const r = await team.client.req('GET', `/v1/billing/payments/fake/confirm?ref=${encodeURIComponent(ref)}&outcome=ok`, undefined, { token: null, redirect: 'manual' });
  if (r.status !== 302) throw new Error(`fake payment confirm answered ${r.status}: ${r.text.slice(0, 300)}`);
  return start;
}

/** A verified team with prepaid credit, ready to create resources. */
export async function readyTeam(s: Sut): Promise<Team> {
  const t = await signup(s);
  await topUp(s, t);
  return t;
}

export function totp(secret: string) {
  return totpCode(secret);
}

// ---- waiting ----

export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, opts: { what: string | (() => string); timeoutMs?: number; intervalMs?: number }): Promise<T> {
  const deadline = Date.now() + (opts.timeoutMs ?? 60_000);
  let last: unknown;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (err) {
      if ((err as { fatal?: boolean }).fatal) throw err;
      last = err;
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${typeof opts.what === 'function' ? opts.what() : opts.what}${last ? `: ${(last as Error).message}` : ''}`);
    await new Promise((r) => setTimeout(r, opts.intervalMs ?? 500));
  }
}

/** Polls a resource until its status is one of `want`; fails at once on `failed` unless that is wanted. */
export async function waitStatus<T extends { status: string; statusMessage?: string | null }>(client: Client, path: string, want: string | string[], timeoutMs = 90_000): Promise<T> {
  const wanted = Array.isArray(want) ? want : [want];
  let seen = '';
  return waitFor(async () => {
    const r = await client.get<T>(path);
    if (r.status !== 200) throw new Error(`GET ${path} answered ${r.status}: ${r.text.slice(0, 300)}`);
    seen = r.body.status;
    if (wanted.includes(r.body.status)) return r.body;
    if (r.body.status === 'failed') throw Object.assign(new Error(`${path} failed: ${r.body.statusMessage ?? ''}`), { fatal: true });
    return null;
  }, { what: () => `${path} to be ${wanted.join(' or ')} (last ${seen || 'unknown'})`, timeoutMs });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
