import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Alert, type AlertSeverity, type ManagedAsset, type ManagedContract, type ManagedPlan } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ApiError } from '../../../common/errors/api-error';
import { cursorArgs, toPage } from '../../../common/pagination';
import type { Actor } from '../../../common/auth/actor';
import { loadConfig } from '../../../config/config';
import { EventsService } from '../../events/events.service';
import { ManagedTicketsService } from '../tickets/tickets.service';
import { PagingService, presentPage } from '../oncall/paging.service';
import { OnCallService } from '../oncall/oncall.service';
import { hashToken } from '../assets/assets.service';

/** Alertmanager webhook payload, version 4 (https://prometheus.io/docs/alerting/latest/configuration/#webhook_config). */
export const alertmanagerPayload = z.object({
  version: z.string().optional(),
  status: z.enum(['firing', 'resolved']).optional(),
  receiver: z.string().optional(),
  groupKey: z.string().optional(),
  alerts: z.array(z.object({
    status: z.enum(['firing', 'resolved']),
    labels: z.record(z.string()).default({}),
    annotations: z.record(z.string()).default({}),
    startsAt: z.string().optional(),
    endsAt: z.string().optional(),
    generatorURL: z.string().optional(),
    fingerprint: z.string().min(1),
  })).max(1000),
});
export type AlertmanagerPayload = z.infer<typeof alertmanagerPayload>;

export const heartbeatPayload = z.object({
  status: z.enum(['ok', 'degraded', 'critical']).default('ok'),
  hostname: z.string().max(255).optional(),
  agentVersion: z.string().max(64).optional(),
  uptimeSeconds: z.number().nonnegative().optional(),
  checks: z.record(z.unknown()).optional(),
}).passthrough();

type AssetWithContract = ManagedAsset & { contract: ManagedContract & { plan: ManagedPlan } };

export function presentAlert(a: Alert & { asset?: { id: string; name: string } | null }) {
  return {
    id: a.id, assetId: a.assetId, asset: a.asset ?? undefined, contractId: a.contractId, fingerprint: a.fingerprint, name: a.name, summary: a.summary, severity: a.severity, status: a.status, source: a.source,
    labels: a.labels, annotations: a.annotations, startsAt: a.startsAt, endsAt: a.endsAt, lastReceivedAt: a.lastReceivedAt, ticketId: a.ticketId,
    acknowledgedById: a.acknowledgedById, acknowledgedAt: a.acknowledgedAt, resolvedAt: a.resolvedAt, createdAt: a.createdAt, updatedAt: a.updatedAt,
  };
}

const SEVERITY: Record<string, AlertSeverity> = { critical: 'CRITICAL', page: 'CRITICAL', error: 'CRITICAL', warning: 'WARNING', warn: 'WARNING' };

/**
 * Alerts from Alertmanager and the heartbeat monitor. An alert is matched to a managed asset
 * by its `asset_id` label and deduplicated by fingerprint while open. CRITICAL opens a P1
 * ticket and pages the primary on call (escalating to the support lead without an ack);
 * WARNING opens a P3 ticket without paging; INFO is recorded only. A resolved alert closes
 * the Alert and adds a note to its ticket, which the engineer closes after the root cause.
 * Suspended contracts keep their alerts but get no tickets or pages.
 */
@Injectable()
export class ManagedAlertsService {
  private readonly log = new Logger(ManagedAlertsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly tickets: ManagedTicketsService,
    private readonly paging: PagingService,
    private readonly oncall: OnCallService,
  ) {}

  // ---- Alertmanager ----

  async ingest(raw: unknown) {
    const parsed = alertmanagerPayload.safeParse(raw);
    if (!parsed.success) throw ApiError.invalid('Not an Alertmanager webhook payload', { issues: parsed.error.issues.slice(0, 5) });
    const result = { received: parsed.data.alerts.length, created: 0, updated: 0, resolved: 0, ignored: 0, tickets: [] as string[] };
    for (const a of parsed.data.alerts) {
      const assetId = a.labels.asset_id;
      const asset = assetId ? await this.asset(assetId) : null;
      if (!asset) {
        result.ignored++;
        this.log.warn(`alert ${a.labels.alertname ?? a.fingerprint} ignored: no managed asset for asset_id=${assetId ?? '(missing)'}`);
        continue;
      }
      if (a.status === 'resolved') {
        if (await this.resolve(a.fingerprint, a.endsAt ? new Date(a.endsAt) : new Date())) result.resolved++;
        else result.ignored++;
        continue;
      }
      const out = await this.fire(asset, {
        fingerprint: a.fingerprint,
        name: a.labels.alertname ?? 'Alert',
        severity: SEVERITY[(a.labels.severity ?? '').toLowerCase()] ?? 'INFO',
        summary: a.annotations.summary ?? a.annotations.description ?? null,
        labels: a.labels,
        annotations: { ...a.annotations, ...(a.generatorURL ? { generatorURL: a.generatorURL } : {}) },
        startsAt: a.startsAt && !a.startsAt.startsWith('0001') ? new Date(a.startsAt) : new Date(),
        source: 'alertmanager',
      });
      if (out === 'ignored') result.ignored++;
      else if (out.created) {
        result.created++;
        if (out.alert.ticketId) result.tickets.push(out.alert.ticketId);
      } else result.updated++;
    }
    return result;
  }

  /** Records a firing alert, or refreshes the open one with the same fingerprint. */
  async fire(asset: AssetWithContract, a: { fingerprint: string; name: string; severity: AlertSeverity; summary: string | null; labels: Record<string, string>; annotations: Record<string, string>; startsAt: Date; source: string }): Promise<'ignored' | { created: boolean; alert: Alert }> {
    if (!asset.monitoringEnabled || asset.contract.status === 'CANCELLED' || asset.contract.status === 'DRAFT') return 'ignored';
    const existing = await this.prisma.alert.findUnique({ where: { openKey: a.fingerprint } });
    if (existing) {
      const alert = await this.prisma.alert.update({ where: { id: existing.id }, data: { lastReceivedAt: new Date(), labels: a.labels, annotations: a.annotations, summary: a.summary ?? existing.summary } });
      return { created: false, alert };
    }
    let alert: Alert;
    try {
      alert = await this.prisma.alert.create({
        data: { assetId: asset.id, contractId: asset.contractId, fingerprint: a.fingerprint, openKey: a.fingerprint, name: a.name.slice(0, 200), summary: a.summary?.slice(0, 2000) ?? null, severity: a.severity, source: a.source, labels: a.labels, annotations: a.annotations, startsAt: a.startsAt },
      });
    } catch (e) {
      // Two deliveries of the same alert at once: the other one created it.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { created: false, alert: await this.prisma.alert.findUniqueOrThrow({ where: { openKey: a.fingerprint } }) };
      throw e;
    }
    await this.events.emit('managed.alert_firing', { alertId: alert.id, assetId: asset.id, contractId: asset.contractId, name: alert.name, severity: alert.severity, source: a.source }, { teamId: asset.contract.teamId, resource: `managed_alert:${alert.id}` });
    const supported = asset.contract.status === 'ACTIVE' || asset.contract.status === 'ONBOARDING';
    if (!supported || alert.severity === 'INFO') return { created: true, alert };

    const critical = alert.severity === 'CRITICAL';
    const primary = critical ? await this.oncall.primary(new Date(), asset.contractId) : null;
    const ticket = await this.tickets.openSystemTicket({
      contract: asset.contract,
      assetId: asset.id,
      priority: critical ? 'P1' : 'P3',
      subject: `${critical ? 'Critical' : 'Warning'}: ${alert.name} on ${asset.name}`,
      body: [`${alert.name} is firing on ${asset.name} since ${alert.startsAt.toISOString()}.`, alert.summary ?? '', 'Our engineers are on it. This ticket is updated when the alert resolves.'].filter(Boolean).join('\n\n'),
      source: 'alert',
      assigneeId: primary?.id ?? null,
      page: false,
    });
    alert = await this.prisma.alert.update({ where: { id: alert.id }, data: { ticketId: ticket.id } });
    if (critical) {
      await this.paging.pageOnCall({ urgency: 'high', subject: `[P1] ${alert.name} on ${asset.name}`, message: `${alert.summary ?? 'Critical alert'} (ticket #${ticket.number})`, alertId: alert.id, ticketId: ticket.id, contractId: asset.contractId })
        .catch((e) => this.log.error(`paging for alert ${alert.id} failed: ${(e as Error).message}`));
    }
    return { created: true, alert };
  }

  /** Closes the open alert with this fingerprint and notes it on the ticket. */
  async resolve(fingerprint: string, endsAt: Date, actor?: Actor) {
    const open = await this.prisma.alert.findUnique({ where: { openKey: fingerprint }, include: { asset: true, contract: true } });
    if (!open) return false;
    const now = new Date();
    await this.prisma.alert.update({ where: { id: open.id }, data: { status: 'RESOLVED', endsAt: endsAt > open.startsAt ? endsAt : now, resolvedAt: now, openKey: null } });
    if (open.ticketId) {
      const minutes = Math.max(1, Math.round((now.getTime() - open.startsAt.getTime()) / 60_000));
      await this.tickets.addSystemNote(open.ticketId, `${open.name} on ${open.asset.name} resolved at ${now.toISOString()} after about ${minutes} minutes. The engineer closes this ticket after recording the root cause.`);
    }
    await this.events.emit('managed.alert_resolved', { alertId: open.id, assetId: open.assetId, contractId: open.contractId, name: open.name, by: actor ? 'staff' : 'source' }, { teamId: open.contract.teamId, actor, resource: `managed_alert:${open.id}` });
    return true;
  }

  // ---- heartbeats ----

  /** A heartbeat from the monitoring agent on an external server. */
  async heartbeat(token: string, raw: unknown) {
    const asset = token ? await this.prisma.managedAsset.findUnique({ where: { heartbeatTokenHash: hashToken(token) }, include: { contract: { include: { plan: true } } } }) : null;
    if (!asset || asset.removedAt || asset.status !== 'APPROVED') throw ApiError.unauthorized('Unknown or revoked heartbeat token');
    const parsed = heartbeatPayload.safeParse(raw ?? {});
    if (!parsed.success) throw ApiError.invalid('Bad heartbeat body', { issues: parsed.error.issues.slice(0, 5) });
    const report = (JSON.stringify(parsed.data).length <= 16_000 ? parsed.data : { status: parsed.data.status, truncated: true }) as Prisma.InputJsonValue;
    const health = parsed.data.status === 'ok' ? 'HEALTHY' : parsed.data.status === 'degraded' ? 'DEGRADED' : 'UNHEALTHY';
    await this.prisma.managedAsset.update({ where: { id: asset.id }, data: { lastHeartbeatAt: new Date(), health, heartbeatReport: report } });
    const recovered = await this.resolve(heartbeatFingerprint(asset.id), new Date());
    if (recovered) this.log.log(`heartbeat from ${asset.name} is back`);
    return { ok: true, assetId: asset.id, health, nextHeartbeatSeconds: 60 };
  }

  /**
   * Marks external servers whose heartbeat is older than MANAGED_HEARTBEAT_STALE_MINUTES as
   * unhealthy and raises a CRITICAL `HeartbeatMissing` alert (P1 ticket and page). An asset
   * that never sent a heartbeat counts once a token was issued and the grace period passed.
   */
  async checkHeartbeats(now = new Date()) {
    const cutoff = new Date(now.getTime() - loadConfig().MANAGED_HEARTBEAT_STALE_MINUTES * 60_000);
    const stale = await this.prisma.managedAsset.findMany({
      where: {
        kind: 'EXTERNAL_SERVER', status: 'APPROVED', removedAt: null, monitoringEnabled: true, health: { not: 'UNHEALTHY' },
        contract: { status: { in: ['ONBOARDING', 'ACTIVE', 'SUSPENDED'] } },
        OR: [{ lastHeartbeatAt: { lt: cutoff } }, { lastHeartbeatAt: null, heartbeatTokenHash: { not: null }, updatedAt: { lt: cutoff } }],
      },
      include: { contract: { include: { plan: true } } },
    });
    for (const asset of stale) {
      await this.prisma.managedAsset.update({ where: { id: asset.id }, data: { health: 'UNHEALTHY' } });
      await this.fire(asset, {
        fingerprint: heartbeatFingerprint(asset.id),
        name: 'HeartbeatMissing',
        severity: 'CRITICAL',
        summary: `No heartbeat from ${asset.name} since ${asset.lastHeartbeatAt?.toISOString() ?? 'the agent was installed'}. The server or its monitoring agent may be down.`,
        labels: { alertname: 'HeartbeatMissing', asset_id: asset.id, severity: 'critical' },
        annotations: {},
        startsAt: asset.lastHeartbeatAt ?? now,
        source: 'heartbeat',
      }).catch((e) => this.log.error(`heartbeat alert for ${asset.id}: ${(e as Error).message}`));
    }
    return stale.length;
  }

  // ---- staff ----

  async list(q: { status?: string; severity?: string; contractId?: string; assetId?: string; limit: number; cursor?: string }) {
    const rows = await this.prisma.alert.findMany({
      where: {
        ...(q.status === 'open' ? { status: { not: 'RESOLVED' } } : q.status ? { status: q.status as Alert['status'] } : {}),
        ...(q.severity ? { severity: q.severity as AlertSeverity } : {}),
        ...(q.contractId ? { contractId: q.contractId } : {}),
        ...(q.assetId ? { assetId: q.assetId } : {}),
      },
      include: { asset: { select: { id: true, name: true } } },
      orderBy: [{ startsAt: 'desc' }],
      ...cursorArgs({ limit: q.limit, cursor: q.cursor }),
    });
    return toPage(rows.map(presentAlert), q.limit);
  }

  async get(id: string) {
    const a = await this.prisma.alert.findUnique({ where: { id }, include: { asset: { select: { id: true, name: true } }, pages: { include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: 'asc' } } } });
    if (!a) throw ApiError.notFound('alert', id);
    return { ...presentAlert(a), pages: a.pages.map(presentPage) };
  }

  /** Acknowledge (stops the page escalation) or resolve by hand. */
  async setStatus(actor: Actor, id: string, status: 'ACKNOWLEDGED' | 'RESOLVED') {
    const a = await this.prisma.alert.findUnique({ where: { id }, include: { contract: true } });
    if (!a) throw ApiError.notFound('alert', id);
    if (status === 'RESOLVED') {
      if (a.status !== 'RESOLVED') await this.resolve(a.fingerprint, new Date(), actor);
      await this.paging.ackByAlert(actor, id, a.ticketId);
      return this.get(id);
    }
    if (a.status === 'RESOLVED') throw ApiError.invalidState('The alert is already resolved');
    await this.prisma.alert.update({ where: { id }, data: { status: 'ACKNOWLEDGED', acknowledgedById: a.acknowledgedById ?? actor.userId, acknowledgedAt: a.acknowledgedAt ?? new Date() } });
    const pages = await this.paging.ackByAlert(actor, id, a.ticketId);
    await this.events.emit('managed.alert_acknowledged', { alertId: id, pagesAcknowledged: pages }, { teamId: a.contract.teamId, actor, resource: `managed_alert:${id}` });
    return this.get(id);
  }

  private async asset(id: string) {
    return this.prisma.managedAsset.findFirst({ where: { id, removedAt: null, status: 'APPROVED' }, include: { contract: { include: { plan: true } } } });
  }
}

export const heartbeatFingerprint = (assetId: string) => `heartbeat:${assetId}`;
