import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Postmortem, PostmortemStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ApiError } from '../../../common/errors/api-error';
import type { Actor } from '../../../common/auth/actor';
import { loadConfig } from '../../../config/config';
import { EventsService } from '../../events/events.service';
import { ManagedWorkflows } from '../../managed/managed-workflows.service';
import { ManagedTicketsService } from '../../managed/tickets/tickets.service';
import { ManagedNotify } from '../../managed/managed-notify.service';
import { OnCallService } from '../../managed/oncall/oncall.service';
import { PagingService } from '../../managed/oncall/paging.service';
import { OpsAudit } from '../ops-audit.service';
import { OpsSettingsService } from '../settings/ops-settings.service';
import { canSee, contractFilter, type OpsContext } from '../guards/ops-context';
import { maskContact } from '../serializers/ops-dto';

export const postmortemWorkflowId = (id: string) => `ops-postmortem-${id}`;

export interface PostmortemFields {
  timeline?: string;
  impact?: string;
  rootCause?: string;
  fix?: string;
  prevention?: string;
}

type Row = Postmortem & { ticket: { id: string; number: number; subject: string; contractId: string | null; assetId: string | null; status: string; closedAt: Date | null } };
const include = { ticket: { select: { id: true, number: true, subject: true, contractId: true, assetId: true, status: true, closedAt: true } } } satisfies Prisma.PostmortemInclude;

export function presentPostmortem(p: Row, external = false) {
  return {
    id: p.id, ticketId: p.ticketId, ticket: { id: p.ticket.id, number: p.ticket.number, subject: external ? maskContact(p.ticket.subject) : p.ticket.subject, status: p.ticket.status, resolvedAt: p.ticket.closedAt },
    contractId: p.ticket.contractId, authorId: p.authorId, status: p.status, timeline: p.timeline, impact: p.impact, rootCause: p.rootCause, fix: p.fix, prevention: p.prevention,
    dueAt: p.dueAt, overdue: p.status === 'DRAFT' && p.dueAt < new Date(), submittedAt: p.submittedAt, submittedById: p.submittedById, closedById: p.closedById, closedAt: p.closedAt, closeComment: p.closeComment,
    createdAt: p.createdAt, updatedAt: p.updatedAt,
  };
}

export type PostmortemPlan = { state: 'done' } | { state: 'waiting'; remindAt: string; dueAt: string; reminded: boolean; overdue: boolean };

const REQUIRED: (keyof PostmortemFields)[] = ['timeline', 'impact', 'rootCause', 'fix', 'prevention'];

/**
 * Postmortems (spec 5.1): every managed P1 needs one. Closing a P1 moves it to
 * resolved_pending_pm (customers see it closed) and creates a DRAFT due postmortemDueHours (48)
 * after the resolution, prefilled with the root cause note and a timeline. Submitting it closes
 * the ticket; a support lead then closes the postmortem. `opsPostmortemDue` reminds the author
 * a day before it is due and tells the support lead when it is overdue.
 */
@Injectable()
export class PostmortemsService implements OnModuleInit {
  private readonly log = new Logger(PostmortemsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: ManagedTicketsService,
    private readonly workflows: ManagedWorkflows,
    private readonly notify: ManagedNotify,
    private readonly oncall: OnCallService,
    private readonly paging: PagingService,
    private readonly events: EventsService,
    private readonly audit: OpsAudit,
    private readonly settings: OpsSettingsService,
  ) {}

  onModuleInit() {
    this.tickets.onClosed(async (ticketId) => {
      await this.ensureDraft(ticketId);
    });
  }

  /** A P1 waiting for its postmortem gets a prefilled DRAFT and the due date workflow. */
  async ensureDraft(ticketId: string) {
    const t = await this.prisma.ticket.findUnique({ where: { id: ticketId }, include: { messages: { orderBy: { createdAt: 'asc' } }, alerts: { orderBy: { startsAt: 'asc' } }, postmortem: true } });
    if (!t || t.status !== 'resolved_pending_pm' || t.postmortem) return null;
    const s = await this.settings.get();
    const resolvedAt = t.closedAt ?? new Date();
    const at = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');
    const timeline = [
      ...t.alerts.map((a) => ({ when: a.startsAt, what: `${a.name} firing (${a.severity.toLowerCase()})` })),
      { when: t.createdAt, what: `Ticket #${t.number} opened (${t.source ?? 'customer'})` },
      ...(t.firstRespondedAt ? [{ when: t.firstRespondedAt, what: 'First response to the customer' }] : []),
      ...t.messages.filter((m) => m.internal && !m.rootCause).map((m) => ({ when: m.createdAt, what: `Note: ${m.body.slice(0, 200)}` })),
      { when: resolvedAt, what: 'Resolved' },
    ].sort((a, b) => a.when.getTime() - b.when.getTime()).map((e) => `- ${at(e.when)} UTC: ${e.what}`).join('\n');
    const rootCause = t.messages.filter((m) => m.rootCause).map((m) => m.body.replace(/^Root cause:\s*/, '')).join('\n\n');
    try {
      const pm = await this.prisma.postmortem.create({ data: { ticketId, authorId: t.assigneeId, timeline, rootCause, dueAt: new Date(resolvedAt.getTime() + s.postmortemDueHours * 3600_000) } });
      await this.workflows.start('opsPostmortemDue', [{ postmortemId: pm.id }], postmortemWorkflowId(pm.id));
      await this.audit.emit('ops.postmortem_required', null, { contractId: t.contractId, assetId: t.assetId, ticketId, postmortemId: pm.id, dueAt: pm.dueAt.toISOString() }, `postmortem:${pm.id}`);
      return pm;
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return null;
      throw e;
    }
  }

  // ---- engineer ----

  async list(ops: OpsContext, q: { status?: PostmortemStatus }) {
    const rows = await this.prisma.postmortem.findMany({ where: { ...(q.status ? { status: q.status } : {}), ticket: { contractId: contractFilter(ops) ?? { not: null } } }, include, orderBy: { dueAt: 'asc' }, take: 200 });
    return { data: rows.map((p) => presentPostmortem(p, ops.external)) };
  }

  async get(ops: OpsContext, id: string) {
    return presentPostmortem(await this.visible(ops, id), ops.external);
  }

  /** Writes the postmortem of a P1 ticket (creating it when needed); `submit` closes the ticket. */
  async upsert(ops: OpsContext, dto: PostmortemFields & { ticketId: string; submit?: boolean }) {
    const t = await this.prisma.ticket.findUniqueOrThrow({ where: { id: dto.ticketId } });
    if (t.managedPriority !== 'P1') throw ApiError.invalid('Postmortems are for P1 tickets');
    const existing = await this.prisma.postmortem.findUnique({ where: { ticketId: t.id } });
    const s = await this.settings.get();
    const pm = existing ?? (await this.prisma.postmortem.create({ data: { ticketId: t.id, authorId: ops.userId, dueAt: new Date((t.closedAt ?? new Date()).getTime() + s.postmortemDueHours * 3600_000) } }));
    return this.update(ops, pm.id, dto);
  }

  async update(ops: OpsContext, id: string, dto: PostmortemFields & { submit?: boolean }) {
    const pm = await this.visible(ops, id);
    if (pm.status !== 'DRAFT') throw ApiError.invalidState(`The postmortem is ${pm.status.toLowerCase()}`);
    const fields = Object.fromEntries(REQUIRED.filter((k) => dto[k] !== undefined).map((k) => [k, dto[k]!]));
    const merged = { ...pm, ...fields };
    if (dto.submit) {
      const empty = REQUIRED.filter((k) => !String(merged[k] ?? '').trim());
      if (empty.length) throw new ApiError(422, 'postmortem_incomplete', `Fill in: ${empty.join(', ')}`, { missing: empty });
    }
    const now = new Date();
    await this.prisma.postmortem.update({ where: { id }, data: { ...fields, authorId: pm.authorId ?? ops.userId, ...(dto.submit ? { status: 'SUBMITTED', submittedAt: now, submittedById: ops.userId } : {}) } });
    await this.audit.emit(dto.submit ? 'ops.postmortem_submitted' : 'ops.postmortem_updated', ops, { contractId: pm.ticket.contractId, assetId: pm.ticket.assetId, ticketId: pm.ticketId, postmortemId: id }, `postmortem:${id}`);
    if (dto.submit) {
      await this.workflows.signal(postmortemWorkflowId(id), 'postmortemDone');
      // The P1 was waiting for this: it is closed now (resolution time unchanged).
      const r = await this.prisma.ticket.updateMany({ where: { id: pm.ticketId, status: 'resolved_pending_pm' }, data: { status: 'closed' } });
      if (r.count) await this.events.emit('managed.ticket_updated', { ticketId: pm.ticketId, number: pm.ticket.number, changes: { status: { from: 'resolved_pending_pm', to: 'closed' } }, via: 'postmortem' }, { actor: ops.actor, resource: `ticket:${pm.ticketId}`, teamId: (await this.prisma.ticket.findUnique({ where: { id: pm.ticketId }, select: { teamId: true } }))?.teamId });
    }
    return this.get(ops, id);
  }

  // ---- support lead ----

  async adminList(q: { status?: PostmortemStatus; overdue?: string }) {
    const rows = await this.prisma.postmortem.findMany({ where: { ...(q.status ? { status: q.status } : {}), ...(q.overdue === 'true' ? { status: 'DRAFT', dueAt: { lt: new Date() } } : {}) }, include, orderBy: { dueAt: 'asc' }, take: 500 });
    return { data: rows.map((p) => presentPostmortem(p)) };
  }

  async adminGet(id: string) {
    const p = await this.prisma.postmortem.findUnique({ where: { id }, include });
    if (!p) throw ApiError.notFound('postmortem', id);
    return presentPostmortem(p);
  }

  async close(actor: Actor, id: string, comment?: string) {
    const p = await this.prisma.postmortem.findUnique({ where: { id }, include });
    if (!p) throw ApiError.notFound('postmortem', id);
    if (p.status !== 'SUBMITTED') throw ApiError.invalidState(p.status === 'DRAFT' ? 'The postmortem is not submitted yet' : 'The postmortem is already closed');
    await this.prisma.postmortem.update({ where: { id }, data: { status: 'CLOSED', closedById: actor.userId, closedAt: new Date(), closeComment: comment ?? null } });
    await this.audit.emit('ops.postmortem_closed', actor, { contractId: p.ticket.contractId, assetId: p.ticket.assetId, ticketId: p.ticketId, postmortemId: id, comment: comment ?? null }, `postmortem:${id}`);
    return this.adminGet(id);
  }

  // ---- workflow steps ----

  async plan(id: string): Promise<PostmortemPlan> {
    const p = await this.prisma.postmortem.findUnique({ where: { id } });
    if (!p || p.status !== 'DRAFT') return { state: 'done' };
    return { state: 'waiting', remindAt: new Date(p.dueAt.getTime() - 24 * 3600_000).toISOString(), dueAt: p.dueAt.toISOString(), reminded: !!p.remindedAt, overdue: !!p.overdueNotifiedAt };
  }

  async remind(id: string) {
    const p = await this.prisma.postmortem.findUnique({ where: { id }, include });
    if (!p || p.status !== 'DRAFT' || p.remindedAt) return 'done';
    await this.prisma.postmortem.update({ where: { id }, data: { remindedAt: new Date() } });
    const author = p.authorId ? await this.prisma.user.findUnique({ where: { id: p.authorId }, select: { id: true, email: true } }) : null;
    const subject = `Postmortem due for #${p.ticket.number}`;
    const message = `The postmortem of P1 ticket #${p.ticket.number} is due ${p.dueAt.toISOString().slice(0, 16).replace('T', ' ')} UTC.`;
    if (author) {
      await this.notify.send({ to: author.email, subject, text: `${message}\n${loadConfig().PRGD_OPS_URL}/postmortems/${id}` });
      await this.paging.page({ userId: author.id, urgency: 'low', subject, message, ticketId: p.ticketId }).catch(() => undefined);
    } else await this.notify.toStaff({ subject, text: message });
    await this.audit.emit('ops.postmortem_reminder', null, { contractId: p.ticket.contractId, ticketId: p.ticketId, postmortemId: id }, `postmortem:${id}`);
    return 'reminded';
  }

  async overdue(id: string) {
    const p = await this.prisma.postmortem.findUnique({ where: { id }, include });
    if (!p || p.status !== 'DRAFT' || p.overdueNotifiedAt) return 'done';
    await this.prisma.postmortem.update({ where: { id }, data: { overdueNotifiedAt: new Date() } });
    const lead = await this.oncall.supportLead(p.authorId ?? undefined);
    const subject = `Postmortem overdue for #${p.ticket.number}`;
    const message = `The postmortem of P1 ticket #${p.ticket.number} was due ${p.dueAt.toISOString().slice(0, 16).replace('T', ' ')} UTC and is not submitted.`;
    if (lead) {
      await this.notify.send({ to: lead.email, subject, text: message });
      await this.paging.page({ userId: lead.id, urgency: 'low', subject, message, ticketId: p.ticketId }).catch(() => undefined);
    } else await this.notify.toStaff({ subject, text: message });
    await this.audit.emit('ops.postmortem_overdue', null, { contractId: p.ticket.contractId, ticketId: p.ticketId, postmortemId: id, leadId: lead?.id ?? null }, `postmortem:${id}`);
    return 'overdue';
  }

  private async visible(ops: OpsContext, id: string): Promise<Row> {
    const p = await this.prisma.postmortem.findUnique({ where: { id }, include });
    if (!p || !canSee(ops, p.ticket.contractId)) throw ApiError.notFound('postmortem', id);
    return p;
  }
}
