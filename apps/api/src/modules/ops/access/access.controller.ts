import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import type { AccessGrantStatus } from '@prisma/client';
import { CurrentActor, RequireScopes, StaffAreas } from '../../../common/auth/decorators';
import type { Actor } from '../../../common/auth/actor';
import { AssignmentGuard, EngineerGuard, ResidencyGuard } from '../guards/ops.guards';
import { Ops, OpsRefs, Residency, type OpsContext } from '../guards/ops-context';
import { GrantsService } from './grants.service';

const STATUSES = ['live', 'REQUESTED', 'APPROVED', 'ACTIVE', 'DENIED', 'EXPIRED', 'REVOKED'] as const;

class RequestGrantDto {
  @IsString() assetId: string;
  /** The ticket, or the maintenance run, the access is for (exactly one). */
  @IsOptional() @IsString() ticketId?: string;
  @IsOptional() @IsString() maintenanceRunId?: string;
  @IsString() @Length(5, 1000) reason: string;
  /** Minutes wanted (at most the maxGrantMinutes setting, four hours). Auto approved grants last autoGrantMinutes. */
  @IsInt() @Min(1) @Max(1440) durationMin: number;
}

class ExtendDto {
  @IsString() @Length(5, 1000) reason: string;
  @IsOptional() @IsInt() @Min(1) @Max(1440) minutes?: number;
}

class GrantQuery {
  @IsOptional() @IsIn(STATUSES) status?: (typeof STATUSES)[number];
}

class AdminGrantQuery extends GrantQuery {
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() contractId?: string;
  @IsOptional() @IsString() assetId?: string;
}

class ApproveDto {
  /** Shorten or confirm the duration (default: what the engineer asked for). */
  @IsOptional() @IsInt() @Min(1) @Max(1440) minutes?: number;
}

class ReasonDto {
  @IsString() @Length(3, 1000) reason: string;
}

/** Engineer side of access grants (/ops/v1/access). */
@ApiTags('ops')
@ApiBearerAuth()
@UseGuards(EngineerGuard, AssignmentGuard, ResidencyGuard)
@Controller('ops/v1/access')
export class OpsAccessController {
  constructor(private readonly grants: GrantsService) {}

  /** Auto approved for P1 or P2 work while on call; otherwise waits for a support lead (status REQUESTED). */
  @Residency()
  @Post('grants') @HttpCode(201)
  request(@Ops() ops: OpsContext, @Body() dto: RequestGrantDto) {
    return this.grants.request(ops, dto);
  }

  @Get('grants')
  list(@Ops() ops: OpsContext, @Query() q: GrantQuery) {
    return this.grants.listMine(ops, q);
  }

  @OpsRefs({ id: 'grant' })
  @Get('grants/:id')
  get(@Ops() ops: OpsContext, @Param('id') id: string) {
    return this.grants.getMine(ops, id);
  }

  /** One extension per grant, with a reason (409 extension_used afterwards). */
  @OpsRefs({ id: 'grant' })
  @Residency()
  @Post('grants/:id/extend') @HttpCode(200)
  extend(@Ops() ops: OpsContext, @Param('id') id: string, @Body() dto: ExtendDto) {
    return this.grants.extend(ops, id, { reason: dto.reason, minutes: dto.minutes ?? 60 });
  }
}

/** Support lead side of access grants (/admin/ops/access). */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/ops/access')
export class AdminOpsAccessController {
  constructor(private readonly grants: GrantsService) {}

  @StaffAreas('support_lead')
  @Get('grants') @RequireScopes('admin')
  list(@Query() q: AdminGrantQuery) {
    return this.grants.adminList({ ...q, status: q.status as AccessGrantStatus | 'live' | undefined });
  }

  @StaffAreas('support_lead')
  @Get('grants/:id') @RequireScopes('admin')
  get(@Param('id') id: string) {
    return this.grants.adminGet(id);
  }

  @StaffAreas('support_lead')
  @Post('grants/:id/approve') @RequireScopes('admin') @HttpCode(200)
  approve(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: ApproveDto) {
    return this.grants.approve(actor, id, dto);
  }

  @StaffAreas('support_lead')
  @Post('grants/:id/deny') @RequireScopes('admin') @HttpCode(200)
  deny(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.grants.deny(actor, id, dto.reason);
  }

  /** Revokes the grant, its certificates and its live terminal sessions. */
  @StaffAreas('support_lead')
  @Post('grants/:id/revoke') @RequireScopes('admin') @HttpCode(200)
  revoke(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.grants.revoke(actor, id, dto.reason);
  }

  /** The certificate authority's public key, for sshd TrustedUserCAKeys on managed assets. */
  @StaffAreas('support_lead', 'engineer')
  @Get('ca') @RequireScopes('admin')
  async ca() {
    return { ca: this.grants.ca.name, publicKey: await this.grants.ca.publicKey() };
  }
}
