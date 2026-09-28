import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type ManagedContract, type ManagedPlan, type ManagedPriority } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ApiError } from '../../../common/errors/api-error';
import { cursorArgs, toPage } from '../../../common/pagination';
import type { Actor } from '../../../common/auth/actor';
import { loadConfig } from '../../../config/config';
import { EventsService } from '../../events/events.service';
import { SUPPORT_PRIORITY, isLead, parseTargets } from '../managed.constants';
import { ManagedWorkflows } from '../managed-workflows.service';
import { ManagedNotify } from '../managed-notify.service';
import { SlaService } from '../sla/sla.service';
import { PagingService } from '../oncall/paging.service';
import { OnCallService } from '../oncall/oncall.service';
import type { AdminListManagedTicketsQuery, CreateManagedTicketDto, ListManagedTicketsQuery, StaffMessageDto, UpdateManagedTicketDto } from './tickets.dto';

type ContractWithPlan = ManagedContract & { plan: ManagedPlan };
type TimerKind = 'response' | 'resolve';

const ticketInclude = { messages: { orderBy: { createdAt: 'asc' as const } } } satisfies Prisma.TicketInclude;
type TicketRow = Prisma.TicketGetPayload<{ include: typeof ticketInclude }>;

/** Contract states in which the SLA applies and customers may open tickets. */
const SUPPORTED = ['ONBOARDING', 'ACTIVE'];

export interface SystemTicket {
  contract: ContractWithPlan;
  subject: string;
  body: string;
  priority: ManagedPriority;
  assetId?: string | null;
  /** alert | maintenance */
  source: string;
  assigneeId?: string | null;
  /** Page the on call engineer for P1 and P2 (alerts page themselves and pass false). */
  page?: boolean;
}

/**
 * Managed tickets are support tickets tied to a contract: same tables, same numbering, with
 * P1 to P4 priority, due times from the plan and calendar, an assignee and internal notes.
 * Two `managedSlaTimer` workflows per ticket watch the response and resolve targets. P1 and
 * P2 tickets page the current primary on call.
 */
@Injectable()
export class ManagedTicketsService {
  private readonly log = new Logger(ManagedTicketsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly sla: SlaService,
    private readonly paging: PagingService,
    private readonly oncall: OnCallService,
    private readonly workflows: ManagedWorkflows,
    private readonly notify: ManagedNotify,
  ) {}

  // ---- customer ----

  async list(actor: Actor, q: ListManagedTicketsQuery) {
    const rows = await this.prisma.ticket.findMany({
      where: { teamId: actor.teamId, contractId: q.contractId ?? { not: null }, ...(q.status && q.status !== 'all' ? { status: q.status } : {}), ...(q.priority ? { managedPriority: q.priority } : {}) },
      include: { _count: { select: { messages: { where: { internal: false } } } } },
      orderBy: { updatedAt: 'desc' },
      ...cursorArgs(q),
    });
    return toPage(rows.map((t) => this.summary(t, t._count.messages)), q.limit);
  }

  async get(actor: Actor, id: string) {
    return this.present(await this.own(actor, id), false);
  }

  async create(actor: Actor, dto: CreateManagedTicketDto) {
    const contract = await this.resolveContract(actor, dto.contractId, dto.assetId);
    if (!SUPPORTED.includes(contract.status)) {
      throw ApiError.invalidState(contract.status === 'SUSPENDED' ? 'Your managed cloud contract is suspended: we keep monitoring, but tickets are paused until it is resumed. Pay any overdue invoice or contact billing.' : `Tickets can be opened once the contract is onboarding or active (it is ${contract.status})`);
    }
    const author = await this.authorName(actor);
    const priority = dto.priority ?? 'P3';
    const ticket = await this.createTicket({ contract, subject: dto.subject.trim(), body: dto.body, priority, assetId: dto.assetId ?? null, createdById: actor.userId, authorName: author, fromSupport: false, source: 'customer', page: true });
    await this.events.emit('ticket.opened', { ticketId: ticket.id, number: ticket.number, subject: ticket.subject, priority: ticket.priority, managedPriority: priority, contractId: contract.id }, { actor, resource: `ticket:${ticket.id}` });
    await this.notify.toStaff({ subject: `[#${ticket.number}] [${priority}] ${ticket.subject}`, text: `${dto.body}\n\nResponse due ${ticket.responseDueAt?.toISOString()}\n${loadConfig().CONSOLE_URL}/admin/managed/tickets/${ticket.id}` });
    return this.present(ticket, false);
  }

  async reply(actor: Actor, id: string, body: string) {
    const t = await this.own(actor, id);
    if (t.status === 'closed' && t.closedAt && Date.now() - t.closedAt.getTime() > 14 * 86_400_000) throw ApiError.invalidState('This ticket was closed more than 14 days ago; open a new one');
    const author = await this.authorName(actor);
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: { status: 'open', closedAt: null, lastCustomerAt: new Date(), messages: { create: { fromSupport: false, authorId: actor.userId, authorName: author, body } } },
      include: ticketInclude,
    });
    await this.events.emit('ticket.replied', { ticketId: id, number: t.number, by: 'customer', contractId: t.contractId }, { actor, resource: `ticket:${id}` });
    await this.notifyAssignee(updated, `Customer replied on #${t.number}`, body);
    return this.present(updated, false);
  }

  async close(actor: Actor, id: string) {
    const t = await this.own(actor, id);
    if (t.status === 'closed') return this.present(t, false);
    const updated = await this.prisma.ticket.update({ where: { id }, data: { status: 'closed', closedAt: new Date() }, include: ticketInclude });
    await this.stopTimers(updated);
    await this.events.emit('ticket.closed', { ticketId: id, number: t.number, by: 'customer', contractId: t.contractId }, { actor, resource: `ticket:${id}` });
    return this.present(updated, false);
  }

  // ---- system (alerts, maintenance) ----

  async openSystemTicket(s: SystemTicket) {
    const ticket = await this.createTicket({ contract: s.contract, subject: s.subject, body: s.body, priority: s.priority, assetId: s.assetId ?? null, createdById: null, authorName: 'Progrid monitoring', fromSupport: true, source: s.source, assigneeId: s.assigneeId, page: s.page ?? false });
    await this.events.emit('ticket.opened', { ticketId: ticket.id, number: ticket.number, subject: ticket.subject, priority: ticket.priority, managedPriority: s.priority, contractId: s.contract.id, source: s.source }, { teamId: s.contract.teamId, resource: `ticket:${ticket.id}` });
    return ticket;
  }

  /** A system note on a ticket (alert resolved, run finished). Public unless `internal`. */
  async addSystemNote(ticketId: string, body: string, internal = false) {
    await this.prisma.ticketMessage.create({ data: { ticketId, fromSupport: true, authorId: null, authorName: 'Progrid monitoring', body, internal } });
    await this.prisma.ticket.update({ where: { id: ticketId }, data: { updatedAt: new Date() } });
  }

  // ---- staff ----

  async adminList(actor: Actor, q: AdminListManagedTicketsQuery) {
    const assignee = q.assignee === 'me' ? actor.userId : q.assignee === 'none' ? null : q.assignee;
    const status = q.status ?? 'all';
    const rows = await this.prisma.ticket.findMany({
      where: {
        contractId: q.contractId ?? { not: null },
        ...(status !== 'all' ? { status } : {}),
        ...(q.priority ? { managedPriority: q.priority } : {}),
        ...(q.assignee !== undefined ? { assigneeId: assignee } : {}),
        ...(q.teamId ? { teamId: q.teamId } : {}),
        ...(q.breached === 'true' ? { breachedAt: { not: null } } : q.breached === 'false' ? { breachedAt: null } : {}),
      },
      include: { _count: { select: { messages: true } }, assignee: { select: { id: true, name: true, email: true } }, asset: { select: { id: true, name: true } }, contract: { select: { id: true, plan: { select: { code: true, name: true } } } } },
      orderBy: status === 'open' || status === 'all' ? [{ status: 'asc' }, { responseDueAt: 'asc' }] : [{ updatedAt: 'desc' }],
      ...cursorArgs(q),
    });
    const teams = await this.prisma.team.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.teamId))] } }, select: { id: true, name: true, slug: true } });
    const teamOf = new Map(teams.map((t) => [t.id, t]));
    return toPage(rows.map((t) => ({ ...this.summary(t, t._count.messages), team: teamOf.get(t.teamId) ?? null, assignee: t.assignee, asset: t.asset, plan: t.contract?.plan ?? null })), q.limit);
  }

  async adminGet(id: string) {
    const t = await this.prisma.ticket.findFirst({ where: { id, contractId: { not: null } }, include: { ...ticketInclude, assignee: { select: { id: true, name: true, email: true } }, asset: { select: { id: true, name: true, kind: true } }, alerts: { select: { id: true, name: true, severity: true, status: true } }, workLogs: { select: { id: true, minutes: true, billable: true, userId: true, workedAt: true } } } });
    if (!t) throw ApiError.notFound('ticket', id);
    const team = await this.prisma.team.findUnique({ where: { id: t.teamId }, select: { id: true, name: true, slug: true } });
    return { ...this.present(t, true), team, assignee: t.assignee, asset: t.asset, alerts: t.alerts, workLogs: t.workLogs };
  }

  async update(actor: Actor, id: string, dto: UpdateManagedTicketDto) {
    const t = await this.prisma.ticket.findFirst({ where: { id, contractId: { not: null } }, include: { contract: { include: { plan: true } } } });
    if (!t || !t.contract) throw ApiError.notFound('ticket', id);
    const data: Prisma.TicketUncheckedUpdateInput = {};
    const changes: Record<string, unknown> = {};
    if (dto.assigneeId !== undefined && dto.assigneeId !== t.assigneeId) {
      if (!isLead(actor) && dto.assigneeId !== actor.userId) throw ApiError.forbidden('Only a support lead can assign tickets to someone else');
      if (dto.assigneeId) {
        const u = await this.prisma.user.findUnique({ where: { id: dto.assigneeId }, select: { isStaff: true } });
        if (!u?.isStaff) throw ApiError.invalid('Tickets can only be assigned to staff');
      }
      data.assigneeId = dto.assigneeId;
      changes.assigneeId = dto.assigneeId;
    }
    let newPriority: ManagedPriority | undefined;
    if (dto.priority && dto.priority !== t.managedPriority) {
      newPriority = dto.priority;
      const due = await this.sla.dueDates(t.contract, dto.priority, t.createdAt);
      Object.assign(data, { managedPriority: dto.priority, priority: SUPPORT_PRIORITY[dto.priority], responseDueAt: due.responseDueAt, resolveDueAt: due.resolveDueAt, firstResponseDueAt: due.responseDueAt, warnedAt: null });
      changes.priority = { from: t.managedPriority, to: dto.priority };
    }
    if (dto.status && dto.status !== t.status) {
      data.status = dto.status;
      data.closedAt = dto.status === 'closed' ? new Date() : null;
      changes.status = { from: t.status, to: dto.status };
    }
    if (!Object.keys(changes).length) return this.adminGet(id);
    const updated = await this.prisma.ticket.update({ where: { id }, data, include: ticketInclude });
    await this.events.emit('managed.ticket_updated', { ticketId: id, number: t.number, changes }, { teamId: t.teamId, actor, resource: `ticket:${id}` });
    if (newPriority) await this.startTimers(updated);
    if (updated.status === 'closed') await this.stopTimers(updated);
    if (changes.assigneeId && dto.assigneeId && dto.assigneeId !== actor.userId) {
      const u = await this.prisma.user.findUnique({ where: { id: dto.assigneeId }, select: { email: true } });
      if (u) await this.notify.send({ to: u.email, subject: `Assigned to you: [#${t.number}] [${updated.managedPriority}] ${t.subject}`, text: `${loadConfig().CONSOLE_URL}/admin/managed/tickets/${id}\nResponse due ${updated.responseDueAt?.toISOString()}` });
    }
    return this.adminGet(id);
  }

  /** Staff reply. A public reply is the first response (stops the response timer) and emails the customer; an internal note does neither. */
  async staffReply(actor: Actor, id: string, dto: StaffMessageDto) {
    const t = await this.prisma.ticket.findFirst({ where: { id, contractId: { not: null } } });
    if (!t) throw ApiError.notFound('ticket', id);
    const staff = await this.prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true } });
    const now = new Date();
    const internal = !!dto.internal;
    const close = !internal && !!dto.close;
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: internal
        ? { messages: { create: { fromSupport: true, internal: true, authorId: actor.userId, authorName: staff?.name ?? 'Progrid engineer', body: dto.body } } }
        : {
            status: close ? 'closed' : 'answered',
            closedAt: close ? now : null,
            lastSupportAt: now,
            firstRespondedAt: t.firstRespondedAt ?? now,
            assigneeId: t.assigneeId ?? actor.userId,
            messages: { create: { fromSupport: true, internal: false, authorId: actor.userId, authorName: staff?.name ?? 'Progrid engineer', body: dto.body } },
          },
      include: ticketInclude,
    });
    await this.events.emit(internal ? 'managed.ticket_note' : close ? 'ticket.closed' : 'ticket.answered', { ticketId: id, number: t.number, by: 'support', contractId: t.contractId }, { teamId: t.teamId, actor, resource: `ticket:${id}` });
    if (!internal) {
      await this.stopTimers(updated);
      await this.notifyCustomer(updated, dto.body);
    }
    return this.adminGet(id);
  }

  // ---- SLA timers (called by the managedSlaTimer workflow) ----

  /** When to warn and when the target is due, or `done` when the timer has nothing left to watch. */
  async timerPlan(ticketId: string, kind: TimerKind, priority: ManagedPriority): Promise<{ state: 'done' } | { state: 'pending'; warnAt: string; dueAt: string; warned: boolean }> {
    const t = await this.timerTicket(ticketId, kind, priority);
    if (!t) return { state: 'done' };
    const targets = parseTargets(kind === 'response' ? t.contract!.plan.responseTargets : t.contract!.plan.resolveTargets, kind);
    const warnAt = await this.sla.pointAt(t.contract!, t.createdAt, targets[priority], 0.75);
    const dueAt = (kind === 'response' ? t.responseDueAt : t.resolveDueAt)!;
    return { state: 'pending', warnAt: warnAt.toISOString(), dueAt: dueAt.toISOString(), warned: false };
  }

  /** 75 percent of the target: email and a low urgency page to the assignee (or the on call engineer). */
  async timerWarn(ticketId: string, kind: TimerKind, priority: ManagedPriority): Promise<'done' | 'warned'> {
    const t = await this.timerTicket(ticketId, kind, priority);
    if (!t) return 'done';
    await this.prisma.ticket.update({ where: { id: ticketId }, data: { warnedAt: t.warnedAt ?? new Date() } });
    const due = kind === 'response' ? t.responseDueAt : t.resolveDueAt;
    const who = t.assigneeId ?? (await this.oncall.primary())?.id;
    const subject = `SLA warning: [#${t.number}] [${priority}] ${kind} due ${due?.toISOString().slice(11, 16)} UTC`;
    const message = `${t.subject}. The ${kind} target is 75 percent used; due at ${due?.toISOString()}.`;
    if (who) {
      const u = await this.prisma.user.findUnique({ where: { id: who }, select: { email: true } });
      if (u) await this.notify.send({ to: u.email, subject, text: `${message}\n${loadConfig().CONSOLE_URL}/admin/managed/tickets/${ticketId}` });
      await this.paging.page({ userId: who, urgency: 'low', subject, message, ticketId }).catch((e) => this.log.warn(`warning page failed: ${(e as Error).message}`));
    } else {
      await this.notify.toStaff({ subject, text: message });
    }
    await this.events.emit('managed.sla_warning', { ticketId, number: t.number, kind, priority, dueAt: due?.toISOString(), notified: who ?? null }, { teamId: t.teamId, resource: `ticket:${ticketId}` });
    return 'warned';
  }

  /** 100 percent: records the breach and escalates to the support lead. */
  async timerBreach(ticketId: string, kind: TimerKind, priority: ManagedPriority): Promise<'done' | 'breached'> {
    const t = await this.timerTicket(ticketId, kind, priority);
    if (!t) return 'done';
    const now = new Date();
    await this.prisma.ticket.update({ where: { id: ticketId }, data: { breachedAt: t.breachedAt ?? now, ...(kind === 'response' ? { responseBreached: true } : { resolveBreached: true }) } });
    const lead = await this.oncall.supportLead(t.assigneeId ?? undefined);
    const subject = `SLA breached: [#${t.number}] [${priority}] ${kind} target missed`;
    const message = `${t.subject}. The ${kind} target was due at ${(kind === 'response' ? t.responseDueAt : t.resolveDueAt)?.toISOString()}.`;
    if (lead) {
      await this.notify.send({ to: lead.email, subject, text: `${message}\n${loadConfig().CONSOLE_URL}/admin/managed/tickets/${ticketId}` });
      await this.paging.page({ userId: lead.id, urgency: 'high', subject, message, ticketId }).catch((e) => this.log.warn(`breach page failed: ${(e as Error).message}`));
    } else {
      await this.notify.toStaff({ subject, text: message });
    }
    await this.events.emit('managed.sla_breached', { ticketId, number: t.number, kind, priority, escalatedTo: lead?.id ?? null }, { teamId: t.teamId, resource: `ticket:${ticketId}` });
    return 'breached';
  }

  // ---- helpers ----

  private async createTicket(i: { contract: ContractWithPlan; subject: string; body: string; priority: ManagedPriority; assetId: string | null; createdById: string | null; authorName: string; fromSupport: boolean; source: string; assigneeId?: string | null; page: boolean }) {
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: i.contract.teamId }, select: { supportPlan: true } });
    const now = new Date();
    const due = await this.sla.dueDates(i.contract, i.priority, now);
    const urgent = i.priority === 'P1' || i.priority === 'P2';
    const assigneeId = i.assigneeId !== undefined ? i.assigneeId : urgent ? (await this.oncall.primary())?.id ?? null : null;
    const ticket = await this.prisma.ticket.create({
      data: {
        teamId: i.contract.teamId,
        subject: i.subject.slice(0, 140),
        priority: SUPPORT_PRIORITY[i.priority],
        plan: team.supportPlan,
        createdById: i.createdById,
        contractId: i.contract.id,
        assetId: i.assetId,
        managedPriority: i.priority,
        assigneeId,
        responseDueAt: due.responseDueAt,
        resolveDueAt: due.resolveDueAt,
        firstResponseDueAt: due.responseDueAt,
        source: i.source,
        createdAt: now,
        messages: { create: { fromSupport: i.fromSupport, authorId: i.createdById, authorName: i.authorName, body: i.body } },
      },
      include: ticketInclude,
    });
    await this.startTimers(ticket);
    if (i.page && urgent) {
      await this.paging.pageOnCall({ urgency: 'high', subject: `[#${ticket.number}] [${i.priority}] ${ticket.subject}`, message: `New ${i.priority} ticket. Response due ${due.responseDueAt.toISOString()}.`, ticketId: ticket.id })
        .catch((e) => this.log.error(`paging for ticket ${ticket.id} failed: ${(e as Error).message}`));
    }
    return ticket;
  }

  private async startTimers(t: { id: string; managedPriority: ManagedPriority | null }) {
    if (!t.managedPriority) return;
    for (const kind of ['response', 'resolve'] as const) {
      await this.workflows.start('managedSlaTimer', [{ ticketId: t.id, kind, priority: t.managedPriority }], ManagedWorkflows.slaId(t.id, kind, t.managedPriority));
    }
  }

  /** Wakes the timers so they see the response or the close at once (they also re-check on their own). */
  private async stopTimers(t: { id: string; managedPriority: ManagedPriority | null; status: string }) {
    if (!t.managedPriority) return;
    await this.workflows.signal(ManagedWorkflows.slaId(t.id, 'response', t.managedPriority), 'slaStop');
    if (t.status === 'closed') await this.workflows.signal(ManagedWorkflows.slaId(t.id, 'resolve', t.managedPriority), 'slaStop');
  }

  /** The ticket when the timer still has something to watch, otherwise null. */
  private async timerTicket(ticketId: string, kind: TimerKind, priority: ManagedPriority) {
    const t = await this.prisma.ticket.findUnique({ where: { id: ticketId }, include: { contract: { include: { plan: true } } } });
    if (!t || !t.contract || t.managedPriority !== priority) return null;
    if (!SUPPORTED.includes(t.contract.status)) return null;
    if (t.status === 'closed') return null;
    if (kind === 'response' && t.firstRespondedAt) return null;
    return t;
  }

  private async resolveContract(actor: Actor, contractId?: string, assetId?: string) {
    if (assetId) {
      const a = await this.prisma.managedAsset.findFirst({ where: { id: assetId, removedAt: null, contract: { teamId: actor.teamId } }, include: { contract: { include: { plan: true } } } });
      if (!a) throw ApiError.invalid(`Unknown asset ${assetId}`);
      if (contractId && a.contractId !== contractId) throw ApiError.invalid('The asset belongs to another contract');
      return a.contract;
    }
    if (contractId) {
      const c = await this.prisma.managedContract.findFirst({ where: { id: contractId, teamId: actor.teamId }, include: { plan: true } });
      if (!c) throw ApiError.notFound('managed contract', contractId);
      return c;
    }
    const open = await this.prisma.managedContract.findMany({ where: { teamId: actor.teamId, status: { in: ['ONBOARDING', 'ACTIVE', 'SUSPENDED'] } }, include: { plan: true } });
    if (open.length === 1) return open[0];
    if (!open.length) throw ApiError.invalidState('Your team has no managed cloud contract; request one first');
    throw ApiError.invalid('Your team has more than one managed cloud contract: pass contractId');
  }

  private async own(actor: Actor, id: string) {
    const t = await this.prisma.ticket.findFirst({ where: { id, teamId: actor.teamId, contractId: { not: null } }, include: ticketInclude });
    if (!t) throw ApiError.notFound('ticket', id);
    return t;
  }

  private async authorName(actor: Actor) {
    const u = await this.prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true } });
    return actor.tokenId ? `${u?.name ?? 'API'} (API token)` : u?.name ?? 'Customer';
  }

  private async notifyCustomer(t: TicketRow, body: string) {
    const owners = await this.notify.ownerEmails(t.teamId);
    const opener = t.createdById ? await this.prisma.user.findUnique({ where: { id: t.createdById }, select: { email: true } }) : null;
    const to = new Set([...owners, ...(opener ? [opener.email] : [])]);
    const url = `${loadConfig().CONSOLE_URL}/managed/tickets/${t.id}`;
    await Promise.all([...to].map((email) => this.notify.send({ to: email, subject: `Re: [#${t.number}] ${t.subject}`, text: `${body}\n\nReply here:\n${url}` })));
  }

  private async notifyAssignee(t: TicketRow, subject: string, body: string) {
    const u = t.assigneeId ? await this.prisma.user.findUnique({ where: { id: t.assigneeId }, select: { email: true } }) : null;
    const text = `${body}\n\n${loadConfig().CONSOLE_URL}/admin/managed/tickets/${t.id}`;
    if (u) await this.notify.send({ to: u.email, subject, text });
    else await this.notify.toStaff({ subject, text });
  }

  summary(t: Prisma.TicketGetPayload<object>, messageCount: number) {
    return {
      id: t.id, number: t.number, subject: t.subject, status: t.status, priority: t.managedPriority, contractId: t.contractId, assetId: t.assetId, assigneeId: t.assigneeId, source: t.source,
      responseDueAt: t.responseDueAt, resolveDueAt: t.resolveDueAt, firstRespondedAt: t.firstRespondedAt, closedAt: t.closedAt,
      warnedAt: t.warnedAt, breachedAt: t.breachedAt, responseBreached: t.responseBreached, resolveBreached: t.resolveBreached,
      lastCustomerAt: t.lastCustomerAt, lastSupportAt: t.lastSupportAt, createdAt: t.createdAt, updatedAt: t.updatedAt, messageCount,
    };
  }

  /** Customer view drops internal notes; the staff view keeps them and flags them. */
  present(t: TicketRow, staff: boolean) {
    const messages = t.messages.filter((m) => staff || !m.internal);
    return {
      ...this.summary(t, messages.length),
      messages: messages.map((m) => ({ id: m.id, fromSupport: m.fromSupport, author: m.authorName, body: m.body, createdAt: m.createdAt, ...(staff ? { internal: m.internal, authorId: m.authorId } : {}) })),
    };
  }
}
