import { Injectable } from '@nestjs/common';
import type { Prisma, WorkLog, WorkLogStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ApiError } from '../../../common/errors/api-error';
import type { Actor } from '../../../common/auth/actor';
import { periodBounds, periodKey } from '../../managed/managed.constants';
import { OpsAudit } from '../ops-audit.service';
import { contractFilter, type OpsContext } from '../guards/ops-context';
import { TimersService } from '../timers/timers.service';

type Row = WorkLog & { ticket: { id: string; number: number } | null; contract: { id: string; team: { name: string } }; user?: { id: string; name: string } };

const rowInclude = { ticket: { select: { id: true, number: true } }, contract: { select: { id: true, team: { select: { name: true } } } } } satisfies Prisma.WorkLogInclude;

export function presentEntry(w: Row) {
  return {
    id: w.id, contractId: w.contractId, customer: w.contract.team.name, ticketId: w.ticketId, ticket: w.ticket ? { id: w.ticket.id, number: w.ticket.number } : null, maintenanceRunId: w.maintenanceRunId,
    userId: w.userId, user: w.user ? { id: w.user.id, name: w.user.name } : undefined, minutes: w.minutes, sessionMinutes: w.sessionMinutes, billable: w.billable, note: w.note,
    status: w.status, source: w.source, flagged: w.flagged, reason: w.reason, workedAt: w.workedAt, startedAt: w.startedAt, endedAt: w.endedAt,
    submittedAt: w.submittedAt, reviewedAt: w.reviewedAt, reviewComment: w.reviewComment, createdAt: w.createdAt,
  };
}

/** [start, end) of "2026-09" or of an ISO week "2026-W39" (UTC). */
export function periodRange(q: { month?: string; week?: string }) {
  if (q.week) {
    const m = /^(\d{4})-W(\d{2})$/.exec(q.week);
    if (!m) throw ApiError.invalid('week must look like 2026-W39');
    // ISO week 1 contains January 4th; weeks start on Monday.
    const jan4 = new Date(Date.UTC(+m[1], 0, 4));
    const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86_400_000 + (+m[2] - 1) * 7 * 86_400_000);
    return { start: monday, end: new Date(monday.getTime() + 7 * 86_400_000), label: q.week };
  }
  const month = q.month ?? periodKey(new Date());
  return { ...periodBounds(month), label: month };
}

function totals(rows: { status: WorkLogStatus; minutes: number; billable: boolean }[]) {
  const byStatus = Object.fromEntries((['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID'] as const).map((s) => [s, 0])) as Record<WorkLogStatus, number>;
  for (const r of rows) byStatus[r.status] += r.minutes;
  return { minutes: rows.reduce((a, r) => a + r.minutes, 0), byStatus };
}

/**
 * Timesheets (spec 5.3): an engineer's worklogs per month, manual entries (with a reason,
 * flagged for review), submission, and the support lead's approval or rejection with a
 * comment. Approved entries feed customer overage and contractor pay from the same rows.
 */
@Injectable()
export class TimesheetsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: OpsAudit, private readonly timers: TimersService) {}

  // ---- engineer ----

  async mine(ops: OpsContext, q: { month?: string; week?: string }) {
    const { start, end, label } = periodRange(q);
    const rows = await this.prisma.workLog.findMany({ where: { userId: ops.userId, workedAt: { gte: start, lt: end } }, include: rowInclude, orderBy: [{ workedAt: 'asc' }, { id: 'asc' }] });
    return { period: label, from: start, to: end, entries: rows.map(presentEntry), totals: totals(rows), runningTimer: await this.timers.current(ops.userId) };
  }

  async createManual(ops: OpsContext, dto: { ticketId?: string; maintenanceRunId?: string; minutes: number; startedAt: Date; reason: string; note?: string; billable?: boolean }) {
    if (!!dto.ticketId === !!dto.maintenanceRunId) throw ApiError.invalid('Pass ticketId or maintenanceRunId');
    if (dto.startedAt.getTime() + dto.minutes * 60_000 > Date.now() + 60_000) throw ApiError.invalid('A manual entry cannot end in the future');
    const contractId = dto.ticketId
      ? (await this.prisma.ticket.findUniqueOrThrow({ where: { id: dto.ticketId } })).contractId!
      : (await this.prisma.maintenanceRun.findUniqueOrThrow({ where: { id: dto.maintenanceRunId }, include: { task: true } })).task.contractId;
    const sessionMinutes = await this.timers.sessionMinutes(ops.userId, dto.startedAt, new Date(dto.startedAt.getTime() + dto.minutes * 60_000));
    const w = await this.prisma.workLog.create({
      data: {
        contractId, ticketId: dto.ticketId ?? null, maintenanceRunId: dto.maintenanceRunId ?? null, userId: ops.userId, engineerId: ops.profile?.id ?? null, minutes: dto.minutes, billable: dto.billable ?? true,
        note: dto.note ?? null, workedAt: dto.startedAt, startedAt: dto.startedAt, endedAt: new Date(dto.startedAt.getTime() + dto.minutes * 60_000), status: 'DRAFT', source: 'MANUAL', reason: dto.reason, flagged: true, sessionMinutes,
      },
      include: rowInclude,
    });
    await this.audit.emit('ops.worklog_manual', ops, { contractId, ticketId: w.ticketId, workLogId: w.id, minutes: w.minutes, reason: dto.reason }, `worklog:${w.id}`);
    return presentEntry(w);
  }

  /** Own DRAFT or REJECTED entries. Timer entries keep their minutes; an edited rejected entry goes back to DRAFT. */
  async updateEntry(ops: OpsContext, id: string, dto: { minutes?: number; startedAt?: Date; reason?: string; note?: string; billable?: boolean }) {
    const w = await this.own(ops, id);
    if (w.source === 'TIMER' && (dto.minutes !== undefined || dto.startedAt !== undefined)) throw ApiError.invalid('Timer entries keep their time; add a manual entry with a reason for a correction');
    const startedAt = dto.startedAt ?? w.startedAt ?? w.workedAt;
    const minutes = dto.minutes ?? w.minutes;
    const updated = await this.prisma.workLog.update({
      where: { id },
      data: { minutes, note: dto.note, billable: dto.billable, reason: dto.reason, startedAt, workedAt: startedAt, endedAt: new Date(startedAt.getTime() + minutes * 60_000), status: 'DRAFT', reviewComment: w.status === 'REJECTED' ? w.reviewComment : undefined },
      include: rowInclude,
    });
    await this.audit.emit('ops.worklog_updated', ops, { contractId: w.contractId, ticketId: w.ticketId, workLogId: id, changes: dto as Record<string, unknown> }, `worklog:${id}`);
    return presentEntry(updated);
  }

  async deleteEntry(ops: OpsContext, id: string) {
    const w = await this.own(ops, id);
    await this.prisma.workLog.delete({ where: { id } });
    await this.audit.emit('ops.worklog_deleted', ops, { contractId: w.contractId, ticketId: w.ticketId, workLogId: id, minutes: w.minutes }, `worklog:${id}`);
    return { deleted: true };
  }

  /** Submits every DRAFT entry of a month or ISO week for approval. */
  async submit(ops: OpsContext, q: { month?: string; week?: string }) {
    const { start, end, label } = periodRange(q);
    const where = { userId: ops.userId, status: 'DRAFT' as const, workedAt: { gte: start, lt: end } };
    const rows = await this.prisma.workLog.findMany({ where, select: { id: true, contractId: true } });
    if (!rows.length) throw ApiError.invalidState(`Nothing to submit for ${label}`);
    await this.prisma.workLog.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: 'SUBMITTED', submittedAt: new Date() } });
    for (const contractId of new Set(rows.map((r) => r.contractId))) {
      await this.audit.emit('ops.timesheet_submitted', ops, { contractId, period: label, workLogIds: rows.filter((r) => r.contractId === contractId).map((r) => r.id) }, `timesheet:${ops.userId}:${label}`);
    }
    return { period: label, submitted: rows.length };
  }

  // ---- support lead ----

  /** Engineers with entries waiting for review (or in `status`). */
  async overview(q: { status?: WorkLogStatus; month?: string }) {
    const status = q.status ?? 'SUBMITTED';
    const range = q.month ? periodRange({ month: q.month }) : null;
    const groups = await this.prisma.workLog.groupBy({ by: ['userId'], where: { status, ...(range ? { workedAt: { gte: range.start, lt: range.end } } : {}) }, _sum: { minutes: true }, _count: { _all: true } });
    const users = await this.prisma.user.findMany({ where: { id: { in: groups.map((g) => g.userId) } }, select: { id: true, name: true, engineerProfile: { select: { id: true, kind: true } } } });
    const flagged = await this.prisma.workLog.groupBy({ by: ['userId'], where: { status, flagged: true, userId: { in: groups.map((g) => g.userId) } }, _count: { _all: true } });
    return {
      data: groups.map((g) => {
        const u = users.find((x) => x.id === g.userId);
        return { userId: g.userId, engineerId: u?.engineerProfile?.id ?? null, name: u?.name, kind: u?.engineerProfile?.kind ?? 'INTERNAL', status, entries: g._count._all, minutes: g._sum.minutes ?? 0, flagged: flagged.find((f) => f.userId === g.userId)?._count._all ?? 0 };
      }),
    };
  }

  async entries(engineer: { userId: string }, q: { month?: string; week?: string; status?: WorkLogStatus }) {
    const { start, end, label } = periodRange(q);
    const rows = await this.prisma.workLog.findMany({ where: { userId: engineer.userId, workedAt: { gte: start, lt: end }, ...(q.status ? { status: q.status } : {}) }, include: { ...rowInclude, user: { select: { id: true, name: true } } }, orderBy: [{ workedAt: 'asc' }, { id: 'asc' }] });
    return { period: label, userId: engineer.userId, entries: rows.map(presentEntry), totals: totals(rows) };
  }

  /** Approves or rejects SUBMITTED entries (listed, or every one of a month). Nobody reviews their own time. */
  async review(actor: Actor, engineer: { userId: string }, dto: { decision: 'APPROVED' | 'REJECTED'; workLogIds?: string[]; month?: string; comment?: string }) {
    if (engineer.userId === actor.userId) throw ApiError.forbidden('You cannot approve your own time');
    if (dto.decision === 'REJECTED' && !dto.comment?.trim()) throw ApiError.invalid('A rejection needs a comment');
    if (!dto.workLogIds?.length && !dto.month) throw ApiError.invalid('Pass workLogIds or month');
    const range = dto.month ? periodRange({ month: dto.month }) : null;
    const rows = await this.prisma.workLog.findMany({
      where: { userId: engineer.userId, status: 'SUBMITTED', ...(dto.workLogIds?.length ? { id: { in: dto.workLogIds } } : {}), ...(range ? { workedAt: { gte: range.start, lt: range.end } } : {}) },
      select: { id: true, contractId: true, ticketId: true, minutes: true },
    });
    if (dto.workLogIds?.length && rows.length !== new Set(dto.workLogIds).size) throw ApiError.invalidState('Only submitted entries of this engineer can be reviewed');
    if (!rows.length) throw ApiError.invalidState('Nothing is waiting for review');
    await this.prisma.workLog.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { status: dto.decision, reviewedById: actor.userId, reviewedAt: new Date(), reviewComment: dto.comment ?? null } });
    for (const contractId of new Set(rows.map((r) => r.contractId))) {
      const mine = rows.filter((r) => r.contractId === contractId);
      await this.audit.emit(dto.decision === 'APPROVED' ? 'ops.timesheet_approved' : 'ops.timesheet_rejected', actor, { contractId, engineerUserId: engineer.userId, workLogIds: mine.map((r) => r.id), minutes: mine.reduce((a, r) => a + r.minutes, 0), comment: dto.comment ?? null }, `timesheet:${engineer.userId}`);
    }
    return { decision: dto.decision, count: rows.length, minutes: rows.reduce((a, r) => a + r.minutes, 0) };
  }

  /** An engineer profile id, or a user id (internal engineers may have no profile). */
  async resolveEngineer(id: string) {
    const p = await this.prisma.engineerProfile.findFirst({ where: { OR: [{ id }, { userId: id }] }, select: { userId: true } });
    if (p) return p;
    const u = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!u) throw ApiError.notFound('engineer', id);
    return { userId: u.id };
  }

  private async own(ops: OpsContext, id: string) {
    const w = await this.prisma.workLog.findFirst({ where: { id, userId: ops.userId, contractId: contractFilter(ops) } });
    if (!w) throw ApiError.notFound('worklog', id);
    if (w.status !== 'DRAFT' && w.status !== 'REJECTED') throw ApiError.invalidState(`A ${w.status.toLowerCase()} entry cannot be changed`);
    return w;
  }
}
