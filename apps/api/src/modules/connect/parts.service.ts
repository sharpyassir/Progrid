import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiError } from '../../common/errors/api-error';
import { seal } from '../../common/crypto/secretbox';
import type { Actor } from '../../common/auth/actor';
import { EventsService } from '../events/events.service';
import { AgentsService } from './agents.service';
import { ToolRegistry } from './tools/registry.service';
import { isValidSchema } from './tools/schema';
import { validateGraph } from './runtime/graph';
import { presentKey, presentTool, presentWebhook, presentWorkflow } from './present';
import type { CreateKeyDto, CreateToolDto, CreateWebhookDto, UpdateToolDto, UpdateWebhookDto } from './dto';

export const AGENT_KEY_PREFIX = 'prgd_ca_';
const MAX_TOOLS = 50;
const MAX_WEBHOOKS = 20;
const MAX_KEYS = 20;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Tools, workflow, inbound webhooks and run API keys of an agent. */
@Injectable()
export class AgentPartsService {
  constructor(private readonly prisma: PrismaService, private readonly events: EventsService, private readonly agents: AgentsService, private readonly registry: ToolRegistry) {}

  // ───────────── tools ─────────────

  async listTools(actor: Actor, agentId: string) {
    const a = await this.agents.own(actor, agentId);
    return { data: a.tools.map(presentTool) };
  }

  private async checkTool(actor: Actor, kind: string, config: Record<string, unknown>, inputSchema: Record<string, unknown> | undefined, connectionId: string | null | undefined) {
    const problem = this.registry.checkConfig(kind, config);
    if (problem) throw ApiError.invalid(`config: ${problem}`);
    if (inputSchema && Object.keys(inputSchema).length) {
      const err = isValidSchema(inputSchema);
      if (err) throw ApiError.invalid(`inputSchema: ${err}`);
      if (inputSchema.type !== undefined && inputSchema.type !== 'object') throw ApiError.invalid('inputSchema must describe an object (type: object)');
    }
    if (connectionId) {
      const c = await this.prisma.connectConnection.findFirst({ where: { id: connectionId, teamId: actor.teamId } });
      if (!c) throw ApiError.notFound('connection', connectionId);
      const e = this.registry.get(kind)!;
      if (!e.connectionKinds.includes(c.kind)) throw ApiError.invalid(`${kind} tools cannot use a ${c.kind} connection${e.connectionKinds.length ? ` (use ${e.connectionKinds.join(', ')})` : ''}`);
    }
  }

  async createTool(actor: Actor, agentId: string, dto: CreateToolDto) {
    const a = await this.agents.own(actor, agentId);
    if (a.tools.length >= MAX_TOOLS) throw ApiError.quota(`An agent can have ${MAX_TOOLS} tools`);
    if (a.tools.some((t) => t.name === dto.name)) throw ApiError.conflict('tool_name_taken', `This agent already has a tool named ${dto.name}`);
    const config = dto.config ?? {};
    await this.checkTool(actor, dto.kind, config, dto.inputSchema, dto.connectionId);
    const row = await this.prisma.connectTool.create({ data: { agentId, name: dto.name, description: dto.description ?? '', kind: dto.kind, connectionId: dto.connectionId || null, enabled: dto.enabled ?? true, requiresApproval: !!dto.requiresApproval, config: config as Prisma.InputJsonValue, inputSchema: (dto.inputSchema ?? {}) as Prisma.InputJsonValue } });
    await this.events.emit('connect.tool_created', { agentId, toolId: row.id, name: row.name, kind: row.kind }, { actor, resource: `connect_agent:${agentId}` });
    return presentTool(row);
  }

  async updateTool(actor: Actor, agentId: string, toolId: string, dto: UpdateToolDto) {
    const a = await this.agents.own(actor, agentId);
    const cur = a.tools.find((t) => t.id === toolId);
    if (!cur) throw ApiError.notFound('tool', toolId);
    if (dto.name && dto.name !== cur.name && a.tools.some((t) => t.name === dto.name)) throw ApiError.conflict('tool_name_taken', `This agent already has a tool named ${dto.name}`);
    const config = dto.config ?? (cur.config as Record<string, unknown>);
    const inputSchema = dto.inputSchema ?? (cur.inputSchema as Record<string, unknown>);
    const connectionId = dto.connectionId === undefined ? cur.connectionId : dto.connectionId || null;
    await this.checkTool(actor, cur.kind, config, inputSchema, connectionId);
    const row = await this.prisma.connectTool.update({
      where: { id: toolId },
      data: { name: dto.name, description: dto.description, connectionId, enabled: dto.enabled, requiresApproval: dto.requiresApproval, config: config as Prisma.InputJsonValue, inputSchema: inputSchema as Prisma.InputJsonValue },
    });
    await this.events.emit('connect.tool_updated', { agentId, toolId, fields: Object.keys(dto) }, { actor, resource: `connect_agent:${agentId}` });
    return presentTool(row);
  }

  async deleteTool(actor: Actor, agentId: string, toolId: string) {
    const a = await this.agents.own(actor, agentId);
    const cur = a.tools.find((t) => t.id === toolId);
    if (!cur) throw ApiError.notFound('tool', toolId);
    if (a.workflow) {
      const { issues } = validateGraph(a.workflow.graph, { toolIds: new Set(a.tools.filter((t) => t.id !== toolId).map((t) => t.id)) });
      if (issues.some((i) => i.message.includes(toolId))) throw ApiError.conflict('tool_in_use', `The workflow uses ${cur.name}; remove it from the workflow first`);
    }
    await this.prisma.connectTool.delete({ where: { id: toolId } });
    await this.events.emit('connect.tool_deleted', { agentId, toolId, name: cur.name }, { actor, resource: `connect_agent:${agentId}` });
  }

  // ───────────── workflow ─────────────

  async getWorkflow(actor: Actor, agentId: string) {
    await this.agents.own(actor, agentId);
    return presentWorkflow(await this.prisma.connectWorkflow.findUnique({ where: { agentId } }));
  }

  /** Saves a validated graph. An empty graph (no nodes) removes the workflow: the agent answers calls directly. */
  async putWorkflow(actor: Actor, agentId: string, raw: Record<string, unknown>) {
    const a = await this.agents.own(actor, agentId);
    if (Array.isArray(raw.nodes) && raw.nodes.length === 0) {
      await this.prisma.connectWorkflow.deleteMany({ where: { agentId } });
      await this.events.emit('connect.workflow_removed', { agentId }, { actor, resource: `connect_agent:${agentId}` });
      return null;
    }
    const { graph, issues } = validateGraph(raw, { toolIds: new Set(a.tools.map((t) => t.id)) });
    if (issues.length) throw ApiError.invalid('The workflow is not valid', { issues });
    const row = await this.prisma.connectWorkflow.upsert({ where: { agentId }, create: { agentId, graph: graph as unknown as Prisma.InputJsonValue }, update: { graph: graph as unknown as Prisma.InputJsonValue } });
    await this.events.emit('connect.workflow_saved', { agentId, nodes: graph.nodes.length, edges: graph.edges.length }, { actor, resource: `connect_agent:${agentId}` });
    return presentWorkflow(row);
  }

  // ───────────── webhooks ─────────────

  async listWebhooks(actor: Actor, agentId: string) {
    await this.agents.own(actor, agentId);
    const rows = await this.prisma.connectWebhook.findMany({ where: { agentId }, orderBy: { createdAt: 'asc' } });
    return { data: rows.map((h) => presentWebhook(h)) };
  }

  private newHookSecrets(signing: boolean) {
    const token = randomBytes(24).toString('base64url');
    const signingSecret = signing ? `whsec_${randomBytes(24).toString('base64url')}` : null;
    return { token, signingSecret };
  }

  async createWebhook(actor: Actor, agentId: string, dto: CreateWebhookDto) {
    await this.agents.own(actor, agentId);
    const n = await this.prisma.connectWebhook.count({ where: { agentId } });
    if (n >= MAX_WEBHOOKS) throw ApiError.quota(`An agent can have ${MAX_WEBHOOKS} webhooks`);
    const { token, signingSecret } = this.newHookSecrets(!!dto.signing);
    const row = await this.prisma.connectWebhook.create({
      data: { agentId, teamId: actor.teamId, name: dto.name, path: dto.path ?? (dto.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 63) || 'hook'), tokenHash: sha256(token), tokenHint: token.slice(-4), signingSecret: signingSecret ? seal(signingSecret) : null, enabled: dto.enabled ?? true },
    });
    await this.events.emit('connect.webhook_created', { agentId, webhookId: row.id, signing: !!signingSecret }, { actor, resource: `connect_agent:${agentId}` });
    // Shown exactly once.
    return { ...presentWebhook(row, token), token, ...(signingSecret ? { signingSecret } : {}) };
  }

  async updateWebhook(actor: Actor, agentId: string, hookId: string, dto: UpdateWebhookDto) {
    await this.agents.own(actor, agentId);
    const cur = await this.prisma.connectWebhook.findFirst({ where: { id: hookId, agentId } });
    if (!cur) throw ApiError.notFound('webhook', hookId);
    let signingSecret: string | null | undefined;
    if (dto.signing === true && !cur.signingSecret) signingSecret = this.newHookSecrets(true).signingSecret;
    if (dto.signing === false) signingSecret = null;
    const row = await this.prisma.connectWebhook.update({ where: { id: hookId }, data: { name: dto.name, path: dto.path, enabled: dto.enabled, ...(signingSecret !== undefined ? { signingSecret: signingSecret ? seal(signingSecret) : null } : {}) } });
    await this.events.emit('connect.webhook_updated', { agentId, webhookId: hookId, fields: Object.keys(dto) }, { actor, resource: `connect_agent:${agentId}` });
    return { ...presentWebhook(row), ...(signingSecret ? { signingSecret } : {}) };
  }

  async deleteWebhook(actor: Actor, agentId: string, hookId: string) {
    await this.agents.own(actor, agentId);
    const r = await this.prisma.connectWebhook.deleteMany({ where: { id: hookId, agentId } });
    if (!r.count) throw ApiError.notFound('webhook', hookId);
    await this.events.emit('connect.webhook_deleted', { agentId, webhookId: hookId }, { actor, resource: `connect_agent:${agentId}` });
  }

  /** New URL token (and signing secret when signing is on). The old ones stop working at once. */
  async rotateWebhook(actor: Actor, agentId: string, hookId: string) {
    await this.agents.own(actor, agentId);
    const cur = await this.prisma.connectWebhook.findFirst({ where: { id: hookId, agentId } });
    if (!cur) throw ApiError.notFound('webhook', hookId);
    const { token, signingSecret } = this.newHookSecrets(!!cur.signingSecret);
    const row = await this.prisma.connectWebhook.update({ where: { id: hookId }, data: { tokenHash: sha256(token), tokenHint: token.slice(-4), ...(signingSecret ? { signingSecret: seal(signingSecret) } : {}) } });
    await this.events.emit('connect.webhook_rotated', { agentId, webhookId: hookId }, { actor, resource: `connect_agent:${agentId}` });
    return { ...presentWebhook(row, token), token, ...(signingSecret ? { signingSecret } : {}) };
  }

  // ───────────── keys ─────────────

  async listKeys(actor: Actor, agentId: string) {
    await this.agents.own(actor, agentId);
    const rows = await this.prisma.connectAgentKey.findMany({ where: { agentId, revokedAt: null }, orderBy: { createdAt: 'asc' } });
    return { data: rows.map(presentKey) };
  }

  async createKey(actor: Actor, agentId: string, dto: CreateKeyDto) {
    await this.agents.own(actor, agentId);
    const n = await this.prisma.connectAgentKey.count({ where: { agentId, revokedAt: null } });
    if (n >= MAX_KEYS) throw ApiError.quota(`An agent can have ${MAX_KEYS} keys`);
    const secret = AGENT_KEY_PREFIX + randomBytes(32).toString('base64url');
    const row = await this.prisma.connectAgentKey.create({ data: { agentId, teamId: actor.teamId, name: dto.name, prefix: secret.slice(0, 12), hash: sha256(secret), createdById: actor.userId } });
    await this.events.emit('connect.key_created', { agentId, keyId: row.id, prefix: row.prefix }, { actor, resource: `connect_agent:${agentId}` });
    return { key: presentKey(row), secret };
  }

  async revokeKey(actor: Actor, agentId: string, keyId: string) {
    await this.agents.own(actor, agentId);
    const r = await this.prisma.connectAgentKey.updateMany({ where: { id: keyId, agentId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!r.count) throw ApiError.notFound('key', keyId);
    await this.events.emit('connect.key_revoked', { agentId, keyId }, { actor, resource: `connect_agent:${agentId}` });
  }
}
