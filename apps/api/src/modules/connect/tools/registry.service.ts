import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { MailService } from '../../../common/mail/mail.service';
import { RedisService } from '../../../common/redis/redis.service';
import { loadConfig } from '../../../config/config';
import { EventsService } from '../../events/events.service';
import { ServersService } from '../../compute/servers.service';
import { MetricsService } from '../../monitoring/metrics.service';
import { AppPlatformService } from '../../app-platform/app.service';
import { SupportService } from '../../support/support.service';
import { makePolicy, type NetPolicy } from '../net/guard';
import { httpRequestExecutor, webhookOutExecutor } from './http.executor';
import { databaseExecutor, type DbDeps } from './database.executor';
import { notifyExecutor, sendEmailExecutor, type MessagingDeps } from './messaging.executor';
import { progridExecutor } from './progrid.executor';
import { isStrictCompatible, schemaErrors } from './schema';
import type { ToolExecutor } from './types';
import type { ToolSpec } from '../runtime/spec';
import type { ModelTool } from '../models/provider';

/**
 * ToolExecutor registry keyed by tool kind. To add a kind: write one executor (config schema,
 * default input schema, execute) and register it here; add the kind to the ConnectToolKind enum.
 */
@Injectable()
export class ToolRegistry {
  private readonly executors = new Map<string, ToolExecutor>();
  readonly policy: NetPolicy;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly redis: RedisService,
    private readonly events: EventsService,
    private readonly servers: ServersService,
    private readonly metrics: MetricsService,
    private readonly apps: AppPlatformService,
    private readonly support: SupportService,
  ) {
    this.policy = makePolicy(loadConfig().CONNECT_NETWORK_ALLOWLIST);
    const dbDeps: DbDeps = { isManagedHost: (teamId, host) => this.isManagedHost(teamId, host) };
    const msgDeps: MessagingDeps = {
      sendPlatformMail: (m) => this.mail.send(m),
      allowPlatformMail: (teamId) => this.redis.allow(`connect:mail:${teamId}`, loadConfig().CONNECT_PLATFORM_EMAILS_PER_HOUR, 3600),
      consoleNotify: (teamId, payload) => this.events.emit('connect.notification', payload, { teamId, resource: `connect_agent:${String(payload.agentId)}` }),
    };
    for (const e of [
      httpRequestExecutor,
      webhookOutExecutor,
      databaseExecutor(dbDeps),
      sendEmailExecutor(msgDeps),
      notifyExecutor(msgDeps),
      progridExecutor({
        prisma: this.prisma,
        serverAction: (actor, id, dto) => this.servers.action(actor, id, dto),
        serverMetrics: (actor, id, period) => this.metrics.series(actor, id, period),
        appLogs: (actor, id, type) => this.apps.logs(actor, id, type),
        createTicket: (actor, dto) => this.support.create(actor, dto),
      }),
    ]) this.register(e);
  }

  register(e: ToolExecutor) {
    this.executors.set(e.kind, e);
  }

  get(kind: string): ToolExecutor | undefined {
    return this.executors.get(kind);
  }

  kinds() {
    return [...this.executors.keys()];
  }

  /** Problems with a tool's config for its kind, or null. */
  checkConfig(kind: string, config: unknown): string | null {
    const e = this.get(kind);
    if (!e) return `unknown tool kind ${kind}`;
    return schemaErrors(e.configSchema, config ?? {});
  }

  /** The schema the model gets: the tool's own, or the kind's default for its config. */
  inputSchemaOf(tool: Pick<ToolSpec, 'kind' | 'config' | 'inputSchema'>): Record<string, unknown> {
    const own = tool.inputSchema;
    const hasOwn = own && typeof own === 'object' && (Object.keys(own).length > 0);
    const schema = hasOwn ? own : this.get(tool.kind)?.defaultInputSchema(tool.config) ?? { type: 'object', properties: {} };
    return schema.type ? schema : { type: 'object', ...schema };
  }

  modelTool(tool: ToolSpec): ModelTool {
    const schema = this.inputSchemaOf(tool);
    return { name: tool.name, description: tool.description || `${tool.kind} tool`, input_schema: schema, strict: isStrictCompatible(schema) };
  }

  private async isManagedHost(teamId: string, host: string) {
    const h = host.trim().toLowerCase();
    const n = await this.prisma.dbCluster.count({ where: { deletedAt: null, project: { teamId }, publicIp: { address: h } } });
    return n > 0;
  }
}
