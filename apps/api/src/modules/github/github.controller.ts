import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, Post, Req, forwardRef } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsInt, IsString } from 'class-validator';
import type { Request } from 'express';
import { CurrentActor, Public, RequireScopes } from '../../common/auth/decorators';
import type { Actor } from '../../common/auth/actor';
import { GithubService } from './github.service';
import { DeployService } from '../deploy/deploy.service';
import { AppPlatformService } from '../app-platform/app.service';

class ConnectDto { @IsInt() installationId: number; @IsString() state: string; }

@ApiTags('github')
@ApiBearerAuth()
@Controller('v1/github')
export class GithubController {
  constructor(private readonly github: GithubService, private readonly deploys: DeployService, @Inject(forwardRef(() => AppPlatformService)) private readonly apps: AppPlatformService) {}

  /** Is the GitHub App configured on this installation of prgd? */
  @Get('app')
  app() {
    return { enabled: this.github.enabled };
  }

  @Get('connect') @RequireScopes('servers:write')
  connect(@CurrentActor() actor: Actor) {
    return this.github.connectUrl(actor);
  }

  @Post('installations') @RequireScopes('servers:write')
  install(@CurrentActor() actor: Actor, @Body() dto: ConnectDto) {
    return this.github.connect(actor, dto.installationId, dto.state);
  }

  @Get('installations') @RequireScopes('servers:read')
  async list(@CurrentActor() actor: Actor) {
    return { data: await this.github.list(actor) };
  }

  @Delete('installations/:id') @RequireScopes('servers:write') @HttpCode(204)
  async remove(@CurrentActor() actor: Actor, @Param('id') id: string) {
    await this.github.remove(actor, id);
  }

  @Get('installations/:id/repos') @RequireScopes('servers:read')
  async repos(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return { data: await this.github.repos(actor, id) };
  }

  /** App level webhook: one URL for every installation. Push events redeploy matching deployments. */
  @Public() @Post('webhook') @HttpCode(200)
  async webhook(@Req() req: Request & { rawBody?: Buffer }, @Headers('x-hub-signature-256') sig?: string, @Headers('x-github-event') event?: string) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    this.github.verifyWebhook(raw, sig);
    const payload = JSON.parse(raw.toString('utf8')) as { action?: string; installation?: { id: number }; repository?: { full_name: string }; ref?: string; after?: string };
    if (event === 'ping') return { ok: true, pong: true };
    if (event === 'installation' && payload.installation) {
      await this.github.handleInstallationEvent(payload.action ?? '', payload.installation.id);
      return { ok: true };
    }
    if (event === 'push' && payload.installation && payload.repository && payload.ref?.startsWith('refs/heads/')) {
      const branch = payload.ref.slice('refs/heads/'.length);
      const n = await this.deploys.onAppPush(payload.installation.id, payload.repository.full_name, branch, payload.after);
      const apps = await this.apps.onPush(payload.installation.id, payload.repository.full_name, branch, payload.after);
      return { ok: true, deploying: n + apps };
    }
    return { ok: true, ignored: event };
  }
}
