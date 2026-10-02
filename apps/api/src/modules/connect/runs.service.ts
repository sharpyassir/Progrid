import { Injectable } from '@nestjs/common';
import { Prisma, type ConnectRun } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { ApiError } from '../../common/errors/api-error';
import { open } from '../../common/crypto/secretbox';
import type { Actor } from '../../common/auth/actor';
import { cursorArgs, toPage } from '../../common/pagination';
import { loadConfig } from '../../config/config';
import { TokenService } from '../iam/token.service';
import { AgentsService, toolSpec } from './agents.service';
import { AGENT_KEY_PREFIX, sha256 } from './parts.service';
import { RunService, presentStep, CONNECT_APPROVAL_KIND } from './runtime/run.service';
import { ConnectUsageService, currentPeriod } from './usage.service';
import { presentRun, publicBase } from './present';
import { TEMPLATES } from './templates';
import type { ListRunsQuery, LogsQuery, PublicRunDto, TestRunDto } from './dto';

const TEST_TIMEOUT_MS = 120_000;
const IDEMPOTENCY_TTL = 24 * 3600;
const SIGNATURE_TOLERANCE_S = 300;
const TERMINAL = ['succeeded', 'failed', 'cancelled', 'waiting_approval'];

export interface PublicResult {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

/** Test runs, run queries and logs, the public run API and inbound webhooks. */
@Injectable()
export class RunsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly tokens: TokenService,
    private readonly agents: AgentsService,
    private readonly runs: RunService,
    private readonly usage: ConnectUsageService,
  ) {}

  private async withSteps(run: ConnectRun, agentName?: string) {
    const [steps, approvals] = await Promise.all([
      this.prisma.connectRunStep.findMany({ where: { runId: run.id }, orderBy: { index: 'asc' } }),
      run.status === 'waiting_approval' ? this.prisma.approval.findMany({ where: { kind: CONNECT_APPROVAL_KIND, resourceId: run.id, status: 'pending' }, select: { id: true, summary: true, expiresAt: true } }) : [],
    ]);
    const name = agentName ?? (await this.prisma.connectAgent.findUnique({ where: { id: run.agentId }, select: { name: true } }))?.name ?? null;
    return presentRun(run, { agentName: name, steps: steps.map(presentStep), ...(approvals.length ? { pendingApprovals: approvals } : {}) });
  }

  /** POST /agents/:id/test: runs the draft (or the deployed version) and waits up to 120 s. */
  async test(actor: Actor, agentId: string, dto: TestRunDto) {
    const agent = await this.agents.own(actor, agentId);
    const spec = await this.agents.spec(agent, dto.useDraft !== false);
    const run = await this.runs.create({ spec, source: 'test', input: dto.input, message: dto.message });
    if (dto.async) {
      await this.runs.dispatch(run.id);
      return this.withSteps(await this.prisma.connectRun.findUniqueOrThrow({ where: { id: run.id } }), agent.name);
    }
    const done = await this.runs.executeAndWait(run.id, TEST_TIMEOUT_MS);
    return this.withSteps(done, agent.name);
  }

  async testTool(actor: Actor, agentId: string, toolId: string, input: unknown) {
    const agent = await this.agents.own(actor, agentId);
    const tool = agent.tools.find((t) => t.id === toolId);
    if (!tool) throw ApiError.notFound('tool', toolId);
    if (!(await this.redis.allow(`connect:tooltest:${actor.teamId}`, 60, 60))) throw new ApiError(429, 'rate_limited', 'Too many tool tests. Try again in a minute.');
    return this.runs.testTool(await this.agents.spec(agent, true), toolSpec(tool), input ?? {});
  }

  async list(actor: Actor, agentId: string, q: ListRunsQuery) {
    const agent = await this.agents.own(actor, agentId);
    const createdAt: Prisma.DateTimeFilter = {};
    if (q.from) createdAt.gte = parseDate(q.from, 'from');
    if (q.to) createdAt.lt = parseDate(q.to, 'to');
    const rows = await this.prisma.connectRun.findMany({
      where: { agentId, teamId: actor.teamId, ...(q.status ? { status: q.status } : {}), ...(q.source ? { source: q.source } : {}), ...(q.from || q.to ? { createdAt } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(q),
    });
    const page = toPage(rows, q.limit);
    return { data: page.data.map((r) => presentRun(r, { agentName: agent.name })), meta: page.meta };
  }

  async get(actor: Actor, runId: string) {
    const run = await this.prisma.connectRun.findFirst({ where: { id: runId, teamId: actor.teamId } });
    if (!run) throw ApiError.notFound('run', runId);
    return this.withSteps(run);
  }

  async cancel(actor: Actor, runId: string) {
    const run = await this.prisma.connectRun.findFirst({ where: { id: runId, teamId: actor.teamId } });
    if (!run) throw ApiError.notFound('run', runId);
    if (!(await this.runs.cancel(actor.teamId, runId))) throw ApiError.invalidState(`The run is already ${run.status}`);
    return this.withSteps(await this.prisma.connectRun.findUniqueOrThrow({ where: { id: runId } }));
  }

  /** GET /logs: runs across agents, newest first. */
  async logs(actor: Actor, q: LogsQuery) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (q.from) createdAt.gte = parseDate(q.from, 'from');
    if (q.to) createdAt.lt = parseDate(q.to, 'to');
    const rows = await this.prisma.connectRun.findMany({
      where: { teamId: actor.teamId, ...(q.agentId ? { agentId: q.agentId } : {}), ...(q.status ? { status: q.status } : {}), ...(q.source ? { source: q.source } : {}), ...(q.from || q.to ? { createdAt } : {}) },
      include: { agent: { select: { name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs(q),
    });
    const page = toPage(rows, q.limit);
    return { data: page.data.map(({ agent, ...r }) => presentRun(r, { agentName: agent.name })), meta: page.meta };
  }

  async overview(actor: Actor) {
    const since = new Date(Date.now() - 24 * 3600_000);
    const team = { teamId: actor.teamId };
    const [agents, deployed, runs24h, failed24h, connections, webhooks, keys, recent, usage] = await Promise.all([
      this.prisma.connectAgent.count({ where: { ...team, deletedAt: null } }),
      this.prisma.connectAgent.count({ where: { ...team, deletedAt: null, status: 'deployed' } }),
      this.prisma.connectRun.count({ where: { ...team, createdAt: { gte: since } } }),
      this.prisma.connectRun.count({ where: { ...team, createdAt: { gte: since }, status: 'failed' } }),
      this.prisma.connectConnection.count({ where: team }),
      this.prisma.connectWebhook.count({ where: { ...team, agent: { deletedAt: null } } }),
      this.prisma.connectAgentKey.count({ where: { ...team, revokedAt: null, agent: { deletedAt: null } } }),
      this.prisma.connectRun.findMany({ where: team, include: { agent: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 10 }),
      this.usage.usage(actor, currentPeriod()),
    ]);
    return {
      agents,
      deployed,
      runs24h,
      failed24h,
      counts: { connections, webhooks, keys, templates: TEMPLATES.length },
      usageThisPeriod: {
        executions: usage.totals.executions,
        aiInputTokens: usage.totals.aiInputTokens,
        aiOutputTokens: usage.totals.aiOutputTokens,
        estimatedCostMinor: usage.estimatedCostMinor,
        currency: usage.currency,
        pricingConfigured: usage.pricingConfigured,
      },
      recentRuns: recent.map(({ agent, ...r }) => presentRun(r, { agentName: agent.name })),
    };
  }

  // ───────────── public run API ─────────────

  /**
   * Resolves `Authorization: Bearer` for the public API: an agent key (prgd_ca_..., only for its
   * own agent) or a team API token with connect:write. Throws 401.
   */
  private async authorize(agentId: string, header: string | undefined): Promise<{ teamId: string; keyId?: string; actor?: Actor }> {
    const [scheme, credential] = (header ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !credential) throw ApiError.unauthorized('Send Authorization: Bearer <agent key>');
    if (credential.startsWith(AGENT_KEY_PREFIX)) {
      const key = await this.prisma.connectAgentKey.findUnique({ where: { hash: sha256(credential) } });
      if (!key || key.revokedAt || key.agentId !== agentId) throw ApiError.unauthorized('Invalid or revoked agent key');
      void this.prisma.connectAgentKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
      return { teamId: key.teamId, keyId: key.id };
    }
    const actor = await this.tokens.resolveBearer(credential);
    if (!actor) throw ApiError.unauthorized();
    if (!actor.scopes.has('connect:write')) throw ApiError.forbidden('Token is missing required scope(s): connect:write');
    return { teamId: actor.teamId, actor };
  }

  private async deployedAgent(teamId: string, agentId: string) {
    const agent = await this.prisma.connectAgent.findFirst({ where: { id: agentId, teamId, deletedAt: null }, include: { tools: { orderBy: { createdAt: 'asc' } }, workflow: { select: { id: true, graph: true } } } });
    if (!agent) throw ApiError.notFound('agent', agentId);
    if (agent.status !== 'deployed' || !agent.deployedVersion) throw new ApiError(409, 'agent_not_deployed', 'This agent is not deployed. Deploy it in the console first.');
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: teamId }, select: { status: true } });
    if (team.status === 'suspended' || team.status === 'closed') throw new ApiError(403, 'account_suspended', 'This account is suspended.');
    return agent;
  }

  private async rateLimit(teamId: string, agentId: string) {
    const cfg = loadConfig();
    if (!(await this.redis.allow(`connect:agent:${agentId}`, cfg.CONNECT_RUNS_PER_MINUTE_PER_AGENT, 60)) || !(await this.redis.allow(`connect:team:${teamId}`, cfg.CONNECT_RUNS_PER_MINUTE_PER_TEAM, 60))) {
      throw new ApiError(429, 'rate_limited', 'Too many runs for this agent or team. Try again in a minute.');
    }
  }

  private statusUrl(agentId: string, runId: string) {
    return `${publicBase()}/v1/connect/agents/${agentId}/runs/${runId}`;
  }

  private publicBody(run: ConnectRun) {
    return {
      runId: run.id,
      status: run.status,
      output: run.output,
      error: run.errorCode ? { code: run.errorCode, message: run.errorMessage ?? '' } : null,
      usage: { model: run.model, inputTokens: run.inputTokens, outputTokens: run.outputTokens, cacheReadTokens: run.cacheReadTokens, cacheWriteTokens: run.cacheWriteTokens, toolCalls: run.toolCalls, apiCalls: run.apiCalls, steps: run.stepCount },
      durationMs: run.durationMs,
    };
  }

  /** POST /v1/connect/agents/:id/run */
  async publicRun(agentId: string, authorization: string | undefined, dto: PublicRunDto, headerKey?: string): Promise<PublicResult> {
    const auth = await this.authorize(agentId, authorization);
    const agent = await this.deployedAgent(auth.teamId, agentId);
    const idemKey = dto.idempotencyKey ?? headerKey;
    if (idemKey) {
      const existing = await this.redis.client.get(`connect:idem:${agentId}:${sha256(idemKey)}`).catch(() => null);
      if (existing) return this.replay(agentId, existing);
    }
    await this.rateLimit(auth.teamId, agentId);
    const spec = await this.agents.spec(agent, false);
    const run = await this.runs.create({ spec, source: 'api', input: dto.input, keyId: auth.keyId, idempotencyKey: idemKey });
    if (idemKey) {
      const set = await this.redis.client.set(`connect:idem:${agentId}:${sha256(idemKey)}`, run.id, 'EX', IDEMPOTENCY_TTL, 'NX').catch(() => 'OK');
      if (set !== 'OK') {
        // Another request with the same key won the race: drop ours, answer with theirs.
        await this.prisma.connectRun.delete({ where: { id: run.id } }).catch(() => undefined);
        const winner = await this.redis.client.get(`connect:idem:${agentId}:${sha256(idemKey)}`);
        if (winner) return this.replay(agentId, winner);
      }
    }
    if (dto.async) {
      await this.runs.dispatch(run.id);
      return { status: 202, body: { runId: run.id, status: 'queued', statusUrl: this.statusUrl(agentId, run.id) } };
    }
    const done = await this.runs.executeAndWait(run.id, loadConfig().CONNECT_SYNC_TIMEOUT_SECONDS * 1000);
    if (!TERMINAL.includes(done.status)) return { status: 202, body: { runId: done.id, status: done.status, statusUrl: this.statusUrl(agentId, done.id) } };
    return { status: 200, body: this.publicBody(done) };
  }

  private async replay(agentId: string, runId: string): Promise<PublicResult> {
    const run = await this.prisma.connectRun.findUnique({ where: { id: runId } });
    if (!run) throw ApiError.conflict('idempotency_key_reused', 'This idempotency key was used for a run that no longer exists');
    const headers = { 'Idempotent-Replayed': 'true' };
    if (!TERMINAL.includes(run.status)) return { status: 202, body: { runId: run.id, status: run.status, statusUrl: this.statusUrl(agentId, run.id) }, headers };
    return { status: 200, body: this.publicBody(run), headers };
  }

  /** GET /v1/connect/agents/:id/runs/:runId (same auth as run). */
  async publicGet(agentId: string, runId: string, authorization: string | undefined, steps: boolean) {
    const auth = await this.authorize(agentId, authorization);
    const run = await this.prisma.connectRun.findFirst({ where: { id: runId, agentId, teamId: auth.teamId } });
    if (!run) throw ApiError.notFound('run', runId);
    return steps ? this.withSteps(run) : presentRun(run);
  }

  /** One firing of a schedule trigger (Temporal cron workflow). Skips agents that are no longer deployed. */
  async scheduled(agentId: string): Promise<string> {
    const agent = await this.prisma.connectAgent.findFirst({ where: { id: agentId, deletedAt: null, status: 'deployed' }, include: { tools: { orderBy: { createdAt: 'asc' } }, workflow: { select: { id: true, graph: true } } } });
    if (!agent?.deployedVersion) return 'skipped: not deployed';
    try {
      const spec = await this.agents.spec(agent, false);
      const run = await this.runs.create({ spec, source: 'schedule', input: { scheduledAt: new Date().toISOString() } });
      await this.runs.execute(run.id);
      return run.id;
    } catch (err) {
      // A spend limit or a busy team skips this firing; the next one tries again.
      return `skipped: ${(err as Error).message}`;
    }
  }

  // ───────────── inbound webhooks ─────────────

  /** POST /v1/connect/hooks/:hookId/:token */
  async hook(hookId: string, token: string, req: { rawBody?: Buffer; body: unknown; headers: Record<string, string | string[] | undefined> }): Promise<PublicResult> {
    const hook = await this.prisma.connectWebhook.findUnique({ where: { id: hookId } });
    const given = Buffer.from(sha256(token ?? ''));
    if (!hook || !timingSafeEqual(given, Buffer.from(hook.tokenHash))) throw ApiError.notFound('webhook', hookId);
    if (!hook.enabled) throw new ApiError(409, 'webhook_disabled', 'This webhook is disabled');
    const raw = req.rawBody ?? Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? {}));
    if (hook.signingSecret) {
      const header = String(req.headers['x-prgd-signature'] ?? '');
      if (!verifySignature(open(hook.signingSecret), header, raw)) throw ApiError.unauthorized('Missing or invalid X-Prgd-Signature');
    }
    const agent = await this.deployedAgent(hook.teamId, hook.agentId);
    await this.rateLimit(hook.teamId, hook.agentId);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (!/^(content-type|user-agent|x-[a-z0-9-]+)$/i.test(k) || /signature|token|auth|cookie|forwarded/i.test(k)) continue;
      headers[k.toLowerCase()] = String(Array.isArray(v) ? v.join(', ') : v ?? '').slice(0, 500);
    }
    const spec = await this.agents.spec(agent, false);
    const run = await this.runs.create({ spec, source: 'webhook', input: req.body ?? null, headers });
    await this.prisma.connectWebhook.update({ where: { id: hook.id }, data: { lastCalledAt: new Date() } });
    await this.runs.dispatch(run.id);
    return { status: 202, body: { runId: run.id, status: 'queued' } };
  }
}

/** X-Prgd-Signature: t=<unix seconds>,v1=<hex hmac-sha256 of "<t>.<raw body>">, within 5 minutes. */
export function verifySignature(secret: string, header: string, raw: Buffer, now = Date.now()): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=') as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1 || Math.abs(now / 1000 - t) > SIGNATURE_TOLERANCE_S) return false;
  const expected = createHmac('sha256', secret).update(`${parts.t}.`).update(raw).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(parts.v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseDate(v: string, name: string) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw ApiError.invalid(`${name} must be an ISO date`);
  return d;
}
