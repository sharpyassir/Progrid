import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentActor, Public, RequireScopes } from '../../common/auth/decorators';
import type { Actor } from '../../common/auth/actor';
import { readCookie } from '../../common/auth/auth.guard';
import { ApiError } from '../../common/errors/api-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TokenService } from '../iam/token.service';
import { AgentsService } from './agents.service';
import { AgentPartsService } from './parts.service';
import { ConnectionsService } from './connections.service';
import { GenerateService } from './generate.service';
import { RunsService } from './runs.service';
import { ConnectUsageService } from './usage.service';
import { ModelService } from './models/model.service';
import { RunEvents } from './runtime/run-events.service';
import { presentStep } from './runtime/run.service';
import { presentRun } from './present';
import { TEMPLATES } from './templates';
import {
  CreateAgentDto, CreateConnectionDto, CreateKeyDto, CreateToolDto, CreateVersionDto, CreateWebhookDto, DeployDto, FromDraftDto, GenerateDto,
  ListRunsQuery, LogsQuery, PutWorkflowDto, SetVariableDto, TestRunDto, TestToolDto, UpdateAgentDto, UpdateConnectionDto, UpdateToolDto, UpdateWebhookDto, UsageQuery,
} from './dto';

/** Progrid Connect console API (session or API token with connect:read / connect:write). */
@ApiTags('connect')
@ApiBearerAuth()
@Controller('v1/connect')
export class ConnectController {
  constructor(
    private readonly agents: AgentsService,
    private readonly parts: AgentPartsService,
    private readonly connections: ConnectionsService,
    private readonly generator: GenerateService,
    private readonly runs: RunsService,
    private readonly usage: ConnectUsageService,
    private readonly models: ModelService,
    private readonly events: RunEvents,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('overview') @RequireScopes('connect:read')
  overview(@CurrentActor() actor: Actor) {
    return this.runs.overview(actor);
  }

  @Get('models') @RequireScopes('connect:read')
  listModels() {
    return this.models.list();
  }

  @Get('templates') @RequireScopes('connect:read')
  templates() {
    return { data: TEMPLATES };
  }

  // ───────────── agents ─────────────

  @Post('agents') @RequireScopes('connect:write') @HttpCode(201)
  create(@CurrentActor() actor: Actor, @Body() dto: CreateAgentDto) {
    return this.agents.create(actor, dto);
  }

  /** Build with AI: a draft from a description. Nothing is saved. */
  @Post('agents/generate') @RequireScopes('connect:write') @HttpCode(200)
  generate(@CurrentActor() actor: Actor, @Body() dto: GenerateDto) {
    return this.generator.generate(actor, dto.prompt);
  }

  @Post('agents/from-draft') @RequireScopes('connect:write') @HttpCode(201)
  fromDraft(@CurrentActor() actor: Actor, @Body() dto: FromDraftDto) {
    return this.agents.createFromBlueprint(actor, dto.draft, dto.connections ?? {});
  }

  @Get('agents') @RequireScopes('connect:read')
  list(@CurrentActor() actor: Actor) {
    return this.agents.list(actor);
  }

  @Get('agents/:id') @RequireScopes('connect:read')
  get(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.agents.detail(actor, id);
  }

  @Patch('agents/:id') @RequireScopes('connect:write')
  update(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: UpdateAgentDto) {
    return this.agents.update(actor, id, dto);
  }

  @Delete('agents/:id') @RequireScopes('connect:write') @HttpCode(204)
  async remove(@CurrentActor() actor: Actor, @Param('id') id: string) {
    await this.agents.remove(actor, id);
  }

  @Put('agents/:id/variables/:key') @RequireScopes('connect:write')
  setVariable(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('key') key: string, @Body() dto: SetVariableDto) {
    return this.agents.setVariable(actor, id, key, dto.value);
  }

  @Get('agents/:id/versions') @RequireScopes('connect:read')
  versions(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.agents.versions(actor, id);
  }

  @Post('agents/:id/versions') @RequireScopes('connect:write') @HttpCode(201)
  createVersion(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: CreateVersionDto) {
    return this.agents.createVersion(actor, id, dto.note ?? '');
  }

  @Post('agents/:id/deploy') @RequireScopes('connect:write') @HttpCode(200)
  deploy(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: DeployDto) {
    return this.agents.deploy(actor, id, dto.version);
  }

  @Post('agents/:id/pause') @RequireScopes('connect:write') @HttpCode(200)
  pause(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.agents.pause(actor, id);
  }

  /** Synchronous test run (up to 120 s) with the full step timeline. */
  @Post('agents/:id/test') @RequireScopes('connect:write') @HttpCode(200)
  test(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: TestRunDto) {
    return this.runs.test(actor, id, dto);
  }

  @Get('agents/:id/runs') @RequireScopes('connect:read')
  agentRuns(@CurrentActor() actor: Actor, @Param('id') id: string, @Query() q: ListRunsQuery) {
    return this.runs.list(actor, id, q);
  }

  @Get('agents/:id/docs') @RequireScopes('connect:read')
  docs(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.agents.docs(actor, id);
  }

  // ───────────── tools ─────────────

  @Get('agents/:id/tools') @RequireScopes('connect:read')
  tools(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.parts.listTools(actor, id);
  }

  @Post('agents/:id/tools') @RequireScopes('connect:write') @HttpCode(201)
  createTool(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: CreateToolDto) {
    return this.parts.createTool(actor, id, dto);
  }

  @Patch('agents/:id/tools/:toolId') @RequireScopes('connect:write')
  updateTool(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('toolId') toolId: string, @Body() dto: UpdateToolDto) {
    return this.parts.updateTool(actor, id, toolId, dto);
  }

  @Delete('agents/:id/tools/:toolId') @RequireScopes('connect:write') @HttpCode(204)
  async deleteTool(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('toolId') toolId: string) {
    await this.parts.deleteTool(actor, id, toolId);
  }

  @Post('agents/:id/tools/:toolId/test') @RequireScopes('connect:write') @HttpCode(200)
  testTool(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('toolId') toolId: string, @Body() dto: TestToolDto) {
    return this.runs.testTool(actor, id, toolId, dto.input);
  }

  // ───────────── workflow ─────────────

  @Get('agents/:id/workflow') @RequireScopes('connect:read')
  workflow(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.parts.getWorkflow(actor, id);
  }

  @Put('agents/:id/workflow') @RequireScopes('connect:write')
  putWorkflow(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: PutWorkflowDto) {
    return this.parts.putWorkflow(actor, id, dto.graph);
  }

  // ───────────── webhooks ─────────────

  @Get('agents/:id/webhooks') @RequireScopes('connect:read')
  webhooks(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.parts.listWebhooks(actor, id);
  }

  @Post('agents/:id/webhooks') @RequireScopes('connect:write') @HttpCode(201)
  createWebhook(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: CreateWebhookDto) {
    return this.parts.createWebhook(actor, id, dto);
  }

  @Patch('agents/:id/webhooks/:hookId') @RequireScopes('connect:write')
  updateWebhook(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('hookId') hookId: string, @Body() dto: UpdateWebhookDto) {
    return this.parts.updateWebhook(actor, id, hookId, dto);
  }

  @Delete('agents/:id/webhooks/:hookId') @RequireScopes('connect:write') @HttpCode(204)
  async deleteWebhook(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('hookId') hookId: string) {
    await this.parts.deleteWebhook(actor, id, hookId);
  }

  @Post('agents/:id/webhooks/:hookId/rotate') @RequireScopes('connect:write') @HttpCode(200)
  rotateWebhook(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('hookId') hookId: string) {
    return this.parts.rotateWebhook(actor, id, hookId);
  }

  // ───────────── keys ─────────────

  @Get('agents/:id/keys') @RequireScopes('connect:read')
  keys(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.parts.listKeys(actor, id);
  }

  @Post('agents/:id/keys') @RequireScopes('connect:write') @HttpCode(201)
  createKey(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: CreateKeyDto) {
    return this.parts.createKey(actor, id, dto);
  }

  @Delete('agents/:id/keys/:keyId') @RequireScopes('connect:write') @HttpCode(204)
  async revokeKey(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('keyId') keyId: string) {
    await this.parts.revokeKey(actor, id, keyId);
  }

  // ───────────── cross-agent lists ─────────────

  @Get('webhooks') @RequireScopes('connect:read')
  allWebhooks(@CurrentActor() actor: Actor) {
    return this.parts.listAllWebhooks(actor);
  }

  @Get('keys') @RequireScopes('connect:read')
  allKeys(@CurrentActor() actor: Actor) {
    return this.parts.listAllKeys(actor);
  }

  // ───────────── runs and logs ─────────────

  @Get('runs/:runId') @RequireScopes('connect:read')
  run(@CurrentActor() actor: Actor, @Param('runId') runId: string) {
    return this.runs.get(actor, runId);
  }

  @Post('runs/:runId/cancel') @RequireScopes('connect:write') @HttpCode(200)
  cancel(@CurrentActor() actor: Actor, @Param('runId') runId: string) {
    return this.runs.cancel(actor, runId);
  }

  /**
   * Server Sent Events of a run: `event: step` (RunStep), `event: run` (Run, on every status
   * change) and a final `event: end`, with a heartbeat comment every 15 s. Authenticated with
   * the normal Authorization header (the console reads the stream with fetch); the console
   * session cookie also works for same site EventSource use.
   */
  @Public()
  @Get('runs/:runId/events')
  async runEvents(@Param('runId') runId: string, @Req() req: Request, @Res() res: Response) {
    const header = req.headers.authorization ?? '';
    const [scheme, bearer] = header.split(' ');
    const credential = (scheme?.toLowerCase() === 'bearer' ? bearer : undefined) ?? readCookie(req.headers.cookie, 'prgd_session');
    const actor = credential ? await this.tokens.resolveBearer(credential) : null;
    if (!actor) throw ApiError.unauthorized();
    if (!actor.scopes.has('connect:read')) throw ApiError.forbidden('Token is missing required scope(s): connect:read');
    const run = await this.prisma.connectRun.findFirst({ where: { id: runId, teamId: actor.teamId }, include: { agent: { select: { name: true } } } });
    if (!run) throw ApiError.notFound('run', runId);

    res.status(200);
    res.setHeader('content-type', 'text/event-stream');
    res.setHeader('cache-control', 'no-cache, no-transform');
    res.setHeader('connection', 'keep-alive');
    res.setHeader('x-accel-buffering', 'no');
    res.flushHeaders();
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const terminal = (s: string) => ['succeeded', 'failed', 'cancelled'].includes(s);
    const agentName = run.agent.name;
    const fullRun = async () => {
      const r = await this.prisma.connectRun.findUnique({ where: { id: runId } });
      return r ? presentRun(r, { agentName }) : null;
    };

    let closed = false;
    let unsubscribe: (() => Promise<void>) | undefined;
    const ping = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
    const close = async () => {
      if (closed) return;
      closed = true;
      clearInterval(ping);
      await unsubscribe?.();
      res.end();
    };
    const finish = async () => {
      if (closed) return;
      send('end', { runId });
      await close();
    };
    req.on('close', () => void close());

    // Subscribe first, then replay what already happened, so nothing falls in between.
    const seen = new Set<string>();
    let lastStatus = '';
    unsubscribe = await this.events.subscribe(runId, (e) => {
      if (closed) return;
      if (e.type === 'step') {
        const step = e.step as { id: string };
        if (seen.has(step.id)) return;
        seen.add(step.id);
        send('step', step);
      } else if (e.type === 'run') {
        void fullRun().then(async (r) => {
          if (!r || closed || r.status === lastStatus) return;
          lastStatus = r.status;
          send('run', r);
          if (terminal(r.status)) await finish();
        });
      }
    });
    lastStatus = run.status;
    send('run', presentRun(run, { agentName }));
    for (const s of await this.prisma.connectRunStep.findMany({ where: { runId }, orderBy: { index: 'asc' } })) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      send('step', presentStep(s));
    }
    const now = await fullRun();
    if (now && now.status !== lastStatus) {
      lastStatus = now.status;
      send('run', now);
    }
    if (now && terminal(now.status)) await finish();
  }

  @Get('logs') @RequireScopes('connect:read')
  logs(@CurrentActor() actor: Actor, @Query() q: LogsQuery) {
    return this.runs.logs(actor, q);
  }

  @Get('usage') @RequireScopes('connect:read')
  usageReport(@CurrentActor() actor: Actor, @Query() q: UsageQuery) {
    return this.usage.usage(actor, q.period);
  }

  // ───────────── connections ─────────────

  @Get('connections') @RequireScopes('connect:read')
  listConnections(@CurrentActor() actor: Actor) {
    return this.connections.list(actor);
  }

  @Post('connections') @RequireScopes('connect:write') @HttpCode(201)
  createConnection(@CurrentActor() actor: Actor, @Body() dto: CreateConnectionDto) {
    return this.connections.create(actor, dto);
  }

  @Get('connections/:id') @RequireScopes('connect:read')
  getConnection(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.connections.get(actor, id);
  }

  @Patch('connections/:id') @RequireScopes('connect:write')
  updateConnection(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: UpdateConnectionDto) {
    return this.connections.update(actor, id, dto);
  }

  @Delete('connections/:id') @RequireScopes('connect:write') @HttpCode(204)
  async deleteConnection(@CurrentActor() actor: Actor, @Param('id') id: string) {
    await this.connections.remove(actor, id);
  }

  @Post('connections/:id/test') @RequireScopes('connect:write') @HttpCode(200)
  testConnection(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.connections.test(actor, id);
  }
}
