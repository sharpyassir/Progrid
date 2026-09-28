import { Injectable } from '@nestjs/common';
import type { ManagedPriority, Prisma, TicketStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ApiError } from '../../../common/errors/api-error';
import { loadConfig } from '../../../config/config';
import { ManagedTicketsService } from '../../managed/tickets/tickets.service';
import { isClosedStatus } from '../../managed/managed.constants';
import { ManagedAlertsService } from '../../managed/alerts/alerts.service';
import { PagingService } from '../../managed/oncall/paging.service';
import { OnCallService } from '../../managed/oncall/oncall.service';
import { OpsAudit } from '../ops-audit.service';
import { OpsSettingsService } from '../settings/ops-settings.service';
import { canSee, contractFilter, type OpsContext } from '../guards/ops-context';
import { opsAlert, opsAsset, opsContract, opsMessage, opsPage, opsResponsibility, opsRun, opsTicketSummary, person } from '../serializers/ops-dto';
import { OpsHooks } from '../ops-hooks.service';

export interface TicketListQuery {
  mine?: string;
  status?: string;
  priority?: ManagedPriority;
  contractId?: string;
  assetId?: string;
}

const OPEN_STATUSES: TicketStatus[] = ['open', 'answered'];

/**
 * The engineer's desk in the ops console: who am I, my contracts, alerts, pages, tickets (with
 * the ticket workspace) and assets. Everything is limited to the engineer's contracts and
 * serialized through the ops mappers. Ticket and alert changes go through the managed module
 * services so SLA timers, paging and customer mails behave exactly as in the back office.
 */
@Injectable()
export class DeskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: ManagedTicketsService,
    private readonly alerts: ManagedAlertsService,
    private readonly paging: PagingService,
    private readonly oncall: OnCallService,
    private readonly audit: OpsAudit,
    private readonly settings: OpsSettingsService,
    private readonly hooks: OpsHooks,
  ) {}

  // ---- me ----

  async me(ops: OpsContext) {
    const now = new Date();
    const [contracts, shift, pages, extra] = await Promise.all([
      this.contracts(ops),
      this.prisma.onCallShift.findFirst({ where: { userId: ops.userId, endedAt: null, startsAt: { lte: new Date(now.getTime() + 30 * 60_000) }, endsAt: { gt: now } }, orderBy: { startsAt: 'asc' } }),
      this.prisma.page.findMany({ where: { userId: ops.userId, ackAt: null, urgency: 'high' }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.hooks.meExtras(ops),
    ]);
    return {
      user: { id: ops.userId, name: ops.name, locale: ops.locale },
      engineer: { kind: ops.kind, country: ops.country, timezone: ops.timezone, status: ops.profile?.status ?? 'ACTIVE', currency: ops.profile?.currency ?? null },
      lead: ops.lead,
      contracts: contracts.data,
      currentShift: shift ? { id: shift.id, role: shift.role, startsAt: shift.startsAt, endsAt: shift.endsAt, startedAt: shift.startedAt, endedAt: shift.endedAt } : null,
      openPages: pages.map(opsPage),
      ...extra,
    };
  }

  async contracts(ops: OpsContext) {
    const rows = await this.prisma.managedContract.findMany({
      where: { id: contractFilter(ops), status: { in: ['ONBOARDING', 'ACTIVE', 'SUSPENDED'] } },
      include: { plan: { select: { code: true, name: true, coverage: true } }, team: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return { data: rows.map(opsContract) };
  }

  // ---- alerts and pages ----

  async listAlerts(ops: OpsContext, q: { status?: string; contractId?: string; assetId?: string; limit?: number }) {
    const rows = await this.prisma.alert.findMany({
      where: {
        contractId: q.contractId ?? contractFilter(ops),
        ...(q.assetId ? { assetId: q.assetId } : {}),
        ...(q.status === 'all' ? {} : q.status && q.status !== 'open' ? { status: q.status as 'FIRING' } : { status: { not: 'RESOLVED' } }),
      },
      include: { asset: { select: { id: true, name: true } } },
      orderBy: [{ severity: 'asc' }, { startsAt: 'desc' }],
      take: Math.min(q.limit ?? 200, 500),
    });
    return { data: rows.map(opsAlert) };
  }

  /** Acknowledges the alert (stops the page escalation) and takes its ticket. */
  async ackAlert(ops: OpsContext, id: string) {
    await this.alerts.setStatus(ops.actor, id, 'ACKNOWLEDGED');
    const a = await this.prisma.alert.findUniqueOrThrow({ where: { id }, include: { asset: { select: { id: true, name: true } }, ticket: { select: { id: true, assigneeId: true } } } });
    if (a.ticket && a.ticket.assigneeId !== ops.userId) {
      await this.tickets.update(ops.actor, a.ticket.id, { assigneeId: ops.userId }).catch(() => undefined);
    }
    await this.audit.emit('ops.alert_acknowledged', ops, { contractId: a.contractId, assetId: a.assetId, ticketId: a.ticketId, alertId: id }, `managed_alert:${id}`);
    await this.hooks.activity(ops.userId, a.ticketId);
    return opsAlert(a);
  }

  async ackPage(ops: OpsContext, id: string) {
    const p = await this.prisma.page.findUnique({ where: { id } });
    if (!p || (p.userId !== ops.userId && ops.external)) throw ApiError.notFound('page', id);
    await this.paging.ack(ops.actor, id);
    return opsPage(await this.prisma.page.findUniqueOrThrow({ where: { id } }));
  }

  // ---- tickets ----

  /** Tickets on the engineer's contracts, most urgent SLA first. */
  async listTickets(ops: OpsContext, q: TicketListQuery) {
    const status = q.status ?? 'open';
    const rows = await this.prisma.ticket.findMany({
      where: {
        contractId: q.contractId ?? contractFilter(ops) ?? { not: null },
        ...(status === 'all' ? {} : status === 'open' ? { status: { in: OPEN_STATUSES } } : { status: status as TicketStatus }),
        ...(q.priority ? { managedPriority: q.priority } : {}),
        ...(q.assetId ? { assetId: q.assetId } : {}),
        ...(q.mine === 'true' ? { assigneeId: ops.userId } : {}),
      },
      include: { assignee: { select: { id: true, name: true } }, asset: { select: { id: true, name: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
    const now = new Date();
    const data = rows.map((t) => opsTicketSummary(t, ops.external, now));
    data.sort((a, b) => (a.slaSecondsLeft ?? Number.MAX_SAFE_INTEGER) - (b.slaSecondsLeft ?? Number.MAX_SAFE_INTEGER));
    return { data };
  }

  /** The ticket workspace: conversation, SLA, asset card, suggested runbooks, grants, time and escalation. */
  async ticket(ops: OpsContext, id: string) {
    const t = await this.prisma.ticket.findUnique({
      where: { id },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        assignee: { select: { id: true, name: true } },
        asset: true,
        alerts: { include: { asset: { select: { id: true, name: true } } }, orderBy: { startsAt: 'desc' }, take: 20 },
        workLogs: { include: { user: { select: { id: true, name: true } } }, orderBy: { workedAt: 'desc' } },
      },
    });
    if (!t || !canSee(ops, t.contractId)) throw ApiError.notFound('ticket', id);
    const s = await this.settings.get();
    const ageMinutes = (Date.now() - t.createdAt.getTime()) / 60_000;
    const open = OPEN_STATUSES.includes(t.status);
    const [assetCard, extra] = await Promise.all([t.asset ? this.assetCard(t.asset.id) : null, this.hooks.ticketExtras(ops, t)]);
    return {
      ticket: opsTicketSummary(t, ops.external),
      messages: t.messages.map((m) => opsMessage(m, ops.external)),
      sla: { responseDueAt: t.responseDueAt, resolveDueAt: t.resolveDueAt, firstRespondedAt: t.firstRespondedAt, warnedAt: t.warnedAt, breachedAt: t.breachedAt, responseBreached: t.responseBreached, resolveBreached: t.resolveBreached },
      asset: assetCard,
      alerts: t.alerts.map(opsAlert),
      workLogs: t.workLogs.map((w) => ({ id: w.id, user: person(w.user), minutes: w.minutes, billable: w.billable, note: w.note, workedAt: w.workedAt })),
      escalation: { suggested: open && t.managedPriority === 'P1' && ageMinutes >= s.escalationSuggestMinutes, afterMinutes: s.escalationSuggestMinutes },
      ...extra,
    };
  }

  async reply(ops: OpsContext, id: string, body: string, internal: boolean) {
    await this.tickets.staffReply(ops.actor, id, { body, internal });
    const t = await this.prisma.ticket.findUniqueOrThrow({ where: { id }, select: { contractId: true, assetId: true } });
    await this.audit.emit(internal ? 'ops.ticket_note' : 'ops.ticket_replied', ops, { contractId: t.contractId, assetId: t.assetId, ticketId: id }, `ticket:${id}`);
    await this.hooks.activity(ops.userId, id);
    return this.ticket(ops, id);
  }

  /**
   * Status, priority or assignee (engineers assign only themselves). Closing needs a root cause
   * internal note: pass `rootCause` or write one first. A P1 goes to resolved_pending_pm until
   * its postmortem is submitted. Closing revokes the ticket's access grants.
   */
  async update(ops: OpsContext, id: string, dto: { status?: 'open' | 'answered' | 'closed'; priority?: ManagedPriority; assigneeId?: string | null; rootCause?: string }) {
    const t = await this.prisma.ticket.findUniqueOrThrow({ where: { id }, include: { messages: { where: { rootCause: true }, select: { id: true } } } });
    if (dto.rootCause) {
      const author = await this.prisma.user.findUnique({ where: { id: ops.userId }, select: { name: true } });
      await this.prisma.ticketMessage.create({ data: { ticketId: id, fromSupport: true, internal: true, rootCause: true, authorId: ops.userId, authorName: author?.name ?? 'Engineer', body: `Root cause: ${dto.rootCause}` } });
      await this.audit.emit('ops.ticket_root_cause', ops, { contractId: t.contractId, assetId: t.assetId, ticketId: id }, `ticket:${id}`);
    }
    const closing = dto.status === 'closed' && !isClosedStatus(t.status);
    if (closing && !dto.rootCause && !t.messages.length) throw new ApiError(422, 'root_cause_required', 'Record the root cause (an internal note) before closing the ticket');
    // The managed module closes a P1 into resolved_pending_pm until its postmortem is submitted,
    // and tells its listeners (access grants are revoked, the postmortem draft is created).
    await this.tickets.update(ops.actor, id, { status: dto.status, priority: dto.priority, assigneeId: dto.assigneeId });
    const after = await this.prisma.ticket.findUniqueOrThrow({ where: { id } });
    if (after.status !== t.status) {
      await this.audit.emit('ops.ticket_status', ops, { contractId: t.contractId, assetId: t.assetId, ticketId: id, from: t.status, to: after.status }, `ticket:${id}`);
    }
    await this.hooks.activity(ops.userId, id);
    return this.ticket(ops, id);
  }

  /** Pages the support lead about a ticket the engineer cannot contain. */
  async escalate(ops: OpsContext, id: string, reason: string) {
    const t = await this.prisma.ticket.findUniqueOrThrow({ where: { id } });
    const lead = await this.oncall.supportLead(ops.userId);
    if (!lead) throw ApiError.invalidState('There is no support lead to escalate to');
    const subject = `Escalated: [#${t.number}] [${t.managedPriority ?? ''}] ${t.subject}`;
    await this.paging.page({ userId: lead.id, urgency: 'high', subject, message: `${ops.name} escalated the ticket: ${reason}`, ticketId: id, contractId: t.contractId });
    await this.prisma.ticketMessage.create({ data: { ticketId: id, fromSupport: true, internal: true, authorId: ops.userId, authorName: ops.name, body: `Escalated to the support lead: ${reason}` } });
    await this.audit.emit('ops.ticket_escalated', ops, { contractId: t.contractId, assetId: t.assetId, ticketId: id, toUserId: lead.id, reason }, `ticket:${id}`);
    await this.hooks.activity(ops.userId, id);
    return { escalated: true, to: person(lead) };
  }

  // ---- assets ----

  async asset(ops: OpsContext, id: string) {
    const card = await this.assetCard(id);
    const [runs, openTickets, responsibilities] = await Promise.all([
      this.prisma.maintenanceRun.findMany({ where: { task: { OR: [{ assetId: id }, { assetId: null, contractId: card.asset.contractId }] } }, include: { task: { select: { id: true, name: true, kind: true, contractId: true, assetId: true } } }, orderBy: { createdAt: 'desc' }, take: 30 }),
      this.prisma.ticket.findMany({ where: { assetId: id, status: { in: OPEN_STATUSES } }, include: { assignee: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.responsibility.findMany({ where: { contractId: card.asset.contractId }, orderBy: [{ sortOrder: 'asc' }, { area: 'asc' }] }),
    ]);
    return {
      ...card,
      maintenanceHistory: runs.filter((r) => r.task.kind !== 'BACKUP_TEST').map((r) => opsRun(r)),
      backups: { enabled: card.asset.backupEnabled, tests: runs.filter((r) => r.task.kind === 'BACKUP_TEST').map((r) => opsRun(r)) },
      openTickets: openTickets.map((t) => opsTicketSummary(t, ops.external)),
      responsibilities: responsibilities.map(opsResponsibility),
    };
  }

  /** Health, links and the latest alerts, patch run and backup test of one asset. */
  private async assetCard(id: string) {
    const a = await this.prisma.managedAsset.findUnique({ where: { id } });
    if (!a) throw ApiError.notFound('asset', id);
    const [alerts, lastPatch, lastBackupTest] = await Promise.all([
      this.prisma.alert.findMany({ where: { assetId: id }, include: { asset: { select: { id: true, name: true } } }, orderBy: { startsAt: 'desc' }, take: 10 }),
      this.lastRun(a.id, a.contractId, 'PATCHING'),
      this.lastRun(a.id, a.contractId, 'BACKUP_TEST'),
    ]);
    const grafana = loadConfig().PRGD_GRAFANA_URL?.replace(/\/$/, '');
    const logsQuery = encodeURIComponent(JSON.stringify({ datasource: 'loki', queries: [{ refId: 'A', expr: `{asset_id="${a.id}"}` }], range: { from: 'now-6h', to: 'now' } }));
    return {
      asset: opsAsset(a),
      links: grafana ? { metrics: `${grafana}/d/prgd-asset/asset?var-asset_id=${a.id}`, logs: `${grafana}/explore?orgId=1&left=${logsQuery}` } : null,
      recentAlerts: alerts.map(opsAlert),
      lastPatch: lastPatch ? opsRun(lastPatch) : null,
      lastBackupTest: lastBackupTest ? opsRun(lastBackupTest) : null,
    };
  }

  private lastRun(assetId: string, contractId: string, kind: 'PATCHING' | 'BACKUP_TEST') {
    const where: Prisma.MaintenanceRunWhereInput = { status: { in: ['SUCCEEDED', 'FAILED'] }, task: { kind, OR: [{ assetId }, { assetId: null, contractId }] } };
    return this.prisma.maintenanceRun.findFirst({ where, include: { task: { select: { id: true, name: true, kind: true, contractId: true, assetId: true } } }, orderBy: { finishedAt: 'desc' } });
  }
}
