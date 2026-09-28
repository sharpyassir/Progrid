import { Injectable, Logger } from '@nestjs/common';
import type { WorkTimer } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ApiError } from '../../../common/errors/api-error';
import type { Actor } from '../../../common/auth/actor';
import { ManagedWorkflows } from '../../managed/managed-workflows.service';
import { ManagedNotify } from '../../managed/managed-notify.service';
import { PagingService } from '../../managed/oncall/paging.service';
import { OpsAudit } from '../ops-audit.service';
import { OpsSettingsService } from '../settings/ops-settings.service';
import type { OpsContext } from '../guards/ops-context';
import { loadConfig } from '../../../config/config';

export const timerWorkflowId = (timerId: string) => `ops-timer-idle-${timerId}`;

export function presentTimer(t: WorkTimer & { ticket?: { id: string; number: number; subject: string } | null }) {
  return {
    id: t.id, contractId: t.contractId, ticketId: t.ticketId, ticket: t.ticket ? { id: t.ticket.id, number: t.ticket.number } : undefined, maintenanceRunId: t.maintenanceRunId,
    note: t.note, startedAt: t.startedAt, lastActivityAt: t.lastActivityAt, promptedAt: t.promptedAt, stoppedAt: t.stoppedAt, stopReason: t.stopReason, workLogId: t.workLogId,
    elapsedSeconds: Math.round(((t.stoppedAt ?? new Date()).getTime() - t.startedAt.getTime()) / 1000),
  };
}

/** Whole minutes between two instants, at least one. */
export function billedMinutes(from: Date, to: Date) {
  return Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 60_000));
}

export type IdlePlan = { state: 'stopped' } | { state: 'running'; prompted: boolean; promptAt: string; stopAt: string };

/**
 * Work timers (spec 5.3). Only the timer creates time; one running timer per engineer, tied to
 * a ticket or a maintenance run. Stopping creates a DRAFT worklog with the terminal session
 * minutes of the window. `opsTimerIdle` prompts the engineer after timerIdlePromptSeconds
 * without activity and stops the timer after timerAutoStopSeconds; an idle stop counts the time
 * up to the last activity only.
 */
@Injectable()
export class TimersService {
  private readonly log = new Logger(TimersService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: ManagedWorkflows,
    private readonly paging: PagingService,
    private readonly notify: ManagedNotify,
    private readonly audit: OpsAudit,
    private readonly settings: OpsSettingsService,
  ) {}

  async current(userId: string) {
    const t = await this.prisma.workTimer.findFirst({ where: { userId, stoppedAt: null }, include: { ticket: { select: { id: true, number: true, subject: true } } } });
    return t ? presentTimer(t) : null;
  }

  async start(ops: OpsContext, dto: { ticketId?: string; maintenanceRunId?: string; note?: string }) {
    if (!!dto.ticketId === !!dto.maintenanceRunId) throw ApiError.invalid('Pass ticketId or maintenanceRunId');
    let contractId: string;
    if (dto.ticketId) {
      const t = await this.prisma.ticket.findUniqueOrThrow({ where: { id: dto.ticketId } });
      if (t.status === 'closed' || t.status === 'resolved_pending_pm') throw ApiError.invalidState('The ticket is closed');
      contractId = t.contractId!;
    } else {
      const r = await this.prisma.maintenanceRun.findUniqueOrThrow({ where: { id: dto.maintenanceRunId }, include: { task: { select: { contractId: true } } } });
      contractId = r.task.contractId;
    }
    if (await this.prisma.workTimer.findFirst({ where: { userId: ops.userId, stoppedAt: null } })) throw ApiError.conflict('timer_running', 'Stop your running timer first');
    let timer: WorkTimer;
    try {
      timer = await this.prisma.workTimer.create({ data: { userId: ops.userId, engineerId: ops.profile?.id ?? null, contractId, ticketId: dto.ticketId ?? null, maintenanceRunId: dto.maintenanceRunId ?? null, note: dto.note ?? null } });
    } catch {
      // The partial unique index: another start won the race.
      throw ApiError.conflict('timer_running', 'Stop your running timer first');
    }
    await this.workflows.start('opsTimerIdle', [{ timerId: timer.id }], timerWorkflowId(timer.id));
    await this.audit.emit('ops.timer_started', ops, { contractId, ticketId: timer.ticketId, maintenanceRunId: timer.maintenanceRunId, timerId: timer.id }, `timer:${timer.id}`);
    return (await this.current(ops.userId))!;
  }

  async stop(who: OpsContext | Actor | null, userId: string, opts: { note?: string; billable?: boolean; reason?: 'manual' | 'idle' | 'offboarded' } = {}) {
    const t = await this.prisma.workTimer.findFirst({ where: { userId, stoppedAt: null } });
    if (!t) throw ApiError.invalidState('No timer is running');
    const now = new Date();
    const reason = opts.reason ?? 'manual';
    // An idle stop counts up to the last activity, not the idle time after it.
    const end = reason === 'idle' ? new Date(Math.max(t.lastActivityAt.getTime(), t.startedAt.getTime() + 60_000)) : now;
    const sessionMinutes = await this.sessionMinutes(userId, t.startedAt, end);
    const workLog = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.workTimer.updateMany({ where: { id: t.id, stoppedAt: null }, data: { stoppedAt: now, stopReason: reason } });
      if (!claimed.count) return null;
      const w = await tx.workLog.create({
        data: {
          contractId: t.contractId, ticketId: t.ticketId, maintenanceRunId: t.maintenanceRunId, userId, engineerId: t.engineerId, minutes: billedMinutes(t.startedAt, end),
          billable: opts.billable ?? true, note: opts.note ?? t.note, workedAt: t.startedAt, startedAt: t.startedAt, endedAt: end, status: 'DRAFT', source: 'TIMER', sessionMinutes,
          ...(reason === 'idle' ? { flagged: true, reason: 'Stopped automatically after no activity' } : {}),
        },
      });
      await tx.workTimer.update({ where: { id: t.id }, data: { workLogId: w.id } });
      return w;
    });
    if (!workLog) throw ApiError.invalidState('No timer is running');
    await this.workflows.signal(timerWorkflowId(t.id), 'timerStopped');
    await this.audit.emit(reason === 'idle' ? 'ops.timer_auto_stopped' : 'ops.timer_stopped', who, { contractId: t.contractId, ticketId: t.ticketId, maintenanceRunId: t.maintenanceRunId, timerId: t.id, workLogId: workLog.id, minutes: workLog.minutes, reason }, `timer:${t.id}`);
    return { timer: presentTimer((await this.prisma.workTimer.findUniqueOrThrow({ where: { id: t.id } }))), workLog: { id: workLog.id, minutes: workLog.minutes, status: workLog.status, sessionMinutes: workLog.sessionMinutes } };
  }

  /** Engineer activity: a ticket action, a terminal session event or a heartbeat from the ops console. */
  async activity(userId: string) {
    await this.prisma.workTimer.updateMany({ where: { userId, stoppedAt: null }, data: { lastActivityAt: new Date(), promptedAt: null } });
  }

  // ---- idle workflow ----

  async idlePlan(timerId: string): Promise<IdlePlan> {
    const t = await this.prisma.workTimer.findUnique({ where: { id: timerId } });
    if (!t || t.stoppedAt) return { state: 'stopped' };
    const s = await this.settings.get();
    const base = t.lastActivityAt.getTime();
    return { state: 'running', prompted: !!t.promptedAt, promptAt: new Date(base + s.timerIdlePromptSeconds * 1000).toISOString(), stopAt: new Date(base + s.timerAutoStopSeconds * 1000).toISOString() };
  }

  /** The timer has been idle for timerIdlePromptSeconds: ask the engineer whether they are still working. */
  async idlePrompt(timerId: string): Promise<'prompted' | 'active' | 'stopped'> {
    const plan = await this.idlePlan(timerId);
    if (plan.state === 'stopped') return 'stopped';
    if (new Date(plan.promptAt) > new Date()) return 'active';
    const t = await this.prisma.workTimer.update({ where: { id: timerId }, data: { promptedAt: new Date() }, include: { user: { select: { email: true } }, ticket: { select: { number: true } } } });
    const minutes = Math.round((Date.now() - t.lastActivityAt.getTime()) / 60_000);
    const subject = `Your work timer is still running${t.ticket ? ` on #${t.ticket.number}` : ''}`;
    const message = `No activity for ${minutes} minutes. Open the ops console to keep it running, or stop it. It stops on its own soon.`;
    await this.notify.send({ to: t.user.email, subject, text: `${message}\n${loadConfig().PRGD_OPS_URL}/timesheet` });
    await this.paging.page({ userId: t.userId, urgency: 'low', subject, message, ticketId: t.ticketId ?? undefined }).catch((e) => this.log.warn(`idle prompt page failed: ${(e as Error).message}`));
    await this.audit.emit('ops.timer_idle_prompt', null, { contractId: t.contractId, ticketId: t.ticketId, timerId, idleMinutes: minutes }, `timer:${timerId}`);
    return 'prompted';
  }

  async idleStop(timerId: string): Promise<'stopped' | 'active'> {
    const plan = await this.idlePlan(timerId);
    if (plan.state === 'stopped') return 'stopped';
    if (new Date(plan.stopAt) > new Date()) return 'active';
    const t = await this.prisma.workTimer.findUniqueOrThrow({ where: { id: timerId } });
    await this.stop(null, t.userId, { reason: 'idle' }).catch(() => undefined);
    return 'stopped';
  }

  /** Minutes of the engineer's terminal sessions inside [from, to), overlapping sessions counted once. */
  async sessionMinutes(userId: string, from: Date, to: Date) {
    const rows = await this.prisma.terminalSession.findMany({ where: { userId, startedAt: { not: null, lt: to }, OR: [{ endedAt: null }, { endedAt: { gt: from } }] }, select: { startedAt: true, endedAt: true } });
    const spans = rows
      .map((r) => [Math.max(r.startedAt!.getTime(), from.getTime()), Math.min((r.endedAt ?? new Date()).getTime(), to.getTime())] as const)
      .filter(([a, b]) => b > a)
      .sort((x, y) => x[0] - y[0]);
    let total = 0;
    let cursor = -Infinity;
    for (const [a, b] of spans) {
      const start = Math.max(a, cursor);
      if (b > start) total += b - start;
      cursor = Math.max(cursor, b);
    }
    return Math.round(total / 60_000);
  }
}
