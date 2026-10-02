import type { PrismaService } from '../../../common/prisma/prisma.service';
import type { Actor } from '../../../common/auth/actor';
import { ToolError, type ToolExecutor } from './types';

/**
 * progrid: the team's own Progrid resources, called as the run's team (the agent creator's
 * membership, limited to the agent's project). Read actions run directly. Mutating actions are
 * marked `destructive` and ALWAYS go through the approvals queue first, whatever the tool's
 * requiresApproval says; they run only with ctx.approved set by the approval executor.
 */

export interface ProgridDeps {
  prisma: PrismaService;
  serverAction(actor: Actor, serverId: string, dto: { type: 'start' | 'stop' | 'reboot'; force?: boolean }): Promise<unknown>;
  serverMetrics(actor: Actor, serverId: string, period: '1h' | '6h' | '24h' | '7d' | '30d'): Promise<unknown>;
  appLogs(actor: Actor, appId: string, type: 'build' | 'runtime'): Promise<unknown>;
  createTicket(actor: Actor, dto: { subject: string; body: string; priority?: 'low' | 'normal' | 'high' | 'urgent' }): Promise<unknown>;
}

interface ActionDef {
  description: string;
  destructive: boolean;
  input: Record<string, unknown>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });

export const PROGRID_ACTIONS: Record<string, ActionDef> = {
  list_servers: { description: 'List the servers in the project with status, size and addresses.', destructive: false, input: obj({}) },
  server_metrics: { description: 'CPU, memory, disk and network metrics of one server.', destructive: false, input: obj({ serverId: { type: 'string' }, period: { type: 'string', enum: ['1h', '6h', '24h', '7d', '30d'] } }, ['serverId']) },
  server_power: { description: 'Start, stop or reboot a server. Always needs a person to approve.', destructive: true, input: obj({ serverId: { type: 'string' }, op: { type: 'string', enum: ['start', 'stop', 'reboot'] } }, ['serverId', 'op']) },
  list_databases: { description: 'List the managed databases in the project.', destructive: false, input: obj({}) },
  database_status: { description: 'Status, engine, version and nodes of one managed database.', destructive: false, input: obj({ databaseId: { type: 'string' } }, ['databaseId']) },
  list_buckets: { description: 'List the object storage buckets in the project with size.', destructive: false, input: obj({}) },
  list_apps: { description: 'List the App Platform apps in the project.', destructive: false, input: obj({}) },
  app_logs: { description: 'Recent build or runtime logs of one app.', destructive: false, input: obj({ appId: { type: 'string' }, type: { type: 'string', enum: ['build', 'runtime'] } }, ['appId']) },
  create_ticket: { description: 'Open a support ticket for the team.', destructive: false, input: obj({ subject: { type: 'string' }, body: { type: 'string' }, priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] } }, ['subject', 'body']) },
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function progridExecutor(deps: ProgridDeps): ToolExecutor {
  const { prisma } = deps;
  return {
    kind: 'progrid',
    connectionKinds: [],
    connectionRequired: false,
    configSchema: { type: 'object', properties: { action: { enum: Object.keys(PROGRID_ACTIONS) } }, required: ['action'] },
    defaultInputSchema(config) {
      return PROGRID_ACTIONS[String(config.action)]?.input ?? obj({});
    },
    needsApproval(config) {
      return !!PROGRID_ACTIONS[String(config.action)]?.destructive;
    },
    summarize(config, input) {
      const i = isObj(input) ? input : {};
      if (config.action === 'server_power') return `${String(i.op ?? 'change power of')} server ${String(i.serverId ?? '')}`;
      return `${String(config.action)} ${JSON.stringify(i).slice(0, 160)}`;
    },
    async execute(input, config, ctx) {
      const action = String(config.action);
      const def = PROGRID_ACTIONS[action];
      if (!def) throw new ToolError(`unknown Progrid action ${action}`);
      if (def.destructive && !ctx.approved) throw new ToolError(`${action} needs a person to approve it first`, 'approval_required');
      const i = isObj(input) ? input : {};
      const project = { id: ctx.projectId, teamId: ctx.teamId };
      switch (action) {
        case 'list_servers': {
          const rows = await prisma.server.findMany({ where: { projectId: project.id, project: { teamId: project.teamId }, deletedAt: null, managedBy: null }, select: { id: true, name: true, status: true, regionId: true, sizeId: true, vcpu: true, memoryMb: true, diskGb: true, privateIp: true, tags: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 200 });
          return { servers: rows };
        }
        case 'server_metrics':
          return deps.serverMetrics(ctx.actor, String(i.serverId), (i.period as '1h') ?? '1h');
        case 'server_power': {
          const op = String(i.op);
          if (!['start', 'stop', 'reboot'].includes(op)) throw new ToolError('op must be start, stop or reboot');
          const server = await prisma.server.findFirst({ where: { id: String(i.serverId), projectId: project.id, deletedAt: null } });
          if (!server) throw new ToolError(`server ${String(i.serverId)} not found in this project`);
          await deps.serverAction(ctx.actor, server.id, { type: op as 'start' });
          return { serverId: server.id, op, accepted: true };
        }
        case 'list_databases': {
          const rows = await prisma.dbCluster.findMany({ where: { projectId: project.id, deletedAt: null }, select: { id: true, name: true, engine: true, version: true, status: true, nodes: true, sizeId: true, createdAt: true }, take: 200 });
          return { databases: rows };
        }
        case 'database_status': {
          const db = await prisma.dbCluster.findFirst({ where: { id: String(i.databaseId), projectId: project.id, deletedAt: null }, select: { id: true, name: true, engine: true, version: true, status: true, statusMessage: true, nodes: true, port: true, sizeId: true, publicIp: { select: { address: true } } } });
          if (!db) throw new ToolError(`database ${String(i.databaseId)} not found in this project`);
          return db;
        }
        case 'list_buckets': {
          const rows = await prisma.bucket.findMany({ where: { projectId: project.id, deletedAt: null }, select: { id: true, name: true, status: true, public: true, sizeBytes: true, objectCount: true, createdAt: true }, take: 200 });
          return { buckets: rows.map((b) => ({ ...b, sizeBytes: Number(b.sizeBytes) })) };
        }
        case 'list_apps': {
          const rows = await prisma.platformApp.findMany({ where: { projectId: project.id, deletedAt: null }, select: { id: true, name: true, slug: true, status: true, size: true, instances: true, createdAt: true }, take: 200 });
          return { apps: rows };
        }
        case 'app_logs':
          return deps.appLogs(ctx.actor, String(i.appId), i.type === 'runtime' ? 'runtime' : 'build');
        case 'create_ticket':
          return deps.createTicket(ctx.actor, { subject: String(i.subject ?? '').slice(0, 140), body: String(i.body ?? ''), priority: (i.priority as 'normal') ?? 'normal' });
      }
      throw new ToolError(`unknown Progrid action ${action}`);
    },
  };
}
