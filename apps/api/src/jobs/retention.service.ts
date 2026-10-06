import { Inject, Injectable, Logger } from '@nestjs/common';
import { gzipSync } from 'node:zlib';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { loadConfig } from '../config/config';
import { EventsService } from '../modules/events/events.service';
import { OBJECT_STORAGE_PROVIDER, type ObjectStorageProvider } from '../modules/storage/objects/objects.provider';

const DAY = 86_400_000;
const PLATFORM_PROJECT = 'platform';
const AUDIT_BATCH = 5000;
export const WEBHOOK_DELIVERY_RETENTION_DAYS = 90;
export const CONNECT_RUN_PAYLOAD_RETENTION_DAYS = 90;
export const SESSION_RETENTION_DAYS_AFTER_EXPIRY = 30;

/**
 * Data retention (ISO 27001 A.5.33 / A.8.10, docs/security/key-management.md):
 *  - audit log rows older than AUDIT_RETENTION_DAYS (default 400) are exported as gzip JSONL to
 *    AUDIT_ARCHIVE_BUCKET, then deleted. Without a bucket they are kept, unless
 *    AUDIT_PURGE_WITHOUT_ARCHIVE=true. The table refuses deletes outside this job (trigger).
 *  - webhook deliveries after 90 days, Connect run steps and run payloads 90 days after the run
 *    finished (the run row with its usage stays for billing), console sessions 30 days after they
 *    expired or were revoked.
 */
@Injectable()
export class RetentionService {
  private readonly log = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    @Inject(OBJECT_STORAGE_PROVIDER) private readonly storage: ObjectStorageProvider,
  ) {}

  async runDaily(now = new Date()) {
    const audit = await this.purgeAudit(now);
    const other = await this.purgeOperational(now);
    return { audit, ...other };
  }

  async purgeAudit(now = new Date()) {
    const cfg = loadConfig();
    const cutoff = new Date(now.getTime() - cfg.AUDIT_RETENTION_DAYS * DAY);
    const due = await this.prisma.auditLog.count({ where: { at: { lt: cutoff } } });
    if (!due) return { due: 0, archived: 0, deleted: 0, archives: [] as string[] };
    const bucket = cfg.AUDIT_ARCHIVE_BUCKET;
    if (!bucket && !cfg.AUDIT_PURGE_WITHOUT_ARCHIVE) {
      this.log.warn(`${due} audit rows are past the ${cfg.AUDIT_RETENTION_DAYS} day retention but AUDIT_ARCHIVE_BUCKET is not set; keeping them`);
      return { due, archived: 0, deleted: 0, archives: [] as string[] };
    }
    if (bucket) {
      await this.storage.ensureUser(PLATFORM_PROJECT);
      await this.storage.createBucket(PLATFORM_PROJECT, bucket).catch((e) => this.log.debug(`audit archive bucket: ${(e as Error).message}`));
    }
    let archived = 0;
    let deleted = 0;
    const archives: string[] = [];
    for (;;) {
      const rows = await this.prisma.auditLog.findMany({ where: { at: { lt: cutoff } }, orderBy: { seq: 'asc' }, take: AUDIT_BATCH });
      if (!rows.length) break;
      const first = rows[0].seq;
      const last = rows[rows.length - 1].seq;
      if (bucket) {
        const jsonl = rows.map((r) => JSON.stringify({ ...r, seq: r.seq.toString() })).join('\n') + '\n';
        const d = rows[0].at;
        const key = `audit/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/audit-${first}-${last}.jsonl.gz`;
        // Throws when the upload fails, so nothing is deleted that was not archived.
        await this.storage.putObject(PLATFORM_PROJECT, bucket, key, gzipSync(jsonl), 'application/gzip');
        archives.push(key);
        archived += rows.length;
      }
      const n = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('prgd.audit_purge', 'on', true)`;
        return tx.auditLog.deleteMany({ where: { seq: { gte: first, lte: last }, at: { lt: cutoff } } });
      });
      deleted += n.count;
      if (rows.length < AUDIT_BATCH) break;
    }
    await this.events.emit('audit.purged', { before: cutoff.toISOString(), archived, deleted, archives: archives.slice(0, 50), bucket: bucket ?? null });
    return { due, archived, deleted, archives };
  }

  async purgeOperational(now = new Date()) {
    const webhookDeliveries = (await this.prisma.webhookDelivery.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - WEBHOOK_DELIVERY_RETENTION_DAYS * DAY) } } })).count;
    const runCutoff = new Date(now.getTime() - CONNECT_RUN_PAYLOAD_RETENTION_DAYS * DAY);
    const connectRunSteps = (await this.prisma.connectRunStep.deleteMany({ where: { run: { finishedAt: { lt: runCutoff } } } })).count;
    const connectRunPayloads = (await this.prisma.connectRun.updateMany({
      where: { finishedAt: { lt: runCutoff }, OR: [{ input: { not: Prisma.AnyNull } }, { output: { not: Prisma.AnyNull } }, { state: { not: Prisma.AnyNull } }] },
      data: { input: Prisma.DbNull, output: Prisma.DbNull, state: Prisma.DbNull },
    })).count;
    const sessionCutoff = new Date(now.getTime() - SESSION_RETENTION_DAYS_AFTER_EXPIRY * DAY);
    const sessions = (await this.prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: sessionCutoff } }, { revokedAt: { lt: sessionCutoff } }] } })).count;
    if (webhookDeliveries || connectRunSteps || connectRunPayloads || sessions) {
      this.log.log(`retention: ${webhookDeliveries} webhook deliveries, ${connectRunSteps} Connect run steps, ${connectRunPayloads} Connect run payloads, ${sessions} sessions`);
    }
    return { webhookDeliveries, connectRunSteps, connectRunPayloads, sessions };
  }
}
