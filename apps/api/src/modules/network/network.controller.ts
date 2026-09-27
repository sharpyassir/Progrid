import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequireScopes } from '../../common/auth/decorators';
import type { Actor } from '../../common/auth/actor';
import { IamService } from '../iam/iam.service';
import { FirewallsService } from './firewalls.service';
import { IpsService } from './ips.service';
import { AttachServerDto, CreateFirewallDto, ReplaceRulesDto } from './network.dto';

@ApiTags('network')
@ApiBearerAuth()
@Controller('v1')
export class NetworkController {
  constructor(private readonly firewalls: FirewallsService, private readonly ips: IpsService, private readonly iam: IamService) {}

  @Get('firewalls') @RequireScopes('network:read')
  async list(@CurrentActor() actor: Actor, @Query('project') project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    return { data: await this.firewalls.list(p.id) };
  }

  @Post('firewalls') @RequireScopes('network:write')
  async create(@CurrentActor() actor: Actor, @Body() dto: CreateFirewallDto) {
    const p = await this.iam.resolveProject(actor, dto.project);
    return this.firewalls.create(actor, p.id, dto);
  }

  @Get('firewalls/:id') @RequireScopes('network:read')
  async get(@CurrentActor() actor: Actor, @Param('id') id: string, @Query('project') project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    return this.firewalls.get(p.id, id);
  }

  @Put('firewalls/:id/rules') @RequireScopes('network:write')
  async replaceRules(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: ReplaceRulesDto, @Query('project') project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    return this.firewalls.replaceRules(actor, p.id, id, dto.rules);
  }

  @Post('firewalls/:id/servers') @RequireScopes('network:write') @HttpCode(204)
  async attach(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: AttachServerDto, @Query('project') project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    await this.firewalls.attach(actor, p.id, id, dto.serverId);
  }

  @Delete('firewalls/:id/servers/:serverId') @RequireScopes('network:write') @HttpCode(204)
  async detach(@CurrentActor() actor: Actor, @Param('id') id: string, @Param('serverId') serverId: string, @Query('project') project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    await this.firewalls.detach(actor, p.id, id, serverId);
  }

  @Delete('firewalls/:id') @RequireScopes('network:write') @HttpCode(204)
  async remove(@CurrentActor() actor: Actor, @Param('id') id: string, @Query('project') project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    await this.firewalls.remove(actor, p.id, id);
  }

  @Get('public-ips') @RequireScopes('network:read')
  async listIps(@CurrentActor() actor: Actor, @Query('project') project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    return { data: await this.ips.list(p.id) };
  }

  /** Moves the address onto the server. The server must not have a public address already. */
  @Post('public-ips/:id/attach') @RequireScopes('network:write')
  async attachIp(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: AttachServerDto, @Query('project') project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    return this.ips.attach(actor, p.id, id, dto.serverId);
  }

  /** Takes the address off its server; it stays reserved for the project. */
  @Post('public-ips/:id/detach') @RequireScopes('network:write')
  async detachIp(@CurrentActor() actor: Actor, @Param('id') id: string, @Query('project') project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    return this.ips.detach(actor, p.id, id);
  }

  /** Releases a detached address back to the pool. */
  @Delete('public-ips/:id') @RequireScopes('network:write') @HttpCode(204)
  async releaseIp(@CurrentActor() actor: Actor, @Param('id') id: string, @Query('project') project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    await this.ips.releaseReserved(actor, p.id, id);
  }
}
