import { Injectable } from '@nestjs/common';
import type { Volume } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TemporalService } from '../../common/temporal/temporal.service';
import type { Actor } from '../../common/auth/actor';
import { ApiError } from '../../common/errors/api-error';
import { loadConfig } from '../../config/config';
import { IamService } from '../iam/iam.service';
import { TrustService } from '../trust/trust.service';
import { EventsService } from '../events/events.service';
import { SpendService } from '../billing/spend.service';
import { AttachVolumeDto, CreateVolumeDto, ResizeVolumeDto } from './volumes.dto';

const cfg = loadConfig();

/** Volumes a server can hold at once: scsi1 to scsi30 on the VM, minus headroom. */
const MAX_VOLUMES_PER_SERVER = 8;

const select = {
  id: true, name: true, sizeGb: true, status: true, statusMessage: true, serverId: true, device: true, regionId: true, projectId: true, createdAt: true,
  server: { select: { id: true, name: true } },
} as const;

/**
 * Block volumes: Ceph RBD images that live independently of servers. Every transition runs
 * as a Temporal workflow so a lost agent or API restart never leaves an image half attached.
 * Rules: one server at a time, same region, grow only, delete only while detached.
 */
@Injectable()
export class VolumesService {
  constructor(private readonly prisma: PrismaService, private readonly iam: IamService, private readonly trust: TrustService, private readonly temporal: TemporalService, private readonly events: EventsService, private readonly spend: SpendService) {}

  async list(actor: Actor, project?: string, serverId?: string) {
    const p = await this.iam.resolveProject(actor, project);
    const data = await this.prisma.volume.findMany({ where: { projectId: p.id, deletedAt: null, ...(serverId ? { serverId } : {}) }, select, orderBy: { createdAt: 'desc' } });
    return { data };
  }

  async get(actor: Actor, id: string, project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    const v = await this.prisma.volume.findFirst({ where: { id, projectId: p.id, deletedAt: null }, select });
    if (!v) throw ApiError.notFound('volume', id);
    return v;
  }

  async create(actor: Actor, dto: CreateVolumeDto) {
    const project = await this.iam.resolveProject(actor, dto.project);
    await this.trust.assertCanProvision(actor.teamId);
    const region = await this.prisma.region.findUnique({ where: { id: dto.region ?? cfg.DEFAULT_REGION } });
    if (!region?.available) throw ApiError.invalid(`Unknown or unavailable region "${dto.region}"`);
    if (await this.prisma.volume.findFirst({ where: { projectId: project.id, name: dto.name, deletedAt: null } })) throw ApiError.conflict('name_taken', `A volume named "${dto.name}" already exists in this project`);

    let server: { id: string; regionId: string } | null = null;
    if (dto.serverId) {
      server = await this.attachableServer(project.id, dto.serverId, region.id);
    }

    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: actor.teamId } });
    const monthly = Math.round((await this.spend.monthlyPriceMinor('volume', 'volume_gb', team.currency)) * dto.sizeGb);
    await this.spend.assertCanSpend(actor, project.id, monthly);

    const v = await this.prisma.volume.create({ data: { projectId: project.id, regionId: region.id, name: dto.name, sizeGb: dto.sizeGb, status: 'creating' }, select });
    await this.temporal.start('createVolume', [{ volumeId: v.id, serverId: server?.id }], `createVolume-${v.id}`);
    await this.events.emit('volume.create_requested', { volumeId: v.id, name: v.name, sizeGb: v.sizeGb, region: region.id, serverId: server?.id }, { actor, resource: `volume:${v.id}` });
    return v;
  }

  async attach(actor: Actor, id: string, dto: AttachVolumeDto, project?: string) {
    const v = await this.get(actor, id, project);
    if (v.status === 'attached' && v.serverId === dto.serverId) return v;
    if (v.status !== 'available') throw ApiError.invalidState(`Volume is ${v.status}; it must be available to attach`);
    await this.attachableServer(v.projectId, dto.serverId, v.regionId);
    await this.prisma.volume.update({ where: { id }, data: { status: 'attaching', statusMessage: null } });
    await this.temporal.start('attachVolume', [{ volumeId: id, serverId: dto.serverId }], `attachVolume-${id}-${Date.now()}`);
    await this.events.emit('volume.attach_requested', { volumeId: id, serverId: dto.serverId }, { actor, resource: `volume:${id}` });
    return { ...v, status: 'attaching' as const, serverId: dto.serverId };
  }

  async detach(actor: Actor, id: string, project?: string) {
    const v = await this.get(actor, id, project);
    if (v.status === 'available') return v;
    if (v.status !== 'attached') throw ApiError.invalidState(`Volume is ${v.status}; it must be attached to detach`);
    await this.prisma.volume.update({ where: { id }, data: { status: 'detaching', statusMessage: null } });
    await this.temporal.start('detachVolume', [{ volumeId: id }], `detachVolume-${id}-${Date.now()}`);
    await this.events.emit('volume.detach_requested', { volumeId: id, serverId: v.serverId }, { actor, resource: `volume:${id}` });
    return { ...v, status: 'detaching' as const };
  }

  async resize(actor: Actor, id: string, dto: ResizeVolumeDto, project?: string) {
    const v = await this.get(actor, id, project);
    if (v.status !== 'available' && v.status !== 'attached') throw ApiError.invalidState(`Volume is ${v.status}; wait for it to settle before resizing`);
    if (dto.sizeGb <= v.sizeGb) throw ApiError.invalid(`Volumes only grow. Current size is ${v.sizeGb} GB`);
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id: actor.teamId } });
    const delta = Math.round((await this.spend.monthlyPriceMinor('volume', 'volume_gb', team.currency)) * (dto.sizeGb - v.sizeGb));
    await this.spend.assertCanSpend(actor, v.projectId, delta);
    await this.prisma.volume.update({ where: { id }, data: { status: 'resizing', statusMessage: null } });
    await this.temporal.start('resizeVolume', [{ volumeId: id, sizeGb: dto.sizeGb, wasAttached: v.status === 'attached' }], `resizeVolume-${id}-${Date.now()}`);
    await this.events.emit('volume.resize_requested', { volumeId: id, from: v.sizeGb, to: dto.sizeGb }, { actor, resource: `volume:${id}` });
    return { ...v, status: 'resizing' as const };
  }

  async remove(actor: Actor, id: string, project?: string) {
    const v = await this.get(actor, id, project);
    if (v.status === 'attached' || v.status === 'attaching' || v.status === 'detaching') throw ApiError.invalidState('Detach the volume from its server before deleting it');
    if (v.status === 'creating' || v.status === 'resizing') throw ApiError.invalidState(`Volume is ${v.status}; wait for it to settle before deleting`);
    await this.prisma.volume.update({ where: { id }, data: { status: 'deleting', statusMessage: null } });
    await this.temporal.start('deleteVolume', [{ volumeId: id }], `deleteVolume-${id}`);
    await this.events.emit('volume.delete_requested', { volumeId: id }, { actor, resource: `volume:${id}` });
    return { id, status: 'deleting' };
  }

  /** Called by server deletion: detach records so the VM's disks are not orphaned. */
  async releaseFromServer(serverId: string) {
    await this.prisma.volume.updateMany({ where: { serverId }, data: { serverId: null, device: null, status: 'available' } });
  }

  private async attachableServer(projectId: string, serverId: string, regionId: string) {
    const s = await this.prisma.server.findFirst({ where: { id: serverId, projectId, deletedAt: null }, select: { id: true, regionId: true, status: true, _count: { select: { volumes: { where: { deletedAt: null } } } } } });
    if (!s) throw ApiError.notFound('server', serverId);
    if (s.regionId !== regionId) throw ApiError.invalid('Volume and server must be in the same region');
    if (!['active', 'off'].includes(s.status)) throw ApiError.invalidState(`Server is ${s.status}; it must be active or off`);
    if (s._count.volumes >= MAX_VOLUMES_PER_SERVER) throw ApiError.quota(`A server can hold at most ${MAX_VOLUMES_PER_SERVER} volumes`);
    return s;
  }
}

export type VolumeView = Pick<Volume, 'id' | 'name' | 'sizeGb' | 'status'>;
