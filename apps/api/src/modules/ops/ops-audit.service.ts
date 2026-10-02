import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { Actor } from '../../common/auth/actor';
import { EventsService } from '../events/events.service';
import type { OpsContext } from './guards/ops-context';

export interface OpsRefs {
  contractId?: string | null;
  assetId?: string | null;
  ticketId?: string | null;
  [key: string]: unknown;
}

/**
 * Every ops state change goes to the audit log through here: the event name (`ops.*`), the
 * actor, the client address, and the contract, asset and ticket it concerns, plus the team so
 * the change is part of the customer's trail too.
 */
@Injectable()
export class OpsAudit {
  constructor(private readonly prisma: PrismaService, private readonly events: EventsService) {}

  async emit(name: string, who: OpsContext | Actor | null, refs: OpsRefs, resource?: string) {
    const actor = who && 'actor' in who ? who.actor : (who as Actor | null) ?? undefined;
    const teamId = refs.contractId ? (await this.prisma.managedContract.findUnique({ where: { id: refs.contractId }, select: { teamId: true } }))?.teamId : undefined;
    // Without an actor (a failed sign in for an unknown email) the address can come in refs.
    const ip = actor?.ip ?? (typeof refs.ip === 'string' ? refs.ip : undefined);
    const payload = { contractId: refs.contractId ?? null, assetId: refs.assetId ?? null, ticketId: refs.ticketId ?? null, ...refs, actorId: actor?.userId ?? 'system', ip: ip ?? null };
    await this.events.emit(name, payload, { teamId, actor, resource, ip });
  }
}
