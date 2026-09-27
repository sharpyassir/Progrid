import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Bucket } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type { Actor } from '../../../common/auth/actor';
import { ApiError } from '../../../common/errors/api-error';
import { loadConfig } from '../../../config/config';
import { IamService } from '../../iam/iam.service';
import { TrustService } from '../../trust/trust.service';
import { EventsService } from '../../events/events.service';
import { OBJECT_STORAGE_PROVIDER, ObjectStorageProvider } from './objects.provider';
import { CreateBucketDto, CreateStorageKeyDto, PresignDto, UpdateBucketDto } from './objects.dto';

const RESERVED = /^(xn--|sthree-|amzn-)|-s3alias$|--ol-s3$|^\d+\.\d+\.\d+\.\d+$/;

/**
 * Object storage: S3 compatible buckets on the region's Ceph RADOS Gateway. The project owns
 * one RGW user; buckets and access keys belong to it. Customers talk S3 to the endpoint with
 * their keys; this service creates and deletes buckets and keys, lists and presigns on their
 * behalf for the console and CLI, and reads usage for billing per GB month.
 */
@Injectable()
export class ObjectsService {
  private readonly log = new Logger(ObjectsService.name);
  readonly endpoint: string;
  readonly region: string;

  constructor(private readonly prisma: PrismaService, private readonly iam: IamService, private readonly trust: TrustService, private readonly events: EventsService, @Inject(OBJECT_STORAGE_PROVIDER) private readonly provider: ObjectStorageProvider) {
    const cfg = loadConfig();
    this.endpoint = cfg.S3_ENDPOINT;
    this.region = cfg.S3_REGION;
  }

  // ---- buckets ----

  async list(actor: Actor, project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    const rows = await this.prisma.bucket.findMany({ where: { projectId: p.id, deletedAt: null }, orderBy: { createdAt: 'desc' } });
    return { data: rows.map((b) => this.present(b)), endpoint: this.endpoint, region: this.region };
  }

  /** One bucket, with usage refreshed from the cluster when the cached figure is older than ten seconds. */
  async get(actor: Actor, name: string, project?: string) {
    let b = await this.own(actor, name, project);
    if (b.status === 'active' && (!b.usageUpdatedAt || Date.now() - b.usageUpdatedAt.getTime() > 10_000)) {
      try {
        const u = await this.provider.usage(b.projectId, name);
        b = await this.prisma.bucket.update({ where: { id: b.id }, data: { sizeBytes: u.sizeBytes, objectCount: u.objectCount, usageUpdatedAt: new Date() } });
      } catch {
        /* keep the cached figure */
      }
    }
    return this.present(b);
  }

  async create(actor: Actor, dto: CreateBucketDto) {
    const p = await this.iam.resolveProject(actor, dto.project);
    await this.trust.assertCanProvision(actor.teamId);
    const region = await this.prisma.region.findUnique({ where: { id: dto.region ?? loadConfig().DEFAULT_REGION } });
    if (!region?.available) throw ApiError.invalid(`Unknown or unavailable region "${dto.region}"`);
    if (RESERVED.test(dto.name) || dto.name.includes('..')) throw ApiError.invalid('That bucket name is reserved');
    if (await this.prisma.bucket.findFirst({ where: { name: dto.name, deletedAt: null } })) throw ApiError.conflict('name_taken', `Bucket name "${dto.name}" is taken; names are global`);
    if ((await this.prisma.bucket.count({ where: { projectId: p.id, deletedAt: null } })) >= 100) throw ApiError.quota('Project bucket limit (100) reached');
    const b = await this.prisma.bucket.create({ data: { projectId: p.id, regionId: region.id, name: dto.name, public: !!dto.public } });
    try {
      await this.provider.ensureUser(p.id);
      await this.provider.createBucket(p.id, dto.name);
      if (dto.public) await this.provider.setPublic(p.id, dto.name, true);
      await this.prisma.bucket.update({ where: { id: b.id }, data: { status: 'active', meteredSince: new Date() } });
    } catch (err) {
      await this.prisma.bucket.update({ where: { id: b.id }, data: { status: 'failed', statusMessage: (err as Error).message.slice(0, 500) } });
      this.log.warn(`bucket ${dto.name} create failed: ${(err as Error).message}`);
      throw new ApiError(502, 'storage_unavailable', 'The storage cluster did not accept the bucket; try again in a minute');
    }
    await this.events.emit('bucket.created', { bucket: dto.name, region: region.id, public: !!dto.public }, { actor, resource: `bucket:${dto.name}` });
    return this.get(actor, dto.name, dto.project);
  }

  async update(actor: Actor, name: string, dto: UpdateBucketDto, project?: string) {
    const b = await this.own(actor, name, project);
    if (dto.public !== undefined && dto.public !== b.public) {
      await this.provider.setPublic(b.projectId, name, dto.public);
      await this.prisma.bucket.update({ where: { id: b.id }, data: { public: dto.public } });
      await this.events.emit('bucket.updated', { bucket: name, public: dto.public }, { actor, resource: `bucket:${name}` });
    }
    return this.get(actor, name, project);
  }

  async remove(actor: Actor, name: string, project?: string) {
    const b = await this.own(actor, name, project);
    if (b.status === 'active' && !(await this.provider.isEmpty(b.projectId, name))) throw ApiError.invalidState('Bucket is not empty; delete its objects first');
    await this.prisma.bucket.update({ where: { id: b.id }, data: { status: 'deleting' } });
    try {
      if (b.status !== 'failed') await this.provider.deleteBucket(b.projectId, name);
      await this.prisma.bucket.update({ where: { id: b.id }, data: { status: 'deleted', deletedAt: new Date(), meteredSince: null } });
    } catch (err) {
      await this.prisma.bucket.update({ where: { id: b.id }, data: { status: 'active', statusMessage: `delete failed: ${(err as Error).message.slice(0, 300)}` } });
      throw new ApiError(502, 'storage_unavailable', 'The storage cluster did not accept the change; try again in a minute');
    }
    await this.events.emit('bucket.deleted', { bucket: name }, { actor, resource: `bucket:${name}` });
    return { name, deleted: true };
  }

  // ---- objects (console and CLI convenience; customers normally use S3 directly) ----

  async listObjects(actor: Actor, name: string, prefix = '', token?: string, project?: string) {
    const b = await this.own(actor, name, project);
    const r = await this.provider.listObjects(b.projectId, name, prefix, token);
    return { bucket: name, prefix, ...r };
  }

  async deleteObject(actor: Actor, name: string, key: string, project?: string) {
    const b = await this.own(actor, name, project);
    await this.provider.deleteObject(b.projectId, name, key);
    return { key, deleted: true };
  }

  async presign(actor: Actor, name: string, dto: PresignDto, project?: string) {
    const b = await this.own(actor, name, project);
    const method = dto.method ?? 'GET';
    const expiresSeconds = dto.expiresSeconds ?? 900;
    const url = await this.provider.presign(b.projectId, name, dto.key, method, expiresSeconds, dto.contentType);
    return { url, method, key: dto.key, expiresAt: new Date(Date.now() + expiresSeconds * 1000) };
  }

  // ---- access keys ----

  async listKeys(actor: Actor, project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    const data = await this.prisma.storageKey.findMany({ where: { projectId: p.id, revokedAt: null }, select: { id: true, name: true, accessKey: true, createdAt: true, lastUsedAt: true }, orderBy: { createdAt: 'desc' } });
    return { data, endpoint: this.endpoint, region: this.region };
  }

  async createKey(actor: Actor, dto: CreateStorageKeyDto) {
    const p = await this.iam.resolveProject(actor, dto.project);
    if ((await this.prisma.storageKey.count({ where: { projectId: p.id, revokedAt: null } })) >= 20) throw ApiError.quota('Project access key limit (20) reached');
    await this.provider.ensureUser(p.id);
    const k = await this.provider.createKey(p.id);
    const row = await this.prisma.storageKey.create({ data: { projectId: p.id, name: dto.name, accessKey: k.accessKey, secretKey: k.secretKey, createdBy: actor.tokenId ?? actor.userId } });
    await this.events.emit('storage_key.created', { keyId: row.id, name: dto.name, accessKey: k.accessKey }, { actor, resource: `storage_key:${row.id}` });
    // The secret is returned once. It stays stored so revocation can find it, never listed.
    return { id: row.id, name: row.name, accessKey: k.accessKey, secretKey: k.secretKey, endpoint: this.endpoint, region: this.region, createdAt: row.createdAt };
  }

  async revokeKey(actor: Actor, id: string, project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    const k = await this.prisma.storageKey.findFirst({ where: { id, projectId: p.id, revokedAt: null } });
    if (!k) throw ApiError.notFound('storage_key', id);
    await this.provider.deleteKey(p.id, k.accessKey);
    await this.prisma.storageKey.update({ where: { id }, data: { revokedAt: new Date(), secretKey: '' } });
    await this.events.emit('storage_key.revoked', { keyId: id, accessKey: k.accessKey }, { actor, resource: `storage_key:${id}` });
    return { id, revoked: true };
  }

  // ---- usage (ten minute job) ----

  async refreshUsage() {
    const buckets = await this.prisma.bucket.findMany({ where: { status: 'active', deletedAt: null }, select: { id: true, name: true, projectId: true } });
    let n = 0;
    for (const b of buckets) {
      try {
        const u = await this.provider.usage(b.projectId, b.name);
        await this.prisma.bucket.update({ where: { id: b.id }, data: { sizeBytes: u.sizeBytes, objectCount: u.objectCount, usageUpdatedAt: new Date() } });
        n++;
      } catch (err) {
        this.log.warn(`usage for ${b.name}: ${(err as Error).message}`);
      }
    }
    return n;
  }

  // ---- helpers ----

  private async own(actor: Actor, name: string, project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    const b = await this.prisma.bucket.findFirst({ where: { name, projectId: p.id, deletedAt: null } });
    if (!b) throw ApiError.notFound('bucket', name);
    return b;
  }

  private present(b: Bucket) {
    return {
      id: b.id, name: b.name, status: b.status, statusMessage: b.statusMessage, regionId: b.regionId, projectId: b.projectId, public: b.public,
      sizeBytes: Number(b.sizeBytes), objectCount: b.objectCount, usageUpdatedAt: b.usageUpdatedAt,
      endpoint: this.endpoint, url: `${this.endpoint.replace(/\/$/, '')}/${b.name}`, createdAt: b.createdAt,
    };
  }
}
