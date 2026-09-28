import { Injectable, Logger } from '@nestjs/common';
import type { EngineerProfile } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { Actor } from '../../../common/auth/actor';
import { OpsAudit } from '../ops-audit.service';

/**
 * What happens when an engineer is suspended or offboarded, or loses a contract assignment.
 * Suspension and offboarding end the engineer's ops sessions (EngineersService) and, here:
 * offboarding removes every assignment.
 */
@Injectable()
export class OffboardingService {
  private readonly log = new Logger(OffboardingService.name);
  constructor(private readonly prisma: PrismaService, private readonly audit: OpsAudit) {}

  async onStatusChange(actor: Actor, p: EngineerProfile, from: string) {
    const summary: Record<string, unknown> = { engineerId: p.id, userId: p.userId, from, to: p.status };
    if (p.status === 'OFFBOARDED') {
      const removed = await this.prisma.engineerAssignment.deleteMany({ where: { engineerId: p.id } });
      summary.assignmentsRemoved = removed.count;
    }
    await this.audit.emit('ops.engineer_access_removed', actor, summary, `engineer:${p.id}`);
    this.log.log(`engineer ${p.id} ${from} -> ${p.status}: ${JSON.stringify(summary)}`);
    return summary;
  }

  /** The engineer lost access to one contract. */
  async onUnassigned(_actor: Actor, _userId: string, _contractId: string) {}
}
