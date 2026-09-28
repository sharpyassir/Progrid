import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { EventsService } from '../../events/events.service';

/**
 * Access revocation hook, run when a contract is cancelled. It stops everything Progrid does on
 * the customer's assets: maintenance schedules, monitoring, heartbeat tokens and open alerts.
 * Removing Progrid's SSH keys and WireGuard peers from external servers is a manual step for
 * now: the `managed.access_revoked` event lists the assets and the operations guide describes
 * the checklist (docs/managed-cloud-operations.md).
 */
@Injectable()
export class ManagedAccessService {
  private readonly log = new Logger(ManagedAccessService.name);
  constructor(private readonly prisma: PrismaService, private readonly events: EventsService) {}

  async revoke(contractId: string, teamId: string) {
    const assets = await this.prisma.managedAsset.findMany({ where: { contractId, removedAt: null }, select: { id: true, name: true, kind: true, managementAddress: true } });
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.maintenanceTask.updateMany({ where: { contractId }, data: { enabled: false, nextRunAt: null } }),
      this.prisma.managedAsset.updateMany({ where: { contractId }, data: { monitoringEnabled: false, heartbeatTokenHash: null } }),
      this.prisma.alert.updateMany({ where: { contractId, status: { not: 'RESOLVED' } }, data: { status: 'RESOLVED', resolvedAt: now, endsAt: now, openKey: null } }),
    ]);
    await this.events.emit('managed.access_revoked', { contractId, assets: assets.map((a) => ({ id: a.id, name: a.name, kind: a.kind, managementAddress: a.managementAddress })) }, { teamId, resource: `managed_contract:${contractId}` });
    this.log.log(`access revoked for contract ${contractId} (${assets.length} assets): remove Progrid keys and management peers on external servers`);
    return assets.length;
  }
}
