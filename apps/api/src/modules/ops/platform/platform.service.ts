import { Injectable, Logger } from '@nestjs/common';
import type { PlatformTaskRun, Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ApiError } from '../../../common/errors/api-error';
import { loadConfig } from '../../../config/config';
import { EventsService } from '../../events/events.service';
import { ManagedNotify } from '../../managed/managed-notify.service';
import type { OpsContext } from '../guards/ops-context';
import { OpsAudit } from '../ops-audit.service';
import { PLATFORM_TASKS, periodOf, taskByKey, type PlatformTask } from './catalog';
import { PlatformChecks } from './checks';

export interface CompleteInput { note?: string; evidence?: string; minutes?: number }
export interface BackupReport { result: 'ok' | 'failed'; offsite?: boolean; sizeBytes?: number; file?: string }

const OPEN = ['open', 'attention', 'overdue'] as const;

/**
 * Platform maintenance (docs/platform-maintenance.md): one run per catalog task per period.
 * The system opens the runs, runs the automatic checks, closes auto tasks that pass and mails
 * the staff inbox about overdue ones; the engineer handles what is left and closes it with a
 * note and evidence.
 */
@Injectable()
export class PlatformService {
  private readonly log = new Logger(PlatformService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly checks: PlatformChecks,
    private readonly audit: OpsAudit,
    private readonly events: EventsService,
    private readonly notify: ManagedNotify,
  ) {}

  /** Opens the run of the current period for every task (idempotent). */
  async ensurePeriods(now = new Date()) {
    const data = PLATFORM_TASKS.map((t) => {
      const p = periodOf(t.cadence, now);
      return { taskKey: t.key, periodKey: p.key, periodStart: p.start, dueAt: p.end };
    });
    const { count } = await this.prisma.platformTaskRun.createMany({ data, skipDuplicates: true });
    return count;
  }

  /** Runs the automatic checks of every open run in the current periods. */
  async runChecks(now = new Date()) {
    await this.ensurePeriods(now);
    const runs = await this.prisma.platformTaskRun.findMany({ where: { status: { in: [...OPEN] }, taskKey: { in: PLATFORM_TASKS.filter((t) => t.check).map((t) => t.key) } } });
    let n = 0;
    for (const run of runs) {
      const task = taskByKey(run.taskKey);
      if (!task?.check) continue;
      // Only the current period: an older run that stayed open is the engineer's to close.
      if (periodOf(task.cadence, now).key !== run.periodKey) continue;
      await this.check(run, task, now);
      n++;
    }
    return n;
  }

  /** Runs one task's check now (the engineer's "Run check now"). */
  async runCheckNow(ops: OpsContext, id: string) {
    const run = await this.find(id);
    const task = taskByKey(run.taskKey)!;
    if (!task.check) throw ApiError.invalid('This task has no automatic check');
    if (run.status === 'done' || run.status === 'passed') throw ApiError.conflict('task_closed', 'This task is already closed');
    const updated = await this.check(run, task, new Date());
    await this.audit.emit('ops.platform_check_run', ops, { platformRunId: run.id, taskKey: run.taskKey }, run.id);
    return this.view(updated);
  }

  private async check(run: PlatformTaskRun, task: PlatformTask, now: Date) {
    let result;
    try {
      result = await this.checks.run(task.check!, now);
    } catch (err) {
      result = { status: 'fail' as const, summary: `The check could not run: ${(err as Error).message.slice(0, 200)}`, details: {}, items: [] };
    }
    const details = { ...result.details, items: result.items } as Prisma.InputJsonValue;
    const base = { checkStatus: result.status, checkSummary: result.summary, checkDetails: details, checkedAt: now };
    // Auto tasks close themselves on a pass; anything else stays for the engineer.
    const status = task.mode === 'auto' ? (result.status === 'pass' ? 'passed' : run.status === 'overdue' ? 'overdue' : 'attention') : run.status;
    const updated = await this.prisma.platformTaskRun.update({
      where: { id: run.id },
      data: { ...base, status, ...(status === 'passed' ? { completedAt: now, minutes: 0 } : {}) },
    });
    if (status === 'passed') await this.events.emit('platform.task_passed', { runId: run.id, taskKey: run.taskKey, periodKey: run.periodKey }, { resource: run.id });
    return updated;
  }

  /** The engineer closes a task with what was done. */
  async complete(ops: OpsContext, id: string, input: CompleteInput) {
    const run = await this.find(id);
    const task = taskByKey(run.taskKey)!;
    if (run.status === 'done' || run.status === 'passed') throw ApiError.conflict('task_closed', 'This task is already closed');
    const note = input.note?.trim() || null;
    const evidence = input.evidence?.trim() || null;
    if (task.evidenceRequired && !evidence) throw ApiError.invalid('Attach the evidence for this task (command output, timings, a link)', { field: 'evidence' });
    if (task.mode !== 'auto' && !note && !evidence) throw ApiError.invalid('Write what was done', { field: 'note' });
    // A warning or failure the engineer closes needs the reason it is fine.
    if (task.mode === 'auto' && run.checkStatus && run.checkStatus !== 'pass' && !note) throw ApiError.invalid('Explain how the warnings were handled', { field: 'note' });
    const updated = await this.prisma.platformTaskRun.update({
      where: { id },
      data: { status: 'done', note, evidence, minutes: Math.max(0, Math.min(24 * 60, Math.round(input.minutes ?? 0))), completedById: ops.userId, completedAt: new Date() },
    });
    await this.audit.emit('ops.platform_task_done', ops, { platformRunId: id, taskKey: run.taskKey, periodKey: run.periodKey, minutes: updated.minutes }, id);
    return this.view(updated);
  }

  /** Runs past their period that are still open become overdue; the staff inbox gets one mail per batch. */
  async markOverdue(now = new Date()) {
    const late = await this.prisma.platformTaskRun.findMany({ where: { status: { in: ['open', 'attention'] }, dueAt: { lte: now } } });
    if (late.length) await this.prisma.platformTaskRun.updateMany({ where: { id: { in: late.map((r) => r.id) } }, data: { status: 'overdue' } });
    const unnotified = await this.prisma.platformTaskRun.findMany({ where: { status: 'overdue', overdueNotifiedAt: null }, orderBy: { dueAt: 'asc' } });
    if (!unnotified.length) return 0;
    const url = `${loadConfig().PRGD_OPS_URL}/platform`;
    const lines = unnotified.map((r) => `- ${r.taskKey} (${r.periodKey}), due ${r.dueAt.toISOString().slice(0, 10)}${r.checkSummary ? `: ${r.checkSummary}` : ''}`);
    await this.notify.toStaff({
      subject: `Platform maintenance overdue: ${unnotified.length} task${unnotified.length === 1 ? '' : 's'}`,
      text: `These platform maintenance tasks were not closed in their period:\n\n${lines.join('\n')}\n\nOpen the DevOps console, Platform: ${url}\n`,
    });
    await this.prisma.platformTaskRun.updateMany({ where: { id: { in: unnotified.map((r) => r.id) } }, data: { overdueNotifiedAt: now } });
    for (const r of unnotified) await this.events.emit('platform.task_overdue', { runId: r.id, taskKey: r.taskKey, periodKey: r.periodKey }, { resource: r.id });
    return unnotified.length;
  }

  /** Current period of every task, older runs still open, the recent history and time spent. */
  async overview(now = new Date()) {
    await this.ensurePeriods(now);
    const current = PLATFORM_TASKS.map((t) => ({ taskKey: t.key, periodKey: periodOf(t.cadence, now).key }));
    const [runs, backlog, history] = await Promise.all([
      this.prisma.platformTaskRun.findMany({ where: { OR: current } }),
      this.prisma.platformTaskRun.findMany({ where: { status: { in: [...OPEN] }, NOT: { OR: current } }, orderBy: { dueAt: 'asc' } }),
      this.prisma.platformTaskRun.findMany({ where: { status: { in: ['done', 'passed'] } }, orderBy: { completedAt: 'desc' }, take: 50 }),
    ]);
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [spent, closedThisMonth] = await Promise.all([
      this.prisma.platformTaskRun.aggregate({ where: { completedAt: { gte: month } }, _sum: { minutes: true } }),
      this.prisma.platformTaskRun.count({ where: { completedAt: { gte: month } } }),
    ]);
    const names = await this.userNames([...runs, ...backlog, ...history].map((r) => r.completedById));
    const byKey = new Map(runs.map((r) => [r.taskKey, r]));
    return {
      current: PLATFORM_TASKS.map((t) => this.view(byKey.get(t.key)!, names)),
      backlog: backlog.map((r) => this.view(r, names)),
      history: history.map((r) => this.view(r, names)),
      month: { minutes: spent._sum.minutes ?? 0, closed: closedThisMonth, estimateMinutes: monthlyEstimate() },
    };
  }

  /** Nightly result from infra/prod/backup.sh. */
  async backupReport(report: BackupReport) {
    const name = report.result === 'ok' ? 'platform.backup_completed' : 'platform.backup_failed';
    await this.events.emit(name, { offsite: report.offsite === true, sizeBytes: report.sizeBytes ?? null, file: report.file ?? null }, { resource: 'platform-database' });
    if (report.result !== 'ok') {
      await this.notify.toStaff({ subject: 'Platform database backup failed', text: `The nightly backup of the control plane database failed${report.file ? ` (${report.file})` : ''}. Check the backup container logs on the management server.\n` });
    }
    return { ok: true };
  }

  private async find(id: string) {
    const run = await this.prisma.platformTaskRun.findUnique({ where: { id } });
    if (!run || !taskByKey(run.taskKey)) throw ApiError.notFound('platform task', id);
    return run;
  }

  private async userNames(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((x): x is string => !!x))];
    if (!unique.length) return new Map<string, string>();
    const users = await this.prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  private view(r: PlatformTaskRun, names = new Map<string, string>()) {
    const t = taskByKey(r.taskKey)!;
    const details = (r.checkDetails ?? {}) as { items?: unknown[] };
    return {
      id: r.id,
      taskKey: r.taskKey,
      cadence: t.cadence,
      mode: t.mode,
      hasCheck: !!t.check,
      evidenceRequired: !!t.evidenceRequired,
      estimateMinutes: t.estimateMinutes,
      periodKey: r.periodKey,
      periodStart: r.periodStart,
      dueAt: r.dueAt,
      status: r.status,
      check: r.checkedAt ? { status: r.checkStatus, summary: r.checkSummary, items: details.items ?? [], at: r.checkedAt } : null,
      note: r.note,
      evidence: r.evidence,
      minutes: r.minutes,
      completedBy: r.completedById ? { id: r.completedById, name: names.get(r.completedById) ?? null } : null,
      completedAt: r.completedAt,
    };
  }
}

/** Expected engineer minutes per month: weekly tasks count 52/12 times, quarterly a third. */
function monthlyEstimate() {
  const factor = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3 } as const;
  return Math.round(PLATFORM_TASKS.reduce((sum, t) => sum + t.estimateMinutes * factor[t.cadence], 0));
}
