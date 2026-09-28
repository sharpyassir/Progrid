import { Injectable } from '@nestjs/common';
import { Prisma, type ManagedPlan } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ApiError } from '../../../common/errors/api-error';
import type { Actor } from '../../../common/auth/actor';
import { EventsService } from '../../events/events.service';
import { parseTargets } from '../managed.constants';
import type { CreatePlanDto, UpdatePlanDto } from './plans.dto';

/** Plan as the API returns it (customer and staff). */
export function presentPlan(p: ManagedPlan) {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    priceMinor: p.priceMinor,
    currency: p.currency,
    custom: p.priceMinor === null,
    maxAssets: p.maxAssets,
    coverage: p.coverage,
    includedEngineerMinutes: p.includedEngineerMinutes,
    hourlyRateMinor: p.hourlyRateMinor,
    responseTargets: p.responseTargets as Record<string, number>,
    resolveTargets: p.resolveTargets as Record<string, number>,
    active: p.active,
    sortOrder: p.sortOrder,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

@Injectable()
export class ManagedPlansService {
  constructor(private readonly prisma: PrismaService, private readonly events: EventsService) {}

  async listActive() {
    const rows = await this.prisma.managedPlan.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] });
    return { data: rows.map(presentPlan) };
  }

  async listAll() {
    const rows = await this.prisma.managedPlan.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }], include: { _count: { select: { contracts: true } } } });
    return { data: rows.map((p) => ({ ...presentPlan(p), contractCount: p._count.contracts })) };
  }

  async get(id: string) {
    const p = await this.prisma.managedPlan.findFirst({ where: { OR: [{ id }, { code: id }] } });
    if (!p) throw ApiError.notFound('managed plan', id);
    return presentPlan(p);
  }

  async create(actor: Actor, dto: CreatePlanDto) {
    const data = this.validated(dto) as Prisma.ManagedPlanCreateInput;
    try {
      const p = await this.prisma.managedPlan.create({ data });
      await this.events.emit('managed.plan_created', { planId: p.id, code: p.code, priceMinor: p.priceMinor, currency: p.currency }, { actor, resource: `managed_plan:${p.id}` });
      return presentPlan(p);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw ApiError.conflict('already_exists', `A plan with code ${dto.code} already exists`);
      throw e;
    }
  }

  async update(actor: Actor, id: string, dto: UpdatePlanDto) {
    const before = await this.prisma.managedPlan.findUnique({ where: { id } });
    if (!before) throw ApiError.notFound('managed plan', id);
    const p = await this.prisma.managedPlan.update({ where: { id }, data: this.validated(dto) });
    await this.events.emit('managed.plan_updated', { planId: id, code: p.code, changes: dto as Record<string, unknown>, before: { priceMinor: before.priceMinor, hourlyRateMinor: before.hourlyRateMinor } }, { actor, resource: `managed_plan:${id}` });
    return presentPlan(p);
  }

  /** Deletes an unused plan; a plan with contracts is deactivated instead so the contracts keep their terms. */
  async remove(actor: Actor, id: string) {
    const p = await this.prisma.managedPlan.findUnique({ where: { id }, include: { _count: { select: { contracts: true } } } });
    if (!p) throw ApiError.notFound('managed plan', id);
    if (p._count.contracts > 0) {
      const off = await this.prisma.managedPlan.update({ where: { id }, data: { active: false } });
      await this.events.emit('managed.plan_deactivated', { planId: id, code: p.code }, { actor, resource: `managed_plan:${id}` });
      return { deleted: false, deactivated: true, plan: presentPlan(off) };
    }
    await this.prisma.managedPlan.delete({ where: { id } });
    await this.events.emit('managed.plan_deleted', { planId: id, code: p.code }, { actor, resource: `managed_plan:${id}` });
    return { deleted: true, deactivated: false };
  }

  private validated(dto: Partial<CreatePlanDto>) {
    const data: Record<string, unknown> = { ...dto };
    try {
      if (dto.responseTargets) data.responseTargets = parseTargets(dto.responseTargets, 'responseTargets');
      if (dto.resolveTargets) data.resolveTargets = parseTargets(dto.resolveTargets, 'resolveTargets');
    } catch (e) {
      throw ApiError.invalid((e as Error).message);
    }
    if (dto.responseTargets && dto.resolveTargets) {
      const r = data.responseTargets as Record<string, number>, s = data.resolveTargets as Record<string, number>;
      for (const k of Object.keys(r)) if (s[k] < r[k]) throw ApiError.invalid(`The ${k} resolve target cannot be shorter than its response target`);
    }
    return data;
  }
}
