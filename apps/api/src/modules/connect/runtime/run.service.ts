import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma, type Approval, type ConnectRun, type ConnectRunSource, type ConnectStepType } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { RedisService } from '../../../common/redis/redis.service';
import { TemporalService } from '../../../common/temporal/temporal.service';
import { ApiError } from '../../../common/errors/api-error';
import { open } from '../../../common/crypto/secretbox';
import { scopesForRole, type Actor } from '../../../common/auth/actor';
import { loadConfig } from '../../../config/config';
import { ApprovalsService } from '../../approvals/approvals.service';
import { SpendService } from '../../billing/spend.service';
import { TrustService } from '../../trust/trust.service';
import { ModelService } from '../models/model.service';
import { providerCostMicroUsd } from '../models/catalog';
import type { ModelResponse, ToolUse } from '../models/provider';
import { ToolRegistry } from '../tools/registry.service';
import { schemaErrors } from '../tools/schema';
import type { OpenConnection, ToolContext } from '../tools/types';
import { ConnectionsService } from '../connections.service';
import { ConnectUsageService } from '../usage.service';
import { initialState, runAgentLoop, type AgentLoopState, type ToolOutcome } from './agent-loop';
import { evaluate } from './expression';
import { implicitGraph, topoOrder, type Graph, type GraphNode } from './graph';
import { PLATFORM_PREAMBLE, runPrompt } from './prompt';
import { capPayload, clip, Redactor } from './redact';
import { RunEvents } from './run-events.service';
import type { AgentSpec, ToolSpec } from './spec';
import { render, renderText, type TemplateContext } from './template';

/**
 * Runs agents. A run is a walk over the agent's workflow graph (or trigger -> agent -> end
 * when it has none) in topological order; a condition activates only the edges for its
 * result. Every node, model call, tool call, condition and approval is a RunStep with timing,
 * published live for the console.
 *
 * Runs are resumable: after each node the walk is checkpointed (finished node outputs, the
 * agent conversation, pending approvals) in ConnectRun.state. A tool that needs approval parks
 * the run in waiting_approval; approving runs the tool and re-dispatches the run, which skips
 * every finished node. Denying fails the run.
 *
 * Limits per run: maxSteps (all steps), maxTokensPerRun (model tokens), timeoutSeconds (per
 * execution, not counting time spent waiting for a person). Cancellation is checked before
 * every step.
 */

export const CONNECT_APPROVAL_KIND = 'connect:tool_call';
const TOOL_TIMEOUT_MS = 60_000;
const MODEL_RESULT_CHARS = 20_000;
const OUTPUT_CAP = 256 * 1024;

export interface TriggerData {
  source: ConnectRunSource;
  body: unknown;
  message?: string;
  headers?: Record<string, string>;
  /** User message of a run without a workflow. */
  prompt: string;
}

interface PendingApproval {
  nodeId: string;
  toolUseId: string | null;
  toolId: string;
  toolName: string;
  input: unknown;
  summary: string;
}

export interface RunState {
  spec: AgentSpec;
  trigger: TriggerData;
  done: Record<string, { output: unknown; branch?: boolean }>;
  agent: Record<string, AgentLoopState>;
  approvals: Record<string, PendingApproval>;
  execMs: number;
  segments: number;
}

export class RunFailure extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}
class RunCancelled extends Error {}

interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  toolCalls: number;
  apiCalls: number;
  steps: number;
  providerCost: number;
}

interface Ctx {
  run: ConnectRun;
  state: RunState;
  spec: AgentSpec;
  actor: Actor;
  redactor: Redactor;
  vars: Record<string, string>;
  secrets: Record<string, string>;
  connections: Map<string, OpenConnection>;
  usage: Usage;
  deadline: number;
  abort: AbortController;
  timedOut: boolean;
  segmentStart: number;
}

type NodeResult = { output: unknown; branch?: boolean } | { waiting: true };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

@Injectable()
export class RunService implements OnModuleInit {
  private readonly log = new Logger(RunService.name);
  /** Node type -> executor. Adding a node type: one entry here plus its check in graph.ts NODE_TYPES. */
  private readonly nodes: Record<string, (ctx: Ctx, node: GraphNode, t: TemplateContext, last: unknown) => Promise<NodeResult>>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly temporal: TemporalService,
    private readonly approvals: ApprovalsService,
    private readonly spend: SpendService,
    private readonly trust: TrustService,
    private readonly models: ModelService,
    private readonly tools: ToolRegistry,
    private readonly connectionsService: ConnectionsService,
    private readonly usageService: ConnectUsageService,
    private readonly events: RunEvents,
  ) {
    this.nodes = {
      trigger: (ctx, node) => this.triggerNode(ctx, node),
      agent: (ctx, node, t) => this.agentNode(ctx, node, t),
      tool: (ctx, node, t) => this.toolNode(ctx, node, t),
      condition: (ctx, node, t) => this.conditionNode(ctx, node, t),
      action: (ctx, node, t) => this.actionNode(ctx, node, t),
      transform: (ctx, node, t) => this.simpleNode(ctx, node, render(node.data?.template, t, 'prompt')),
      end: (ctx, node, t, last) => this.simpleNode(ctx, node, node.data?.output !== undefined ? render(node.data.output, t, 'prompt') : last),
    };
  }

  onModuleInit() {
    this.approvals.registerExecutor(CONNECT_APPROVAL_KIND, (actor, approval) => this.approveCall(actor, approval));
    this.approvals.onDenied(CONNECT_APPROVAL_KIND, (actor, approval, reason) => this.denyCall(actor, approval, reason));
  }

  // ───────────── creating and dispatching ─────────────

  /**
   * Checks caps, spend limits and variables, then records a queued run. Throws 402 (spend
   * limit, prepaid first), 429 (too many concurrent runs) or 422 (missing variables).
   */
  async create(opts: { spec: AgentSpec; source: ConnectRunSource; input: unknown; message?: string; headers?: Record<string, string>; keyId?: string; idempotencyKey?: string }): Promise<ConnectRun> {
    const { spec } = opts;
    const cfg = loadConfig();
    const running = await this.prisma.connectRun.count({ where: { teamId: spec.teamId, status: { in: ['queued', 'running'] } } });
    if (running >= cfg.CONNECT_MAX_CONCURRENT_RUNS) throw new ApiError(429, 'too_many_runs', `Your team already has ${running} runs in progress (limit ${cfg.CONNECT_MAX_CONCURRENT_RUNS}). Try again when one finishes.`);
    const actor = await this.runActor(spec);
    // Existing spend controls: the prepaid before postpaid rule, then the project hard limit.
    await this.trust.assertPrepaidBeforePostpaid(spec.teamId, 0);
    await this.spend.assertCanSpend(actor, spec.projectId, 0);
    const values = await this.prisma.connectVariable.findMany({ where: { agentId: spec.agentId }, select: { key: true } });
    const missing = spec.variables.filter((v) => v.required && !values.some((x) => x.key === v.key)).map((v) => v.key);
    if (missing.length) throw ApiError.invalid(`Set these variables before running the agent: ${missing.join(', ')}`, { missingVariables: missing });

    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: spec.teamId }, select: { currency: true } });
    const trigger: TriggerData = { source: opts.source, body: opts.input ?? null, ...(opts.message ? { message: opts.message } : {}), ...(opts.headers ? { headers: opts.headers } : {}), prompt: runPrompt(opts.source, opts.input, opts.message) };
    const state: RunState = { spec, trigger, done: {}, agent: {}, approvals: {}, execMs: 0, segments: 0 };
    const run = await this.prisma.connectRun.create({
      data: {
        teamId: spec.teamId,
        projectId: spec.projectId,
        agentId: spec.agentId,
        version: spec.version,
        source: opts.source,
        input: (opts.input ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        model: spec.model,
        currency: team.currency,
        workflow: !!spec.workflow,
        keyId: opts.keyId,
        idempotencyKey: opts.idempotencyKey,
        state: state as unknown as Prisma.InputJsonValue,
      },
    });
    this.events.publish(run.id, { type: 'run', run: { id: run.id, status: run.status } });
    return run;
  }

  /** Starts the run on the Temporal worker; runs it in this process when Temporal cannot be reached. */
  async dispatch(runId: string, segment = 0) {
    try {
      await this.temporal.start('connectRunWorkflow', [{ runId }], `connect-run-${runId}-${segment}`, { workflowExecutionTimeout: '30 minutes' });
    } catch (err) {
      this.log.warn(`Temporal unavailable for run ${runId} (${(err as Error).message}); running in process`);
      setImmediate(() => void this.execute(runId).catch((e) => this.log.error(`run ${runId}: ${(e as Error).message}`)));
    }
  }

  /** Runs in this process and waits up to `timeoutMs`. Returns the run as it is then. */
  async executeAndWait(runId: string, timeoutMs: number): Promise<ConnectRun> {
    const work = this.execute(runId).catch((e) => this.log.error(`run ${runId}: ${(e as Error).message}`));
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([work, new Promise((r) => (timer = setTimeout(r, timeoutMs)))]);
    if (timer) clearTimeout(timer);
    return this.prisma.connectRun.findUniqueOrThrow({ where: { id: runId } });
  }

  async cancel(teamId: string, runId: string) {
    const r = await this.prisma.connectRun.updateMany({ where: { id: runId, teamId, status: { in: ['queued', 'running', 'waiting_approval'] } }, data: { status: 'cancelled', finishedAt: new Date(), errorCode: 'cancelled', errorMessage: 'Cancelled by a person' } });
    if (r.count) {
      this.events.publish(runId, { type: 'run', run: { id: runId, status: 'cancelled' } });
      // Approvals still open for this run no longer matter.
      await this.prisma.approval.updateMany({ where: { kind: CONNECT_APPROVAL_KIND, resourceId: runId, status: 'pending' }, data: { status: 'expired', decidedAt: new Date(), reason: 'run cancelled' } });
    }
    return r.count > 0;
  }

  // ───────────── execution ─────────────

  /** Executes (or resumes) a queued run. Safe to call twice: only one caller claims the run. */
  async execute(runId: string): Promise<void> {
    const claimed = await this.prisma.connectRun.updateMany({ where: { id: runId, status: 'queued' }, data: { status: 'running' } });
    if (!claimed.count) return;
    let run = await this.prisma.connectRun.findUniqueOrThrow({ where: { id: runId } });
    if (!run.startedAt) run = await this.prisma.connectRun.update({ where: { id: runId }, data: { startedAt: new Date() } });
    this.events.publish(runId, { type: 'run', run: { id: runId, status: 'running' } });
    const state = run.state as unknown as RunState;
    let ctx: Ctx;
    try {
      ctx = await this.context(run, state);
    } catch (err) {
      await this.finish(null, run, { status: 'failed', code: err instanceof RunFailure ? err.code : 'setup_failed', message: (err as Error).message });
      return;
    }
    const timer = setTimeout(() => {
      ctx.timedOut = true;
      ctx.abort.abort();
    }, Math.max(0, ctx.deadline - Date.now()));
    try {
      const result = await this.walk(ctx);
      if (result.waiting) await this.park(ctx);
      else await this.finish(ctx, run, { status: 'succeeded', output: result.output });
    } catch (err) {
      if (err instanceof RunCancelled) await this.finish(ctx, run, { status: 'cancelled' });
      else if (ctx.timedOut) await this.finish(ctx, run, { status: 'failed', code: 'timeout', message: `The run took longer than ${ctx.spec.limits.timeoutSeconds} seconds.` });
      else if (err instanceof RunFailure) await this.finish(ctx, run, { status: 'failed', code: err.code, message: err.message, details: err.details });
      else {
        const code = (err as { code?: string }).code;
        this.log.warn(`run ${runId} failed: ${(err as Error).message}`);
        await this.finish(ctx, run, { status: 'failed', code: typeof code === 'string' && /^[a-z_]+$/.test(code) ? code : 'run_error', message: ctx.redactor.text((err as Error).message || 'The run failed') });
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /** The acting identity of a run: the agent creator's membership, limited to the agent's project. */
  private async runActor(spec: AgentSpec): Promise<Actor> {
    const m = await this.prisma.teamMember.findUnique({ where: { teamId_userId: { teamId: spec.teamId, userId: spec.createdById } }, include: { user: { select: { locale: true } }, team: { select: { status: true } } } });
    // The creator left the team: act as the team owner so team agents keep working.
    const member = m ?? (await this.prisma.teamMember.findFirst({ where: { teamId: spec.teamId, role: 'owner' }, include: { user: { select: { locale: true } }, team: { select: { status: true } } } }));
    if (!member) throw new RunFailure('agent_owner_missing', 'Nobody in the team can run this agent');
    if (member.team.status === 'suspended') throw new ApiError(403, 'account_suspended', 'This account is suspended. Only billing is available.');
    return {
      userId: member.userId,
      teamId: spec.teamId,
      role: member.role,
      projectId: spec.projectId,
      scopes: scopesForRole(member.role),
      isAgent: true,
      requireApprovalFor: new Set(),
      locale: member.user.locale,
      teamStatus: member.team.status,
    };
  }

  private async context(run: ConnectRun, state: RunState): Promise<Ctx> {
    const spec = state.spec;
    const actor = await this.runActor(spec);
    const redactor = new Redactor();
    const vars: Record<string, string> = {};
    const secrets: Record<string, string> = {};
    for (const v of await this.prisma.connectVariable.findMany({ where: { agentId: spec.agentId } })) {
      const value = open(v.value);
      if (v.secret) {
        secrets[v.key] = value;
        redactor.add(value);
      } else vars[v.key] = value;
    }
    const now = Date.now();
    return {
      run,
      state,
      spec,
      actor,
      redactor,
      vars,
      secrets,
      connections: new Map(),
      usage: { inputTokens: run.inputTokens, outputTokens: run.outputTokens, cacheReadTokens: run.cacheReadTokens, cacheWriteTokens: run.cacheWriteTokens, toolCalls: run.toolCalls, apiCalls: run.apiCalls, steps: run.stepCount, providerCost: run.providerCostMicroUsd },
      deadline: now + spec.limits.timeoutSeconds * 1000,
      abort: new AbortController(),
      timedOut: false,
      segmentStart: now,
    };
  }

  private templateCtx(ctx: Ctx): TemplateContext {
    const steps: Record<string, { output?: unknown }> = {};
    for (const [id, d] of Object.entries(ctx.state.done)) steps[id] = { output: d.output };
    const { prompt: _p, ...trigger } = ctx.state.trigger;
    return { trigger, steps, vars: ctx.vars, secrets: ctx.secrets };
  }

  private async walk(ctx: Ctx): Promise<{ waiting?: boolean; output?: unknown }> {
    const graph: Graph = ctx.spec.workflow ?? implicitGraph();
    const order = topoOrder(graph);
    if (!order) throw new RunFailure('invalid_workflow', 'The workflow has a cycle');
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const trigger = graph.nodes.find((n) => n.type === 'trigger');
    if (!trigger) throw new RunFailure('invalid_workflow', 'The workflow has no trigger');
    const active = new Set([trigger.id]);
    const t = this.templateCtx(ctx);
    let last: unknown = null;
    for (const id of order) {
      if (!active.has(id)) continue;
      const node = byId.get(id)!;
      let res = ctx.state.done[id];
      if (!res) {
        const exec = this.nodes[node.type];
        if (!exec) throw new RunFailure('invalid_workflow', `Unknown node type ${node.type}`);
        const r = await exec(ctx, node, t, last);
        if ('waiting' in r) return { waiting: true };
        res = { output: ctx.redactor.value(r.output), ...(r.branch !== undefined ? { branch: r.branch } : {}) };
        ctx.state.done[id] = res;
        delete ctx.state.agent[id];
        await this.checkpoint(ctx);
      }
      t.steps![id] = { output: res.output };
      last = res.output;
      for (const e of graph.edges) {
        if (e.source !== id) continue;
        if (node.type === 'condition' && e.sourceHandle !== String(res.branch)) continue;
        active.add(e.target);
      }
      if (node.type === 'end') return { output: res.output };
    }
    return { output: last };
  }

  /** Throws when the run must stop before another step. */
  private async guard(ctx: Ctx) {
    if (ctx.timedOut || Date.now() > ctx.deadline) {
      ctx.timedOut = true;
      throw new RunFailure('timeout', `The run took longer than ${ctx.spec.limits.timeoutSeconds} seconds.`);
    }
    if (ctx.usage.steps >= ctx.spec.limits.maxSteps) throw new RunFailure('step_limit', `The run reached its limit of ${ctx.spec.limits.maxSteps} steps.`);
    const tokens = ctx.usage.inputTokens + ctx.usage.outputTokens + ctx.usage.cacheWriteTokens;
    if (tokens >= ctx.spec.limits.maxTokensPerRun) throw new RunFailure('token_limit', `The run used its limit of ${ctx.spec.limits.maxTokensPerRun} tokens.`);
    const cur = await this.prisma.connectRun.findUnique({ where: { id: ctx.run.id }, select: { status: true } });
    if (cur?.status === 'cancelled') throw new RunCancelled();
  }

  private async addStep(ctx: Ctx, s: { type: ConnectStepType; nodeId?: string; name: string; status: string; input?: unknown; output?: unknown; error?: unknown; tokens?: unknown; startedAt?: Date; durationMs?: number }) {
    const index = ctx.usage.steps++;
    const row = await this.prisma.connectRunStep.create({
      data: {
        runId: ctx.run.id,
        index,
        type: s.type,
        nodeId: s.nodeId,
        name: s.name.slice(0, 200),
        status: s.status,
        input: capPayload(ctx.redactor.value(s.input)) as Prisma.InputJsonValue,
        output: capPayload(ctx.redactor.value(s.output)) as Prisma.InputJsonValue,
        error: s.error === undefined ? Prisma.JsonNull : (capPayload(ctx.redactor.value(s.error)) as Prisma.InputJsonValue),
        tokens: s.tokens === undefined ? Prisma.JsonNull : (s.tokens as Prisma.InputJsonValue),
        startedAt: s.startedAt ?? new Date(),
        durationMs: s.durationMs ?? 0,
      },
    });
    this.events.publish(ctx.run.id, { type: 'step', step: presentStep(row) });
    return row;
  }

  private async checkpoint(ctx: Ctx) {
    await this.prisma.connectRun.update({ where: { id: ctx.run.id }, data: { state: ctx.state as unknown as Prisma.InputJsonValue, ...this.usageColumns(ctx) } });
  }

  private usageColumns(ctx: Ctx) {
    const u = ctx.usage;
    return { inputTokens: u.inputTokens, outputTokens: u.outputTokens, cacheReadTokens: u.cacheReadTokens, cacheWriteTokens: u.cacheWriteTokens, toolCalls: u.toolCalls, apiCalls: u.apiCalls, stepCount: u.steps, providerCostMicroUsd: u.providerCost };
  }

  /** Saves the state of a run that waits for approvals. */
  private async park(ctx: Ctx) {
    ctx.state.execMs += Date.now() - ctx.segmentStart;
    ctx.state.segments++;
    await this.prisma.connectRun.updateMany({ where: { id: ctx.run.id, status: 'running' }, data: { status: 'waiting_approval', state: ctx.state as unknown as Prisma.InputJsonValue, ...this.usageColumns(ctx) } });
    this.events.publish(ctx.run.id, { type: 'run', run: { id: ctx.run.id, status: 'waiting_approval' } });
  }

  private async finish(ctx: Ctx | null, run: ConnectRun, r: { status: 'succeeded' | 'failed' | 'cancelled'; output?: unknown; code?: string; message?: string; details?: unknown }) {
    const finishedAt = new Date();
    const execMs = ctx ? ctx.state.execMs + (Date.now() - ctx.segmentStart) : 0;
    const usage = ctx?.usage;
    const costEstimateMinor = usage
      ? await this.usageService.estimate({ executions: 1, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens, toolCalls: usage.toolCalls }, run.currency).catch(() => 0)
      : 0;
    if (r.status === 'failed' && r.details !== undefined && ctx) {
      await this.addStep(ctx, { type: 'node', name: 'Run failed', status: 'failed', error: { code: r.code, message: r.message, details: r.details } }).catch(() => undefined);
    }
    const output = r.output === undefined ? Prisma.JsonNull : (capPayload(ctx ? ctx.redactor.value(r.output) : r.output, OUTPUT_CAP) as Prisma.InputJsonValue);
    // A cancel that landed while the run was executing wins: only a running row is finished here.
    const done = await this.prisma.connectRun.updateMany({
      where: { id: run.id, status: r.status === 'cancelled' ? { in: ['running', 'cancelled'] } : 'running' },
      data: {
        status: r.status,
        output,
        errorCode: r.status === 'succeeded' ? null : r.code ?? (r.status === 'cancelled' ? 'cancelled' : 'run_error'),
        errorMessage: r.status === 'succeeded' ? null : (r.message ?? (r.status === 'cancelled' ? 'Cancelled by a person' : null))?.slice(0, 2000),
        finishedAt,
        durationMs: execMs,
        costEstimateMinor,
        // The checkpoint is only needed while the run can still resume.
        state: Prisma.DbNull,
        ...(ctx ? this.usageColumns(ctx) : {}),
      },
    });
    await this.prisma.connectAgent.update({ where: { id: run.agentId }, data: { lastRunAt: finishedAt } }).catch(() => undefined);
    if (done.count) this.events.publish(run.id, { type: 'run', run: { id: run.id, status: r.status, errorCode: r.code ?? null } });
  }

  // ───────────── nodes ─────────────

  private async triggerNode(ctx: Ctx, node: GraphNode): Promise<NodeResult> {
    const { prompt: _p, ...trigger } = ctx.state.trigger;
    await this.guard(ctx);
    await this.addStep(ctx, { type: 'node', nodeId: node.id, name: `Trigger (${trigger.source})`, status: 'succeeded', output: trigger });
    return { output: trigger };
  }

  private async simpleNode(ctx: Ctx, node: GraphNode, output: unknown): Promise<NodeResult> {
    await this.guard(ctx);
    await this.addStep(ctx, { type: 'node', nodeId: node.id, name: node.type === 'end' ? 'End' : `Transform ${node.id}`, status: 'succeeded', output });
    return { output };
  }

  private async conditionNode(ctx: Ctx, node: GraphNode, t: TemplateContext): Promise<NodeResult> {
    await this.guard(ctx);
    const expression = String(node.data?.expression ?? '');
    const started = Date.now();
    let result: boolean;
    try {
      result = evaluate(expression, t);
    } catch (err) {
      await this.addStep(ctx, { type: 'condition', nodeId: node.id, name: `Condition ${node.id}`, status: 'failed', input: { expression }, error: { message: (err as Error).message } });
      throw new RunFailure('invalid_condition', `Condition ${node.id}: ${(err as Error).message}`);
    }
    await this.addStep(ctx, { type: 'condition', nodeId: node.id, name: `Condition ${node.id}`, status: 'succeeded', input: { expression }, output: { result }, durationMs: Date.now() - started });
    return { output: { result }, branch: result };
  }

  private async agentNode(ctx: Ctx, node: GraphNode, t: TemplateContext): Promise<NodeResult> {
    const data = node.data ?? {};
    const implicit = !ctx.spec.workflow;
    const prompt = implicit ? ctx.state.trigger.prompt : renderText(String(data.prompt ?? ''), t, 'prompt');
    const allowed = ctx.spec.tools.filter((x) => x.enabled && (!Array.isArray(data.toolIds) || (data.toolIds as string[]).includes(x.id)));
    const outputSchema = isObj(data.outputSchema) ? data.outputSchema : undefined;
    const instructions = renderText(ctx.spec.instructions, { vars: ctx.vars, secrets: ctx.secrets }, 'prompt');
    const res = await runAgentLoop(
      {
        provider: this.models.provider,
        request: {
          model: ctx.spec.model,
          effort: ctx.spec.effort,
          system: { preamble: PLATFORM_PREAMBLE, instructions },
          tools: allowed.map((x) => this.tools.modelTool(x)),
          maxTokens: loadConfig().CONNECT_MAX_OUTPUT_TOKENS,
          outputSchema,
          signal: ctx.abort.signal,
        },
        executeTool: (call) => this.callFromModel(ctx, node.id, allowed, call),
        beforeModelCall: () => this.guard(ctx),
        onModelResponse: (r, ms) => this.recordModel(ctx, node.id, r, ms),
      },
      ctx.state.agent[node.id] ?? initialState(prompt),
    );
    ctx.state.agent[node.id] = res.state;
    if (res.status === 'waiting') return { waiting: true };
    if (res.status === 'failed') throw new RunFailure(res.code, res.message, res.details ?? (res.text ? { partialText: clip(res.text, 4000) } : undefined));
    return { output: res.json !== undefined ? res.json : { text: res.text } };
  }

  private async recordModel(ctx: Ctx, nodeId: string, r: ModelResponse, ms: number) {
    const u = ctx.usage;
    u.inputTokens += r.usage.inputTokens;
    u.outputTokens += r.usage.outputTokens;
    u.cacheReadTokens += r.usage.cacheReadTokens;
    u.cacheWriteTokens += r.usage.cacheWriteTokens;
    u.providerCost += providerCostMicroUsd(r.servedBy || ctx.spec.model, r.usage);
    const toolCalls = r.content.filter((b) => b.type === 'tool_use').map((b) => String(b.name));
    const text = r.content.filter((b) => b.type === 'text').map((b) => String(b.text)).join('');
    await this.addStep(ctx, {
      type: 'model',
      nodeId,
      name: r.servedBy || ctx.spec.model,
      status: r.stopReason === 'refusal' || r.stopReason === 'max_tokens' ? 'failed' : 'succeeded',
      output: { stopReason: r.stopReason, text: clip(text, 8000), toolCalls, servedBy: r.servedBy, ...(r.fallbacks?.length ? { fallbacks: r.fallbacks } : {}), ...(r.stopDetails ? { stopDetails: r.stopDetails } : {}) },
      tokens: { input: r.usage.inputTokens, output: r.usage.outputTokens, cacheRead: r.usage.cacheReadTokens, cacheWrite: r.usage.cacheWriteTokens },
      startedAt: new Date(Date.now() - ms),
      durationMs: ms,
    });
  }

  /** A tool_use block from the model: parse, validate, maybe park for approval, run. */
  private async callFromModel(ctx: Ctx, nodeId: string, allowed: ToolSpec[], call: ToolUse): Promise<ToolOutcome> {
    const tool = allowed.find((x) => x.name === call.name);
    if (!tool) return { kind: 'result', content: `There is no tool named ${call.name}. Available: ${allowed.map((x) => x.name).join(', ') || 'none'}.`, isError: true };
    let input: unknown = call.input;
    if (typeof input === 'string') {
      try {
        input = JSON.parse(input);
      } catch {
        return { kind: 'result', content: JSON.stringify({ INVALID_JSON: String(call.input).slice(0, 2000) }), isError: true };
      }
    }
    const problems = schemaErrors(this.tools.inputSchemaOf(tool), input ?? {});
    if (problems) {
      await this.guard(ctx);
      await this.addStep(ctx, { type: 'tool', nodeId, name: tool.name, status: 'failed', input, error: { code: 'invalid_input', message: problems } });
      return { kind: 'result', content: `Invalid input for ${tool.name}: ${problems}`, isError: true };
    }
    const executor = this.tools.get(tool.kind);
    if (tool.requiresApproval || executor?.needsApproval?.(tool.config, input)) {
      const approvalId = await this.requestApproval(ctx, { nodeId, toolUseId: call.id, tool, input });
      return { kind: 'approval', approvalId, summary: tool.name };
    }
    const out = await this.runTool(ctx, tool, input, nodeId, input, false);
    return { kind: 'result', content: out.content, isError: out.isError };
  }

  private async toolNode(ctx: Ctx, node: GraphNode, t: TemplateContext): Promise<NodeResult> {
    const tool = ctx.spec.tools.find((x) => x.id === node.data?.toolId);
    if (!tool) throw new RunFailure('tool_missing', `Node ${node.id} uses a tool that no longer exists`);
    if (!tool.enabled) throw new RunFailure('tool_disabled', `Node ${node.id} uses the disabled tool ${tool.name}`);
    const input = render(node.data?.input ?? {}, t, 'tool');
    const display = render(node.data?.input ?? {}, t, 'prompt');
    const problems = schemaErrors(this.tools.inputSchemaOf(tool), input);
    if (problems) {
      await this.guard(ctx);
      await this.addStep(ctx, { type: 'tool', nodeId: node.id, name: tool.name, status: 'failed', input: display, error: { code: 'invalid_input', message: problems } });
      throw new RunFailure('invalid_tool_input', `Node ${node.id}: ${problems}`);
    }
    if (tool.requiresApproval || this.tools.get(tool.kind)?.needsApproval?.(tool.config, input)) {
      await this.requestApproval(ctx, { nodeId: node.id, toolUseId: null, tool, input: display });
      return { waiting: true };
    }
    const out = await this.runTool(ctx, tool, input, node.id, display, false);
    if (out.isError) throw new RunFailure('tool_failed', `${tool.name}: ${out.error}`);
    return { output: out.output };
  }

  /** An action node runs one executor with its config, as an inline tool. */
  private actionTool(node: GraphNode, t: TemplateContext, mode: 'tool' | 'prompt'): { tool: ToolSpec; input: unknown } {
    const kind = String(node.data?.kind ?? '');
    const raw = isObj(node.data?.config) ? node.data.config : {};
    const config = render(raw, t, mode) as Record<string, unknown>;
    const input = isObj(config.input) ? config.input : config;
    return {
      tool: { id: `action:${node.id}`, name: node.id, description: `${kind} action`, kind: kind as ToolSpec['kind'], connectionId: typeof config.connectionId === 'string' ? config.connectionId : null, enabled: true, requiresApproval: !!config.requiresApproval, config, inputSchema: { type: 'object' } },
      input,
    };
  }

  private async actionNode(ctx: Ctx, node: GraphNode, t: TemplateContext): Promise<NodeResult> {
    const { tool, input } = this.actionTool(node, t, 'tool');
    const display = this.actionTool(node, t, 'prompt').input;
    const executor = this.tools.get(tool.kind);
    if (!executor) throw new RunFailure('invalid_workflow', `Action ${node.id} has an unknown kind ${tool.kind}`);
    if (tool.connectionId) {
      const owned = await this.prisma.connectConnection.count({ where: { id: tool.connectionId, teamId: ctx.spec.teamId } });
      if (!owned) throw new RunFailure('connection_missing', `Action ${node.id} uses a connection that does not exist`);
    }
    if (tool.requiresApproval || executor.needsApproval?.(tool.config, input)) {
      await this.requestApproval(ctx, { nodeId: node.id, toolUseId: null, tool, input: display });
      return { waiting: true };
    }
    const out = await this.runTool(ctx, tool, input, node.id, display, false);
    if (out.isError) throw new RunFailure('action_failed', `${node.id}: ${out.error}`);
    return { output: out.output };
  }

  private async connection(ctx: Ctx, id: string): Promise<OpenConnection> {
    let c = ctx.connections.get(id);
    if (!c) {
      c = await this.connectionsService.openConnection(ctx.spec.teamId, id);
      ctx.redactor.add(...Object.values(c.secrets));
      ctx.connections.set(id, c);
    }
    return c;
  }

  /** Executes one tool and records its step. Never throws for a tool failure (isError instead). */
  private async runTool(ctx: Ctx, tool: ToolSpec, input: unknown, nodeId: string, display: unknown, approved: boolean): Promise<{ output: unknown; content: string; isError: boolean; error?: string }> {
    await this.guard(ctx);
    const started = new Date();
    const executor = this.tools.get(tool.kind);
    let output: unknown = null;
    let error: string | undefined;
    try {
      if (!executor) throw new Error(`unknown tool kind ${tool.kind}`);
      const conn = tool.connectionId ? await this.connection(ctx, tool.connectionId).catch(() => null) : null;
      if (tool.connectionId && !conn) throw new Error('the connection of this tool no longer exists');
      if (executor.connectionRequired && !conn) throw new Error(`${tool.kind} tools need a connection`);
      if (conn && executor.connectionKinds.length && !executor.connectionKinds.includes(conn.kind)) throw new Error(`${tool.kind} tools cannot use a ${conn.kind} connection`);
      const tctx: ToolContext = {
        teamId: ctx.spec.teamId,
        projectId: ctx.spec.projectId,
        agentId: ctx.spec.agentId,
        agentName: ctx.spec.name,
        runId: ctx.run.id,
        actor: ctx.actor,
        connection: conn,
        vars: ctx.vars,
        secrets: ctx.secrets,
        redactor: ctx.redactor,
        policy: this.tools.policy,
        countApiCall: () => void ctx.usage.apiCalls++,
        signal: ctx.abort.signal,
        approved,
      };
      ctx.usage.toolCalls++;
      const budget = Math.max(1000, Math.min(TOOL_TIMEOUT_MS, ctx.deadline - Date.now()));
      let timer: NodeJS.Timeout | undefined;
      output = await Promise.race([
        executor.execute(input, tool.config, tctx),
        new Promise((_, rej) => (timer = setTimeout(() => rej(new Error(`the tool did not answer within ${Math.round(budget / 1000)} s`)), budget))),
      ]).finally(() => timer && clearTimeout(timer));
      output = ctx.redactor.value(output ?? null);
    } catch (err) {
      error = ctx.redactor.text((err as Error).message || 'tool failed');
    }
    await this.addStep(ctx, { type: 'tool', nodeId, name: tool.name, status: error ? 'failed' : 'succeeded', input: display, output: error ? undefined : output, error: error ? { message: error } : undefined, startedAt: started, durationMs: Date.now() - started.getTime() });
    if (error) return { output: null, content: `Tool ${tool.name} failed: ${error}`, isError: true, error };
    return { output, content: clip(JSON.stringify(output) ?? 'null', MODEL_RESULT_CHARS), isError: false };
  }

  /**
   * POST /tools/:toolId/test: runs one tool outside a run, with the agent's variables and the
   * tool's connection. Calls that need approval are refused here; test those in a test run.
   */
  async testTool(spec: AgentSpec, tool: ToolSpec, input: unknown) {
    const started = Date.now();
    const executor = this.tools.get(tool.kind);
    const problems = schemaErrors(this.tools.inputSchemaOf(tool), input ?? {});
    if (problems) return { ok: false, output: null, durationMs: 0, error: `Invalid input: ${problems}` };
    if (!executor) return { ok: false, output: null, durationMs: 0, error: `unknown tool kind ${tool.kind}` };
    if (tool.requiresApproval || executor.needsApproval?.(tool.config, input)) return { ok: false, output: null, durationMs: 0, error: 'This call needs a person to approve it, so it only runs inside a run. Start a test run instead.' };
    const fake = { id: 'tool-test', inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, toolCalls: 0, apiCalls: 0, stepCount: 0, providerCostMicroUsd: 0 } as ConnectRun;
    const ctx = await this.context(fake, { spec, trigger: { source: 'test', body: null, prompt: '' }, done: {}, agent: {}, approvals: {}, execMs: 0, segments: 0 });
    try {
      const conn = tool.connectionId ? await this.connection(ctx, tool.connectionId) : null;
      if (executor.connectionRequired && !conn) throw new Error(`${tool.kind} tools need a connection`);
      if (conn && executor.connectionKinds.length && !executor.connectionKinds.includes(conn.kind)) throw new Error(`${tool.kind} tools cannot use a ${conn.kind} connection`);
      const out = await executor.execute(input ?? {}, tool.config, {
        teamId: spec.teamId, projectId: spec.projectId, agentId: spec.agentId, agentName: spec.name, runId: 'tool-test', actor: ctx.actor, connection: conn,
        vars: ctx.vars, secrets: ctx.secrets, redactor: ctx.redactor, policy: this.tools.policy, countApiCall: () => undefined,
      });
      return { ok: true, output: capPayload(ctx.redactor.value(out ?? null)), durationMs: Date.now() - started, error: null };
    } catch (err) {
      return { ok: false, output: null, durationMs: Date.now() - started, error: ctx.redactor.text((err as Error).message || 'tool failed') };
    }
  }

  // ───────────── approvals ─────────────

  private async requestApproval(ctx: Ctx, p: { nodeId: string; toolUseId: string | null; tool: ToolSpec; input: unknown }): Promise<string> {
    await this.guard(ctx);
    const executor = this.tools.get(p.tool.kind);
    const what = executor?.summarize?.(p.tool.config, p.input) ?? `run ${p.tool.name}`;
    const summary = clip(`Agent "${ctx.spec.name}" wants to ${what}`, 300);
    const approval = await this.approvals.createPending(ctx.actor, {
      kind: CONNECT_APPROVAL_KIND,
      resourceType: 'connect_run',
      resourceId: ctx.run.id,
      resourceName: ctx.spec.name,
      summary,
      projectId: ctx.spec.projectId,
      payload: { runId: ctx.run.id, agentId: ctx.spec.agentId, nodeId: p.nodeId, toolUseId: p.toolUseId, toolId: p.tool.id, toolName: p.tool.name, input: ctx.redactor.value(p.input) as Prisma.InputJsonValue },
    });
    ctx.state.approvals[approval.id] = { nodeId: p.nodeId, toolUseId: p.toolUseId, toolId: p.tool.id, toolName: p.tool.name, input: p.input, summary };
    await this.addStep(ctx, { type: 'approval', nodeId: p.nodeId, name: `Approval: ${p.tool.name}`, status: 'waiting', input: p.input, output: { approvalId: approval.id, summary } });
    return approval.id;
  }

  private async withRunLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const release = await this.redis.lock(`connect-run:${runId}`, 120_000);
      if (release) {
        try {
          return await fn();
        } finally {
          await release();
        }
      }
      if (Date.now() > deadline) throw ApiError.conflict('run_busy', 'The run is busy; try again in a moment');
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  /** Approval executor: runs the approved tool call, stores its result and resumes the run. */
  async approveCall(approver: Actor, approval: Approval) {
    const payload = approval.payload as { runId: string };
    return this.withRunLock(payload.runId, async () => {
      const run = await this.prisma.connectRun.findUnique({ where: { id: payload.runId } });
      if (!run || run.status !== 'waiting_approval' || !run.state) return { runId: payload.runId, resumed: false, status: run?.status ?? 'missing' };
      const state = run.state as unknown as RunState;
      const entry = state.approvals[approval.id];
      if (!entry) return { runId: run.id, resumed: false, status: run.status };
      const ctx = await this.context(run, state);
      ctx.deadline = Date.now() + TOOL_TIMEOUT_MS + 5000;
      const t = this.templateCtx(ctx);
      let tool: ToolSpec | undefined;
      let input: unknown;
      let display: unknown = entry.input;
      const node = (state.spec.workflow ?? implicitGraph()).nodes.find((n) => n.id === entry.nodeId);
      if (entry.toolId.startsWith('action:')) {
        if (!node) throw new RunFailure('invalid_workflow', 'The approved action is no longer in the workflow');
        ({ tool, input } = this.actionTool(node, t, 'tool'));
      } else {
        tool = state.spec.tools.find((x) => x.id === entry.toolId);
        // Model calls never contain secrets; tool node inputs are rendered again with them.
        input = entry.toolUseId ? entry.input : render(node?.data?.input ?? {}, t, 'tool');
      }
      if (!tool) throw new RunFailure('tool_missing', 'The approved tool no longer exists');
      display = entry.input;
      await this.addStep(ctx, { type: 'approval', nodeId: entry.nodeId, name: `Approval: ${entry.toolName}`, status: 'approved', output: { approvalId: approval.id, decidedBy: approver.userId } });
      // Steps and tokens limits do not block a call a person just approved.
      const limits = state.spec.limits;
      state.spec.limits = { ...limits, maxSteps: Math.max(limits.maxSteps, ctx.usage.steps + 2), maxTokensPerRun: Number.MAX_SAFE_INTEGER };
      const out = await this.runTool(ctx, tool, input, entry.nodeId, display, true);
      state.spec.limits = limits;
      if (entry.toolUseId) {
        const loop = state.agent[entry.nodeId];
        const pending = loop?.pending?.find((x) => x.toolUseId === entry.toolUseId);
        if (pending) pending.result = { content: out.content, isError: out.isError };
      } else if (out.isError) {
        await this.prisma.connectRun.updateMany({ where: { id: run.id, status: 'waiting_approval' }, data: { status: 'failed', errorCode: 'tool_failed', errorMessage: `${tool.name}: ${out.error}`.slice(0, 2000), finishedAt: new Date(), durationMs: state.execMs, state: Prisma.DbNull, ...this.usageColumns(ctx) } });
        this.events.publish(run.id, { type: 'run', run: { id: run.id, status: 'failed', errorCode: 'tool_failed' } });
        return { runId: run.id, resumed: false, status: 'failed' };
      } else {
        state.done[entry.nodeId] = { output: out.output };
      }
      delete state.approvals[approval.id];
      const remaining = Object.keys(state.approvals).length;
      await this.prisma.connectRun.update({ where: { id: run.id }, data: { status: remaining ? 'waiting_approval' : 'queued', state: state as unknown as Prisma.InputJsonValue, ...this.usageColumns(ctx) } });
      if (!remaining) {
        this.events.publish(run.id, { type: 'run', run: { id: run.id, status: 'queued' } });
        await this.dispatch(run.id, state.segments);
      }
      return { runId: run.id, resumed: !remaining, status: remaining ? 'waiting_approval' : 'queued', tool: { name: tool.name, ok: !out.isError } };
    });
  }

  /** A person said no: the run fails with approval_denied. */
  async denyCall(actor: Actor, approval: Approval, reason?: string) {
    const payload = approval.payload as { runId: string; toolName?: string; nodeId?: string };
    await this.withRunLock(payload.runId, async () => {
      const run = await this.prisma.connectRun.findUnique({ where: { id: payload.runId } });
      if (!run || run.status !== 'waiting_approval') return;
      const step = await this.prisma.connectRunStep.count({ where: { runId: run.id } });
      await this.prisma.connectRunStep.create({ data: { runId: run.id, index: step, type: 'approval', nodeId: payload.nodeId, name: `Approval: ${payload.toolName ?? 'tool'}`, status: 'denied', output: { approvalId: approval.id, decidedBy: actor.userId, reason: reason ?? null } } });
      await this.prisma.connectRun.update({
        where: { id: run.id },
        data: { status: 'failed', errorCode: 'approval_denied', errorMessage: `A person denied: ${approval.summary}${reason ? ` (${reason})` : ''}`.slice(0, 2000), finishedAt: new Date(), stepCount: step + 1, state: Prisma.DbNull, durationMs: (run.state as unknown as RunState | null)?.execMs ?? run.durationMs ?? 0 },
      });
      await this.prisma.approval.updateMany({ where: { kind: CONNECT_APPROVAL_KIND, resourceId: run.id, status: 'pending' }, data: { status: 'expired', decidedAt: new Date(), reason: 'another request of the run was denied' } });
      this.events.publish(run.id, { type: 'run', run: { id: run.id, status: 'failed', errorCode: 'approval_denied' } });
    });
  }

  /** Runs waiting on approvals that expired fail with approval_expired. Called by the jobs. */
  async failExpiredApprovals() {
    const waiting = await this.prisma.connectRun.findMany({ where: { status: 'waiting_approval' }, select: { id: true }, take: 500 });
    let failed = 0;
    for (const r of waiting) {
      const pending = await this.prisma.approval.count({ where: { kind: CONNECT_APPROVAL_KIND, resourceId: r.id, status: 'pending', expiresAt: { gt: new Date() } } });
      if (pending) continue;
      const n = await this.prisma.connectRun.updateMany({ where: { id: r.id, status: 'waiting_approval' }, data: { status: 'failed', errorCode: 'approval_expired', errorMessage: 'Nobody approved the request in time', finishedAt: new Date(), state: Prisma.DbNull } });
      failed += n.count;
    }
    return failed;
  }
}

export function presentStep(s: { id: string; runId: string; index: number; type: string; nodeId: string | null; name: string; status: string; input: unknown; output: unknown; error: unknown; tokens: unknown; startedAt: Date; durationMs: number | null }) {
  return { id: s.id, runId: s.runId, index: s.index, type: s.type, nodeId: s.nodeId, name: s.name, status: s.status, input: s.input, output: s.output, error: s.error, startedAt: s.startedAt, durationMs: s.durationMs, tokens: s.tokens ?? undefined };
}
