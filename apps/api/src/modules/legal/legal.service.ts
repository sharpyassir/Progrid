import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { entityProfile, type BillingEntityId } from '../../common/entities/entities';
import { EventsService } from '../events/events.service';
import { LEGAL_DOCUMENTS, LEGAL_RELATED, LEGAL_VERSION, type LegalMethod } from './legal';

type Tx = Prisma.TransactionClient | PrismaService;

@Injectable()
export class LegalService {
  constructor(private readonly prisma: PrismaService, private readonly events: EventsService) {}

  /** The current version and where to read each document for this company. */
  summary(entity: BillingEntityId = 'progrid_llc') {
    const www = entityProfile(entity).wwwUrl;
    const link = (slug: string) => ({ slug, url: `${www}/legal/${slug}` });
    return { version: LEGAL_VERSION, entity, documents: LEGAL_DOCUMENTS.map(link), related: LEGAL_RELATED.map(link) };
  }

  /** Records an acceptance of the current version (the clickwrap record) and marks the user current. */
  async accept(userId: string, how: { method: LegalMethod; entity: BillingEntityId; ip?: string; userAgent?: string }, tx: Tx = this.prisma) {
    const at = new Date();
    await tx.legalAcceptance.create({
      data: { userId, version: LEGAL_VERSION, documents: [...LEGAL_DOCUMENTS], entity: how.entity, method: how.method, ip: how.ip?.slice(0, 64), userAgent: how.userAgent?.slice(0, 300), createdAt: at },
    });
    await tx.user.update({ where: { id: userId }, data: { legalVersion: LEGAL_VERSION, legalAcceptedAt: at } });
    return { version: LEGAL_VERSION, acceptedAt: at };
  }

  /** Accept from the console (a user asked to accept a new version, or one created without the checkbox). */
  async acceptFromConsole(actor: { userId: string; teamId: string; ip?: string; userAgent?: string }) {
    const team = await this.prisma.team.findUnique({ where: { id: actor.teamId }, select: { billingEntity: true } });
    const entity = team?.billingEntity ?? 'progrid_llc';
    const r = await this.accept(actor.userId, { method: 'reaccept', entity, ip: actor.ip, userAgent: actor.userAgent });
    await this.events.emit('legal.accepted', { version: r.version, method: 'reaccept', entity }, { actor: actor as never, teamId: actor.teamId, resource: `user:${actor.userId}` });
    return { ...r, required: false };
  }

  history(userId: string) {
    return this.prisma.legalAcceptance.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50, select: { version: true, documents: true, entity: true, method: true, ip: true, createdAt: true } });
  }
}
