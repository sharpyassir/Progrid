import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { AccessGrant, Prisma, TerminalSession, TerminalSessionStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { NatsService } from '../../../common/nats/nats.service';
import { ApiError } from '../../../common/errors/api-error';
import type { Actor } from '../../../common/auth/actor';
import { loadConfig } from '../../../config/config';
import { OBJECT_STORAGE_PROVIDER, type ObjectStorageProvider } from '../../storage/objects/objects.provider';
import { OpsAudit } from '../ops-audit.service';
import { OpsSettingsService } from '../settings/ops-settings.service';
import { checkEligibility } from '../guards/residency';
import type { OpsContext } from '../guards/ops-context';
import { person } from '../serializers/ops-dto';
import { GrantsService } from '../access/grants.service';
import { TimersService } from '../timers/timers.service';
import { assetSecretRef, createSecretStore, type SecretStore } from '../secrets/secret-store';

/** Owner of platform buckets (not a customer project): recordings are neither listed nor billed. */
const PLATFORM_PROJECT = 'platform';
export const GATEWAY_TOKEN_PREFIX = 'prgd_gws_';
/** NATS subject the gateway subscribes to; each message ends one live session. */
export const GATEWAY_KILL_SUBJECT = 'prgd.gateway.sessions.kill';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

const LIVE: TerminalSessionStatus[] = ['PENDING', 'ACTIVE'];

type SessionRow = TerminalSession & { user?: { id: string; name: string }; grant?: { asset: { id: string; name: string }; ticket: { id: string; number: number } | null } };

export function presentSession(t: SessionRow) {
  const end = t.endedAt ?? (t.status === 'ACTIVE' ? new Date() : null);
  return {
    id: t.id, grantId: t.grantId, engineer: t.user ? person(t.user) : undefined, contractId: t.contractId, assetId: t.assetId, asset: t.grant?.asset, ticketId: t.ticketId, ticket: t.grant?.ticket ?? null,
    maintenanceRunId: t.maintenanceRunId, status: t.status, gatewayId: t.gatewayId, clientIp: t.clientIp, startedAt: t.startedAt, endedAt: t.endedAt,
    durationSeconds: t.startedAt && end ? Math.round((end.getTime() - t.startedAt.getTime()) / 1000) : null,
    bytesIn: Number(t.bytesIn), bytesOut: Number(t.bytesOut), recorded: !!t.recordingKey && !t.recordingExpiredAt, recordingSize: t.recordingSize === null ? null : Number(t.recordingSize),
    recordingStoredAt: t.recordingStoredAt, recordingExpiredAt: t.recordingExpiredAt, killedById: t.killedById, killReason: t.killReason, endReason: t.endReason, createdAt: t.createdAt,
  };
}

export interface SessionCheck {
  token: string;
  sessionId?: string;
  /** The gateway's per session ed25519 public key (OpenSSH line). Its private half never leaves the gateway. */
  publicKey: string;
  gatewayId?: string;
  clientIp?: string;
}

export interface SessionEvent {
  sessionId: string;
  type: 'started' | 'heartbeat' | 'ended' | 'recording_stored' | 'error';
  at?: Date;
  gatewayId?: string;
  bytesIn?: number;
  bytesOut?: number;
  reason?: string;
  recordingKey?: string;
  recordingSize?: number;
  error?: string;
}

/**
 * Browser terminal sessions (spec 3.6). The ops console asks for a session on an ACTIVE grant
 * and gets a one time gateway token; prgd-gateway checks it (POST /internal/gateway/session-check)
 * with its ephemeral public key and gets a certificate, the target and the secret references;
 * it reports events and the stored recording (POST /internal/gateway/session-events). Revoking
 * or expiring the grant, or a staff kill, ends live sessions: a NATS message on
 * prgd.gateway.sessions.kill, and `action: "kill"` on the gateway's next event or heartbeat.
 */
@Injectable()
export class SessionsService implements OnModuleInit {
  private readonly log = new Logger(SessionsService.name);
  readonly secrets: SecretStore;

  constructor(
    private readonly prisma: PrismaService,
    private readonly nats: NatsService,
    private readonly grants: GrantsService,
    private readonly timers: TimersService,
    private readonly audit: OpsAudit,
    private readonly settings: OpsSettingsService,
    @Inject(OBJECT_STORAGE_PROVIDER) private readonly storage: ObjectStorageProvider,
  ) {
    this.secrets = createSecretStore(prisma);
  }

  onModuleInit() {
    this.grants.onRevoked(async (grant, reason) => {
      await this.killForGrant(grant, reason);
    });
  }

  // ---- engineer ----

  /** Opens a session on the engineer's ACTIVE grant: a one time gateway token and where to connect. */
  async open(ops: OpsContext, grantId: string) {
    const grant = await this.prisma.accessGrant.findFirst({ where: { id: grantId, userId: ops.userId }, include: { asset: { select: { id: true, name: true } }, ticket: { select: { id: true, number: true } } } });
    if (!grant) throw ApiError.notFound('access grant', grantId);
    if (grant.status !== 'ACTIVE' || !grant.expiresAt || grant.expiresAt <= new Date()) throw ApiError.invalidState('The grant is not active');
    const eligible = await checkEligibility(this.prisma, ops.userId, grant.contractId);
    if (!eligible.ok) throw new ApiError(403, eligible.reason === 'residency' ? 'residency_blocked' : 'forbidden', eligible.message);
    const c = loadConfig();
    const token = GATEWAY_TOKEN_PREFIX + randomBytes(32).toString('base64url');
    const tokenExpiresAt = new Date(Date.now() + c.PRGD_GATEWAY_TOKEN_TTL_SECONDS * 1000);
    const session = await this.prisma.terminalSession.create({
      data: { grantId, userId: ops.userId, contractId: grant.contractId, assetId: grant.assetId, ticketId: grant.ticketId, maintenanceRunId: grant.maintenanceRunId, tokenHash: hash(token), tokenExpiresAt, clientIp: ops.ip },
    });
    await this.audit.emit('ops.session_opened', ops, { contractId: grant.contractId, assetId: grant.assetId, ticketId: grant.ticketId, grantId, sessionId: session.id }, `terminal_session:${session.id}`);
    await this.timers.activity(ops.userId);
    return {
      sessionId: session.id,
      token,
      tokenExpiresAt,
      gatewayUrl: `${c.PRGD_GATEWAY_PUBLIC_URL.replace(/\/$/, '')}/v1/terminal?session=${session.id}`,
      asset: grant.asset,
      ticket: grant.ticket,
      grant: { id: grant.id, expiresAt: grant.expiresAt },
      recorded: true,
      policy: { clipboardPaste: true, fileDownload: false },
    };
  }

  async listMine(ops: OpsContext) {
    const rows = await this.prisma.terminalSession.findMany({ where: { userId: ops.userId }, include: { grant: { select: { asset: { select: { id: true, name: true } }, ticket: { select: { id: true, number: true } } } } }, orderBy: { createdAt: 'desc' }, take: 100 });
    return { data: rows.map(presentSession) };
  }

  // ---- gateway ----

  /**
   * The gateway's check before it connects. The token must be unused and unexpired, the grant
   * ACTIVE and unexpired, the engineer still eligible. Answers the certificate for the
   * gateway's ephemeral key, the target, the secret references and where to upload the recording.
   */
  async check(dto: SessionCheck) {
    const s = await this.prisma.terminalSession.findUnique({ where: { tokenHash: hash(dto.token ?? '') }, include: { grant: true, user: { select: { id: true, name: true } } } });
    if (!s || (dto.sessionId && dto.sessionId !== s.id)) throw new ApiError(401, 'token_invalid', 'Unknown gateway token');
    const refuse = async (code: string, message: string, status: TerminalSessionStatus = 'FAILED') => {
      await this.prisma.terminalSession.updateMany({ where: { id: s.id, status: 'PENDING' }, data: { status, endedAt: new Date(), endReason: code } });
      await this.audit.emit('ops.session_refused', null, { contractId: s.contractId, assetId: s.assetId, ticketId: s.ticketId, sessionId: s.id, grantId: s.grantId, code, gatewayId: dto.gatewayId ?? null }, `terminal_session:${s.id}`);
      return new ApiError(409, code, message);
    };
    if (s.tokenUsedAt) throw await refuse('token_used', 'The gateway token was already used', s.status);
    if (s.status !== 'PENDING') {
      // Killed before it connected: by its grant ending, or by staff.
      throw s.grant.status !== 'ACTIVE' ? new ApiError(409, 'grant_inactive', `The access grant is ${s.grant.status.toLowerCase()}`) : new ApiError(409, 'session_killed', 'The session was ended before it connected');
    }
    if (s.tokenExpiresAt <= new Date()) throw await refuse('token_expired', 'The gateway token expired; open the terminal again', 'EXPIRED');
    const g = s.grant;
    if (g.status !== 'ACTIVE') throw await refuse('grant_inactive', `The access grant is ${g.status.toLowerCase()}`);
    if (!g.expiresAt || g.expiresAt <= new Date()) throw await refuse('grant_expired', 'The access grant expired');
    const eligible = await checkEligibility(this.prisma, s.userId, s.contractId);
    if (!eligible.ok) throw await refuse(eligible.reason === 'residency' ? 'residency_blocked' : eligible.reason === 'inactive' ? 'engineer_inactive' : 'forbidden', eligible.message);
    const asset = await this.prisma.managedAsset.findUnique({ where: { id: s.assetId } });
    if (!asset?.managementAddress || asset.removedAt) throw await refuse('asset_unavailable', 'The asset has no management address');

    // Claim the token first so a replay racing this call cannot also pass.
    const claimed = await this.prisma.terminalSession.updateMany({ where: { id: s.id, tokenUsedAt: null, status: 'PENDING' }, data: { tokenUsedAt: new Date(), status: 'ACTIVE', startedAt: new Date(), lastEventAt: new Date(), gatewayId: dto.gatewayId ?? null, clientIp: dto.clientIp ?? s.clientIp } });
    if (!claimed.count) throw new ApiError(409, 'token_used', 'The gateway token was already used');
    let cert;
    try {
      cert = await this.grants.issueCertificate(g, dto.publicKey, s.id);
    } catch (e) {
      await this.prisma.terminalSession.update({ where: { id: s.id }, data: { status: 'FAILED', endedAt: new Date(), endReason: 'certificate' } });
      throw e instanceof ApiError ? e : ApiError.invalid(`Could not issue a certificate: ${(e as Error).message}`);
    }
    await this.prisma.terminalSession.update({ where: { id: s.id }, data: { certSerial: cert.serial } });
    const c = loadConfig();
    const recording = await this.recordingTarget(s.id, g.expiresAt);
    const secretKeys = Object.keys(await this.secrets.get(assetSecretRef(asset.id)).catch(() => ({})));
    const ticket = s.ticketId ? await this.prisma.ticket.findUnique({ where: { id: s.ticketId }, select: { id: true, number: true } }) : null;
    await this.audit.emit('ops.session_started', null, { contractId: s.contractId, assetId: s.assetId, ticketId: s.ticketId, sessionId: s.id, grantId: g.id, gatewayId: dto.gatewayId ?? null, certSerial: cert.serial }, `terminal_session:${s.id}`);
    await this.timers.activity(s.userId);
    return {
      sessionId: s.id,
      grantId: g.id,
      expiresAt: g.expiresAt,
      engineer: person(s.user),
      asset: { id: asset.id, name: asset.name, contractId: asset.contractId },
      ticket,
      maintenanceRunId: s.maintenanceRunId,
      target: { host: asset.managementAddress, port: c.PRGD_SSH_PORT, username: c.PRGD_SSH_LOGIN_USER },
      certificate: cert.certificate,
      certSerial: cert.serial,
      principals: cert.principals,
      validBefore: cert.validBefore,
      secrets: secretKeys.length ? [{ ref: assetSecretRef(asset.id), keys: secretKeys }] : [],
      recording,
      policy: { clipboardPaste: true, fileDownload: false },
      banner: `This session is recorded. ${asset.name}${ticket ? `, ticket #${ticket.number}` : ''}, access until ${g.expiresAt.toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
      kill: { natsSubject: GATEWAY_KILL_SUBJECT, heartbeatSeconds: 30 },
    };
  }

  /** Session events from the gateway. The answer tells the gateway to continue or to kill the session. */
  async event(dto: SessionEvent) {
    const s = await this.prisma.terminalSession.findUnique({ where: { id: dto.sessionId }, include: { grant: true } });
    if (!s) throw ApiError.notFound('terminal session', dto.sessionId);
    const at = dto.at ?? new Date();
    const counters = { ...(dto.bytesIn !== undefined ? { bytesIn: BigInt(Math.max(0, Math.floor(dto.bytesIn))) } : {}), ...(dto.bytesOut !== undefined ? { bytesOut: BigInt(Math.max(0, Math.floor(dto.bytesOut))) } : {}) };
    const data: Prisma.TerminalSessionUpdateInput = { lastEventAt: at, ...counters, ...(dto.gatewayId ? { gatewayId: dto.gatewayId } : {}) };
    if (dto.type === 'started' && !s.startedAt) data.startedAt = at;
    if (dto.type === 'ended' || dto.type === 'error') {
      if (LIVE.includes(s.status)) data.status = dto.type === 'error' ? 'FAILED' : 'ENDED';
      data.endedAt = s.endedAt ?? at;
      data.endReason = (dto.reason ?? dto.error ?? dto.type).slice(0, 200);
    }
    if (dto.type === 'recording_stored') {
      if (!dto.recordingKey || dto.recordingKey !== s.recordingKey) throw ApiError.invalid('recordingKey must be the key session-check returned');
      data.recordingSize = BigInt(Math.max(0, Math.floor(dto.recordingSize ?? 0)));
      data.recordingStoredAt = at;
    }
    await this.prisma.terminalSession.update({ where: { id: s.id }, data });
    if (dto.type !== 'heartbeat') {
      await this.audit.emit(`ops.session_${dto.type}`, null, { contractId: s.contractId, assetId: s.assetId, ticketId: s.ticketId, sessionId: s.id, grantId: s.grantId, reason: dto.reason ?? dto.error ?? null, recordingSize: dto.recordingSize ?? null }, `terminal_session:${s.id}`);
    }
    await this.timers.activity(s.userId);
    const g = s.grant;
    const kill = s.status === 'KILLED' ? s.killReason ?? 'killed' : g.status !== 'ACTIVE' ? `grant ${g.status.toLowerCase()}` : g.expiresAt && g.expiresAt <= new Date() ? 'grant expired' : null;
    return kill && dto.type !== 'ended' && dto.type !== 'recording_stored' ? { ok: true, action: 'kill' as const, reason: kill, expiresAt: g.expiresAt } : { ok: true, action: 'continue' as const, expiresAt: g.expiresAt };
  }

  /** Secret values for a live session on the matching asset, for the gateway only. */
  async resolveSecret(dto: { sessionId: string; ref: string }) {
    const s = await this.prisma.terminalSession.findUnique({ where: { id: dto.sessionId }, include: { grant: true } });
    if (!s) throw ApiError.notFound('terminal session', dto.sessionId);
    if (s.status !== 'ACTIVE' || s.grant.status !== 'ACTIVE' || !s.grant.expiresAt || s.grant.expiresAt <= new Date()) throw new ApiError(409, 'session_inactive', 'The session is not live');
    if (dto.ref !== assetSecretRef(s.assetId)) throw ApiError.forbidden('The session may only read its own asset\'s secrets');
    const values = await this.secrets.get(dto.ref);
    await this.audit.emit('ops.secret_resolved', null, { contractId: s.contractId, assetId: s.assetId, ticketId: s.ticketId, sessionId: s.id, ref: dto.ref, keys: Object.keys(values), store: this.secrets.name }, `terminal_session:${s.id}`);
    return { ref: dto.ref, values };
  }

  /** A fresh upload URL for the session's recording (the first one expires one hour after the grant). */
  async recordingUrl(sessionId: string) {
    const s = await this.prisma.terminalSession.findUnique({ where: { id: sessionId }, include: { grant: true } });
    if (!s || !s.recordingKey) throw ApiError.notFound('terminal session', sessionId);
    if (s.recordingStoredAt) throw ApiError.invalidState('The recording is already stored');
    return this.recordingTarget(s.id, new Date(Date.now() + 3600_000));
  }

  // ---- staff ----

  async adminList(q: { status?: TerminalSessionStatus | 'live'; userId?: string; assetId?: string; grantId?: string }) {
    const rows = await this.prisma.terminalSession.findMany({
      where: { ...(q.status === 'live' ? { status: 'ACTIVE' } : q.status ? { status: q.status } : {}), ...(q.userId ? { userId: q.userId } : {}), ...(q.assetId ? { assetId: q.assetId } : {}), ...(q.grantId ? { grantId: q.grantId } : {}) },
      include: { user: { select: { id: true, name: true } }, grant: { select: { asset: { select: { id: true, name: true } }, ticket: { select: { id: true, number: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return { data: rows.map(presentSession) };
  }

  async adminGet(id: string) {
    const s = await this.prisma.terminalSession.findUnique({ where: { id }, include: { user: { select: { id: true, name: true } }, grant: { select: { asset: { select: { id: true, name: true } }, ticket: { select: { id: true, number: true } } } } } });
    if (!s) throw ApiError.notFound('terminal session', id);
    return presentSession(s);
  }

  /** A five minute URL to the asciicast v2 recording (asciinema-player plays it). */
  async playback(actor: Actor, id: string) {
    const s = await this.prisma.terminalSession.findUnique({ where: { id } });
    if (!s) throw ApiError.notFound('terminal session', id);
    if (!s.recordingKey || !s.recordingStoredAt) throw ApiError.invalidState('No recording is stored for this session');
    if (s.recordingExpiredAt) throw ApiError.invalidState('The recording was deleted after the retention period');
    const expiresAt = new Date(Date.now() + 300_000);
    const url = await this.storage.presign(PLATFORM_PROJECT, loadConfig().PRGD_RECORDINGS_BUCKET, s.recordingKey, 'GET', 300);
    await this.audit.emit('ops.session_playback', actor, { contractId: s.contractId, assetId: s.assetId, ticketId: s.ticketId, sessionId: id }, `terminal_session:${id}`);
    return { url, expiresAt, format: 'asciicast-v2', contentType: 'application/x-asciicast' };
  }

  /** Staff kill: marks the session KILLED and tells the gateway to end it now. */
  async kill(actor: Actor, id: string, reason: string) {
    const s = await this.prisma.terminalSession.findUnique({ where: { id } });
    if (!s) throw ApiError.notFound('terminal session', id);
    if (!LIVE.includes(s.status)) throw ApiError.invalidState(`The session is ${s.status.toLowerCase()}`);
    await this.markKilled(s, reason, actor.userId);
    await this.audit.emit('ops.session_killed', actor, { contractId: s.contractId, assetId: s.assetId, ticketId: s.ticketId, sessionId: id, reason }, `terminal_session:${id}`);
    return this.adminGet(id);
  }

  /** Every live session of a revoked or expired grant ends. */
  async killForGrant(grant: AccessGrant, reason: string) {
    const live = await this.prisma.terminalSession.findMany({ where: { grantId: grant.id, status: { in: LIVE } } });
    for (const s of live) {
      await this.markKilled(s, `grant ${grant.status.toLowerCase()}: ${reason}`, null);
      await this.audit.emit('ops.session_killed', null, { contractId: s.contractId, assetId: s.assetId, ticketId: s.ticketId, sessionId: s.id, reason: `grant ${grant.status.toLowerCase()}: ${reason}` }, `terminal_session:${s.id}`);
    }
    return live.length;
  }

  /** Every live session of an engineer (suspension, offboarding). */
  async killForUser(userId: string, reason: string) {
    const live = await this.prisma.terminalSession.findMany({ where: { userId, status: { in: LIVE } } });
    for (const s of live) {
      await this.markKilled(s, reason, null);
      await this.audit.emit('ops.session_killed', null, { contractId: s.contractId, assetId: s.assetId, ticketId: s.ticketId, sessionId: s.id, reason }, `terminal_session:${s.id}`);
    }
    return live.length;
  }

  // ---- jobs ----

  /** Daily: deletes recordings older than the retention period (12 months) and marks them expired. */
  async expireRecordings(now = new Date()) {
    const months = (await this.settings.get()).recordingRetentionMonths;
    const cutoff = new Date(now);
    cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
    const old = await this.prisma.terminalSession.findMany({ where: { recordingKey: { not: null }, recordingExpiredAt: null, createdAt: { lt: cutoff } }, take: 1000 });
    const bucket = loadConfig().PRGD_RECORDINGS_BUCKET;
    let deleted = 0;
    for (const s of old) {
      try {
        await this.storage.deleteObject(PLATFORM_PROJECT, bucket, s.recordingKey!);
        await this.prisma.terminalSession.update({ where: { id: s.id }, data: { recordingExpiredAt: now } });
        deleted++;
      } catch (e) {
        this.log.warn(`deleting recording ${s.recordingKey}: ${(e as Error).message}`);
      }
    }
    if (deleted) await this.audit.emit('ops.recordings_expired', null, { count: deleted, before: cutoff.toISOString() }, 'terminal_sessions');
    // Tokens nobody used.
    await this.prisma.terminalSession.updateMany({ where: { status: 'PENDING', tokenExpiresAt: { lt: now } }, data: { status: 'EXPIRED', endReason: 'token_expired' } });
    return deleted;
  }

  // ---- helpers ----

  private async markKilled(s: TerminalSession, reason: string, byUserId: string | null) {
    await this.prisma.terminalSession.update({ where: { id: s.id }, data: { status: 'KILLED', killedById: byUserId, killReason: reason.slice(0, 500), endedAt: s.endedAt ?? new Date(), endReason: 'killed' } });
    this.nats.publish(GATEWAY_KILL_SUBJECT, { sessionId: s.id, grantId: s.grantId, gatewayId: s.gatewayId, reason, at: new Date().toISOString() });
  }

  /** Recording object key and a presigned PUT URL valid until `until` (plus an hour). */
  private async recordingTarget(sessionId: string, until: Date) {
    const bucket = loadConfig().PRGD_RECORDINGS_BUCKET;
    await this.storage.ensureUser(PLATFORM_PROJECT);
    await this.storage.createBucket(PLATFORM_PROJECT, bucket).catch((e) => this.log.debug(`recordings bucket: ${(e as Error).message}`));
    const now = new Date();
    const key = `sessions/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${sessionId}.cast`;
    await this.prisma.terminalSession.update({ where: { id: sessionId }, data: { recordingKey: key } });
    const seconds = Math.min(7 * 86_400, Math.max(600, Math.ceil((until.getTime() - Date.now()) / 1000) + 3600));
    const uploadUrl = await this.storage.presign(PLATFORM_PROJECT, bucket, key, 'PUT', seconds, 'application/x-asciicast');
    return { format: 'asciicast-v2', key, uploadUrl, uploadMethod: 'PUT', contentType: 'application/x-asciicast', uploadUrlExpiresAt: new Date(Date.now() + seconds * 1000) };
  }
}
