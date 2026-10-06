import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentActor, Public, RequireScopes } from '../../common/auth/decorators';
import type { Actor } from '../../common/auth/actor';
import { DeployService } from './deploy.service';
import { CreateDeployDto } from './deploy.dto';

@ApiTags('deploys')
@ApiBearerAuth()
@Controller('v1/deploys')
export class DeployController {
  constructor(private readonly deploys: DeployService) {}

  @Get() @RequireScopes('servers:read')
  async list(@CurrentActor() actor: Actor, @Query('project') project?: string) {
    return { data: await this.deploys.list(actor, project) };
  }

  /** Returns 202 plus the GitHub webhook URL + secret (shown once). */
  @Post() @RequireScopes('servers:write') @HttpCode(202)
  create(@CurrentActor() actor: Actor, @Body() dto: CreateDeployDto) {
    return this.deploys.create(actor, dto);
  }

  @Get(':id') @RequireScopes('servers:read')
  async get(@CurrentActor() actor: Actor, @Param('id') id: string) {
    await this.deploys.get(actor, id); // ownership first: refreshing polls the deployment's VM
    await this.deploys.refreshStatus(id);
    return this.deploys.get(actor, id);
  }

  /** Tail of the last build log, refreshed from the server when it is reachable. */
  @Get(':id/logs') @RequireScopes('servers:read')
  logs(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.deploys.logs(actor, id);
  }

  @Post(':id/redeploy') @RequireScopes('servers:write') @HttpCode(202)
  redeploy(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.deploys.redeploy(actor, id);
  }

  /** GitHub → us. Verified with X-Hub-Signature-256; no bearer token. */
  @Public() @Post(':id/hook') @HttpCode(200)
  hook(@Param('id') id: string, @Req() req: Request & { rawBody?: Buffer }, @Headers('x-hub-signature-256') sig?: string, @Headers('x-github-event') event?: string) {
    return this.deploys.githubHook(id, req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {})), sig, event);
  }
}
