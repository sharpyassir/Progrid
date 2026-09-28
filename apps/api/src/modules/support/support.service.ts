import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiError } from '../../common/errors/api-error';
import { cursorArgs, toPage } from '../../common/pagination';
import { MailService } from '../../common/mail/mail.service';
import type { Actor } from '../../common/auth/actor';
import { loadConfig } from '../../config/config';
import { EventsService } from '../events/events.service';
import { SpendService } from '../billing/spend.service';
import { FxService } from '../billing/fx.service';
import { BOOK_CURRENCY } from '../billing/pricing';
import { AdminListTicketsQuery, CreateTicketDto, ListTicketsQuery, PLAN_CATALOG, Priority, SUPPORT_PLANS, SupportPlanId, TicketMessageDto } from './support.dto';

/** Normalized inbound email, from whichever provider posts it. */
export interface InboundMail { from: string; subject: string; text: string }

/** Drops the quoted previous message from an email reply so the ticket shows only the new text. */
function stripQuoted(text: string) {
  const lines = text.split(/\r?\n/);
  const cut = lines.findIndex((l) => /^On .+ wrote:$/.test(l.trim()) || /^-{2,}\s*Original Message\s*-{2,}$/i.test(l.trim()) || /^From: .+/.test(l.trim()) && lines.indexOf(l) > 0);
  const kept = (cut > 0 ? lines.slice(0, cut) : lines).filter((l) => !l.startsWith('>'));
  return kept.join('\n').trim() || text.trim();
}

const ticketInclude = { messages: { orderBy: { createdAt: 'asc' as const } } } satisfies Prisma.TicketInclude;
type TicketRow = Prisma.TicketGetPayload<{ include: typeof ticketInclude }>;

/**
 * Support plans and tickets.
 *
 * The plan sits on the team and is billed monthly against the team's oldest project through the
 * usual meter (resource type `support`, sku `support-<plan>`). Tickets carry the plan they were
 * opened under so a downgrade does not move the target on an open ticket. Staff answer from the
 * back office; every customer message reopens the ticket and every staff answer marks it answered.
 */
@Injectable()
export class SupportService {
  private readonly log = new Logger(SupportService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly spend: SpendService,
    private readonly fx: FxService,
    private readonly mail: MailService,
  ) {}

  /** Plan catalog with prices in the requested currency, converted from the SAR price book. */
  async plans(currency: 'USD' | 'SAR' = BOOK_CURRENCY) {
    const prices = await this.prisma.price.findMany({ where: { resourceType: 'support', currency: BOOK_CURRENCY, validTo: null } });
    const rate = await this.fx.bookRate(currency, new Date());
    return {
      data: SUPPORT_PLANS.map((id) => {
        const book = prices.find((p) => p.sku === `support-${id}`)?.monthlyMinor ?? 0;
        return { id, ...PLAN_CATALOG[id], currency, monthlyMinor: Math.round(book * rate) };
      }),
    };
  }

  async current(actor: Actor) {
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: actor.teamId }, select: { supportPlan: true, supportPlanSince: true, currency: true } });
    const plans = await this.plans(team.currency);
    const open = await this.prisma.ticket.count({ where: { teamId: actor.teamId, status: { not: 'closed' } } });
    return { plan: team.supportPlan, since: team.supportPlanSince, openTickets: open, details: plans.data.find((p) => p.id === team.supportPlan) };
  }

  /** Change the plan. Upgrades check spend on the oldest project; downgrades take effect at once. */
  async setPlan(actor: Actor, plan: SupportPlanId) {
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: actor.teamId }, include: { projects: { orderBy: { createdAt: 'asc' }, take: 1 } } });
    if (team.supportPlan === plan) return this.current(actor);
    const order = SUPPORT_PLANS.indexOf(plan) - SUPPORT_PLANS.indexOf(team.supportPlan);
    if (order > 0) {
      if (!team.projects.length) throw ApiError.invalidState('The team needs a project before a paid plan can be billed');
      const monthly = await this.spend.monthlyPriceMinor('support', `support-${plan}`, team.currency);
      const current = team.supportPlan === 'free' ? 0 : await this.spend.monthlyPriceMinor('support', `support-${team.supportPlan}`, team.currency);
      await this.spend.assertCanSpend(actor, team.projects[0].id, Math.max(0, monthly - current));
    }
    await this.prisma.team.update({ where: { id: team.id }, data: { supportPlan: plan, supportPlanSince: new Date() } });
    await this.events.emit('support.plan_changed', { from: team.supportPlan, to: plan }, { actor, resource: `team:${team.id}` });
    return this.current(actor);
  }

  async list(actor: Actor, q: ListTicketsQuery) {
    const status = q.status ?? 'all';
    const rows = await this.prisma.ticket.findMany({
      where: { teamId: actor.teamId, ...(status === 'all' ? {} : { status }) },
      include: { _count: { select: { messages: { where: { internal: false } } } } },
      orderBy: { updatedAt: 'desc' },
      ...cursorArgs(q),
    });
    return toPage(rows.map((t) => this.summary(t, t._count.messages)), q.limit);
  }

  async get(actor: Actor, id: string) {
    return this.present(await this.own(actor, id));
  }

  async create(actor: Actor, dto: CreateTicketDto) {
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: actor.teamId } });
    const plan = team.supportPlan;
    const priority: Priority = dto.priority ?? 'normal';
    const target = PLAN_CATALOG[plan].targets[priority];
    if (target === null) throw ApiError.invalid(`Priority "${priority}" needs a higher support plan`, { plan, allowed: (Object.keys(PLAN_CATALOG[plan].targets) as Priority[]).filter((p) => PLAN_CATALOG[plan].targets[p] !== null) });
    // Managed cloud tickets are covered by the managed contract, not the support plan.
    const open = await this.prisma.ticket.count({ where: { teamId: team.id, status: { not: 'closed' }, contractId: null } });
    if (open >= PLAN_CATALOG[plan].maxOpen) throw ApiError.quota(`Your plan allows ${PLAN_CATALOG[plan].maxOpen} open tickets; close one first`);
    if (dto.resource) await this.checkResource(actor, dto.resource);
    const author = await this.authorName(actor);
    const ticket = await this.prisma.ticket.create({
      data: {
        teamId: team.id,
        subject: dto.subject.trim(),
        priority,
        plan,
        resource: dto.resource ?? null,
        createdById: actor.userId,
        firstResponseDueAt: new Date(Date.now() + target * 3600_000),
        messages: { create: { fromSupport: false, authorId: actor.userId, authorName: author, body: dto.body } },
      },
      include: ticketInclude,
    });
    await this.events.emit('ticket.opened', { ticketId: ticket.id, number: ticket.number, subject: ticket.subject, priority, plan }, { actor, resource: `ticket:${ticket.id}` });
    await this.notifyStaff(ticket, dto.body);
    return this.present(ticket);
  }

  async reply(actor: Actor, id: string, dto: TicketMessageDto) {
    const ticket = await this.own(actor, id);
    if (ticket.status === 'closed' && ticket.closedAt && Date.now() - ticket.closedAt.getTime() > 14 * 86400_000) throw ApiError.invalidState('This ticket was closed more than 14 days ago; open a new one');
    const author = await this.authorName(actor);
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: { status: 'open', closedAt: null, lastCustomerAt: new Date(), messages: { create: { fromSupport: false, authorId: actor.userId, authorName: author, body: dto.body } } },
      include: ticketInclude,
    });
    await this.events.emit('ticket.replied', { ticketId: id, number: ticket.number, by: 'customer' }, { actor, resource: `ticket:${id}` });
    await this.notifyStaff(updated, dto.body);
    return this.present(updated);
  }

  async close(actor: Actor, id: string) {
    const ticket = await this.own(actor, id);
    if (ticket.status === 'closed') return this.present(ticket);
    const updated = await this.prisma.ticket.update({ where: { id }, data: { status: 'closed', closedAt: new Date() }, include: ticketInclude });
    await this.events.emit('ticket.closed', { ticketId: id, number: ticket.number, by: 'customer' }, { actor, resource: `ticket:${id}` });
    return this.present(updated);
  }

  /**
   * Email intake: a message sent to the support inbox becomes a ticket, or a reply on the ticket
   * named in the subject as "[#123]". The sender must match a user; the ticket lands on the team
   * they own (or their first team). Unknown senders get an acknowledgement that a person will
   * answer from the mailbox, since we have no account to attach a ticket to.
   */
  async inbound(msg: InboundMail) {
    const email = msg.from.trim().toLowerCase();
    if (!email || /^(no-?reply|mailer-daemon|postmaster)@/i.test(email)) return { accepted: false, reason: 'ignored_sender' };
    const subject = (msg.subject || '(no subject)').trim().slice(0, 140);
    const body = (msg.text || '').trim().slice(0, 20000) || '(empty message)';
    const user = await this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, include: { memberships: { orderBy: { role: 'asc' }, include: { team: { select: { id: true, createdAt: true } } } } } });
    const membership = user?.memberships.sort((a, b) => (a.role === 'owner' ? -1 : b.role === 'owner' ? 1 : a.team.createdAt.getTime() - b.team.createdAt.getTime()))[0];
    if (!user || !membership) {
      await this.mail.send({ to: email, subject: `Re: ${subject}`, text: `Thanks for writing to ${loadConfig().COMPANY_NAME} support. We received your message and a person will answer by email within one business day.\n\nIf you have an account, please write from the email address on it, or open a ticket from Support in the console, so we can attach the conversation to your account.` }).catch((e) => this.log.warn(`support ack failed: ${e}`));
      return { accepted: false, reason: 'unknown_sender' };
    }
    const actor: Actor = { userId: user.id, teamId: membership.teamId, role: membership.role, scopes: new Set(['support:read', 'support:write']), isAgent: false, requireApprovalFor: new Set(), locale: 'en' };
    const ref = /\[#(\d+)\]/.exec(subject);
    if (ref) {
      const existing = await this.prisma.ticket.findFirst({ where: { number: Number(ref[1]), teamId: membership.teamId } });
      if (existing) {
        const t = await this.reply(actor, existing.id, { body: stripQuoted(body) });
        return { accepted: true, action: 'replied', ticketId: t.id, number: t.number };
      }
    }
    try {
      const t = await this.create(actor, { subject: subject.replace(/^(re|fwd?):\s*/i, ''), body: stripQuoted(body), priority: 'normal' });
      await this.mail.send({ to: email, subject: `Re: [#${t.number}] ${t.subject}`, text: `Your ticket #${t.number} is open. Reply to this email or follow it in the console:\n${loadConfig().CONSOLE_URL}/support/${t.id}` }).catch((e) => this.log.warn(`support ack failed: ${e}`));
      return { accepted: true, action: 'created', ticketId: t.id, number: t.number };
    } catch (e) {
      const reason = e instanceof ApiError ? e.message : 'could not open a ticket';
      await this.mail.send({ to: email, subject: `Re: ${subject}`, text: `We could not open a ticket from your email: ${reason}\n\nOpen one from Support in the console:\n${loadConfig().CONSOLE_URL}/support` }).catch((err) => this.log.warn(`support ack failed: ${err}`));
      return { accepted: false, reason };
    }
  }

  // ---- back office ----

  async adminList(q: AdminListTicketsQuery) {
    const status = q.status ?? 'open';
    const rows = await this.prisma.ticket.findMany({
      where: { ...(status === 'all' ? {} : { status }), ...(q.team ? { teamId: q.team } : {}) },
      include: { _count: { select: { messages: true } } },
      orderBy: status === 'open' ? [{ firstResponseDueAt: 'asc' }, { lastCustomerAt: 'asc' }] : [{ updatedAt: 'desc' }],
      ...cursorArgs(q),
    });
    const teams = await this.prisma.team.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.teamId))] } }, select: { id: true, name: true, slug: true, supportPlan: true } });
    const teamOf = new Map(teams.map((t) => [t.id, t]));
    return toPage(rows.map((t) => ({ ...this.summary(t, t._count.messages), team: teamOf.get(t.teamId) ?? null, overdue: t.status === 'open' && !t.firstRespondedAt && !!t.firstResponseDueAt && t.firstResponseDueAt < new Date() })), q.limit);
  }

  async adminGet(id: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id }, include: ticketInclude });
    if (!ticket) throw ApiError.notFound('ticket', id);
    const team = await this.prisma.team.findUnique({ where: { id: ticket.teamId }, select: { id: true, name: true, slug: true, supportPlan: true, currency: true, country: true, members: { where: { role: 'owner' }, include: { user: { select: { email: true, name: true } } } } } });
    return { ...this.present(ticket, true), team };
  }

  /** Staff answer: marks the ticket answered, records the first response, emails the team owners and the opener. */
  async adminReply(actor: Actor, id: string, dto: TicketMessageDto, close = false) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw ApiError.notFound('ticket', id);
    const staff = await this.prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true } });
    const now = new Date();
    const updated = await this.prisma.ticket.update({
      where: { id },
      data: {
        status: close ? 'closed' : 'answered',
        closedAt: close ? now : null,
        lastSupportAt: now,
        firstRespondedAt: ticket.firstRespondedAt ?? now,
        messages: { create: { fromSupport: true, authorId: actor.userId, authorName: staff?.name ?? 'Progrid support', body: dto.body } },
      },
      include: ticketInclude,
    });
    await this.events.emit(close ? 'ticket.closed' : 'ticket.answered', { ticketId: id, number: ticket.number, by: 'support' }, { teamId: ticket.teamId, actor, resource: `ticket:${id}` });
    await this.notifyCustomer(updated, dto.body);
    return this.present(updated, true);
  }

  async adminClose(actor: Actor, id: string) {
    const ticket = await this.prisma.ticket.findUnique({ where: { id } });
    if (!ticket) throw ApiError.notFound('ticket', id);
    const updated = await this.prisma.ticket.update({ where: { id }, data: { status: 'closed', closedAt: new Date() }, include: ticketInclude });
    await this.events.emit('ticket.closed', { ticketId: id, number: ticket.number, by: 'support' }, { teamId: ticket.teamId, actor, resource: `ticket:${id}` });
    return this.present(updated, true);
  }

  /** Open tickets past their first response target; used by the back office overview. */
  async overdueCount() {
    return this.prisma.ticket.count({ where: { status: 'open', firstRespondedAt: null, firstResponseDueAt: { lt: new Date() } } });
  }

  // ---- helpers ----

  private async own(actor: Actor, id: string) {
    const ticket = await this.prisma.ticket.findFirst({ where: { id, teamId: actor.teamId }, include: ticketInclude });
    if (!ticket) throw ApiError.notFound('ticket', id);
    return ticket;
  }

  private async authorName(actor: Actor) {
    const u = await this.prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true } });
    return actor.tokenId ? `${u?.name ?? 'API'} (API token)` : u?.name ?? 'Customer';
  }

  /** The resource named on a ticket must belong to the team. */
  private async checkResource(actor: Actor, ref: string) {
    const [kind, id] = ref.split(':', 2);
    const teamScope = { project: { teamId: actor.teamId } };
    const found = await (async () => {
      switch (kind) {
        case 'server': return this.prisma.server.count({ where: { id, ...teamScope } });
        case 'database': return this.prisma.dbCluster.count({ where: { id, ...teamScope } });
        case 'load_balancer': return this.prisma.loadBalancer.count({ where: { id, ...teamScope } });
        case 'volume': return this.prisma.volume.count({ where: { id, ...teamScope } });
        case 'domain': return this.prisma.dnsZone.count({ where: { id, ...teamScope } });
        case 'bucket': return this.prisma.bucket.count({ where: { id, ...teamScope } });
        case 'invoice': return this.prisma.invoice.count({ where: { id, teamId: actor.teamId } });
        default: return 0;
      }
    })();
    if (!found) throw ApiError.invalid(`Unknown resource "${ref}"`);
  }

  private async notifyStaff(ticket: TicketRow, body: string) {
    const c = loadConfig();
    if (!c.SUPPORT_INBOX) return;
    await this.mail.send({ to: c.SUPPORT_INBOX, subject: `[#${ticket.number}] [${ticket.priority}] ${ticket.subject}`, text: `${body}\n\n${c.CONSOLE_URL}/admin/support/${ticket.id}` }).catch((e) => this.log.warn(`support mail failed: ${e}`));
  }

  private async notifyCustomer(ticket: TicketRow, body: string) {
    const [owners, opener] = await Promise.all([
      this.prisma.teamMember.findMany({ where: { teamId: ticket.teamId, role: 'owner' }, include: { user: { select: { email: true } } } }),
      ticket.createdById ? this.prisma.user.findUnique({ where: { id: ticket.createdById }, select: { email: true } }) : null,
    ]);
    const to = new Set([...owners.map((m) => m.user.email), ...(opener ? [opener.email] : [])]);
    const url = `${loadConfig().CONSOLE_URL}/support/${ticket.id}`;
    await Promise.all([...to].map((email) => this.mail.send({ to: email, subject: `Re: [#${ticket.number}] ${ticket.subject}`, text: `${body}\n\nReply or close the ticket here:\n${url}` }).catch((e) => this.log.warn(`support mail failed: ${e}`))));
  }

  private summary(t: Prisma.TicketGetPayload<object>, messageCount: number) {
    return {
      id: t.id, number: t.number, subject: t.subject, status: t.status, priority: t.priority, plan: t.plan, resource: t.resource,
      firstResponseDueAt: t.firstResponseDueAt, firstRespondedAt: t.firstRespondedAt, lastCustomerAt: t.lastCustomerAt, lastSupportAt: t.lastSupportAt,
      closedAt: t.closedAt, createdAt: t.createdAt, updatedAt: t.updatedAt, messageCount,
    };
  }

  /** Customer view by default: internal notes (managed cloud tickets) are never returned to customers. */
  private present(t: TicketRow, staff = false) {
    const messages = t.messages.filter((m) => staff || !m.internal);
    return { ...this.summary(t, messages.length), messages: messages.map((m) => ({ id: m.id, fromSupport: m.fromSupport, author: m.authorName, body: m.body, createdAt: m.createdAt, ...(staff ? { internal: m.internal } : {}) })) };
  }
}
