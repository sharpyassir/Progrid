import { Injectable, Logger } from '@nestjs/common';
import type { MaintenanceKind, MaintenanceRun, MaintenanceTask, Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ApiError } from '../../../common/errors/api-error';
import { cursorArgs, toPage } from '../../../common/pagination';
import type { Actor } from '../../../common/auth/actor';
import { EventsService } from '../../events/events.service';
import { CONTRACT_REF, contractRef, DEFAULT_PLAYBOOK, type ContractRef } from '../managed.constants';
import { ManagedWorkflows } from '../managed-workflows.service';
import { ManagedTicketsService } from '../tickets/tickets.service';
import { OnCallService } from '../oncall/oncall.service';
import { checkEligibility } from '../../ops/guards/residency';
import { isValidCron, nextRun } from './cron';
import { PLAYBOOK_NAME, runnerFor, type MaintenanceTarget } from './runners';

export function presentTask(t: MaintenanceTask & { asset?: { id: string; name: string } | null; contract?: ContractRef }) {
  return {
    id: t.id, contractId: t.contractId, ...(t.contract ? contractRef(t.contract) : {}), assetId: t.assetId, asset: t.asset ?? undefined, kind: t.kind, name: t.name, cron: t.cron, timezone: t.timezone, playbook: t.playbook, vars: t.vars,
    enabled: t.enabled, lastRunAt: t.lastRunAt, nextRunAt: t.nextRunAt, createdById: t.createdById, createdAt: t.createdAt, updatedAt: t.updatedAt,
  };
}

export function presentRun(r: MaintenanceRun & { task?: { id: string; name: string; kind: MaintenanceKind; contractId: string; contract?: ContractRef } }, withLog = false) {
  const task = r.task ? { id: r.task.id, name: r.task.name, kind: r.task.kind, contractId: r.task.contractId, ...(r.task.contract ? contractRef(r.task.contract) : {}) } : undefined;
  return {
    id: r.id, taskId: r.taskId, task, status: r.status, trigger: r.trigger, runner: r.runner, startedById: r.startedById, startedAt: r.startedAt, finishedAt: r.finishedAt,
    error: r.error, ticketId: r.ticketId, createdAt: r.createdAt, ...(withLog ? { log: r.log } : {}),
  };
}

export interface TaskInput {
  contractId: string;
  assetId?: string | null;
  kind: MaintenanceKind;
  name?: string;
  cron: string;
  timezone?: string;
  playbook?: string;
  vars?: Record<string, unknown>;
  enabled?: boolean;
}

/**
 * Scheduled maintenance: patching, backup restore tests and custom playbooks per contract or
 * asset, on a cron schedule in the task's time zone. A job starts due runs, each executed by
 * `managedMaintenanceRun` through the configured MaintenanceRunner (fake or Ansible). A failed
 * run opens a P3 ticket assigned to the current on call engineer.
 */
@Injectable()
export class MaintenanceService {
  private readonly log = new Logger(MaintenanceService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly workflows: ManagedWorkflows,
    private readonly tickets: ManagedTicketsService,
    private readonly oncall: OnCallService,
  ) {}

  // ---- tasks ----

  async listTasks(q: { contractId?: string; assetId?: string }) {
    const rows = await this.prisma.maintenanceTask.findMany({ where: { ...(q.contractId ? { contractId: q.contractId } : {}), ...(q.assetId ? { assetId: q.assetId } : {}) }, include: { asset: { select: { id: true, name: true } }, contract: CONTRACT_REF }, orderBy: [{ contractId: 'asc' }, { createdAt: 'asc' }] });
    return { data: rows.map(presentTask) };
  }

  async getTask(id: string) {
    const t = await this.prisma.maintenanceTask.findUnique({ where: { id }, include: { asset: { select: { id: true, name: true } }, contract: CONTRACT_REF, runs: { orderBy: { createdAt: 'desc' }, take: 20 } } });
    if (!t) throw ApiError.notFound('maintenance task', id);
    return { ...presentTask(t), runs: t.runs.map((r) => presentRun(r)) };
  }

  async createTask(actor: Actor, dto: TaskInput) {
    const c = await this.prisma.managedContract.findUnique({ where: { id: dto.contractId } });
    if (!c) throw ApiError.notFound('managed contract', dto.contractId);
    if (c.status === 'CANCELLED') throw ApiError.invalidState('The contract is cancelled');
    if (dto.assetId) await this.checkAsset(dto.assetId, dto.contractId);
    const timezone = dto.timezone ?? (c.calendar === 'TR' ? 'Europe/Istanbul' : 'Asia/Riyadh');
    const playbook = this.playbookFor(dto.kind, dto.playbook);
    const enabled = dto.enabled ?? true;
    this.checkSchedule(dto.cron, timezone);
    const t = await this.prisma.maintenanceTask.create({
      data: {
        contractId: dto.contractId, assetId: dto.assetId ?? null, kind: dto.kind, name: dto.name ?? defaultName(dto.kind), cron: dto.cron.trim(), timezone, playbook,
        vars: (dto.vars ?? {}) as Prisma.InputJsonValue, enabled, nextRunAt: enabled ? nextRun(dto.cron, new Date(), timezone) : null, createdById: actor.userId,
      },
      include: { asset: { select: { id: true, name: true } }, contract: CONTRACT_REF },
    });
    await this.events.emit('managed.maintenance_task_created', { taskId: t.id, contractId: t.contractId, kind: t.kind, cron: t.cron }, { teamId: c.teamId, actor, resource: `maintenance_task:${t.id}` });
    return presentTask(t);
  }

  async updateTask(actor: Actor, id: string, dto: Partial<Omit<TaskInput, 'contractId'>>) {
    const cur = await this.prisma.maintenanceTask.findUnique({ where: { id }, include: { contract: true } });
    if (!cur) throw ApiError.notFound('maintenance task', id);
    if (dto.assetId) await this.checkAsset(dto.assetId, cur.contractId);
    const cron = dto.cron?.trim() ?? cur.cron;
    const timezone = dto.timezone ?? cur.timezone;
    const enabled = dto.enabled ?? cur.enabled;
    this.checkSchedule(cron, timezone);
    if (enabled && cur.contract.status === 'CANCELLED') throw ApiError.invalidState('The contract is cancelled');
    // A new playbook, or the default one of a new kind.
    const playbook = dto.playbook ? this.playbookFor(dto.kind ?? cur.kind, dto.playbook) : dto.kind && dto.kind !== cur.kind ? this.playbookFor(dto.kind) : undefined;
    const t = await this.prisma.maintenanceTask.update({
      where: { id },
      data: {
        assetId: dto.assetId, kind: dto.kind, name: dto.name, cron, timezone, enabled,
        playbook,
        vars: dto.vars as Prisma.InputJsonValue | undefined,
        nextRunAt: enabled ? nextRun(cron, new Date(), timezone) : null,
      },
      include: { asset: { select: { id: true, name: true } }, contract: CONTRACT_REF },
    });
    await this.events.emit('managed.maintenance_task_updated', { taskId: id, changes: dto as Record<string, unknown> }, { teamId: cur.contract.teamId, actor, resource: `maintenance_task:${id}` });
    return presentTask(t);
  }

  async deleteTask(actor: Actor, id: string) {
    const cur = await this.prisma.maintenanceTask.findUnique({ where: { id }, include: { contract: true } });
    if (!cur) throw ApiError.notFound('maintenance task', id);
    await this.prisma.maintenanceTask.delete({ where: { id } });
    await this.events.emit('managed.maintenance_task_deleted', { taskId: id, contractId: cur.contractId }, { teamId: cur.contract.teamId, actor, resource: `maintenance_task:${id}` });
    return { deleted: true };
  }

  // ---- runs ----

  async runNow(actor: Actor, taskId: string, trigger: 'manual' | 'retry' = 'manual') {
    const t = await this.prisma.maintenanceTask.findUnique({ where: { id: taskId }, include: { contract: true } });
    if (!t) throw ApiError.notFound('maintenance task', taskId);
    if (t.contract.status === 'CANCELLED' || t.contract.status === 'DRAFT') throw ApiError.invalidState(`The contract is ${t.contract.status}`);
    const run = await this.startRun(t, trigger, actor.userId);
    await this.events.emit('managed.maintenance_run_started', { runId: run.id, taskId, trigger }, { teamId: t.contract.teamId, actor, resource: `maintenance_task:${taskId}` });
    return presentRun(run);
  }

  /** Starts every enabled task whose next run is due. Run by a job every minute. */
  async startDue(now = new Date()) {
    const due = await this.prisma.maintenanceTask.findMany({ where: { enabled: true, nextRunAt: { lte: now }, contract: { status: { in: ['ONBOARDING', 'ACTIVE'] } } }, include: { contract: true }, take: 100 });
    let started = 0;
    for (const t of due) {
      // Claim the slot first so two schedulers never start the same run.
      const claimed = await this.prisma.maintenanceTask.updateMany({ where: { id: t.id, nextRunAt: t.nextRunAt }, data: { lastRunAt: now, nextRunAt: nextRun(t.cron, now, t.timezone) } });
      if (claimed.count !== 1) continue;
      await this.startRun(t, 'schedule', null);
      started++;
    }
    // Suspended contracts keep their schedule but skip the runs.
    await this.skipSuspended(now);
    return started;
  }

  async listRuns(q: { taskId?: string; contractId?: string; status?: string; limit: number; cursor?: string }) {
    const rows = await this.prisma.maintenanceRun.findMany({
      where: { ...(q.taskId ? { taskId: q.taskId } : {}), ...(q.contractId ? { task: { contractId: q.contractId } } : {}), ...(q.status ? { status: q.status as MaintenanceRun['status'] } : {}) },
      include: { task: { select: { id: true, name: true, kind: true, contractId: true, contract: CONTRACT_REF } } },
      orderBy: { createdAt: 'desc' },
      ...cursorArgs({ limit: q.limit, cursor: q.cursor }),
    });
    return toPage(rows.map((r) => presentRun(r)), q.limit);
  }

  async getRun(id: string) {
    const r = await this.prisma.maintenanceRun.findUnique({ where: { id }, include: { task: { select: { id: true, name: true, kind: true, contractId: true, contract: CONTRACT_REF } } } });
    if (!r) throw ApiError.notFound('maintenance run', id);
    return presentRun(r, true);
  }

  /** Executes a run with the configured runner (activity). Idempotent: a finished run returns its status. */
  async execute(runId: string): Promise<'SUCCEEDED' | 'FAILED'> {
    const run = await this.prisma.maintenanceRun.findUnique({ where: { id: runId }, include: { task: { include: { asset: true } } } });
    if (!run) return 'FAILED';
    if (run.status === 'SUCCEEDED' || run.status === 'FAILED') return run.status;
    const runner = runnerFor();
    await this.prisma.maintenanceRun.update({ where: { id: runId }, data: { status: 'RUNNING', startedAt: new Date(), runner: runner.name } });
    const targets = await this.targets(run.task);
    // The log is written as it grows (about once a second) so the ops console can stream it.
    let live = '';
    let written = 0;
    let writing: Promise<unknown> = Promise.resolve();
    const flush = () => {
      if (live.length === written) return;
      written = live.length;
      const log = live.slice(0, 500_000);
      writing = writing.then(() => this.prisma.maintenanceRun.updateMany({ where: { id: runId, status: 'RUNNING' }, data: { log } })).catch(() => undefined);
    };
    const ticker = setInterval(flush, 1000);
    const result = await runner.run({ runId, kind: run.task.kind, playbook: run.task.playbook, vars: (run.task.vars ?? {}) as Record<string, unknown>, targets }, (chunk) => {
      live += chunk;
    })
      .catch((e: Error) => ({ ok: false, log: live, error: e.message }))
      .finally(() => clearInterval(ticker));
    await writing;
    const status = result.ok ? 'SUCCEEDED' : 'FAILED';
    await this.prisma.maintenanceRun.update({ where: { id: runId }, data: { status, finishedAt: new Date(), log: result.log.slice(0, 500_000), error: result.error?.slice(0, 2000) ?? null } });
    const teamId = (await this.prisma.managedContract.findUnique({ where: { id: run.task.contractId }, select: { teamId: true } }))?.teamId;
    await this.events.emit(result.ok ? 'managed.maintenance_run_succeeded' : 'managed.maintenance_run_failed', { runId, taskId: run.taskId, kind: run.task.kind, error: result.error ?? null, targets: targets.length }, { teamId, resource: `maintenance_task:${run.taskId}` });
    return status;
  }

  /** Marks a run failed when the workflow could not execute it at all. */
  async markFailed(runId: string, error: string) {
    await this.prisma.maintenanceRun.updateMany({ where: { id: runId, status: { in: ['QUEUED', 'RUNNING'] } }, data: { status: 'FAILED', finishedAt: new Date(), error: error.slice(0, 2000) } });
  }

  /** A failed run opens a P3 ticket assigned to the current on call engineer. Idempotent. */
  async openFailureTicket(runId: string) {
    const run = await this.prisma.maintenanceRun.findUnique({ where: { id: runId }, include: { task: { include: { asset: true, contract: { include: { plan: true } } } } } });
    if (!run || run.status !== 'FAILED') return null;
    if (run.ticketId) return run.ticketId;
    const t = run.task;
    const what = `${t.name}${t.asset ? ` on ${t.asset.name}` : ''}`;
    // A run an engineer started goes back to them; scheduled runs go to the on call engineer.
    const starter = run.startedById && (await checkEligibility(this.prisma, run.startedById, t.contractId)).ok ? run.startedById : null;
    const onCall = starter ? { id: starter } : await this.oncall.primary(new Date(), t.contractId);
    const ticket = await this.tickets.openSystemTicket({
      contract: t.contract,
      assetId: t.assetId,
      priority: 'P3',
      subject: `Maintenance failed: ${what}`,
      body: `The scheduled maintenance "${what}" did not complete (${run.error ?? 'failed'}). An engineer is looking into it and will reschedule it.`,
      source: 'maintenance',
      assigneeId: onCall?.id ?? null,
      page: false,
    });
    await this.tickets.addSystemNote(ticket.id, `Run ${run.id} with the ${run.runner ?? 'unknown'} runner.\n\n${run.log.slice(-4000)}`, true);
    await this.prisma.maintenanceRun.update({ where: { id: runId }, data: { ticketId: ticket.id } });
    return ticket.id;
  }

  // ---- helpers ----

  private async startRun(t: MaintenanceTask, trigger: 'schedule' | 'manual' | 'retry', startedById: string | null) {
    const run = await this.prisma.maintenanceRun.create({ data: { taskId: t.id, trigger, startedById } });
    if (trigger !== 'schedule') await this.prisma.maintenanceTask.update({ where: { id: t.id }, data: { lastRunAt: new Date() } });
    const ok = await this.workflows.start('managedMaintenanceRun', [{ runId: run.id }], ManagedWorkflows.maintenanceId(run.id));
    if (!ok) {
      // Temporal unavailable: run it here so maintenance is not silently skipped.
      void this.execute(run.id).then((s) => (s === 'FAILED' ? this.openFailureTicket(run.id) : null)).catch((e) => this.log.error(`inline maintenance run ${run.id}: ${(e as Error).message}`));
    }
    return run;
  }

  private async skipSuspended(now: Date) {
    const stale = await this.prisma.maintenanceTask.findMany({ where: { enabled: true, nextRunAt: { lte: now }, contract: { status: { notIn: ['ONBOARDING', 'ACTIVE'] } } }, select: { id: true, cron: true, timezone: true } });
    for (const t of stale) await this.prisma.maintenanceTask.update({ where: { id: t.id }, data: { nextRunAt: nextRun(t.cron, now, t.timezone) } });
  }

  private async targets(task: MaintenanceTask & { asset: { id: string; name: string; managementAddress: string | null; os: string | null; status: string; removedAt: Date | null } | null }): Promise<MaintenanceTarget[]> {
    const assets = task.asset ? [task.asset] : await this.prisma.managedAsset.findMany({ where: { contractId: task.contractId, status: 'APPROVED', removedAt: null, kind: { not: 'SITE' } } });
    return assets.filter((a) => a.status === 'APPROVED' && !a.removedAt && a.managementAddress).map((a) => ({ assetId: a.id, name: a.name, host: a.managementAddress!, os: a.os }));
  }

  private async checkAsset(assetId: string, contractId: string) {
    const a = await this.prisma.managedAsset.findFirst({ where: { id: assetId, contractId, removedAt: null } });
    if (!a) throw ApiError.invalid('The asset does not belong to this contract');
  }

  private playbookFor(kind: MaintenanceKind, playbook?: string) {
    const p = playbook ?? (kind === 'CUSTOM' ? undefined : DEFAULT_PLAYBOOK[kind]);
    if (!p) throw ApiError.invalid('A CUSTOM task needs a playbook');
    if (!PLAYBOOK_NAME.test(p)) throw ApiError.invalid('playbook must be a file name like patching.yml in the playbook directory');
    return p;
  }

  private checkSchedule(cron: string, timezone: string) {
    if (!isValidCron(cron)) throw ApiError.invalid(`"${cron}" is not a valid five field cron expression`);
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch {
      throw ApiError.invalid(`Unknown time zone ${timezone}`);
    }
  }
}

function defaultName(kind: MaintenanceKind) {
  return kind === 'PATCHING' ? 'Operating system patching' : kind === 'BACKUP_TEST' ? 'Backup restore test' : 'Custom maintenance';
}
