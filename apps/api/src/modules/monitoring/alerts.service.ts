import { Injectable, Logger } from '@nestjs/common';
import { NatsService, Subjects } from '../../common/nats/nats.service';
import type { AlertMetric, AlertPolicy } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MailService } from '../../common/mail/mail.service';
import { EventsService } from '../events/events.service';
import { ApiError } from '../../common/errors/api-error';
import { loadConfig } from '../../config/config';
import type { Actor } from '../../common/auth/actor';
import { CreateAlertDto, EVENT_METRICS, UpdateAlertDto } from './monitoring.dto';

const UNIT: Record<AlertMetric, string> = { cpu: '%', memory: '%', disk: '%', net_in: 'Mbps', net_out: 'Mbps', db_node_unreachable: '', app_deploy_failed: '' };
const LABEL: Record<AlertMetric, string> = { cpu: 'CPU', memory: 'Memory', disk: 'Disk', net_in: 'Inbound bandwidth', net_out: 'Outbound bandwidth', db_node_unreachable: 'Database node unreachable', app_deploy_failed: 'App deploy failed' };
const isEventMetric = (m: AlertMetric) => (EVENT_METRICS as readonly string[]).includes(m);

/** Events that open (or close) incidents of the event based metrics. */
const EVENT_EDGES: Record<string, { metric: AlertMetric; edge: 'triggered' | 'resolved' }> = {
  'database.node_unreachable': { metric: 'db_node_unreachable', edge: 'triggered' },
  'database.node_recovered': { metric: 'db_node_unreachable', edge: 'resolved' },
  'app.deploy_failed': { metric: 'app_deploy_failed', edge: 'triggered' },
  'app.deployed': { metric: 'app_deploy_failed', edge: 'resolved' },
  'app.created': { metric: 'app_deploy_failed', edge: 'resolved' },
};

/**
 * Resource alerts: a rule says "metric above threshold for N minutes on these servers".
 * The evaluator runs every minute, averages the window, opens an incident once and resolves
 * it once, and notifies by email and webhook on both edges.
 */
@Injectable()
export class AlertsService {
  private readonly log = new Logger(AlertsService.name);

  constructor(private readonly prisma: PrismaService, private readonly mail: MailService, private readonly events: EventsService, private readonly nats: NatsService) {}

  /** Event based alerts ride on the internal event fan out: database node outages and failed app deploys. */
  listen() {
    for (const name of Object.keys(EVENT_EDGES)) {
      this.nats.subscribe<{ name: string; teamId?: string; payload: Record<string, unknown> }>(Subjects.event(name), (e) => this.onEvent(e.name, e.teamId, e.payload ?? {}).catch((err) => this.log.warn(`alert for ${name}: ${(err as Error).message}`)));
    }
  }

  /** Opens an incident per matching policy on the triggering edge, resolves it on the other. */
  async onEvent(name: string, teamId: string | undefined, payload: Record<string, unknown>) {
    const rule = EVENT_EDGES[name];
    if (!rule || !teamId) return;
    const db = rule.metric === 'db_node_unreachable';
    const subject = db
      ? { id: String(payload.serverId ?? ''), name: `node ${String(payload.node ?? '?')} of database ${String(payload.name ?? payload.databaseId ?? '')}`, url: `${loadConfig().CONSOLE_URL}/databases/${String(payload.databaseId ?? '')}` }
      : { id: String(payload.appId ?? ''), name: `app ${String(payload.name ?? payload.appId ?? '')}`, url: `${loadConfig().CONSOLE_URL}/apps/${String(payload.appId ?? '')}` };
    if (!subject.id) return;
    const policies = await this.prisma.alertPolicy.findMany({ where: { teamId, enabled: true, metric: rule.metric } });
    for (const policy of policies) {
      const open = await this.prisma.alertIncident.findFirst({ where: { policyId: policy.id, serverId: subject.id, resolvedAt: null } });
      if (rule.edge === 'triggered' && !open) {
        const inc = await this.prisma.alertIncident.create({ data: { policyId: policy.id, teamId, serverId: subject.id, value: 1, peakValue: 1 } });
        const detail = db ? `has not answered for more than five minutes` : `failed to deploy${payload.error || payload.message ? `: ${String(payload.error ?? payload.message).slice(0, 300)}` : ''}`;
        await this.notify(policy, subject, 1, 'triggered', inc.id, { summary: `${subject.name} ${detail}`, url: subject.url });
      } else if (rule.edge === 'resolved' && open) {
        await this.prisma.alertIncident.update({ where: { id: open.id }, data: { resolvedAt: new Date(), value: 0 } });
        await this.notify(policy, subject, 0, 'resolved', open.id, { summary: db ? `${subject.name} is reachable again` : `${subject.name} deployed successfully`, url: subject.url });
      }
    }
  }

  list(actor: Actor) {
    return this.prisma.alertPolicy.findMany({ where: { teamId: actor.teamId }, include: { _count: { select: { incidents: { where: { resolvedAt: null } } } } }, orderBy: { createdAt: 'desc' } });
  }

  async get(actor: Actor, id: string) {
    const p = await this.prisma.alertPolicy.findFirst({ where: { id, teamId: actor.teamId }, include: { incidents: { orderBy: { startedAt: 'desc' }, take: 20 } } });
    if (!p) throw ApiError.notFound('alert', id);
    return p;
  }

  async create(actor: Actor, dto: CreateAlertDto) {
    await this.checkServers(actor, dto.serverIds ?? []);
    const p = await this.prisma.alertPolicy.create({ data: { teamId: actor.teamId, name: dto.name, metric: dto.metric, comparator: dto.comparator ?? 'above', threshold: dto.threshold, windowMinutes: dto.windowMinutes ?? 5, serverIds: dto.serverIds ?? [], tags: dto.tags ?? [], emails: dto.emails ?? [], enabled: dto.enabled ?? true } });
    await this.events.emit('alert.created', { alertId: p.id, metric: p.metric, threshold: p.threshold }, { actor, resource: `alert:${p.id}` });
    return p;
  }

  async update(actor: Actor, id: string, dto: UpdateAlertDto) {
    await this.get(actor, id);
    if (dto.serverIds) await this.checkServers(actor, dto.serverIds);
    const p = await this.prisma.alertPolicy.update({ where: { id }, data: { ...dto } });
    await this.events.emit('alert.updated', { alertId: id }, { actor, resource: `alert:${id}` });
    return p;
  }

  async remove(actor: Actor, id: string) {
    await this.get(actor, id);
    await this.prisma.alertPolicy.delete({ where: { id } });
    await this.events.emit('alert.deleted', { alertId: id }, { actor, resource: `alert:${id}` });
  }

  incidents(actor: Actor, open?: boolean) {
    return this.prisma.alertIncident.findMany({ where: { teamId: actor.teamId, ...(open ? { resolvedAt: null } : {}) }, include: { policy: { select: { name: true, metric: true, comparator: true, threshold: true, windowMinutes: true } } }, orderBy: { startedAt: 'desc' }, take: 100 });
  }

  /** Every minute: evaluate every enabled policy against the last window of samples. */
  async evaluate(now = new Date()) {
    const policies = (await this.prisma.alertPolicy.findMany({ where: { enabled: true } })).filter((p) => !isEventMetric(p.metric));
    let opened = 0, resolved = 0;
    for (const policy of policies) {
      const servers = await this.targets(policy);
      const from = new Date(now.getTime() - policy.windowMinutes * 60_000);
      for (const s of servers) {
        const value = await this.windowValue(policy.metric, s.id, from);
        if (value === null) continue; // no samples in the window: neither fire nor resolve
        const firing = policy.comparator === 'above' ? value > policy.threshold : value < policy.threshold;
        const open = await this.prisma.alertIncident.findFirst({ where: { policyId: policy.id, serverId: s.id, resolvedAt: null } });
        if (firing && !open) {
          const inc = await this.prisma.alertIncident.create({ data: { policyId: policy.id, teamId: policy.teamId, serverId: s.id, value, peakValue: value } });
          opened++;
          await this.notify(policy, s, value, 'triggered', inc.id);
        } else if (firing && open) {
          if (value > open.peakValue) await this.prisma.alertIncident.update({ where: { id: open.id }, data: { peakValue: value, value } });
        } else if (!firing && open) {
          await this.prisma.alertIncident.update({ where: { id: open.id }, data: { resolvedAt: now, value } });
          resolved++;
          await this.notify(policy, s, value, 'resolved', open.id);
        }
      }
    }
    if (opened || resolved) this.log.log(`alerts: ${opened} opened, ${resolved} resolved`);
    return { opened, resolved };
  }

  /** Servers a policy applies to: explicit ids, tags, or the whole team when both are empty. */
  private async targets(policy: AlertPolicy) {
    return this.prisma.server.findMany({
      where: {
        deletedAt: null, project: { teamId: policy.teamId },
        ...(policy.serverIds.length || policy.tags.length ? { OR: [{ id: { in: policy.serverIds } }, ...(policy.tags.length ? [{ tags: { hasSome: policy.tags } }] : [])] } : {}),
      },
      select: { id: true, name: true, projectId: true },
    });
  }

  private async windowValue(metric: AlertMetric, serverId: string, from: Date): Promise<number | null> {
    const agg = await this.prisma.metricSample.aggregate({ where: { serverId, at: { gte: from } }, _avg: { cpuPercent: true, memoryUsedMb: true, memoryTotalMb: true, netInBps: true, netOutBps: true, diskUsedPercent: true }, _count: true });
    if (!agg._count) return null;
    const a = agg._avg;
    switch (metric) {
      case 'cpu': return round(a.cpuPercent ?? 0);
      case 'memory': return a.memoryTotalMb ? round(((a.memoryUsedMb ?? 0) / a.memoryTotalMb) * 100) : null;
      case 'disk': return a.diskUsedPercent == null ? null : round(a.diskUsedPercent);
      case 'net_in': return round(((a.netInBps ?? 0) * 8) / 1e6);
      case 'net_out': return round(((a.netOutBps ?? 0) * 8) / 1e6);
      default: return null; // event based metrics have no samples
    }
  }

  private async checkServers(actor: Actor, ids: string[]) {
    if (!ids.length) return;
    const n = await this.prisma.server.count({ where: { id: { in: ids }, deletedAt: null, project: { teamId: actor.teamId } } });
    if (n !== ids.length) throw ApiError.invalid('One or more serverIds do not belong to this team');
  }

  private async notify(policy: AlertPolicy, server: { id: string; name: string }, value: number, edge: 'triggered' | 'resolved', incidentId: string, text?: { summary: string; url: string }) {
    const summary = text?.summary ?? `${LABEL[policy.metric]} on ${server.name} is ${value}${UNIT[policy.metric]} (${policy.comparator} ${policy.threshold}${UNIT[policy.metric]} for ${policy.windowMinutes} min)`;
    await this.events.emit(`alert.${edge}`, { alertId: policy.id, incidentId, name: policy.name, serverId: server.id, serverName: server.name, metric: policy.metric, value, threshold: policy.threshold, summary }, { teamId: policy.teamId, resource: `server:${server.id}` });
    const owners = await this.prisma.teamMember.findMany({ where: { teamId: policy.teamId, role: { in: ['owner', 'admin'] } }, include: { user: { select: { email: true, name: true } } } });
    const to = new Set([...owners.map((m) => m.user.email), ...policy.emails]);
    const url = text?.url ?? `${loadConfig().CONSOLE_URL}/servers/${server.id}`;
    await Promise.all([...to].map((email) => this.mail.send({
      to: email,
      subject: `${edge === 'triggered' ? 'Alert' : 'Resolved'}: ${policy.name} on ${server.name}`,
      text: edge === 'triggered'
        ? `${summary}.\n\n${text ? 'Details' : 'Open the server'}:\n${url}\n\nYou get one email when an alert starts and one when it ends. Edit or mute the rule under Core Cloud, Monitoring.`
        : text
          ? `${policy.name}: ${summary}.\n\n${url}`
          : `${policy.name} on ${server.name} is back within limits: ${LABEL[policy.metric]} is now ${value}${UNIT[policy.metric]}.\n\n${url}`,
    }).catch((e) => this.log.warn(`alert mail to ${email} failed: ${e.message}`))));
  }
}

const round = (n: number) => Math.round(n * 100) / 100;
