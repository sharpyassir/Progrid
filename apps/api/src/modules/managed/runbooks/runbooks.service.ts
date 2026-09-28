import { Injectable } from '@nestjs/common';
import { Prisma, type Runbook } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ApiError } from '../../../common/errors/api-error';
import type { Actor } from '../../../common/auth/actor';
import { EventsService } from '../../events/events.service';

export function presentRunbook(r: Runbook & { updatedBy?: { id: string; name: string } | null }, withBody = true) {
  return { id: r.id, slug: r.slug, title: r.title, tags: r.tags, ...(withBody ? { body: r.body } : { excerpt: r.body.replace(/[#*`>_-]/g, '').trim().slice(0, 200) }), updatedById: r.updatedById, updatedBy: r.updatedBy ?? undefined, createdAt: r.createdAt, updatedAt: r.updatedAt };
}

export function slugify(title: string) {
  return title.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'runbook';
}

const normTags = (tags?: string[]) => [...new Set((tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);

/**
 * The internal knowledge base: markdown runbooks with a unique slug and tags. Search matches the
 * title (case insensitive) or a tag. Tag a customer runbook `contract:<id>` so onboarding and
 * the back office can find it.
 */
@Injectable()
export class RunbooksService {
  constructor(private readonly prisma: PrismaService, private readonly events: EventsService) {}

  async list(q: { q?: string; tag?: string }) {
    const term = q.q?.trim();
    const rows = await this.prisma.runbook.findMany({
      where: {
        ...(q.tag ? { tags: { has: q.tag.toLowerCase() } } : {}),
        ...(term ? { OR: [{ title: { contains: term, mode: 'insensitive' } }, { tags: { has: term.toLowerCase() } }, { slug: { contains: slugify(term) } }] } : {}),
      },
      include: { updatedBy: { select: { id: true, name: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return { data: rows.map((r) => presentRunbook(r, false)) };
  }

  async get(idOrSlug: string) {
    const r = await this.prisma.runbook.findFirst({ where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] }, include: { updatedBy: { select: { id: true, name: true } } } });
    if (!r) throw ApiError.notFound('runbook', idOrSlug);
    return presentRunbook(r);
  }

  async create(actor: Actor, dto: { title: string; body: string; slug?: string; tags?: string[] }) {
    const slug = dto.slug ?? slugify(dto.title);
    try {
      const r = await this.prisma.runbook.create({ data: { slug, title: dto.title.trim(), body: dto.body, tags: normTags(dto.tags), updatedById: actor.userId }, include: { updatedBy: { select: { id: true, name: true } } } });
      await this.events.emit('managed.runbook_created', { runbookId: r.id, slug }, { actor, resource: `runbook:${r.id}` });
      return presentRunbook(r);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw ApiError.conflict('already_exists', `A runbook with the slug "${slug}" already exists`);
      throw e;
    }
  }

  async update(actor: Actor, idOrSlug: string, dto: { title?: string; body?: string; slug?: string; tags?: string[] }) {
    const cur = await this.get(idOrSlug);
    try {
      const r = await this.prisma.runbook.update({ where: { id: cur.id }, data: { title: dto.title?.trim(), body: dto.body, slug: dto.slug, tags: dto.tags ? normTags(dto.tags) : undefined, updatedById: actor.userId }, include: { updatedBy: { select: { id: true, name: true } } } });
      await this.events.emit('managed.runbook_updated', { runbookId: r.id, slug: r.slug }, { actor, resource: `runbook:${r.id}` });
      return presentRunbook(r);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw ApiError.conflict('already_exists', `A runbook with the slug "${dto.slug}" already exists`);
      throw e;
    }
  }

  async remove(actor: Actor, idOrSlug: string) {
    const cur = await this.get(idOrSlug);
    await this.prisma.runbook.delete({ where: { id: cur.id } });
    await this.events.emit('managed.runbook_deleted', { runbookId: cur.id, slug: cur.slug }, { actor, resource: `runbook:${cur.id}` });
    return { deleted: true };
  }
}
