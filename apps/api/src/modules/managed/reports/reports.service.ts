import { Injectable, Logger } from '@nestjs/common';
import type { MonthlyReport, Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ApiError } from '../../../common/errors/api-error';
import type { Actor } from '../../../common/auth/actor';
import { loadConfig } from '../../../config/config';
import { EventsService } from '../../events/events.service';
import { assertOwner, periodBounds, periodKey } from '../managed.constants';
import { ManagedWorkflows } from '../managed-workflows.service';
import { ManagedNotify } from '../managed-notify.service';
import { ContractTermsService } from '../contracts/contract-terms.service';
import { draftRecommendations, uptime, type ReportData } from './report-data';
import { renderReportPdf } from './report-pdf';

export function presentReport(r: MonthlyReport, staff = false) {
  return {
    id: r.id, contractId: r.contractId, period: r.period, status: r.status, data: r.data as unknown as ReportData, recommendations: r.recommendations,
    hasPdf: !!r.pdf, pdfBytes: r.pdf?.length ?? 0, generatedAt: r.generatedAt, sentAt: r.sentAt, ...(staff ? { sentById: r.sentById } : {}), createdAt: r.createdAt, updatedAt: r.updatedAt,
  };
}

/**
 * Monthly reports. On the 1st a job starts `managedMonthlyReport` for every ACTIVE contract:
 * it drafts last month's report (data and PDF) and, if nobody sent it by
 * MANAGED_REPORT_AUTOSEND_DAY (the 3rd), sends it. Engineers edit the recommendations of a
 * draft (the PDF is re-rendered) and send it; sending emails the PDF to the team owners.
 */
@Injectable()
export class ReportsService {
  private readonly log = new Logger(ReportsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly workflows: ManagedWorkflows,
    private readonly notify: ManagedNotify,
    private readonly terms: ContractTermsService,
  ) {}

  /** The previous calendar month (UTC) as "2026-09". */
  static previousPeriod(now = new Date()) {
    return periodKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1));
  }

  /** When a draft for `period` is sent automatically: 06:00 UTC on the autosend day of the next month. */
  static autoSendAt(period: string) {
    const { end } = periodBounds(period);
    return new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), loadConfig().MANAGED_REPORT_AUTOSEND_DAY, 6));
  }

  /** Starts the monthly report workflow for every ACTIVE contract. Run by a job on the 1st. */
  async startMonthly(now = new Date()) {
    const period = ReportsService.previousPeriod(now);
    const contracts = await this.prisma.managedContract.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
    for (const c of contracts) {
      const ok = await this.workflows.start('managedMonthlyReport', [{ contractId: c.id, period }], ManagedWorkflows.reportId(c.id, period));
      if (!ok) await this.generate(c.id, period).catch((e) => this.log.error(`report ${c.id} ${period}: ${(e as Error).message}`));
    }
    return contracts.length;
  }

  /** Sends drafts whose autosend time passed (a safety net next to the workflow timer). */
  async sendOverdueDrafts(now = new Date()) {
    const drafts = await this.prisma.monthlyReport.findMany({ where: { status: 'DRAFT' }, select: { id: true, period: true } });
    let sent = 0;
    for (const r of drafts) {
      if (ReportsService.autoSendAt(r.period) <= now && (await this.autoSend(r.id)) === 'sent') sent++;
    }
    return sent;
  }

  /** Builds (or rebuilds) the report for a contract and period. Keeps edited recommendations and the sent state. */
  async generate(contractId: string, period: string, actor?: Actor) {
    const { start, end } = periodBounds(period);
    const c = await this.prisma.managedContract.findUnique({ where: { id: contractId }, include: { plan: true, team: { select: { id: true, name: true } } } });
    if (!c) throw ApiError.notFound('managed contract', contractId);
    const data = await this.collect(c, start, end);
    const existing = await this.prisma.monthlyReport.findUnique({ where: { contractId_period: { contractId, period } } });
    const recommendations = existing?.recommendations || draftRecommendations(data);
    const generatedAt = new Date();
    const pdf = new Uint8Array(await renderReportPdf(data, recommendations, generatedAt));
    const report = await this.prisma.monthlyReport.upsert({
      where: { contractId_period: { contractId, period } },
      create: { contractId, period, data: data as unknown as Prisma.InputJsonValue, recommendations, pdf, generatedAt },
      update: { data: data as unknown as Prisma.InputJsonValue, pdf, generatedAt },
    });
    await this.events.emit('managed.report_generated', { reportId: report.id, contractId, period, regenerated: !!existing }, { teamId: c.teamId, actor, resource: `managed_contract:${contractId}` });
    return report;
  }

  async updateRecommendations(actor: Actor, id: string, recommendations: string) {
    const r = await this.load(id);
    if (r.status === 'SENT') throw ApiError.invalidState('This report was already sent; regenerate a new month or add notes in a ticket');
    const updated = await this.prisma.monthlyReport.update({ where: { id }, data: { recommendations } });
    const pdf = new Uint8Array(await renderReportPdf(updated.data as unknown as ReportData, recommendations, updated.generatedAt));
    const out = await this.prisma.monthlyReport.update({ where: { id }, data: { pdf } });
    await this.events.emit('managed.report_edited', { reportId: id, period: r.period }, { teamId: r.contract.teamId, actor, resource: `managed_contract:${r.contractId}` });
    return presentReport(out, true);
  }

  /** Emails the PDF to the team owners and marks the report sent. */
  async send(id: string, actor: Actor | null) {
    const r = await this.load(id);
    if (!r.pdf) throw ApiError.invalidState('The report has no PDF yet; regenerate it');
    const claimed = await this.prisma.monthlyReport.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'SENT', sentAt: new Date(), sentById: actor?.userId ?? null } });
    if (claimed.count !== 1) return presentReport(await this.load(id), true);
    const data = r.data as unknown as ReportData;
    const month = new Date(`${r.period}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const to = await this.notify.toOwners(r.contract.teamId, {
      subject: `Your managed cloud report for ${month}`,
      text: `Hi,\n\nYour managed cloud report for ${month} is attached.\n\nUptime: ${data.uptimePercent === null ? 'n/a' : `${data.uptimePercent}%`}\nCritical incidents: ${data.incidents.alerts.critical}\nSLA targets met: ${data.sla.responseMet + data.sla.resolveMet}, breached: ${data.sla.responseBreached + data.sla.resolveBreached}\nEngineer time: ${Math.round((data.hours.billableMinutes / 60) * 10) / 10} of ${Math.round((data.hours.includedMinutes / 60) * 10) / 10} included hours\n\nAll reports are in the console:\n${loadConfig().CONSOLE_URL}/managed/reports`,
      attachments: [{ filename: `progrid-managed-report-${r.period}.pdf`, content: Buffer.from(r.pdf), contentType: 'application/pdf' }],
    });
    await this.events.emit('managed.report_sent', { reportId: id, period: r.period, recipients: to.length, automatic: !actor }, { teamId: r.contract.teamId, actor: actor ?? undefined, resource: `managed_contract:${r.contractId}` });
    return presentReport(await this.load(id), true);
  }

  async autoSend(id: string): Promise<'sent' | 'already_sent' | 'missing'> {
    const r = await this.prisma.monthlyReport.findUnique({ where: { id }, select: { status: true } });
    if (!r) return 'missing';
    if (r.status === 'SENT') return 'already_sent';
    await this.send(id, null);
    return 'sent';
  }

  // ---- reads ----

  async listForCustomer(actor: Actor, contractId: string) {
    assertOwner(actor);
    await this.ownContract(actor, contractId);
    const rows = await this.prisma.monthlyReport.findMany({ where: { contractId, status: 'SENT' }, orderBy: { period: 'desc' } });
    return { data: rows.map((r) => ({ ...presentReport(r), pdfUrl: `/v1/managed/contracts/${contractId}/reports/${r.id}/pdf` })) };
  }

  async pdfForCustomer(actor: Actor, contractId: string, id: string) {
    assertOwner(actor);
    await this.ownContract(actor, contractId);
    const r = await this.prisma.monthlyReport.findFirst({ where: { id, contractId, status: 'SENT' } });
    if (!r?.pdf) throw ApiError.notFound('report', id);
    return { filename: `progrid-managed-report-${r.period}.pdf`, pdf: Buffer.from(r.pdf) };
  }

  async adminList(q: { contractId?: string; period?: string; status?: 'DRAFT' | 'SENT' }) {
    const rows = await this.prisma.monthlyReport.findMany({ where: { ...(q.contractId ? { contractId: q.contractId } : {}), ...(q.period ? { period: q.period } : {}), ...(q.status ? { status: q.status } : {}) }, orderBy: [{ period: 'desc' }, { createdAt: 'desc' }], take: 200 });
    return { data: rows.map((r) => presentReport(r, true)) };
  }

  async adminGet(id: string) {
    return presentReport(await this.load(id), true);
  }

  async pdf(id: string) {
    const r = await this.load(id);
    if (!r.pdf) throw ApiError.notFound('report pdf', id);
    return { filename: `progrid-managed-report-${r.period}.pdf`, pdf: Buffer.from(r.pdf) };
  }

  // ---- data ----

  private async collect(c: { id: string; teamId: string; calendar: string; plan: { code: string; name: string; coverage: string }; team: { id: string; name: string } } & Parameters<ContractTermsService['terms']>[0], start: Date, end: Date): Promise<ReportData> {
    const now = new Date();
    const until = new Date(Math.min(end.getTime(), now.getTime()));
    const assets = await this.prisma.managedAsset.findMany({
      where: { contractId: c.id, status: 'APPROVED', approvedAt: { lt: end }, OR: [{ removedAt: null }, { removedAt: { gt: start } }] },
      include: { alerts: { where: { severity: 'CRITICAL', startsAt: { lt: end }, OR: [{ endsAt: null }, { endsAt: { gt: start } }] }, select: { startsAt: true, endsAt: true } } },
      orderBy: { name: 'asc' },
    });
    const assetRows = assets.map((a) => {
      const from = Math.max(start.getTime(), a.approvedAt!.getTime());
      const to = Math.min(until.getTime(), a.removedAt?.getTime() ?? until.getTime());
      return { id: a.id, name: a.name, kind: a.kind, ...uptime({ from, to: Math.max(from, to) }, a.alerts) };
    });
    const observed = assetRows.reduce((s, a) => s + a.observedMinutes, 0);
    const uptimePercent = observed ? Math.round((1 - assetRows.reduce((s, a) => s + a.downtimeMinutes, 0) / observed) * 100_000) / 1000 : null;

    const alerts = await this.prisma.alert.groupBy({ by: ['severity'], where: { contractId: c.id, startsAt: { gte: start, lt: end } }, _count: { _all: true } });
    const count = (sev: string) => alerts.find((a) => a.severity === sev)?._count._all ?? 0;
    const tickets = await this.prisma.ticket.findMany({ where: { contractId: c.id, createdAt: { gte: start, lt: end }, managedPriority: { not: null } }, orderBy: { createdAt: 'asc' } });
    const major = tickets.filter((t) => t.managedPriority === 'P1' || t.managedPriority === 'P2');

    const runs = await this.prisma.maintenanceRun.findMany({ where: { task: { contractId: c.id }, finishedAt: { gte: start, lt: end }, status: { in: ['SUCCEEDED', 'FAILED'] } }, select: { status: true, task: { select: { kind: true } } } });
    const tally = (kind: string) => {
      const r = runs.filter((x) => x.task.kind === kind);
      return { runs: r.length, succeeded: r.filter((x) => x.status === 'SUCCEEDED').length, failed: r.filter((x) => x.status === 'FAILED').length };
    };

    const logs = await this.prisma.workLog.groupBy({ by: ['billable'], where: { contractId: c.id, workedAt: { gte: start, lt: end } }, _sum: { minutes: true } });
    const billable = logs.find((l) => l.billable)?._sum.minutes ?? 0;
    const { includedEngineerMinutes } = await this.terms.terms(c, end);

    return {
      period: periodKey(start),
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      team: c.team,
      plan: { code: c.plan.code, name: c.plan.name, coverage: c.plan.coverage },
      calendar: c.calendar,
      assets: assetRows,
      uptimePercent,
      incidents: {
        alerts: { total: alerts.reduce((s, a) => s + a._count._all, 0), critical: count('CRITICAL'), warning: count('WARNING'), info: count('INFO') },
        majorTickets: major.map((t) => ({ id: t.id, number: t.number, subject: t.subject, priority: t.managedPriority!, openedAt: t.createdAt.toISOString(), closedAt: t.closedAt?.toISOString() ?? null, source: t.source })),
      },
      sla: {
        tickets: tickets.length,
        responseMet: tickets.filter((t) => t.firstRespondedAt && !t.responseBreached).length,
        responseBreached: tickets.filter((t) => t.responseBreached).length,
        resolveMet: tickets.filter((t) => t.status === 'closed' && !t.resolveBreached).length,
        resolveBreached: tickets.filter((t) => t.resolveBreached).length,
      },
      patches: tally('PATCHING'),
      backupTests: tally('BACKUP_TEST'),
      hours: { billableMinutes: billable, nonBillableMinutes: logs.find((l) => !l.billable)?._sum.minutes ?? 0, includedMinutes: includedEngineerMinutes, overageMinutes: Math.max(0, billable - includedEngineerMinutes) },
    };
  }

  private async load(id: string) {
    const r = await this.prisma.monthlyReport.findUnique({ where: { id }, include: { contract: { select: { teamId: true } } } });
    if (!r) throw ApiError.notFound('report', id);
    return r;
  }

  private async ownContract(actor: Actor, contractId: string) {
    const c = await this.prisma.managedContract.findFirst({ where: { id: contractId, teamId: actor.teamId } });
    if (!c) throw ApiError.notFound('managed contract', contractId);
    return c;
  }
}
