import { Body, CanActivate, Controller, ExecutionContext, Get, HttpCode, Injectable, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Public } from '../../../common/auth/decorators';
import { ApiError } from '../../../common/errors/api-error';
import { loadConfig } from '../../../config/config';
import { EngineerGuard } from '../guards/ops.guards';
import { Ops, type OpsContext } from '../guards/ops-context';
import { PlatformService } from './platform.service';

class CompleteDto {
  @IsOptional() @IsString() @MaxLength(4000) note?: string;
  @IsOptional() @IsString() @MaxLength(20000) evidence?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1440) minutes?: number;
}

class BackupReportDto {
  @IsIn(['ok', 'failed']) result!: 'ok' | 'failed';
  @IsOptional() @IsBoolean() offsite?: boolean;
  @IsOptional() @IsInt() @Min(0) sizeBytes?: number;
  @IsOptional() @IsString() @MaxLength(200) file?: string;
}

/**
 * Platform maintenance from the ops console (docs/platform-maintenance.md): the task list of
 * Progrid's own platform. Any engineer may read it and close tasks; it concerns no customer
 * contract, so there is no assignment or residency check.
 */
@ApiTags('ops')
@ApiBearerAuth()
@UseGuards(EngineerGuard)
@Controller('ops/v1/platform')
export class OpsPlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get()
  overview() {
    return this.platform.overview();
  }

  @Post('runs/:id/check') @HttpCode(200)
  check(@Ops() ops: OpsContext, @Param('id') id: string) {
    return this.platform.runCheckNow(ops, id);
  }

  @Post('runs/:id/complete') @HttpCode(200)
  complete(@Ops() ops: OpsContext, @Param('id') id: string, @Body() dto: CompleteDto) {
    return this.platform.complete(ops, id, dto);
  }
}

/** X-Prgd-Platform-Secret, constant time. An empty PRGD_PLATFORM_HEARTBEAT_SECRET refuses every report. */
@Injectable()
export class PlatformSecretGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const want = loadConfig().PRGD_PLATFORM_HEARTBEAT_SECRET;
    const got = String(req.headers['x-prgd-platform-secret'] ?? '');
    if (!want || !got) throw ApiError.unauthorized('Platform secret required');
    const a = Buffer.from(want);
    const b = Buffer.from(got);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw ApiError.unauthorized('Wrong platform secret');
    return true;
  }
}

/** Reports from the platform's own jobs: the nightly database backup (infra/prod/backup.sh). */
@ApiTags('internal')
@Public()
@UseGuards(PlatformSecretGuard)
@Controller('internal/platform')
export class PlatformInternalController {
  constructor(private readonly platform: PlatformService) {}

  @Post('backup') @HttpCode(200)
  backup(@Body() dto: BackupReportDto) {
    return this.platform.backupReport(dto);
  }
}
