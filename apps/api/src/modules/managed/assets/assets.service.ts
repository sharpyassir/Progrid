import { Injectable } from '@nestjs/common';
import type { ManagedAsset } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ApiError } from '../../../common/errors/api-error';
import type { Actor } from '../../../common/auth/actor';
import { loadConfig } from '../../../config/config';
import { EventsService } from '../../events/events.service';
import { assertOwner } from '../managed.constants';
import { ManagedNotify } from '../managed-notify.service';
import { ContractsService } from '../contracts/contracts.service';
import { ContractTermsService } from '../contracts/contract-terms.service';
import type { RequestAssetDto, StaffCreateAssetDto, UpdateAssetDto } from './assets.dto';

/** Heartbeat tokens: `prgd_hb_` plus 32 random bytes. Only the sha256 is stored. */
export const HEARTBEAT_TOKEN_PREFIX = 'prgd_hb_';
export const hashToken = (raw: string) => createHash('sha256').update(raw).digest('hex');

export function presentAsset(a: ManagedAsset, staff = false) {
  return {
    id: a.id,
    contractId: a.contractId,
    kind: a.kind,
    serverId: a.serverId,
    name: a.name,
    address: a.address,
    provider: a.provider,
    os: a.os,
    status: a.status,
    monitoringEnabled: a.monitoringEnabled,
    backupEnabled: a.backupEnabled,
    health: a.health,
    lastHeartbeatAt: a.lastHeartbeatAt,
    approvedAt: a.approvedAt,
    rejectedReason: a.rejectedReason,
    notes: a.notes,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    ...(staff ? { managementAddress: a.managementAddress, hasHeartbeatToken: !!a.heartbeatTokenHash, heartbeatReport: a.heartbeatReport, requestedById: a.requestedById, approvedById: a.approvedById } : {}),
  };
}

/**
 * Servers and sites under management. Customers request an asset (PENDING) and an engineer
 * approves or rejects it; staff can add assets directly. Removal is soft so alerts and reports
 * keep their history.
 */
@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly contracts: ContractsService,
    private readonly terms: ContractTermsService,
    private readonly notify: ManagedNotify,
  ) {}

  // ---- customer ----

  async listForContract(actor: Actor, contractId: string) {
    await this.contracts.owned(actor, contractId);
    return this.list(contractId, false);
  }

  /** Every asset of the team's contracts (members use this; they cannot read contracts). */
  async listForTeam(actor: Actor) {
    const rows = await this.prisma.managedAsset.findMany({ where: { removedAt: null, contract: { teamId: actor.teamId } }, orderBy: [{ contractId: 'asc' }, { createdAt: 'asc' }] });
    const open = await this.openAlertCounts(rows.map((r) => r.id));
    return { data: rows.map((a) => ({ ...presentAsset(a), openAlerts: open.get(a.id) ?? 0 })) };
  }

  async request(actor: Actor, contractId: string, dto: RequestAssetDto) {
    assertOwner(actor);
    const c = await this.contracts.owned(actor, contractId);
    if (c.status === 'CANCELLED') throw ApiError.invalidState('The contract is cancelled');
    await this.checkShape(dto, c.teamId);
    await this.checkLimit(c);
    const a = await this.prisma.managedAsset.create({
      data: { contractId, kind: dto.kind, name: dto.name.trim(), serverId: dto.serverId ?? null, address: dto.address ?? null, provider: dto.provider ?? (dto.kind === 'PLATFORM_SERVER' ? 'Progrid' : null), os: dto.os ?? null, notes: dto.notes ?? null, requestedById: actor.userId, status: 'PENDING' },
    });
    await this.events.emit('managed.asset_requested', { contractId, assetId: a.id, kind: a.kind, name: a.name }, { actor, resource: `managed_asset:${a.id}` });
    await this.notify.toStaff({ subject: `Managed asset to approve: ${a.name}`, text: `A customer asked to add ${a.name} (${a.kind}) to a managed contract.\n\n${loadConfig().CONSOLE_URL}/admin/managed/contracts/${contractId}` });
    return presentAsset(a);
  }

  // ---- staff ----

  async list(contractId: string, staff = true) {
    const rows = await this.prisma.managedAsset.findMany({ where: { contractId, removedAt: null }, orderBy: { createdAt: 'asc' } });
    const open = await this.openAlertCounts(rows.map((r) => r.id));
    return { data: rows.map((a) => ({ ...presentAsset(a, staff), openAlerts: open.get(a.id) ?? 0 })) };
  }

  async get(assetId: string) {
    return presentAsset(await this.load(assetId), true);
  }

  async create(actor: Actor, contractId: string, dto: StaffCreateAssetDto) {
    const c = await this.prisma.managedContract.findUnique({ where: { id: contractId }, include: { plan: true } });
    if (!c) throw ApiError.notFound('managed contract', contractId);
    if (c.status === 'CANCELLED') throw ApiError.invalidState('The contract is cancelled');
    await this.checkShape(dto, c.teamId);
    await this.checkLimit(c);
    const approved = dto.approved !== false;
    const a = await this.prisma.managedAsset.create({
      data: {
        contractId, kind: dto.kind, name: dto.name.trim(), serverId: dto.serverId ?? null, address: dto.address ?? null, managementAddress: dto.managementAddress ?? null,
        provider: dto.provider ?? (dto.kind === 'PLATFORM_SERVER' ? 'Progrid' : null), os: dto.os ?? null, notes: dto.notes ?? null,
        monitoringEnabled: dto.monitoringEnabled ?? true, backupEnabled: dto.backupEnabled ?? false,
        status: approved ? 'APPROVED' : 'PENDING', approvedAt: approved ? new Date() : null, approvedById: approved ? actor.userId : null, requestedById: actor.userId,
      },
    });
    await this.events.emit('managed.asset_created', { contractId, assetId: a.id, kind: a.kind, name: a.name, status: a.status }, { teamId: c.teamId, actor, resource: `managed_asset:${a.id}` });
    return presentAsset(a, true);
  }

  async update(actor: Actor, assetId: string, dto: UpdateAssetDto) {
    const a = await this.load(assetId);
    const updated = await this.prisma.managedAsset.update({ where: { id: assetId }, data: dto });
    const teamId = await this.teamOf(a.contractId);
    await this.events.emit('managed.asset_updated', { contractId: a.contractId, assetId, changes: dto as Record<string, unknown> }, { teamId, actor, resource: `managed_asset:${assetId}` });
    return presentAsset(updated, true);
  }

  async approve(actor: Actor, assetId: string) {
    const a = await this.load(assetId);
    if (a.status === 'APPROVED') return presentAsset(a, true);
    const updated = await this.prisma.managedAsset.update({ where: { id: assetId }, data: { status: 'APPROVED', approvedAt: new Date(), approvedById: actor.userId, rejectedReason: null } });
    const teamId = await this.teamOf(a.contractId);
    await this.events.emit('managed.asset_approved', { contractId: a.contractId, assetId, name: a.name }, { teamId, actor, resource: `managed_asset:${assetId}` });
    await this.notify.toOwners(teamId, { subject: `${a.name} is now managed`, text: `Our engineers approved ${a.name} for your managed cloud contract. It is monitored from now on.\n\n${loadConfig().CONSOLE_URL}/managed/assets` });
    return presentAsset(updated, true);
  }

  async reject(actor: Actor, assetId: string, reason: string) {
    const a = await this.load(assetId);
    if (a.status !== 'PENDING') throw ApiError.invalidState(`Only a PENDING asset can be rejected (this one is ${a.status})`);
    const updated = await this.prisma.managedAsset.update({ where: { id: assetId }, data: { status: 'REJECTED', rejectedReason: reason } });
    const teamId = await this.teamOf(a.contractId);
    await this.events.emit('managed.asset_rejected', { contractId: a.contractId, assetId, name: a.name, reason }, { teamId, actor, resource: `managed_asset:${assetId}` });
    await this.notify.toOwners(teamId, { subject: `We could not add ${a.name}`, text: `Our engineers could not add ${a.name} to your managed cloud contract: ${reason}\n\nReply on a ticket if you have questions.` });
    return presentAsset(updated, true);
  }

  async remove(actor: Actor, assetId: string) {
    const a = await this.load(assetId);
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.managedAsset.update({ where: { id: assetId }, data: { removedAt: now, monitoringEnabled: false, heartbeatTokenHash: null } }),
      this.prisma.maintenanceTask.updateMany({ where: { assetId }, data: { enabled: false, nextRunAt: null } }),
      this.prisma.alert.updateMany({ where: { assetId, status: { not: 'RESOLVED' } }, data: { status: 'RESOLVED', resolvedAt: now, endsAt: now, openKey: null } }),
    ]);
    await this.events.emit('managed.asset_removed', { contractId: a.contractId, assetId, name: a.name }, { teamId: await this.teamOf(a.contractId), actor, resource: `managed_asset:${assetId}` });
    return { deleted: true };
  }

  /** Issues a new heartbeat token for the monitoring agent; the old one stops working. Shown once. */
  async rotateToken(actor: Actor, assetId: string) {
    const a = await this.load(assetId);
    if (a.kind !== 'EXTERNAL_SERVER') throw ApiError.invalid('Heartbeat tokens are for external servers; platform servers and sites are monitored by the platform');
    const token = HEARTBEAT_TOKEN_PREFIX + randomBytes(32).toString('base64url');
    await this.prisma.managedAsset.update({ where: { id: assetId }, data: { heartbeatTokenHash: hashToken(token) } });
    await this.events.emit('managed.asset_token_rotated', { contractId: a.contractId, assetId }, { teamId: await this.teamOf(a.contractId), actor, resource: `managed_asset:${assetId}` });
    return { assetId, token, heartbeatUrl: `${loadConfig().PUBLIC_API_URL}/internal/agents/heartbeat` };
  }

  // ---- helpers ----

  private async checkShape(dto: RequestAssetDto, teamId: string) {
    if (dto.kind === 'PLATFORM_SERVER') {
      if (!dto.serverId) throw ApiError.invalid('serverId is required for a PLATFORM_SERVER asset');
      const s = await this.prisma.server.findFirst({ where: { id: dto.serverId, deletedAt: null, project: { teamId } } });
      if (!s) throw ApiError.invalid(`Server ${dto.serverId} is not one of the team's servers`);
      const dup = await this.prisma.managedAsset.findFirst({ where: { serverId: s.id, removedAt: null, status: { not: 'REJECTED' } } });
      if (dup) throw ApiError.conflict('already_exists', `Server ${s.name} is already under management`);
    } else if (!dto.address) {
      throw ApiError.invalid(`address is required for a ${dto.kind} asset`);
    }
  }

  private async checkLimit(c: Parameters<ContractTermsService['terms']>[0]) {
    const { maxAssets } = await this.terms.terms(c);
    if (maxAssets === null) return;
    const n = await this.prisma.managedAsset.count({ where: { contractId: c.id, removedAt: null, status: { not: 'REJECTED' } } });
    if (n >= maxAssets) throw ApiError.quota(`The ${c.plan.name} plan covers ${maxAssets} assets; ask us about a larger plan`, { maxAssets });
  }

  private async openAlertCounts(assetIds: string[]) {
    if (!assetIds.length) return new Map<string, number>();
    const rows = await this.prisma.alert.groupBy({ by: ['assetId'], where: { assetId: { in: assetIds }, status: { not: 'RESOLVED' } }, _count: { _all: true } });
    return new Map(rows.map((r) => [r.assetId, r._count._all]));
  }

  private async load(id: string) {
    const a = await this.prisma.managedAsset.findFirst({ where: { id, removedAt: null } });
    if (!a) throw ApiError.notFound('managed asset', id);
    return a;
  }

  private async teamOf(contractId: string) {
    return (await this.prisma.managedContract.findUniqueOrThrow({ where: { id: contractId }, select: { teamId: true } })).teamId;
  }
}
