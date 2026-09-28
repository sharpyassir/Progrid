import { Injectable } from '@nestjs/common';
import type { Prisma, WorkLog } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ApiError } from '../../../common/errors/api-error';
import { cursorArgs, toPage } from '../../../common/pagination';
import type { Actor } from '../../../common/auth/actor';
import { EventsService } from '../../events/events.service';
import { isLead } from '../managed.constants';

export function presentWorkLog(w: WorkLog & { user?: { id: string; name: string } }) {
  return {
    id: w.id, contractId: w.contractId, ticketId: w.ticketId, userId: w.userId, user: w.user, minutes: w.minutes, billable: w.billable, note: w.note, workedAt: w.workedAt,
    billedPeriod: w.billedPeriod, billedInvoiceId: w.billedInvoiceId, createdAt: w.createdAt, updatedAt: w.updatedAt,
  };
}

export interface WorkLogInput {
  contractId: string;
  ticketId?: string | null;
  userId?: string;
  minutes: number;
  billable?: boolean;
  note?: string;
  workedAt?: Date;
}

/**
 * Engineer time per contract. Billable minutes beyond the plan's included minutes are billed
 * as overage at month end (ManagedBillingService). An entry the billing run already counted
 * is locked. Engineers edit their own entries; support leads edit anyone's.
 */
@Injectable()
export class WorkLogsService {
  constructor(private readonly prisma: PrismaService, private readonly events: EventsService) {}

  async list(actor: Actor, q: { contractId?: string; ticketId?: string; userId?: string; from?: Date; to?: Date; billable?: string; limit: number; cursor?: string }) {
    const where: Prisma.WorkLogWhereInput = {
      ...(q.contractId ? { contractId: q.contractId } : {}),
      ...(q.ticketId ? { ticketId: q.ticketId } : {}),
      ...(q.userId ? { userId: q.userId === 'me' ? actor.userId : q.userId } : {}),
      ...(q.billable ? { billable: q.billable === 'true' } : {}),
      ...(q.from || q.to ? { workedAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } } : {}),
    };
    const [rows, totals] = await Promise.all([
      this.prisma.workLog.findMany({ where, include: { user: { select: { id: true, name: true } } }, orderBy: [{ workedAt: 'desc' }, { id: 'desc' }], ...cursorArgs({ limit: q.limit, cursor: q.cursor }) }),
      this.prisma.workLog.groupBy({ by: ['billable'], where, _sum: { minutes: true } }),
    ]);
    const page = toPage(rows.map(presentWorkLog), q.limit);
    return { ...page, totals: { billableMinutes: totals.find((t) => t.billable)?._sum.minutes ?? 0, nonBillableMinutes: totals.find((t) => !t.billable)?._sum.minutes ?? 0 } };
  }

  async create(actor: Actor, dto: WorkLogInput) {
    const c = await this.prisma.managedContract.findUnique({ where: { id: dto.contractId } });
    if (!c) throw ApiError.notFound('managed contract', dto.contractId);
    if (c.status === 'DRAFT') throw ApiError.invalidState('Log time once the contract is onboarding');
    const userId = dto.userId ?? actor.userId;
    if (userId !== actor.userId && !isLead(actor)) throw ApiError.forbidden('Only a support lead can log time for someone else');
    await this.checkTicket(dto.ticketId, dto.contractId);
    this.checkWhen(dto.workedAt);
    const w = await this.prisma.workLog.create({ data: { contractId: dto.contractId, ticketId: dto.ticketId ?? null, userId, minutes: dto.minutes, billable: dto.billable ?? true, note: dto.note ?? null, workedAt: dto.workedAt ?? new Date() }, include: { user: { select: { id: true, name: true } } } });
    await this.events.emit('managed.worklog_created', { workLogId: w.id, contractId: w.contractId, ticketId: w.ticketId, minutes: w.minutes, billable: w.billable }, { teamId: c.teamId, actor, resource: `managed_contract:${c.id}` });
    return presentWorkLog(w);
  }

  async update(actor: Actor, id: string, dto: Partial<Omit<WorkLogInput, 'contractId' | 'userId'>>) {
    const w = await this.editable(actor, id);
    if (dto.ticketId !== undefined) await this.checkTicket(dto.ticketId, w.contractId);
    this.checkWhen(dto.workedAt);
    const updated = await this.prisma.workLog.update({ where: { id }, data: { ticketId: dto.ticketId, minutes: dto.minutes, billable: dto.billable, note: dto.note, workedAt: dto.workedAt }, include: { user: { select: { id: true, name: true } } } });
    await this.events.emit('managed.worklog_updated', { workLogId: id, contractId: w.contractId, changes: dto as Record<string, unknown> }, { teamId: w.contract.teamId, actor, resource: `managed_contract:${w.contractId}` });
    return presentWorkLog(updated);
  }

  async remove(actor: Actor, id: string) {
    const w = await this.editable(actor, id);
    await this.prisma.workLog.delete({ where: { id } });
    await this.events.emit('managed.worklog_deleted', { workLogId: id, contractId: w.contractId, minutes: w.minutes }, { teamId: w.contract.teamId, actor, resource: `managed_contract:${w.contractId}` });
    return { deleted: true };
  }

  private async editable(actor: Actor, id: string) {
    const w = await this.prisma.workLog.findUnique({ where: { id }, include: { contract: { select: { teamId: true } } } });
    if (!w) throw ApiError.notFound('worklog', id);
    if (w.userId !== actor.userId && !isLead(actor)) throw ApiError.forbidden('Only a support lead can change someone else\'s time');
    if (w.billedPeriod || w.billedInvoiceId) throw ApiError.invalidState('This entry was already billed; add a correcting entry instead');
    return w;
  }

  private async checkTicket(ticketId: string | null | undefined, contractId: string) {
    if (!ticketId) return;
    const t = await this.prisma.ticket.findFirst({ where: { id: ticketId, contractId } });
    if (!t) throw ApiError.invalid('The ticket does not belong to this contract');
  }

  private checkWhen(at?: Date) {
    if (at && at.getTime() > Date.now() + 86_400_000) throw ApiError.invalid('workedAt cannot be in the future');
  }
}
