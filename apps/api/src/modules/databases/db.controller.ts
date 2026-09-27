import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequireScopes } from '../../common/auth/decorators';
import type { Actor } from '../../common/auth/actor';
import { DatabasesService } from './db.service';
import { CreateDatabaseDto, DbNameDto, ENGINE_VERSIONS, RestoreDatabaseDto, UpdateDatabaseDto } from './db.dto';

@ApiTags('databases')
@ApiBearerAuth()
@Controller('v1/databases')
export class DatabasesController {
  constructor(private readonly dbs: DatabasesService) {}

  @Get() @RequireScopes('databases:read')
  list(@CurrentActor() actor: Actor, @Query('project') project?: string) {
    return this.dbs.list(actor, project);
  }

  @Get('engines') @RequireScopes('databases:read')
  engines() {
    return { data: Object.entries(ENGINE_VERSIONS).map(([engine, versions]) => ({ engine, versions, available: true })) };
  }

  @Post() @RequireScopes('databases:write') @HttpCode(202)
  create(@CurrentActor() actor: Actor, @Body() dto: CreateDatabaseDto) {
    return this.dbs.create(actor, dto);
  }

  @Get(':id') @RequireScopes('databases:read')
  get(@CurrentActor() actor: Actor, @Param('id') id: string, @Query('project') project?: string) {
    return this.dbs.get(actor, id, project);
  }

  @Patch(':id') @RequireScopes('databases:write') @HttpCode(202)
  update(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: UpdateDatabaseDto, @Query('project') project?: string) {
    return this.dbs.update(actor, id, dto, project);
  }

  @Delete(':id') @RequireScopes('databases:write') @HttpCode(202)
  remove(@CurrentActor() actor: Actor, @Param('id') id: string, @Query('project') project?: string) {
    return this.dbs.remove(actor, id, project);
  }

  @Post(':id/users') @RequireScopes('databases:write') @HttpCode(201)
  addUser(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: DbNameDto, @Query('project') project?: string) {
    return this.dbs.addUser(actor, id, dto, project);
  }

  @Post(':id/users/:userId/reset-password') @RequireScopes('databases:write')
  resetPassword(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('userId') userId: string, @Query('project') project?: string) {
    return this.dbs.resetUserPassword(actor, id, userId, project);
  }

  @Delete(':id/users/:userId') @RequireScopes('databases:write')
  deleteUser(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('userId') userId: string, @Query('project') project?: string) {
    return this.dbs.deleteUser(actor, id, userId, project);
  }

  @Post(':id/dbs') @RequireScopes('databases:write') @HttpCode(201)
  addDatabase(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: DbNameDto, @Query('project') project?: string) {
    return this.dbs.addDatabase(actor, id, dto, project);
  }

  @Delete(':id/dbs/:dbId') @RequireScopes('databases:write')
  deleteDatabase(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('dbId') dbId: string, @Query('project') project?: string) {
    return this.dbs.deleteDatabase(actor, id, dbId, project);
  }

  @Get(':id/backups') @RequireScopes('databases:read')
  backups(@CurrentActor() actor: Actor, @Param('id') id: string, @Query('project') project?: string) {
    return this.dbs.listBackups(actor, id, project);
  }

  @Post(':id/backups') @RequireScopes('databases:write') @HttpCode(202)
  backup(@CurrentActor() actor: Actor, @Param('id') id: string, @Query('project') project?: string) {
    return this.dbs.startBackup(actor, id, 'manual', project);
  }

  @Post(':id/restore') @RequireScopes('databases:write') @HttpCode(202)
  restore(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: RestoreDatabaseDto, @Query('project') project?: string) {
    return this.dbs.restore(actor, id, dto, project);
  }
}
