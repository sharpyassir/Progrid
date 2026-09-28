import { Injectable, Logger } from '@nestjs/common';
import type { Page, PageChannel } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { MailService } from '../../../common/mail/mail.service';
import { ApiError } from '../../../common/errors/api-error';
import type { Actor } from '../../../common/auth/actor';
import { loadConfig } from '../../../config/config';
import { EventsService } from '../../events/events.service';
import { ManagedWorkflows } from '../managed-workflows.service';
import { OnCallService, type StaffContact } from './oncall.service';
import { EmailPagingProvider, LogPagingProvider, PushWebhookPagingProvider, TwilioPagingProvider, type PagingProvider } from './paging.providers';

export interface PageRequest {
  userId: string;
  urgency: 'high' | 'low';
  subject: string;
  message: string;
  alertId?: string;
  ticketId?: string;
  /** Start the escalation timer (high urgency pages to the on call engineer). */
  escalate?: boolean;
  /** Contract the page is about: only someone eligible for it is paged as on call (assignment and residency). */
  contractId?: string | null;
  escalatedFromId?: string;
}

export function presentPage(p: Page & { user?: { id: string; name: string; email: string } }) {
  return {
    id: p.id, alertId: p.alertId, ticketId: p.ticketId, userId: p.userId, user: p.user, channel: p.channel, provider: p.provider, urgency: p.urgency,
    message: p.message, error: p.error, sentAt: p.sentAt, ackAt: p.ackAt, ackById: p.ackById, escalatedAt: p.escalatedAt, escalatedFromId: p.escalatedFromId, createdAt: p.createdAt,
  };
}

/**
 * Paging. High urgency goes to the person's preferred channel (SMS when they have a phone,
 * otherwise email); low urgency (SLA warnings) goes to push when configured, otherwise email.
 * PAGING_MODE=log records every page without sending it. In live mode a channel that is not
 * configured, or a person without a phone, falls back to email so a page is never dropped.
 * A high urgency page with `escalate` starts `managedPageEscalation`, which pages the support
 * lead when nobody acknowledges within PAGE_ACK_TIMEOUT_SECONDS.
 */
@Injectable()
export class PagingService {
  private readonly log = new Logger(PagingService.name);
  private readonly email: EmailPagingProvider;
  private readonly live: Record<PageChannel, PagingProvider>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly oncall: OnCallService,
    private readonly workflows: ManagedWorkflows,
    mail: MailService,
  ) {
    this.email = new EmailPagingProvider(mail);
    this.live = { SMS: new TwilioPagingProvider('SMS'), WHATSAPP: new TwilioPagingProvider('WHATSAPP'), PUSH: new PushWebhookPagingProvider(), EMAIL: this.email };
  }

  /** Channel and provider for one person. */
  route(to: StaffContact, urgency: 'high' | 'low'): PagingProvider {
    const wanted: PageChannel = urgency === 'low' ? (loadConfig().PUSH_WEBHOOK_URL ? 'PUSH' : 'EMAIL') : to.pagingChannel ?? (to.phone ? 'SMS' : 'EMAIL');
    if (loadConfig().PAGING_MODE === 'log') return new LogPagingProvider(wanted);
    const provider = this.live[wanted];
    return provider.canReach(to) ? provider : this.email;
  }

  async page(req: PageRequest) {
    const to = await this.prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, name: true, email: true, phone: true, pagingChannel: true, staffRoles: true } });
    if (!to) throw new Error(`cannot page unknown user ${req.userId}`);
    const provider = this.route(to, req.urgency);
    const row = await this.prisma.page.create({ data: { userId: to.id, alertId: req.alertId ?? null, ticketId: req.ticketId ?? null, channel: provider.channel, provider: provider.name, urgency: req.urgency, message: `${req.subject}: ${req.message}`.slice(0, 2000), escalatedFromId: req.escalatedFromId ?? null } });
    const c = loadConfig();
    const url = req.alertId ? `${c.CONSOLE_URL}/admin/managed/alerts/${req.alertId}` : req.ticketId ? `${c.CONSOLE_URL}/admin/managed/tickets/${req.ticketId}` : `${c.CONSOLE_URL}/admin/managed`;
    let error: string | null = null;
    try {
      await provider.send({ pageId: row.id, to, urgency: req.urgency, subject: req.subject, message: req.message, url });
    } catch (e) {
      error = (e as Error).message.slice(0, 500);
      this.log.warn(`page ${row.id} via ${provider.name} failed: ${error}`);
      if (provider !== this.email && provider.name !== 'log') {
        // Last resort: email, so a failed SMS still reaches someone.
        await this.email.send({ pageId: row.id, to, urgency: req.urgency, subject: req.subject, message: req.message, url }).catch(() => undefined);
      }
    }
    const sent = await this.prisma.page.update({ where: { id: row.id }, data: { sentAt: new Date(), error } });
    await this.events.emit('managed.page_sent', { pageId: row.id, userId: to.id, channel: sent.channel, provider: sent.provider, urgency: req.urgency, alertId: req.alertId ?? null, ticketId: req.ticketId ?? null, error }, { resource: `page:${row.id}` });
    if (req.escalate && req.urgency === 'high') await this.workflows.start('managedPageEscalation', [{ pageId: row.id }], ManagedWorkflows.pageEscalationId(row.id));
    return sent;
  }

  /** Pages the current primary on call, if any, with escalation. */
  async pageOnCall(req: Omit<PageRequest, 'userId' | 'escalate'>) {
    const primary = await this.oncall.primary(new Date(), req.contractId);
    if (!primary) {
      // Nobody on call: go straight to the support lead so the page is not lost.
      const lead = await this.oncall.supportLead();
      if (!lead) {
        this.log.error(`nobody on call and no support lead to page for: ${req.subject}`);
        return null;
      }
      return this.page({ ...req, userId: lead.id, escalate: false });
    }
    return this.page({ ...req, userId: primary.id, escalate: true });
  }

  async list(q: { userId?: string; open?: boolean; alertId?: string; ticketId?: string; limit?: number }) {
    const rows = await this.prisma.page.findMany({
      where: { ...(q.userId ? { userId: q.userId } : {}), ...(q.open ? { ackAt: null, urgency: 'high' } : {}), ...(q.alertId ? { alertId: q.alertId } : {}), ...(q.ticketId ? { ticketId: q.ticketId } : {}) },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(q.limit ?? 100, 500),
    });
    return { data: rows.map(presentPage) };
  }

  async ack(actor: Actor, pageId: string) {
    const p = await this.prisma.page.findUnique({ where: { id: pageId } });
    if (!p) throw ApiError.notFound('page', pageId);
    if (p.ackAt) return presentPage(p);
    const now = new Date();
    // Acknowledging a page also covers the other open pages for the same alert or ticket.
    await this.prisma.page.updateMany({ where: { ackAt: null, OR: [{ id: pageId }, ...(p.alertId ? [{ alertId: p.alertId }] : []), ...(p.ticketId ? [{ ticketId: p.ticketId }] : [])] }, data: { ackAt: now, ackById: actor.userId } });
    await this.events.emit('managed.page_acknowledged', { pageId, alertId: p.alertId, ticketId: p.ticketId }, { actor, resource: `page:${pageId}` });
    return presentPage(await this.prisma.page.findUniqueOrThrow({ where: { id: pageId } }));
  }

  /** Acknowledges every open page about an alert (and its ticket). */
  async ackByAlert(actor: Actor, alertId: string, ticketId?: string | null) {
    const now = new Date();
    const r = await this.prisma.page.updateMany({ where: { ackAt: null, OR: [{ alertId }, ...(ticketId ? [{ ticketId }] : [])] }, data: { ackAt: now, ackById: actor.userId } });
    return r.count;
  }

  /**
   * Called by `managedPageEscalation` after the acknowledgement timeout: pages the support lead
   * when the original page is still open. Returns what happened.
   */
  async escalate(pageId: string): Promise<'acknowledged' | 'escalated' | 'no_lead' | 'resolved'> {
    const p = await this.prisma.page.findUnique({ where: { id: pageId }, include: { alert: true, ticket: true } });
    if (!p || p.ackAt) return 'acknowledged';
    if (p.escalatedAt) return 'escalated';
    if (p.alert?.status === 'RESOLVED' && (!p.ticket || p.ticket.status === 'closed')) return 'resolved';
    const lead = await this.oncall.supportLead(p.userId);
    await this.prisma.page.update({ where: { id: pageId }, data: { escalatedAt: new Date() } });
    if (!lead) {
      this.log.error(`page ${pageId} was not acknowledged and there is no support lead to escalate to`);
      return 'no_lead';
    }
    const who = await this.prisma.user.findUnique({ where: { id: p.userId }, select: { name: true } });
    await this.page({ userId: lead.id, urgency: 'high', subject: 'Escalated: page not acknowledged', message: `${who?.name ?? 'The on call engineer'} did not acknowledge within ${Math.round(loadConfig().PAGE_ACK_TIMEOUT_SECONDS / 60) || 1} minutes. ${p.message}`, alertId: p.alertId ?? undefined, ticketId: p.ticketId ?? undefined, escalatedFromId: p.id });
    await this.events.emit('managed.page_escalated', { pageId, toUserId: lead.id, alertId: p.alertId, ticketId: p.ticketId }, { resource: `page:${pageId}` });
    return 'escalated';
  }
}
