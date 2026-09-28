import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import type { PostmortemStatus } from '@prisma/client';
import { CurrentActor, RequireScopes, StaffAreas } from '../../../common/auth/decorators';
import type { Actor } from '../../../common/auth/actor';
import { ApiError } from '../../../common/errors/api-error';
import { RunbooksService } from '../../managed/runbooks/runbooks.service';
import { AssignmentGuard, EngineerGuard, ResidencyGuard } from '../guards/ops.guards';
import { Ops, canSee, type OpsContext } from '../guards/ops-context';
import { OpsAudit } from '../ops-audit.service';
import { PostmortemsService } from './postmortems.service';

const STATUSES = ['DRAFT', 'SUBMITTED', 'CLOSED'] as const;

class PostmortemFieldsDto {
  @IsOptional() @IsString() @Length(0, 50_000) timeline?: string;
  @IsOptional() @IsString() @Length(0, 50_000) impact?: string;
  @IsOptional() @IsString() @Length(0, 50_000) rootCause?: string;
  @IsOptional() @IsString() @Length(0, 50_000) fix?: string;
  @IsOptional() @IsString() @Length(0, 50_000) prevention?: string;
  /** Submit it (every section filled): closes the P1 ticket waiting for it. */
  @IsOptional() @IsBoolean() submit?: boolean;
}

class CreatePostmortemDto extends PostmortemFieldsDto {
  @IsString() ticketId: string;
}

class ListQuery {
  @IsOptional() @IsIn(STATUSES) status?: PostmortemStatus;
}

class AdminListQuery extends ListQuery {
  @IsOptional() @IsIn(['true', 'false']) overdue?: string;
}

class CloseDto {
  @IsOptional() @IsString() @Length(0, 2000) comment?: string;
}

class RunbookQuery {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsString() tag?: string;
}

class RunbookDto {
  @IsString() @Length(3, 200) title: string;
  @IsString() @Length(1, 100_000) body: string;
  @IsOptional() @Matches(/^[a-z0-9-]{2,80}$/) slug?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) tags?: string[];
}

class UpdateRunbookDto {
  @IsOptional() @IsString() @Length(3, 200) title?: string;
  @IsOptional() @IsString() @Length(1, 100_000) body?: string;
  @IsOptional() @Matches(/^[a-z0-9-]{2,80}$/) slug?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) tags?: string[];
}

/** A contract tag (contract:<id>) the engineer may not see hides the runbook. */
const contractTags = (tags: string[]) => tags.filter((t) => t.toLowerCase().startsWith('contract:')).map((t) => t.slice('contract:'.length));
const runbookVisible = (ops: OpsContext, tags: string[]) => contractTags(tags).every((c) => canSee(ops, c));

/** Postmortems and runbooks for engineers (/ops/v1). */
@ApiTags('ops')
@ApiBearerAuth()
@UseGuards(EngineerGuard, AssignmentGuard, ResidencyGuard)
@Controller('ops/v1')
export class OpsPostmortemsController {
  constructor(private readonly postmortems: PostmortemsService, private readonly runbooks: RunbooksService, private readonly audit: OpsAudit) {}

  @Get('postmortems')
  list(@Ops() ops: OpsContext, @Query() q: ListQuery) {
    return this.postmortems.list(ops, q);
  }

  /** Creates (or updates) the postmortem of a P1 ticket. */
  @Post('postmortems') @HttpCode(201)
  create(@Ops() ops: OpsContext, @Body() dto: CreatePostmortemDto) {
    return this.postmortems.upsert(ops, dto);
  }

  @Get('postmortems/:id')
  get(@Ops() ops: OpsContext, @Param('id') id: string) {
    return this.postmortems.get(ops, id);
  }

  @Patch('postmortems/:id')
  update(@Ops() ops: OpsContext, @Param('id') id: string, @Body() dto: PostmortemFieldsDto) {
    return this.postmortems.update(ops, id, dto);
  }

  @Get('runbooks')
  async runbookList(@Ops() ops: OpsContext, @Query() q: RunbookQuery) {
    const r = await this.runbooks.list(q);
    return { data: r.data.filter((x) => runbookVisible(ops, x.tags)) };
  }

  @Get('runbooks/:idOrSlug')
  async runbook(@Ops() ops: OpsContext, @Param('idOrSlug') idOrSlug: string) {
    const r = await this.runbooks.get(idOrSlug);
    if (!runbookVisible(ops, r.tags)) throw ApiError.notFound('runbook', idOrSlug);
    return r;
  }

  @Post('runbooks') @HttpCode(201)
  async createRunbook(@Ops() ops: OpsContext, @Body() dto: RunbookDto) {
    if (!runbookVisible(ops, dto.tags ?? [])) throw ApiError.forbidden('You can only tag runbooks with your own contracts');
    return this.runbooks.create(ops.actor, dto);
  }

  @Patch('runbooks/:idOrSlug')
  async updateRunbook(@Ops() ops: OpsContext, @Param('idOrSlug') idOrSlug: string, @Body() dto: UpdateRunbookDto) {
    const cur = await this.runbook(ops, idOrSlug);
    if (!runbookVisible(ops, dto.tags ?? [])) throw ApiError.forbidden('You can only tag runbooks with your own contracts');
    return this.runbooks.update(ops.actor, cur.id, dto);
  }

  /** Internal engineers only: external engineers never delete runbooks. */
  @Delete('runbooks/:idOrSlug')
  async deleteRunbook(@Ops() ops: OpsContext, @Param('idOrSlug') idOrSlug: string) {
    if (ops.external) throw ApiError.forbidden('External engineers cannot delete runbooks');
    const cur = await this.runbook(ops, idOrSlug);
    return this.runbooks.remove(ops.actor, cur.id);
  }
}

/** Support leads close submitted postmortems (/admin/ops/postmortems). */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/ops/postmortems')
export class AdminOpsPostmortemsController {
  constructor(private readonly postmortems: PostmortemsService) {}

  @StaffAreas('support_lead')
  @Get() @RequireScopes('admin')
  list(@Query() q: AdminListQuery) {
    return this.postmortems.adminList(q);
  }

  @StaffAreas('support_lead')
  @Get(':id') @RequireScopes('admin')
  get(@Param('id') id: string) {
    return this.postmortems.adminGet(id);
  }

  @StaffAreas('support_lead')
  @Post(':id/close') @RequireScopes('admin') @HttpCode(200)
  close(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: CloseDto) {
    return this.postmortems.close(actor, id, dto.comment);
  }
}
