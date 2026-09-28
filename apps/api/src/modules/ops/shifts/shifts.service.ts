import { Injectable, Logger } from '@nestjs/common';
import type { Handover, OnCallShift, Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ApiError } from '../../../common/errors/api-error';
import { loadConfig } from '../../../config/config';
import { ManagedWorkflows } from '../../managed/managed-workflows.service';
import { ManagedNotify } from '../../managed/managed-notify.service';
import { OnCallService } from '../../managed/oncall/oncall.service';
import { PagingService } from '../../managed/oncall/paging.service';
import { OpsAudit } from '../ops-audit.service';
import { OpsSettingsService } from '../settings/ops-settings.service';
import { GrantsService } from '../access/grants.service';
import { maskContact } from '../serializers/ops-dto';
import type { OpsContext } from '../guards/ops-context';

export const shiftWorkflowId = (shiftId: string) => `ops-shift-${shiftId}`;

export interface StartChecklist {
  pagingAppOnline: boolean;
  vpnWorking: boolean;
  twoFactorWorking: boolean;
  lastHandoverRead: boolean;
}

export const CHECKLIST_ITEMS: { key: keyof StartChecklist; label: string }[] = [
  { key: 'pagingAppOnline', label: 'Paging app online (a test page arrived)' },
  { key: 'vpnWorking', label: 'VPN connected and two factor sign in working' },
  { key: 'twoFactorWorking', label: 'Two factor sign in working on this device' },
  { key: 'lastHandoverRead', label: 'Last handover read' },
];

export function presentShift(s: OnCallShift & { handover?: Handover | null }) {
  return {
    id: s.id, userId: s.userId, role: s.role, startsAt: s.startsAt, endsAt: s.endsAt, note: s.note, startedAt: s.startedAt, endedAt: s.endedAt,
    startChecklist: s.startChecklist, handoverId: s.handover?.id ?? null, state: s.endedAt ? 'ended' : s.startedAt ? 'started' : s.endsAt < new Date() ? 'missed' : 'scheduled',
  };
}

export function presentHandover(h: Handover & { shift?: OnCallShift & { user?: { id: string; name: string } } }, external: boolean) {
  const tickets = (h.openTickets as { id: string; number: number; subject: string; priority: string | null; status: string; contractId: string | null }[]) ?? [];
  return {
    id: h.id, shiftId: h.shiftId, author: h.shift?.user ? { id: h.shift.user.id, name: h.shift.user.name } : { id: h.authorId }, shiftEndedAt: h.shift?.endedAt ?? null,
    openTickets: tickets.map((t) => ({ ...t, subject: external ? maskContact(t.subject) : t.subject })), risks: h.risks, pendingMaintenance: h.pendingMaintenance, notes: h.notes, createdAt: h.createdAt,
  };
}

export type ShiftPlan = { state: 'done' } | { state: 'waiting'; endsAt: string; remindAt: string; escalateAt: string; reminded: boolean; escalated: boolean };

/**
 * Shifts in the ops console (spec 5.2). Starting a shift needs the start checklist (paging app
 * online, VPN and two factor working, last handover read). Ending it needs a handover (open
 * tickets, risks, pending maintenance, notes) and revokes the engineer's non emergency grants.
 * `opsShift` reminds the engineer 15 minutes after the scheduled end without a handover and
 * notifies the support lead after 60; at the scheduled end it also revokes non emergency grants.
 */
@Injectable()
export class ShiftsService {
  private readonly log = new Logger(ShiftsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: ManagedWorkflows,
    private readonly notify: ManagedNotify,
    private readonly oncall: OnCallService,
    private readonly paging: PagingService,
    private readonly grants: GrantsService,
    private readonly audit: OpsAudit,
    private readonly settings: OpsSettingsService,
  ) {}

  async mine(ops: OpsContext) {
    const now = Date.now();
    const rows = await this.prisma.onCallShift.findMany({ where: { userId: ops.userId, endsAt: { gt: new Date(now - 7 * 86_400_000) }, startsAt: { lt: new Date(now + 28 * 86_400_000) } }, include: { handover: true }, orderBy: { startsAt: 'asc' } });
    return { data: rows.map(presentShift), checklist: CHECKLIST_ITEMS };
  }

  /** The latest handover, from anyone; reading it counts for the start checklist. */
  async latestHandover(ops: OpsContext) {
    const h = await this.prisma.handover.findFirst({ orderBy: { createdAt: 'desc' }, include: { shift: { include: { user: { select: { id: true, name: true } } } } } });
    if (!h) return { handover: null };
    if (!h.readBy.includes(ops.userId)) await this.prisma.handover.update({ where: { id: h.id }, data: { readBy: { push: ops.userId } } });
    return { handover: presentHandover(h, ops.external) };
  }

  async start(ops: OpsContext, dto: { shiftId?: string; checklist: Partial<StartChecklist> }) {
    const missing = CHECKLIST_ITEMS.filter((i) => dto.checklist?.[i.key] !== true);
    if (missing.length) throw new ApiError(422, 'checklist_incomplete', `Confirm every start checklist item: ${missing.map((m) => m.label).join('; ')}`, { missing: missing.map((m) => m.key) });
    const now = new Date();
    const shift = dto.shiftId
      ? await this.prisma.onCallShift.findFirst({ where: { id: dto.shiftId, userId: ops.userId } })
      : await this.prisma.onCallShift.findFirst({ where: { userId: ops.userId, startedAt: null, endedAt: null, startsAt: { lte: new Date(now.getTime() + 30 * 60_000) }, endsAt: { gt: now } }, orderBy: { startsAt: 'asc' } });
    if (!shift) throw ApiError.invalidState('You have no shift starting in the next 30 minutes');
    if (shift.startedAt) throw ApiError.invalidState('This shift was already started');
    if (shift.endsAt <= now) throw ApiError.invalidState('This shift is over');
    if (shift.startsAt.getTime() > now.getTime() + 30 * 60_000) throw ApiError.invalidState('A shift can be started at most 30 minutes early');
    const last = await this.prisma.handover.findFirst({ where: { shift: { userId: { not: ops.userId } } }, orderBy: { createdAt: 'desc' } });
    if (last && !last.readBy.includes(ops.userId)) throw new ApiError(409, 'handover_not_read', 'Read the last handover first (GET /ops/v1/shifts/handover/latest)');
    const checklist = { ...dto.checklist, lastHandoverId: last?.id ?? null, at: now.toISOString() } as Prisma.InputJsonValue;
    const r = await this.prisma.onCallShift.updateMany({ where: { id: shift.id, startedAt: null }, data: { startedAt: now, startChecklist: checklist } });
    if (!r.count) throw ApiError.invalidState('This shift was already started');
    await this.workflows.start('opsShift', [{ shiftId: shift.id }], shiftWorkflowId(shift.id));
    await this.audit.emit('ops.shift_started', ops, { shiftId: shift.id, role: shift.role, startsAt: shift.startsAt.toISOString(), endsAt: shift.endsAt.toISOString(), checklist: checklist as Record<string, unknown> }, `oncall_shift:${shift.id}`);
    return presentShift({ ...shift, startedAt: now, startChecklist: checklist as Prisma.JsonValue, handover: null });
  }

  /** Ends the started shift with a handover and revokes the engineer's non emergency grants. */
  async end(ops: OpsContext, dto: { shiftId?: string; handover: { risks: string; pendingMaintenance: string; notes: string; ticketIds?: string[] } }) {
    const shift = await this.prisma.onCallShift.findFirst({ where: { userId: ops.userId, startedAt: { not: null }, endedAt: null, ...(dto.shiftId ? { id: dto.shiftId } : {}) }, orderBy: { startsAt: 'desc' } });
    if (!shift) throw ApiError.invalidState('You have no started shift to end');
    const tickets = await this.prisma.ticket.findMany({
      where: { OR: [{ assigneeId: ops.userId, status: { in: ['open', 'answered'] }, contractId: { not: null } }, ...(dto.handover.ticketIds?.length ? [{ id: { in: dto.handover.ticketIds }, ...(ops.contractIds ? { contractId: { in: ops.contractIds } } : {}) }] : [])] },
      select: { id: true, number: true, subject: true, managedPriority: true, status: true, contractId: true },
      orderBy: { number: 'asc' },
    });
    const now = new Date();
    const handover = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.onCallShift.updateMany({ where: { id: shift.id, endedAt: null }, data: { endedAt: now } });
      if (!claimed.count) return null;
      return tx.handover.create({
        data: {
          shiftId: shift.id, authorId: ops.userId, risks: dto.handover.risks, pendingMaintenance: dto.handover.pendingMaintenance, notes: dto.handover.notes, readBy: [ops.userId],
          openTickets: tickets.map((t) => ({ id: t.id, number: t.number, subject: t.subject, priority: t.managedPriority, status: t.status, contractId: t.contractId })),
        },
      });
    });
    if (!handover) throw ApiError.invalidState('This shift was already ended');
    const revoked = await this.grants.revokeWhere({ userId: ops.userId, emergency: false }, 'shift_end', ops);
    await this.workflows.signal(shiftWorkflowId(shift.id), 'shiftEnded');
    await this.audit.emit('ops.shift_ended', ops, { shiftId: shift.id, handoverId: handover.id, openTickets: tickets.length, grantsRevoked: revoked }, `oncall_shift:${shift.id}`);
    return { shift: presentShift({ ...shift, endedAt: now, handover }), handover: presentHandover(handover, ops.external), grantsRevoked: revoked };
  }

  // ---- workflow steps ----

  async plan(shiftId: string): Promise<ShiftPlan> {
    const s = await this.prisma.onCallShift.findUnique({ where: { id: shiftId }, include: { handover: { select: { id: true } } } });
    if (!s || s.endedAt || s.handover) return { state: 'done' };
    const cfg = await this.settings.get();
    const end = s.endsAt.getTime();
    return {
      state: 'waiting', endsAt: s.endsAt.toISOString(),
      remindAt: new Date(end + cfg.handoverReminderMinutes * 60_000).toISOString(),
      escalateAt: new Date(end + cfg.handoverEscalateMinutes * 60_000).toISOString(),
      reminded: !!s.handoverRemindedAt, escalated: !!s.handoverEscalatedAt,
    };
  }

  /** The scheduled end passed: non emergency grants of the engineer end with the shift. */
  async scheduledEnd(shiftId: string) {
    const s = await this.prisma.onCallShift.findUnique({ where: { id: shiftId } });
    if (!s) return 0;
    const n = await this.grants.revokeWhere({ userId: s.userId, emergency: false, createdAt: { lt: s.endsAt } }, 'shift_end', null);
    if (n) await this.audit.emit('ops.shift_grants_revoked', null, { shiftId, userId: s.userId, grantsRevoked: n }, `oncall_shift:${shiftId}`);
    return n;
  }

  async remind(shiftId: string): Promise<'done' | 'reminded'> {
    const s = await this.prisma.onCallShift.findUnique({ where: { id: shiftId }, include: { handover: { select: { id: true } }, user: { select: { id: true, email: true, name: true } } } });
    if (!s || s.endedAt || s.handover) return 'done';
    if (s.handoverRemindedAt) return 'reminded';
    await this.prisma.onCallShift.update({ where: { id: shiftId }, data: { handoverRemindedAt: new Date() } });
    const subject = 'Your shift ended: write the handover';
    const message = `Your on call shift ended at ${s.endsAt.toISOString().slice(11, 16)} UTC. End it in the ops console with a handover for the next engineer.`;
    await this.notify.send({ to: s.user.email, subject, text: `${message}\n${loadConfig().PRGD_OPS_URL}/handover` });
    await this.paging.page({ userId: s.userId, urgency: 'low', subject, message }).catch((e) => this.log.warn(`handover reminder page failed: ${(e as Error).message}`));
    await this.audit.emit('ops.handover_reminder', null, { shiftId, userId: s.userId }, `oncall_shift:${shiftId}`);
    return 'reminded';
  }

  async escalate(shiftId: string): Promise<'done' | 'escalated'> {
    const s = await this.prisma.onCallShift.findUnique({ where: { id: shiftId }, include: { handover: { select: { id: true } }, user: { select: { id: true, name: true } } } });
    if (!s || s.endedAt || s.handover) return 'done';
    if (s.handoverEscalatedAt) return 'escalated';
    await this.prisma.onCallShift.update({ where: { id: shiftId }, data: { handoverEscalatedAt: new Date() } });
    const lead = await this.oncall.supportLead(s.userId);
    const subject = `Missing handover: ${s.user.name}`;
    const message = `${s.user.name}'s shift ended at ${s.endsAt.toISOString().slice(11, 16)} UTC and there is still no handover.`;
    if (lead) {
      await this.notify.send({ to: lead.email, subject, text: message });
      await this.paging.page({ userId: lead.id, urgency: 'low', subject, message }).catch((e) => this.log.warn(`handover escalation page failed: ${(e as Error).message}`));
    } else {
      await this.notify.toStaff({ subject, text: message });
    }
    await this.audit.emit('ops.handover_missing', null, { shiftId, userId: s.userId, leadId: lead?.id ?? null }, `oncall_shift:${shiftId}`);
    return 'escalated';
  }

  /** Offboarding: the engineer's started shift ends now, and (when offboarded) future shifts are removed. */
  async endForEngineer(userId: string, removeFuture: boolean) {
    const now = new Date();
    const ended = await this.prisma.onCallShift.updateMany({ where: { userId, startsAt: { lte: now }, endsAt: { gt: now }, endedAt: null }, data: { endedAt: now, endsAt: now } });
    const removed = removeFuture ? (await this.prisma.onCallShift.deleteMany({ where: { userId, startsAt: { gt: now } } })).count : 0;
    return { ended: ended.count, removed };
  }
}
