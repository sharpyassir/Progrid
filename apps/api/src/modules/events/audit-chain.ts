import { createHash, randomBytes } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';

/**
 * Tamper evidence for the audit log. Every row the API writes carries
 *   hash = sha256(prevHash + "\n" + canonical(row))
 * where prevHash is the hash of the row with the next lower seq. Writers take a process wide
 * mutex plus a Postgres advisory lock so the chain is linear across the API and the worker.
 * The table itself refuses UPDATE / DELETE / TRUNCATE (trigger in migration
 * 20261010200000_data_protection), except deletes by the retention job.
 */
export const AUDIT_CHAIN_LOCK = 72_380_001;

export interface AuditRowInput {
  teamId?: string | null;
  userId?: string | null;
  tokenId?: string | null;
  action: string;
  resource?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  request?: unknown;
  status: number;
}

interface HashedFields {
  id: string;
  at: Date;
  teamId: string | null;
  userId: string | null;
  tokenId: string | null;
  action: string;
  resource: string | null;
  ip: string | null;
  userAgent: string | null;
  request: unknown;
  status: number;
  prevHash: string | null;
}

/** JSON with sorted object keys, so a value read back from jsonb hashes the same. */
export function canonical(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

export function rowHash(r: HashedFields): string {
  const body = canonical({
    id: r.id, at: r.at.toISOString(), teamId: r.teamId, userId: r.userId, tokenId: r.tokenId, action: r.action,
    resource: r.resource, ip: r.ip, userAgent: r.userAgent, request: r.request ?? null, status: r.status,
  });
  return createHash('sha256').update(`${r.prevHash ?? ''}\n${body}`).digest('hex');
}

/** Normalises a payload the way jsonb will give it back (Dates to strings, undefined dropped). */
function jsonValue(v: unknown): unknown {
  return v === undefined ? null : JSON.parse(JSON.stringify(v));
}

let queue: Promise<unknown> = Promise.resolve();

/** Appends one row to the chain. Serialised in process (one connection waits) and across processes (advisory lock). */
export function appendAudit(prisma: PrismaClient, input: AuditRowInput) {
  const run = queue.then(() => insert(prisma, input));
  queue = run.catch(() => undefined);
  return run;
}

async function insert(prisma: PrismaClient, input: AuditRowInput) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK}::bigint)`;
      const last = await tx.$queryRaw<{ hash: string | null }[]>`SELECT "hash" FROM "prgd_audit_logs" ORDER BY "seq" DESC LIMIT 1`;
      const request = jsonValue(input.request);
      const row: HashedFields = {
        id: `al${randomBytes(12).toString('hex')}`,
        at: new Date(),
        teamId: input.teamId ?? null,
        userId: input.userId ?? null,
        tokenId: input.tokenId ?? null,
        action: input.action,
        resource: input.resource ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
        request,
        status: input.status,
        prevHash: last[0]?.hash ?? null,
      };
      return tx.auditLog.create({
        data: { ...row, request: request === null ? Prisma.JsonNull : (request as Prisma.InputJsonValue), hash: rowHash(row) },
      });
    },
    { maxWait: 15_000, timeout: 15_000 },
  );
}

export interface ChainReport {
  ok: boolean;
  checked: number;
  /** Rows from before the chain existed (no hash). */
  unhashed: number;
  firstSeq?: string;
  lastSeq?: string;
  /** The first row whose hash or link does not match, if any. */
  broken?: { seq: string; id: string; reason: 'hash_mismatch' | 'link_mismatch' };
}

/**
 * Walks the chain in seq order. The first hashed row is the anchor: its prevHash points at a row
 * that may have been purged by the retention job (the archive keeps it).
 */
export async function verifyAuditChain(prisma: PrismaClient, pageSize = 2000): Promise<ChainReport> {
  const unhashed = await prisma.auditLog.count({ where: { hash: null } });
  let checked = 0;
  let prev: string | null | undefined;
  let cursor: bigint | undefined;
  let firstSeq: string | undefined;
  let lastSeq: string | undefined;
  for (;;) {
    const page = await prisma.auditLog.findMany({ where: { hash: { not: null }, ...(cursor !== undefined ? { seq: { gt: cursor } } : {}) }, orderBy: { seq: 'asc' }, take: pageSize });
    if (!page.length) break;
    for (const r of page) {
      firstSeq ??= r.seq.toString();
      if (prev !== undefined && r.prevHash !== prev) return { ok: false, checked, unhashed, firstSeq, lastSeq, broken: { seq: r.seq.toString(), id: r.id, reason: 'link_mismatch' } };
      if (rowHash({ ...r, request: r.request }) !== r.hash) return { ok: false, checked, unhashed, firstSeq, lastSeq, broken: { seq: r.seq.toString(), id: r.id, reason: 'hash_mismatch' } };
      prev = r.hash;
      checked++;
      lastSeq = r.seq.toString();
    }
    cursor = page[page.length - 1].seq;
  }
  return { ok: true, checked, unhashed, firstSeq, lastSeq };
}
