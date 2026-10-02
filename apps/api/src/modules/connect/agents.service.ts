import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type ConnectAgent, type ConnectTool } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TemporalService } from '../../common/temporal/temporal.service';
import { ApiError } from '../../common/errors/api-error';
import { open, seal } from '../../common/crypto/secretbox';
import type { Actor } from '../../common/auth/actor';
import { loadConfig } from '../../config/config';
import { EventsService } from '../events/events.service';
import { IamService } from '../iam/iam.service';
import { ModelService } from './models/model.service';
import { isKnownModel, type Effort } from './models/catalog';
import { ToolRegistry } from './tools/registry.service';
import { bindToolIds, validateBlueprint, type Blueprint } from './blueprint';
import { findTemplate } from './templates';
import { normalizeLimits, normalizeVariables, type AgentSpec, type Snapshot, type ToolSpec } from './runtime/spec';
import { validateGraph, type Graph } from './runtime/graph';
import { presentAgent, presentKey, presentTool, presentWebhook, presentWorkflow, runEndpoint } from './present';
import type { CreateAgentDto, UpdateAgentDto } from './dto';

type AgentWithParts = ConnectAgent & { tools: ConnectTool[]; workflow: { id: string; graph: Prisma.JsonValue } | null };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function slugify(name: string) {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'agent';
}

export function toolSpec(t: ConnectTool): ToolSpec {
  return { id: t.id, name: t.name, description: t.description, kind: t.kind, connectionId: t.connectionId, enabled: t.enabled, requiresApproval: t.requiresApproval, config: (t.config ?? {}) as Record<string, unknown>, inputSchema: (t.inputSchema ?? {}) as Record<string, unknown> };
}

/**
 * Agents: create (blank, from a template or from a Build with AI draft), edit, variables,
 * immutable versions, deploy and pause. A run executes an AgentSpec: the live draft for tests,
 * the deployed version's snapshot for everything else.
 */
@Injectable()
export class AgentsService {
  private readonly log = new Logger(AgentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly iam: IamService,
    private readonly models: ModelService,
    private readonly tools: ToolRegistry,
    private readonly temporal: TemporalService,
  ) {}

  async own(actor: { teamId: string }, id: string): Promise<AgentWithParts> {
    const a = await this.prisma.connectAgent.findFirst({ where: { id, teamId: actor.teamId, deletedAt: null }, include: { tools: { orderBy: { createdAt: 'asc' } }, workflow: { select: { id: true, graph: true } } } });
    if (!a) throw ApiError.notFound('agent', id);
    return a;
  }

  private async values(agentId: string) {
    const rows = await this.prisma.connectVariable.findMany({ where: { agentId } });
    return rows.map((v) => ({ key: v.key, secret: v.secret, ...(v.secret ? {} : { value: open(v.value) }) }));
  }

  async present(a: AgentWithParts | ConnectAgent) {
    return presentAgent(a as AgentWithParts, await this.values(a.id));
  }

  async list(actor: Actor) {
    const rows = await this.prisma.connectAgent.findMany({ where: { teamId: actor.teamId, deletedAt: null }, include: { tools: { select: { id: true } }, workflow: { select: { id: true } } }, orderBy: { createdAt: 'desc' } });
    const values = await this.prisma.connectVariable.findMany({ where: { agentId: { in: rows.map((r) => r.id) } } });
    return {
      data: rows.map((r) => presentAgent(r, values.filter((v) => v.agentId === r.id).map((v) => ({ key: v.key, secret: v.secret, ...(v.secret ? {} : { value: open(v.value) }) })))),
    };
  }

  /** Agent with tools, workflow, webhooks, keys and what still blocks a deploy. */
  async detail(actor: Actor, id: string) {
    const a = await this.own(actor, id);
    const [webhooks, keys, wf] = await Promise.all([
      this.prisma.connectWebhook.findMany({ where: { agentId: id }, orderBy: { createdAt: 'asc' } }),
      this.prisma.connectAgentKey.findMany({ where: { agentId: id, revokedAt: null }, orderBy: { createdAt: 'asc' } }),
      this.prisma.connectWorkflow.findUnique({ where: { agentId: id } }),
    ]);
    return {
      ...(await this.present(a)),
      tools: a.tools.map(presentTool),
      workflow: presentWorkflow(wf),
      webhooks: webhooks.map((h) => presentWebhook(h)),
      keys: keys.map(presentKey),
      issues: await this.issues(a),
    };
  }

  /** Human readable reasons the agent cannot run yet (missing connections, variables, workflow problems). */
  async issues(a: AgentWithParts): Promise<string[]> {
    const out: string[] = [];
    for (const t of a.tools) {
      const e = this.tools.get(t.kind);
      if (e?.connectionRequired && !t.connectionId) out.push(`Tool ${t.name} needs a connection`);
      if (t.kind === 'http_request' && !t.connectionId && !(isObj(t.config) && Array.isArray(t.config.allowedHosts) && t.config.allowedHosts.length)) out.push(`Tool ${t.name} needs a connection or allowedHosts`);
    }
    const set = new Set((await this.prisma.connectVariable.findMany({ where: { agentId: a.id }, select: { key: true } })).map((v) => v.key));
    for (const v of normalizeVariables(a.variables)) if (v.required && !set.has(v.key)) out.push(`Variable ${v.key} has no value`);
    if (a.workflow) {
      const { issues } = validateGraph(a.workflow.graph, { toolIds: new Set(a.tools.map((t) => t.id)) });
      for (const i of issues) out.push(`Workflow: ${i.message}`);
    }
    return out;
  }

  private async uniqueSlug(teamId: string, name: string) {
    const base = slugify(name);
    const taken = new Set((await this.prisma.connectAgent.findMany({ where: { teamId, deletedAt: null, slug: { startsWith: base } }, select: { slug: true } })).map((r) => r.slug));
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  }

  private async assertCap(teamId: string) {
    const n = await this.prisma.connectAgent.count({ where: { teamId, deletedAt: null } });
    const max = loadConfig().CONNECT_MAX_AGENTS_PER_TEAM;
    if (n >= max) throw ApiError.quota(`Your team can have ${max} agents; delete one first`);
  }

  private model(m: string | undefined) {
    if (m === undefined || m === '') return this.models.defaultModel();
    if (!isKnownModel(m)) throw ApiError.invalid(`Unknown model ${m}. GET /v1/connect/models lists the models.`);
    return m;
  }

  async create(actor: Actor, dto: CreateAgentDto) {
    if (dto.templateSlug) {
      const t = findTemplate(dto.templateSlug);
      if (!t) throw ApiError.invalid(`Unknown template ${dto.templateSlug}. GET /v1/connect/templates lists them.`);
      const bp: Blueprint = JSON.parse(JSON.stringify(t));
      bp.agent.name = dto.name;
      if (dto.description !== undefined) bp.agent.description = dto.description;
      if (dto.instructions !== undefined) bp.agent.instructions = dto.instructions;
      if (dto.model) bp.agent.model = dto.model;
      if (dto.effort) bp.agent.effort = dto.effort;
      return this.createFromBlueprint(actor, bp, {}, { templateSlug: t.slug, project: dto.project });
    }
    await this.assertCap(actor.teamId);
    const project = await this.iam.resolveProject(actor, dto.project);
    const agent = await this.prisma.connectAgent.create({
      data: {
        teamId: actor.teamId,
        projectId: project.id,
        createdById: actor.userId,
        name: dto.name.trim(),
        slug: await this.uniqueSlug(actor.teamId, dto.name),
        description: dto.description ?? '',
        instructions: dto.instructions ?? '',
        model: this.model(dto.model),
        effort: dto.effort ?? 'medium',
      },
      include: { tools: true, workflow: { select: { id: true, graph: true } } },
    });
    await this.events.emit('connect.agent_created', { agentId: agent.id, name: agent.name, model: agent.model }, { actor, resource: `connect_agent:${agent.id}` });
    return this.present(agent);
  }

  /**
   * Saves a template or a Build with AI draft: agent, tools (connection refs mapped to the
   * team's connections when given, else left empty), workflow with tool names bound to ids.
   */
  async createFromBlueprint(actor: Actor, raw: unknown, connections: Record<string, string>, opts: { templateSlug?: string; project?: string } = {}) {
    const { blueprint: bp, issues } = validateBlueprint(raw, (kind, config) => this.tools.checkConfig(kind, config));
    if (issues.length) throw ApiError.invalid('The draft has problems; fix them and try again', { issues });
    await this.assertCap(actor.teamId);
    const project = await this.iam.resolveProject(actor, opts.project);
    const connIds: Record<string, string> = {};
    for (const [refOrName, id] of Object.entries(connections ?? {})) {
      const need = bp.connectionsNeeded.find((c) => c.ref === refOrName) ?? bp.connectionsNeeded.find((c) => c.name === refOrName);
      if (!need) throw ApiError.invalid(`The draft needs no connection called ${refOrName}`);
      const c = await this.prisma.connectConnection.findFirst({ where: { id, teamId: actor.teamId } });
      if (!c) throw ApiError.notFound('connection', id);
      if (c.kind !== need.kind && !(need.kind === 'postgres' && c.kind === 'mysql')) throw ApiError.invalid(`${need.name} needs a ${need.kind} connection, not ${c.kind}`);
      connIds[need.ref] = c.id;
    }
    const agent = await this.prisma.$transaction(async (tx) => {
      const a = await tx.connectAgent.create({
        data: {
          teamId: actor.teamId,
          projectId: project.id,
          createdById: actor.userId,
          name: bp.agent.name,
          slug: await this.uniqueSlug(actor.teamId, bp.agent.name),
          description: bp.agent.description,
          instructions: bp.agent.instructions,
          model: this.model(bp.agent.model),
          effort: bp.agent.effort ?? 'medium',
          variables: bp.variables as unknown as Prisma.InputJsonValue,
          templateSlug: opts.templateSlug,
        },
      });
      const idByName = new Map<string, string>();
      for (const t of bp.tools) {
        const connectionId = t.connectionRef ? connIds[t.connectionRef] ?? null : null;
        if (connectionId) {
          const c = await tx.connectConnection.findUniqueOrThrow({ where: { id: connectionId } });
          const e = this.tools.get(t.kind);
          if (e && e.connectionKinds.length && !e.connectionKinds.includes(c.kind)) throw ApiError.invalid(`Tool ${t.name} cannot use the ${c.kind} connection ${c.name}`);
        }
        const row = await tx.connectTool.create({ data: { agentId: a.id, name: t.name, description: t.description, kind: t.kind, connectionId, enabled: t.enabled !== false, requiresApproval: !!t.requiresApproval, config: t.config as Prisma.InputJsonValue, inputSchema: (t.inputSchema ?? {}) as Prisma.InputJsonValue } });
        idByName.set(t.name, row.id);
      }
      if (bp.workflow) await tx.connectWorkflow.create({ data: { agentId: a.id, graph: bindToolIds(bp.workflow, idByName) as unknown as Prisma.InputJsonValue } });
      return a;
    });
    await this.events.emit('connect.agent_created', { agentId: agent.id, name: agent.name, model: agent.model, templateSlug: opts.templateSlug ?? null, fromDraft: !opts.templateSlug }, { actor, resource: `connect_agent:${agent.id}` });
    return this.present(await this.own(actor, agent.id));
  }

  async update(actor: Actor, id: string, dto: UpdateAgentDto) {
    const cur = await this.own(actor, id);
    const data: Prisma.ConnectAgentUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.instructions !== undefined) data.instructions = dto.instructions;
    if (dto.model !== undefined) data.model = this.model(dto.model);
    if (dto.effort !== undefined) data.effort = dto.effort as Effort;
    if (dto.limits !== undefined) data.limits = normalizeLimits(dto.limits) as unknown as Prisma.InputJsonValue;
    if (dto.variables !== undefined) {
      const vars = normalizeVariables(dto.variables);
      if (vars.length !== dto.variables.length) throw ApiError.invalid('variables: each needs a unique UPPER_SNAKE_CASE key');
      data.variables = vars as unknown as Prisma.InputJsonValue;
      // A variable that changed between secret and plain keeps its value but its storage follows.
      for (const v of vars) await this.prisma.connectVariable.updateMany({ where: { agentId: id, key: v.key }, data: { secret: v.secret } });
      await this.prisma.connectVariable.deleteMany({ where: { agentId: id, key: { notIn: vars.map((v) => v.key) } } });
    }
    const row = await this.prisma.connectAgent.update({ where: { id: cur.id }, data, include: { tools: true, workflow: { select: { id: true, graph: true } } } });
    await this.events.emit('connect.agent_updated', { agentId: id, fields: Object.keys(data) }, { actor, resource: `connect_agent:${id}` });
    return this.present(row);
  }

  async remove(actor: Actor, id: string) {
    const a = await this.own(actor, id);
    await this.prisma.$transaction([
      this.prisma.connectAgent.update({ where: { id: a.id }, data: { deletedAt: new Date(), status: 'paused' } }),
      this.prisma.connectAgentKey.updateMany({ where: { agentId: a.id, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.connectWebhook.updateMany({ where: { agentId: a.id }, data: { enabled: false } }),
    ]);
    await this.stopSchedule(a.id);
    await this.events.emit('connect.agent_deleted', { agentId: a.id, name: a.name }, { actor, resource: `connect_agent:${a.id}` });
  }

  async setVariable(actor: Actor, id: string, key: string, value: string) {
    const a = await this.own(actor, id);
    const def = normalizeVariables(a.variables).find((v) => v.key === key);
    if (!def) throw ApiError.notFound('variable', key);
    if (value === '') await this.prisma.connectVariable.deleteMany({ where: { agentId: id, key } });
    else await this.prisma.connectVariable.upsert({ where: { agentId_key: { agentId: id, key } }, create: { agentId: id, key, value: seal(value), secret: def.secret }, update: { value: seal(value), secret: def.secret } });
    // The value never goes into the audit log, secret or not.
    await this.events.emit('connect.variable_set', { agentId: id, key, secret: def.secret, cleared: value === '' }, { actor, resource: `connect_agent:${id}` });
    return { key, description: def.description, required: def.required, secret: def.secret, hasValue: value !== '', ...(def.secret || value === '' ? {} : { value }) };
  }

  // ───────────── versions and deploy ─────────────

  snapshot(a: AgentWithParts): Snapshot {
    return {
      name: a.name,
      description: a.description,
      instructions: a.instructions,
      model: a.model,
      effort: a.effort as Effort,
      variables: normalizeVariables(a.variables),
      limits: normalizeLimits(a.limits),
      tools: a.tools.map(toolSpec),
      workflow: a.workflow ? (a.workflow.graph as unknown as Graph) : null,
    };
  }

  async versions(actor: Actor, id: string) {
    await this.own(actor, id);
    const rows = await this.prisma.connectAgentVersion.findMany({ where: { agentId: id }, orderBy: { version: 'desc' } });
    return { data: rows.map((v) => ({ version: v.version, createdAt: v.createdAt, createdBy: v.createdById, note: v.note, snapshot: v.snapshot })) };
  }

  async createVersion(actor: Actor, id: string, note = '') {
    const a = await this.own(actor, id);
    const problems = await this.issues(a);
    const blocking = problems.filter((p) => p.startsWith('Workflow:'));
    if (blocking.length) throw ApiError.invalid('Fix the workflow before saving a version', { issues: blocking });
    const v = await this.prisma.$transaction(async (tx) => {
      const last = await tx.connectAgentVersion.findFirst({ where: { agentId: id }, orderBy: { version: 'desc' }, select: { version: true } });
      const version = (last?.version ?? 0) + 1;
      const row = await tx.connectAgentVersion.create({ data: { agentId: id, version, note, snapshot: this.snapshot(a) as unknown as Prisma.InputJsonValue, createdById: actor.userId } });
      await tx.connectAgent.update({ where: { id }, data: { currentVersion: version } });
      return row;
    });
    await this.events.emit('connect.version_created', { agentId: id, version: v.version, note }, { actor, resource: `connect_agent:${id}` });
    return { version: v.version, createdAt: v.createdAt, createdBy: v.createdById, note: v.note, snapshot: v.snapshot };
  }

  /** Deploys a version (a new one from the draft when none is given). */
  async deploy(actor: Actor, id: string, version?: number) {
    const a = await this.own(actor, id);
    let v: number;
    if (version) {
      const row = await this.prisma.connectAgentVersion.findUnique({ where: { agentId_version: { agentId: id, version } } });
      if (!row) throw ApiError.notFound('version', String(version));
      v = version;
    } else {
      const problems = await this.issues(a);
      if (problems.length) throw new ApiError(409, 'agent_incomplete', `The agent is not ready to deploy: ${problems.join('; ')}`, { issues: problems });
      v = (await this.createVersion(actor, id, 'Deployed')).version;
    }
    const snap = (await this.prisma.connectAgentVersion.findUniqueOrThrow({ where: { agentId_version: { agentId: id, version: v } } })).snapshot as unknown as Snapshot;
    const row = await this.prisma.connectAgent.update({ where: { id }, data: { status: 'deployed', deployedVersion: v }, include: { tools: true, workflow: { select: { id: true, graph: true } } } });
    await this.syncSchedule(row, snap);
    await this.events.emit('connect.agent_deployed', { agentId: id, version: v }, { actor, resource: `connect_agent:${id}` });
    return this.present(row);
  }

  async pause(actor: Actor, id: string) {
    const a = await this.own(actor, id);
    const row = await this.prisma.connectAgent.update({ where: { id: a.id }, data: { status: 'paused' }, include: { tools: true, workflow: { select: { id: true, graph: true } } } });
    await this.stopSchedule(id);
    await this.events.emit('connect.agent_paused', { agentId: id }, { actor, resource: `connect_agent:${id}` });
    return this.present(row);
  }

  /** A schedule trigger in the deployed version runs as a Temporal cron workflow. */
  private async syncSchedule(a: ConnectAgent, snap: Snapshot) {
    const trigger = snap.workflow?.nodes.find((n) => n.type === 'trigger');
    await this.stopSchedule(a.id);
    if (trigger?.data?.source !== 'schedule' || typeof trigger.data.cron !== 'string') return;
    try {
      await this.temporal.start('connectScheduleWorkflow', [{ agentId: a.id }], `connect-schedule-${a.id}`, { cronSchedule: trigger.data.cron });
    } catch (err) {
      this.log.warn(`schedule for agent ${a.id} not started: ${(err as Error).message}`);
    }
  }

  private async stopSchedule(agentId: string) {
    await this.temporal.terminate(`connect-schedule-${agentId}`, 'agent paused, redeployed or deleted').catch((err) => this.log.debug(`stop schedule ${agentId}: ${(err as Error).message}`));
  }

  // ───────────── specs ─────────────

  /** What a run executes: the deployed snapshot, or the draft for tests (useDraft). */
  async spec(agent: AgentWithParts, useDraft: boolean): Promise<AgentSpec> {
    let snap: Snapshot;
    let version: number | null = null;
    if (useDraft || !agent.deployedVersion) snap = this.snapshot(agent);
    else {
      const v = await this.prisma.connectAgentVersion.findUniqueOrThrow({ where: { agentId_version: { agentId: agent.id, version: agent.deployedVersion } } });
      snap = v.snapshot as unknown as Snapshot;
      version = v.version;
    }
    return { ...snap, limits: normalizeLimits(snap.limits), variables: normalizeVariables(snap.variables), agentId: agent.id, teamId: agent.teamId, projectId: agent.projectId, createdById: agent.createdById, version };
  }

  // ───────────── docs ─────────────

  async docs(actor: Actor, id: string) {
    const a = await this.own(actor, id);
    const endpoint = runEndpoint(a.id);
    const sample = { input: { message: 'Hello' } };
    const body = JSON.stringify(sample);
    const requestSchema = {
      type: 'object',
      properties: {
        input: { description: 'Any JSON value: a string, or an object your agent expects' },
        async: { type: 'boolean', description: 'Return 202 at once with a runId instead of waiting (up to 60 s)' },
        idempotencyKey: { type: 'string', description: 'Repeat a request safely for 24 hours' },
      },
    };
    const responseSchema = {
      type: 'object',
      properties: {
        runId: { type: 'string' },
        status: { type: 'string', enum: ['succeeded', 'failed', 'waiting_approval', 'running', 'queued', 'cancelled'] },
        output: { description: 'Structured JSON result: {text} for a single agent, the end node output for a workflow' },
        error: { type: ['object', 'null'], properties: { code: { type: 'string' }, message: { type: 'string' } } },
        usage: { type: 'object' },
        durationMs: { type: 'integer' },
      },
    };
    return {
      endpoint,
      method: 'POST',
      auth: { type: 'bearer', header: 'Authorization', format: 'Bearer prgd_ca_...', note: 'Create a key under Keys. A team API token with connect:write also works.' },
      status: a.status,
      deployedVersion: a.deployedVersion,
      requestSchema,
      responseSchema,
      statusEndpoint: `${endpoint.replace(/\/run$/, '')}/runs/{runId}`,
      errors: { 401: 'bad or revoked key', 402: 'spend limit reached or payment required', 404: 'unknown agent', 409: 'agent not deployed', 429: 'rate limited' },
      examples: {
        curl: `curl -X POST ${endpoint} \\\n  -H "Authorization: Bearer $PRGD_AGENT_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${body}'`,
        javascript: `const res = await fetch("${endpoint}", {\n  method: "POST",\n  headers: {\n    Authorization: \`Bearer \${process.env.PRGD_AGENT_KEY}\`,\n    "Content-Type": "application/json",\n  },\n  body: JSON.stringify(${JSON.stringify(sample)}),\n});\nconst run = await res.json();\nconsole.log(run.status, run.output);`,
        python: `import os\nimport requests\n\nres = requests.post(\n    "${endpoint}",\n    headers={"Authorization": f"Bearer {os.environ['PRGD_AGENT_KEY']}"},\n    json=${JSON.stringify(sample).replace(/"/g, '"')},\n    timeout=90,\n)\nrun = res.json()\nprint(run["status"], run.get("output"))`,
        php: `<?php\n$ch = curl_init("${endpoint}");\ncurl_setopt_array($ch, [\n    CURLOPT_POST => true,\n    CURLOPT_RETURNTRANSFER => true,\n    CURLOPT_HTTPHEADER => [\n        "Authorization: Bearer " . getenv("PRGD_AGENT_KEY"),\n        "Content-Type: application/json",\n    ],\n    CURLOPT_POSTFIELDS => json_encode(["input" => ["message" => "Hello"]]),\n    CURLOPT_TIMEOUT => 90,\n]);\n$run = json_decode(curl_exec($ch), true);\necho $run["status"];`,
      },
    };
  }
}
