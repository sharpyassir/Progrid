import { Injectable } from '@nestjs/common';
import { Prisma, type Responsibility, type ResponsibilityOwner } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ApiError } from '../../../common/errors/api-error';
import type { Actor } from '../../../common/auth/actor';
import { EventsService } from '../../events/events.service';
import { DEFAULT_RESPONSIBILITIES } from '../managed.constants';

export function presentResponsibility(r: Responsibility) {
  return { id: r.id, area: r.area, owner: r.owner, notes: r.notes, sortOrder: r.sortOrder, updatedAt: r.updatedAt };
}

/** The shared responsibility matrix per contract: who owns each area (PROGRID, CUSTOMER or SHARED). */
@Injectable()
export class ResponsibilityService {
  constructor(private readonly prisma: PrismaService, private readonly events: EventsService) {}

  /** Seeds the default matrix for a new contract. Idempotent. */
  async ensureDefaults(contractId: string, tx: Prisma.TransactionClient = this.prisma) {
    await tx.responsibility.createMany({ data: DEFAULT_RESPONSIBILITIES.map((r, i) => ({ contractId, area: r.area, owner: r.owner, notes: r.notes ?? null, sortOrder: i })), skipDuplicates: true });
  }

  async list(contractId: string) {
    const rows = await this.prisma.responsibility.findMany({ where: { contractId }, orderBy: [{ sortOrder: 'asc' }, { area: 'asc' }] });
    return { data: rows.map(presentResponsibility) };
  }

  async create(actor: Actor, contractId: string, dto: { area: string; owner: ResponsibilityOwner; notes?: string; sortOrder?: number }) {
    const c = await this.contract(contractId);
    const max = await this.prisma.responsibility.aggregate({ where: { contractId }, _max: { sortOrder: true } });
    try {
      const r = await this.prisma.responsibility.create({ data: { contractId, area: dto.area.trim(), owner: dto.owner, notes: dto.notes ?? null, sortOrder: dto.sortOrder ?? (max._max.sortOrder ?? 0) + 1 } });
      await this.events.emit('managed.responsibility_changed', { contractId, area: r.area, owner: r.owner, change: 'created' }, { teamId: c.teamId, actor, resource: `managed_contract:${contractId}` });
      return presentResponsibility(r);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw ApiError.conflict('already_exists', `The matrix already has an area named "${dto.area}"`);
      throw e;
    }
  }

  async update(actor: Actor, contractId: string, id: string, dto: { area?: string; owner?: ResponsibilityOwner; notes?: string; sortOrder?: number }) {
    const c = await this.contract(contractId);
    const row = await this.prisma.responsibility.findFirst({ where: { id, contractId } });
    if (!row) throw ApiError.notFound('responsibility', id);
    const r = await this.prisma.responsibility.update({ where: { id }, data: { area: dto.area?.trim(), owner: dto.owner, notes: dto.notes, sortOrder: dto.sortOrder } });
    await this.events.emit('managed.responsibility_changed', { contractId, area: r.area, owner: r.owner, before: row.owner, change: 'updated' }, { teamId: c.teamId, actor, resource: `managed_contract:${contractId}` });
    return presentResponsibility(r);
  }

  async remove(actor: Actor, contractId: string, id: string) {
    const c = await this.contract(contractId);
    const row = await this.prisma.responsibility.findFirst({ where: { id, contractId } });
    if (!row) throw ApiError.notFound('responsibility', id);
    await this.prisma.responsibility.delete({ where: { id } });
    await this.events.emit('managed.responsibility_changed', { contractId, area: row.area, change: 'deleted' }, { teamId: c.teamId, actor, resource: `managed_contract:${contractId}` });
    return { deleted: true };
  }

  private async contract(id: string) {
    const c = await this.prisma.managedContract.findUnique({ where: { id } });
    if (!c) throw ApiError.notFound('managed contract', id);
    return c;
  }
}
