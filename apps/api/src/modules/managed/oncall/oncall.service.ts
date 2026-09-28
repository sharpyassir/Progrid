import { Injectable } from '@nestjs/common';
import type { OnCallRole, OnCallShift, User } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ApiError } from '../../../common/errors/api-error';
import type { Actor } from '../../../common/auth/actor';
import { EventsService } from '../../events/events.service';

export type StaffContact = Pick<User, 'id' | 'name' | 'email' | 'phone' | 'pagingChannel' | 'staffRoles'>;
const contactSelect = { id: true, name: true, email: true, phone: true, pagingChannel: true, staffRoles: true, isStaff: true } as const;

export function presentShift(s: OnCallShift & { user?: Pick<User, 'id' | 'name' | 'email'> }) {
  return { id: s.id, userId: s.userId, user: s.user ? { id: s.user.id, name: s.user.name, email: s.user.email } : undefined, role: s.role, startsAt: s.startsAt, endsAt: s.endsAt, note: s.note, createdAt: s.createdAt };
}

/**
 * On call schedule. The current primary gets P1 and P2 pages; an unacknowledged page goes to
 * the support lead: the current secondary when one is scheduled, otherwise the longest serving
 * staff member with the support_lead role.
 */
@Injectable()
export class OnCallService {
  constructor(private readonly prisma: PrismaService, private readonly events: EventsService) {}

  async current(at = new Date()) {
    const shifts = await this.prisma.onCallShift.findMany({ where: { startsAt: { lte: at }, endsAt: { gt: at } }, include: { user: { select: contactSelect } }, orderBy: { startsAt: 'desc' } });
    const pick = (role: OnCallRole) => shifts.find((s) => s.role === role)?.user ?? null;
    return { at, primary: pick('PRIMARY'), secondary: pick('SECONDARY'), shifts: shifts.map(presentShift) };
  }

  async primary(at = new Date()): Promise<StaffContact | null> {
    return (await this.current(at)).primary;
  }

  /** Who a missed page escalates to. Never the person who missed it. */
  async supportLead(excludeUserId?: string, at = new Date()): Promise<StaffContact | null> {
    const { secondary } = await this.current(at);
    if (secondary && secondary.id !== excludeUserId) return secondary;
    const leads = await this.prisma.user.findMany({ where: { isStaff: true, staffRoles: { has: 'support_lead' }, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) }, select: contactSelect, orderBy: { createdAt: 'asc' }, take: 1 });
    return leads[0] ?? null;
  }

  async listShifts(q: { from?: Date; to?: Date; userId?: string }) {
    const from = q.from ?? new Date(Date.now() - 7 * 86_400_000);
    const to = q.to ?? new Date(Date.now() + 28 * 86_400_000);
    const rows = await this.prisma.onCallShift.findMany({ where: { startsAt: { lt: to }, endsAt: { gt: from }, ...(q.userId ? { userId: q.userId } : {}) }, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { startsAt: 'asc' } });
    return { data: rows.map(presentShift) };
  }

  async createShift(actor: Actor, dto: { userId: string; role?: OnCallRole; startsAt: Date; endsAt: Date; note?: string }) {
    await this.checkShift(dto);
    const s = await this.prisma.onCallShift.create({ data: { userId: dto.userId, role: dto.role ?? 'PRIMARY', startsAt: dto.startsAt, endsAt: dto.endsAt, note: dto.note ?? null, createdById: actor.userId }, include: { user: { select: { id: true, name: true, email: true } } } });
    await this.events.emit('managed.oncall_shift_created', { shiftId: s.id, userId: s.userId, role: s.role, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() }, { actor, resource: `oncall_shift:${s.id}` });
    return presentShift(s);
  }

  async updateShift(actor: Actor, id: string, dto: { userId?: string; role?: OnCallRole; startsAt?: Date; endsAt?: Date; note?: string }) {
    const cur = await this.prisma.onCallShift.findUnique({ where: { id } });
    if (!cur) throw ApiError.notFound('on call shift', id);
    const next = { userId: dto.userId ?? cur.userId, role: dto.role ?? cur.role, startsAt: dto.startsAt ?? cur.startsAt, endsAt: dto.endsAt ?? cur.endsAt };
    await this.checkShift(next, id);
    const s = await this.prisma.onCallShift.update({ where: { id }, data: { ...next, note: dto.note }, include: { user: { select: { id: true, name: true, email: true } } } });
    await this.events.emit('managed.oncall_shift_updated', { shiftId: id, userId: s.userId, role: s.role, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() }, { actor, resource: `oncall_shift:${id}` });
    return presentShift(s);
  }

  async deleteShift(actor: Actor, id: string) {
    const cur = await this.prisma.onCallShift.findUnique({ where: { id } });
    if (!cur) throw ApiError.notFound('on call shift', id);
    await this.prisma.onCallShift.delete({ where: { id } });
    await this.events.emit('managed.oncall_shift_deleted', { shiftId: id, userId: cur.userId }, { actor, resource: `oncall_shift:${id}` });
    return { deleted: true };
  }

  /** Staff who can be put on call, with their paging contact. */
  async staff() {
    const rows = await this.prisma.user.findMany({ where: { isStaff: true }, select: contactSelect, orderBy: { name: 'asc' } });
    return { data: rows.map((u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, pagingChannel: u.pagingChannel, staffRoles: u.staffRoles })) };
  }

  async setContact(actor: Actor, userId: string, dto: { phone?: string | null; pagingChannel?: 'SMS' | 'WHATSAPP' | 'PUSH' | 'EMAIL' | null }) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u || !u.isStaff) throw ApiError.notFound('staff user', userId);
    const updated = await this.prisma.user.update({ where: { id: userId }, data: { phone: dto.phone, pagingChannel: dto.pagingChannel }, select: contactSelect });
    await this.events.emit('managed.paging_contact_updated', { userId, pagingChannel: updated.pagingChannel, hasPhone: !!updated.phone }, { actor, resource: `user:${userId}` });
    return { id: updated.id, name: updated.name, email: updated.email, phone: updated.phone, pagingChannel: updated.pagingChannel, staffRoles: updated.staffRoles };
  }

  private async checkShift(s: { userId: string; startsAt: Date; endsAt: Date; role?: OnCallRole }, id?: string) {
    if (s.endsAt <= s.startsAt) throw ApiError.invalid('endsAt must be after startsAt');
    const u = await this.prisma.user.findUnique({ where: { id: s.userId }, select: { isStaff: true } });
    if (!u?.isStaff) throw ApiError.invalid('On call shifts are for staff users');
    const clash = await this.prisma.onCallShift.findFirst({ where: { userId: s.userId, startsAt: { lt: s.endsAt }, endsAt: { gt: s.startsAt }, ...(id ? { id: { not: id } } : {}) } });
    if (clash) throw ApiError.conflict('shift_overlap', 'This person already has a shift in that window');
  }
}
