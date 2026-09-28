import { Body, CanActivate, Controller, Delete, ExecutionContext, Get, HttpCode, Injectable, Param, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Readable } from 'node:stream';
import { timingSafeEqual } from 'node:crypto';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Min } from 'class-validator';
import type { TerminalSessionStatus } from '@prisma/client';
import { CurrentActor, Public, RequireScopes, StaffAreas } from '../../../common/auth/decorators';
import type { Actor } from '../../../common/auth/actor';
import { ApiError } from '../../../common/errors/api-error';
import { loadConfig } from '../../../config/config';
import { AssignmentGuard, EngineerGuard, ResidencyGuard } from '../guards/ops.guards';
import { Ops, Residency, type OpsContext } from '../guards/ops-context';
import { OpsAudit } from '../ops-audit.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { assetSecretRef } from '../secrets/secret-store';
import { SessionsService } from './sessions.service';

class OpenSessionDto {
  /** An ACTIVE grant of yours. */
  @IsString() grantId: string;
}

class SessionCheckDto {
  /** The one time token (prgd_gws_...) the browser sent the gateway. */
  @IsString() @Length(10, 200) token: string;
  @IsOptional() @IsString() sessionId?: string;
  /** The gateway's per session public key, "ssh-ed25519 AAAA...". */
  @IsString() @Length(20, 1000) publicKey: string;
  @IsOptional() @IsString() @Length(1, 100) gatewayId?: string;
  /** The browser's address as the gateway saw it. */
  @IsOptional() @IsString() @Length(1, 64) clientIp?: string;
}

const EVENT_TYPES = ['started', 'heartbeat', 'ended', 'recording_stored', 'error'] as const;

class SessionEventDto {
  @IsString() sessionId: string;
  @IsIn(EVENT_TYPES) type: (typeof EVENT_TYPES)[number];
  @IsOptional() @Type(() => Date) @IsDate() at?: Date;
  @IsOptional() @IsString() gatewayId?: string;
  /** Totals since the session started (not deltas). */
  @IsOptional() @IsInt() @Min(0) bytesIn?: number;
  @IsOptional() @IsInt() @Min(0) bytesOut?: number;
  /** For ended: client_closed | grant_expired | killed | ssh_closed | error. */
  @IsOptional() @IsString() @Length(0, 200) reason?: string;
  @IsOptional() @IsString() recordingKey?: string;
  @IsOptional() @IsInt() @Min(0) recordingSize?: number;
  @IsOptional() @IsString() @Length(0, 2000) error?: string;
  /** On started: the asset's SSH host key as an OpenSSH line ("ssh-ed25519 AAAA..."). */
  @IsOptional() @IsString() @Length(0, 2000) hostKey?: string;
  /** SHA256 fingerprint of hostKey, as ssh-keygen prints it. */
  @IsOptional() @IsString() @Length(0, 100) hostKeyFingerprint?: string;
}

class SecretRequestDto {
  @IsString() sessionId: string;
  /** A ref from session-check, e.g. assets/<assetId>. */
  @IsString() ref: string;
}

class RecordingUrlDto {
  @IsString() sessionId: string;
}

class AdminSessionQuery {
  /** live (ACTIVE), or a status. */
  @IsOptional() @IsIn(['live', 'PENDING', 'ACTIVE', 'ENDED', 'KILLED', 'FAILED', 'EXPIRED']) status?: string;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() assetId?: string;
  @IsOptional() @IsString() grantId?: string;
}

class KillDto {
  @IsString() @Length(3, 500) reason: string;
}

class SecretsDto {
  /** Every value under the asset's ref (replaces what is stored). */
  @IsObject() values: Record<string, string>;
}

/** Engineer side: open a terminal session on an ACTIVE grant (/ops/v1/sessions). */
@ApiTags('ops')
@ApiBearerAuth()
@UseGuards(EngineerGuard, AssignmentGuard, ResidencyGuard)
@Controller('ops/v1/sessions')
export class OpsSessionsController {
  constructor(private readonly sessions: SessionsService) {}

  /** Returns a one time gateway token (valid PRGD_GATEWAY_TOKEN_TTL_SECONDS) and the gateway URL. */
  @Residency()
  @Post() @HttpCode(201)
  open(@Ops() ops: OpsContext, @Body() dto: OpenSessionDto) {
    return this.sessions.open(ops, dto.grantId);
  }

  @Get()
  list(@Ops() ops: OpsContext) {
    return this.sessions.listMine(ops);
  }
}

/** Shared secret check for prgd-gateway: X-Prgd-Gateway-Secret, constant time. An empty PRGD_GATEWAY_SECRET refuses every call. */
@Injectable()
export class GatewaySecretGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const want = loadConfig().PRGD_GATEWAY_SECRET;
    const got = String(req.headers['x-prgd-gateway-secret'] ?? '');
    if (!want || !got) throw ApiError.unauthorized('Gateway secret required');
    const a = Buffer.from(want);
    const b = Buffer.from(got);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw ApiError.unauthorized('Wrong gateway secret');
    return true;
  }
}

/**
 * The terminal gateway's API (/internal/gateway), authenticated by PRGD_GATEWAY_SECRET. The
 * exact request and response bodies are in docs/devops-console.md, "Gateway contract".
 */
@ApiTags('internal')
@Public()
@UseGuards(GatewaySecretGuard)
@Controller('internal/gateway')
export class GatewayInternalController {
  constructor(private readonly sessions: SessionsService) {}

  @Post('session-check') @HttpCode(200)
  check(@Body() dto: SessionCheckDto) {
    return this.sessions.check(dto);
  }

  @Post('session-events') @HttpCode(200)
  event(@Body() dto: SessionEventDto) {
    return this.sessions.event(dto);
  }

  @Post('secrets') @HttpCode(200)
  secrets(@Body() dto: SecretRequestDto) {
    return this.sessions.resolveSecret(dto);
  }

  @Post('recording-url') @HttpCode(200)
  recordingUrl(@Body() dto: RecordingUrlDto) {
    return this.sessions.recordingUrl(dto.sessionId);
  }
}

/** Support leads watch sessions, play recordings and kill live sessions; they also keep the gateway's asset secrets. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/ops')
export class AdminOpsSessionsController {
  constructor(private readonly sessions: SessionsService, private readonly prisma: PrismaService, private readonly audit: OpsAudit) {}

  @StaffAreas('support_lead')
  @Get('sessions') @RequireScopes('admin')
  list(@Query() q: AdminSessionQuery) {
    return this.sessions.adminList({ ...q, status: q.status as TerminalSessionStatus | 'live' | undefined });
  }

  @StaffAreas('support_lead')
  @Get('sessions/:id') @RequireScopes('admin')
  get(@Param('id') id: string) {
    return this.sessions.adminGet(id);
  }

  /** A five minute URL to the asciicast v2 file. */
  @StaffAreas('support_lead')
  @Get('sessions/:id/playback') @RequireScopes('admin')
  playback(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.sessions.playback(actor, id);
  }

  /** Streams the asciicast v2 file through the API (for players that cannot reach object storage). */
  @StaffAreas('support_lead')
  @Get('sessions/:id/recording') @RequireScopes('admin')
  async recording(@CurrentActor() actor: Actor, @Param('id') id: string, @Res() res: Response) {
    const { url } = await this.sessions.playback(actor, id);
    const r = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok || !r.body) throw new ApiError(502, 'storage_unavailable', `Object storage answered ${r.status}`);
    res.setHeader('content-type', 'application/x-asciicast');
    res.setHeader('content-disposition', `inline; filename="${id}.cast"`);
    Readable.fromWeb(r.body as never).pipe(res);
  }

  @StaffAreas('support_lead')
  @Post('sessions/:id/kill') @RequireScopes('admin') @HttpCode(200)
  kill(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: KillDto) {
    return this.sessions.kill(actor, id, dto.reason);
  }

  /** Keys stored for an asset; values are never returned by any API except to the gateway. */
  @StaffAreas('support_lead')
  @Get('assets/:id/secrets') @RequireScopes('admin')
  async listSecrets(@Param('id') id: string) {
    await this.asset(id);
    const values = await this.sessions.secrets.get(assetSecretRef(id));
    return { ref: assetSecretRef(id), store: this.sessions.secrets.name, keys: Object.keys(values) };
  }

  @StaffAreas('support_lead')
  @Put('assets/:id/secrets') @RequireScopes('admin')
  async putSecrets(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: SecretsDto) {
    const a = await this.asset(id);
    const values = Object.fromEntries(Object.entries(dto.values).filter(([k, v]) => /^[A-Za-z0-9_.-]{1,64}$/.test(k) && typeof v === 'string'));
    if (Object.keys(values).length !== Object.keys(dto.values).length) throw ApiError.invalid('Secret names are letters, digits, dot, dash and underscore; values are strings');
    await this.sessions.secrets.put(assetSecretRef(id), values);
    await this.audit.emit('ops.asset_secrets_updated', actor, { contractId: a.contractId, assetId: id, keys: Object.keys(values), store: this.sessions.secrets.name }, `managed_asset:${id}`);
    return { ref: assetSecretRef(id), store: this.sessions.secrets.name, keys: Object.keys(values) };
  }

  @StaffAreas('support_lead')
  @Delete('assets/:id/secrets') @RequireScopes('admin')
  async deleteSecrets(@CurrentActor() actor: Actor, @Param('id') id: string) {
    const a = await this.asset(id);
    await this.sessions.secrets.delete(assetSecretRef(id));
    await this.audit.emit('ops.asset_secrets_deleted', actor, { contractId: a.contractId, assetId: id }, `managed_asset:${id}`);
    return { deleted: true };
  }

  private async asset(id: string) {
    const a = await this.prisma.managedAsset.findUnique({ where: { id }, select: { id: true, contractId: true } });
    if (!a) throw ApiError.notFound('asset', id);
    return a;
  }
}
