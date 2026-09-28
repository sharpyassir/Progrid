import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, Length, ValidateIf } from 'class-validator';
import { CurrentActor, RequireScopes, StaffAreas } from '../../../common/auth/decorators';
import type { Actor } from '../../../common/auth/actor';
import { PaginationQuery } from '../../../common/pagination';
import { MaintenanceService } from './maintenance.service';

const KINDS = ['PATCHING', 'BACKUP_TEST', 'CUSTOM'] as const;

class CreateTaskDto {
  @IsString() contractId: string;
  /** Omit to run against every approved asset of the contract with a management address. */
  @IsOptional() @IsString() assetId?: string;
  @IsIn(KINDS) kind: (typeof KINDS)[number];
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  /** Five field cron, e.g. "0 3 * * 5" for Friday 03:00. */
  @IsString() @Length(9, 100) cron: string;
  /** IANA zone; defaults to the contract calendar's zone. */
  @IsOptional() @IsString() timezone?: string;
  /** File in MAINTENANCE_PLAYBOOK_DIR; defaults to patching.yml or backup-test.yml by kind. */
  @IsOptional() @IsString() playbook?: string;
  @IsOptional() @IsObject() vars?: Record<string, unknown>;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

class UpdateTaskDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() assetId?: string | null;
  @IsOptional() @IsIn(KINDS) kind?: (typeof KINDS)[number];
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @IsString() @Length(9, 100) cron?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() playbook?: string;
  @IsOptional() @IsObject() vars?: Record<string, unknown>;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

class TaskQuery {
  @IsOptional() @IsString() contractId?: string;
  @IsOptional() @IsString() assetId?: string;
}

class RunQuery extends PaginationQuery {
  @IsOptional() @IsString() taskId?: string;
  @IsOptional() @IsString() contractId?: string;
  @IsOptional() @IsIn(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED']) status?: string;
}

/** Back office: maintenance schedules and runs. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/managed/maintenance')
export class AdminManagedMaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @StaffAreas('engineer', 'support_lead')
  @Get('tasks') @RequireScopes('admin')
  list(@Query() q: TaskQuery) {
    return this.maintenance.listTasks(q);
  }

  @StaffAreas('engineer', 'support_lead')
  @Post('tasks') @RequireScopes('admin') @HttpCode(201)
  create(@CurrentActor() actor: Actor, @Body() dto: CreateTaskDto) {
    return this.maintenance.createTask(actor, dto);
  }

  @StaffAreas('engineer', 'support_lead')
  @Get('tasks/:id') @RequireScopes('admin')
  get(@Param('id') id: string) {
    return this.maintenance.getTask(id);
  }

  @StaffAreas('engineer', 'support_lead')
  @Patch('tasks/:id') @RequireScopes('admin')
  update(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: UpdateTaskDto) {
    return this.maintenance.updateTask(actor, id, dto);
  }

  @StaffAreas('engineer', 'support_lead')
  @Delete('tasks/:id') @RequireScopes('admin')
  remove(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.maintenance.deleteTask(actor, id);
  }

  @StaffAreas('engineer', 'support_lead')
  @Post('tasks/:id/run') @RequireScopes('admin') @HttpCode(202)
  run(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.maintenance.runNow(actor, id);
  }

  @StaffAreas('engineer', 'support_lead')
  @Get('runs') @RequireScopes('admin')
  runs(@Query() q: RunQuery) {
    return this.maintenance.listRuns(q);
  }

  /** One run with its log. */
  @StaffAreas('engineer', 'support_lead')
  @Get('runs/:id') @RequireScopes('admin')
  getRun(@Param('id') id: string) {
    return this.maintenance.getRun(id);
  }
}
