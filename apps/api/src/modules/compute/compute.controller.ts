import { Body, Controller, Delete, Get, Header, Headers, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrentActor, Public, RequireScopes } from '../../common/auth/decorators';
import type { Actor } from '../../common/auth/actor';
import { ManagedCareService, ServersService } from './servers.service';
import type { ManagedReport } from './managed-agent';
import { CreateServerDto, ListServersQuery, RestoreServerDto, ServerActionDto, UpdateServerDto } from './compute.dto';

@ApiTags('servers')
@ApiBearerAuth()
@Controller('v1/servers')
export class ServersController {
  constructor(private readonly servers: ServersService) {}

  @Get() @RequireScopes('servers:read')
  list(@CurrentActor() actor: Actor, @Query() q: ListServersQuery) {
    return this.servers.list(actor, q);
  }

  /** Returns 202: the server is `new` and a workflow is provisioning it. */
  @Post() @RequireScopes('servers:write') @HttpCode(202)
  create(@CurrentActor() actor: Actor, @Body() dto: CreateServerDto) {
    return this.servers.create(actor, dto);
  }

  @Get(':id') @RequireScopes('servers:read')
  get(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.servers.get(actor, id);
  }

  @Patch(':id') @RequireScopes('servers:write')
  update(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: UpdateServerDto) {
    return this.servers.update(actor, id, dto);
  }

  /** Managed tier: health, the last care report and the install command while the agent is not reporting. */
  @Get(':id/managed') @RequireScopes('servers:read')
  managed(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.servers.managedStatus(actor, id);
  }

  @Post(':id/actions') @RequireScopes('servers:write') @HttpCode(202)
  action(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: ServerActionDto) {
    return this.servers.action(actor, id, dto);
  }

  /** Rolls the server back to one of its snapshots: power off, roll back, power on. Everything written since is lost. */
  @Post(':id/restore') @RequireScopes('servers:write') @HttpCode(202)
  restore(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: RestoreServerDto) {
    return this.servers.restore(actor, id, dto);
  }

  @Get(':id/actions') @RequireScopes('servers:read')
  async actions(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return { data: await this.servers.actions(actor, id) };
  }

  @Delete(':id') @RequireScopes('servers:delete') @HttpCode(202)
  remove(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.servers.delete(actor, id);
  }
}

@ApiTags('catalog')
@Controller('v1')
export class CatalogController {
  constructor(private readonly prisma: PrismaService) {}

  @Public() @Get('regions')
  async regions() {
    return { data: await this.prisma.region.findMany({ where: { available: true } }) };
  }

  @Public() @Get('sizes')
  async sizes() {
    return { data: await this.prisma.size.findMany({ where: { available: true }, orderBy: { sortOrder: 'asc' } }) };
  }

  @Public() @Get('images')
  async images(@Query('kind') kind?: 'distribution' | 'marketplace') {
    return {
      data: await this.prisma.image.findMany({
        where: { public: true, deprecated: false, ...(kind ? { kind } : {}) },
        select: { id: true, kind: true, name: true, distribution: true, version: true, minDiskGb: true, minMemoryMb: true, regionId: true },
        orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      }),
    };
  }
}

/** Called by the care agent inside managed servers, authenticated by the server's own token. */
@ApiTags('servers')
@Controller('v1/managed')
export class ManagedCareController {
  constructor(private readonly care: ManagedCareService) {}

  @Public() @Get('install/:token') @Header('Content-Type', 'text/plain; charset=utf-8')
  install(@Param('token') token: string) {
    return this.care.installScript(token);
  }

  @Public() @Post('report') @HttpCode(200)
  report(@Headers('x-prgd-managed-token') token: string | undefined, @Body() body: ManagedReport) {
    return this.care.report(token, body ?? {});
  }
}
