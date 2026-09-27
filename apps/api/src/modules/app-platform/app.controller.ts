import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequireScopes, StaffAreas } from '../../common/auth/decorators';
import type { Actor } from '../../common/auth/actor';
import { AppPlatformService } from './app.service';
import { CreateAppDto, DomainDto, LogsQuery, ProvisionHostDto, UpdateAppDto } from './app.dto';

@ApiTags('app-platform')
@ApiBearerAuth()
@Controller('v1/app-platform')
export class AppPlatformController {
  constructor(private readonly apps: AppPlatformService) {}

  @Get('sizes') @RequireScopes('apps:read')
  sizes() {
    return this.apps.sizes();
  }

  @Get('apps') @RequireScopes('apps:read')
  list(@CurrentActor() actor: Actor, @Query('project') project?: string) {
    return this.apps.list(actor, project);
  }

  @Post('apps') @RequireScopes('apps:write') @HttpCode(202)
  create(@CurrentActor() actor: Actor, @Body() dto: CreateAppDto) {
    return this.apps.create(actor, dto);
  }

  @Get('apps/:id') @RequireScopes('apps:read')
  get(@CurrentActor() actor: Actor, @Param('id') id: string, @Query('project') project?: string) {
    return this.apps.get(actor, id, project);
  }

  @Patch('apps/:id') @RequireScopes('apps:write') @HttpCode(202)
  update(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: UpdateAppDto, @Query('project') project?: string) {
    return this.apps.update(actor, id, dto, project);
  }

  @Delete('apps/:id') @RequireScopes('apps:write') @HttpCode(202)
  remove(@CurrentActor() actor: Actor, @Param('id') id: string, @Query('project') project?: string) {
    return this.apps.remove(actor, id, project);
  }

  @Post('apps/:id/deploy') @RequireScopes('apps:write') @HttpCode(202)
  deploy(@CurrentActor() actor: Actor, @Param('id') id: string, @Query('project') project?: string) {
    return this.apps.redeploy(actor, id, 'manual', project);
  }

  @Post('apps/:id/stop') @RequireScopes('apps:write') @HttpCode(200)
  stop(@CurrentActor() actor: Actor, @Param('id') id: string, @Query('project') project?: string) {
    return this.apps.stop(actor, id, project);
  }

  @Post('apps/:id/start') @RequireScopes('apps:write') @HttpCode(200)
  start(@CurrentActor() actor: Actor, @Param('id') id: string, @Query('project') project?: string) {
    return this.apps.start(actor, id, project);
  }

  @Get('apps/:id/deploys') @RequireScopes('apps:read')
  deploys(@CurrentActor() actor: Actor, @Param('id') id: string, @Query('project') project?: string) {
    return this.apps.deploys(actor, id, project);
  }

  @Get('apps/:id/logs') @RequireScopes('apps:read')
  logs(@CurrentActor() actor: Actor, @Param('id') id: string, @Query() q: LogsQuery, @Query('project') project?: string) {
    return this.apps.logs(actor, id, q.type ?? 'build', project);
  }

  @Post('apps/:id/domains') @RequireScopes('apps:write') @HttpCode(200)
  addDomain(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: DomainDto, @Query('project') project?: string) {
    return this.apps.addDomain(actor, id, dto, project);
  }

  /** Check the TXT or CNAME record now; verified domains are served on the next push. */
  @Post('apps/:id/domains/:domain/verify') @RequireScopes('apps:write') @HttpCode(200)
  verifyDomain(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('domain') domain: string, @Query('project') project?: string) {
    return this.apps.verifyDomain(actor, id, domain, project);
  }

  @Delete('apps/:id/domains/:domain') @RequireScopes('apps:write') @HttpCode(200)
  removeDomain(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('domain') domain: string, @Query('project') project?: string) {
    return this.apps.removeDomain(actor, id, domain, project);
  }
}

/** Back office: the shared hosts. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/v1/app-platform')
export class AdminAppPlatformController {
  constructor(private readonly apps: AppPlatformService) {}

  @StaffAreas('ops')
  @Get('hosts') @RequireScopes('admin')
  hosts() {
    return this.apps.adminHosts();
  }

  @StaffAreas('ops')
  @Post('hosts') @RequireScopes('admin') @HttpCode(202)
  provision(@Body() dto: ProvisionHostDto) {
    return this.apps.provisionHost(dto.region ?? 'sa1', dto.size).then((h) => ({ id: h.id, status: h.status, region: h.regionId }));
  }
}
