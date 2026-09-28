import { Injectable, Logger } from '@nestjs/common';
import type { EngineerProfile } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { Actor } from '../../../common/auth/actor';
import { OpsAudit } from '../ops-audit.service';
import { GrantsService } from '../access/grants.service';

/**
 * What happens when an engineer is suspended or offboarded, or loses a contract assignment.
 * Suspension and offboarding end the engineer's ops sessions (EngineersService) and, here:
 * revoke every live access grant; offboarding also removes every assignment.
 */
@Injectable()
export class OffboardingService {
  private readonly log = new Logger(OffboardingService.name);
  constructor(private readonly prisma: PrismaService, private readonly audit: OpsAudit, private readonly grants: GrantsService) {}

  async onStatusChange(actor: Actor, p: EngineerProfile, from: string) {
    const summary: Record<string, unknown> = { engineerId: p.id, userId: p.userId, from, to: p.status };
    summary.grantsRevoked = await this.grants.revokeWhere({ userId: p.userId }, p.status.toLowerCase(), actor);
    if (p.status === 'OFFBOARDED') {
      const removed = await this.prisma.engineerAssignment.deleteMany({ where: { engineerId: p.id } });
      summary.assignmentsRemoved = removed.count;
    }
    await this.audit.emit('ops.engineer_access_removed', actor, summary, `engineer:${p.id}`);
    this.log.log(`engineer ${p.id} ${from} -> ${p.status}: ${JSON.stringify(summary)}`);
    return summary;
  }

  /** The engineer lost access to one contract (unassigned, or excluded by a new residency policy): its grants end. */
  async onUnassigned(actor: Actor, userId: string, contractId: string) {
    await this.grants.revokeWhere({ userId, contractId }, 'unassigned', actor);
  }
}
