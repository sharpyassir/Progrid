import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentActor, RequireScopes, StaffAreas } from '../../../common/auth/decorators';
import type { Actor } from '../../../common/auth/actor';
import { AssetsService } from './assets.service';
import { RejectAssetDto, RequestAssetDto, StaffCreateAssetDto, UpdateAssetDto } from './assets.dto';

/** Customer: managed assets. Members can read; owners request new ones. */
@ApiTags('managed')
@ApiBearerAuth()
@Controller('v1/managed')
export class ManagedAssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get('assets') @RequireScopes('managed:read')
  listAll(@CurrentActor() actor: Actor) {
    return this.assets.listForTeam(actor);
  }

  @Get('contracts/:id/assets') @RequireScopes('managed:read')
  list(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.assets.listForContract(actor, id);
  }

  @Post('contracts/:id/assets') @RequireScopes('managed:write') @HttpCode(201)
  request(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: RequestAssetDto) {
    return this.assets.request(actor, id, dto);
  }
}

/** Back office: assets under management. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/managed')
export class AdminManagedAssetsController {
  constructor(private readonly assets: AssetsService) {}

  @StaffAreas('engineer', 'support_lead')
  @Get('contracts/:id/assets') @RequireScopes('admin')
  list(@Param('id') id: string) {
    return this.assets.list(id);
  }

  @StaffAreas('support_lead')
  @Post('contracts/:id/assets') @RequireScopes('admin') @HttpCode(201)
  create(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: StaffCreateAssetDto) {
    return this.assets.create(actor, id, dto);
  }

  @StaffAreas('engineer', 'support_lead')
  @Get('assets/:assetId') @RequireScopes('admin')
  get(@Param('assetId') assetId: string) {
    return this.assets.get(assetId);
  }

  /** Details and the monitoring and backup toggles. */
  @StaffAreas('support_lead')
  @Patch('assets/:assetId') @RequireScopes('admin')
  update(@CurrentActor() actor: Actor, @Param('assetId') assetId: string, @Body() dto: UpdateAssetDto) {
    return this.assets.update(actor, assetId, dto);
  }

  @StaffAreas('support_lead')
  @Delete('assets/:assetId') @RequireScopes('admin')
  remove(@CurrentActor() actor: Actor, @Param('assetId') assetId: string) {
    return this.assets.remove(actor, assetId);
  }

  @StaffAreas('engineer', 'support_lead')
  @Post('assets/:assetId/approve') @RequireScopes('admin') @HttpCode(200)
  approve(@CurrentActor() actor: Actor, @Param('assetId') assetId: string) {
    return this.assets.approve(actor, assetId);
  }

  @StaffAreas('engineer', 'support_lead')
  @Post('assets/:assetId/reject') @RequireScopes('admin') @HttpCode(200)
  reject(@CurrentActor() actor: Actor, @Param('assetId') assetId: string, @Body() dto: RejectAssetDto) {
    return this.assets.reject(actor, assetId, dto.reason);
  }

  /** New heartbeat token for the monitoring agent on an external server. Shown once. */
  @StaffAreas('engineer', 'support_lead')
  @Post('assets/:assetId/heartbeat-token') @RequireScopes('admin') @HttpCode(201)
  rotateToken(@CurrentActor() actor: Actor, @Param('assetId') assetId: string) {
    return this.assets.rotateToken(actor, assetId);
  }
}
