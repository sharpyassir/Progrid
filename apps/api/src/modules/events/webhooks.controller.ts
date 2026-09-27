import { Body, Controller, Delete, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsIn, IsUrl } from 'class-validator';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrentActor, RequireScopes } from '../../common/auth/decorators';
import type { Actor } from '../../common/auth/actor';
import { ApiError } from '../../common/errors/api-error';
import { CUSTOMER_EVENTS } from './events.service';
import { assertSafeUrl } from '../../common/net/safe-url';
import { seal } from '../../common/crypto/secretbox';

class CreateWebhookDto {
  @IsUrl({ protocols: ['https'], require_protocol: true }) url: string;
  @IsArray() @ArrayNotEmpty() @IsIn(CUSTOMER_EVENTS, { each: true }) events: string[];
}

@ApiTags('webhooks')
@ApiBearerAuth()
@Controller('v1/webhooks')
@RequireScopes('iam:write')
export class WebhooksController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentActor() actor: Actor) {
    const data = await this.prisma.webhook.findMany({
      where: { teamId: actor.teamId },
      select: { id: true, url: true, events: true, active: true, createdAt: true },
    });
    return { data };
  }

  @Post()
  async create(@CurrentActor() actor: Actor, @Body() dto: CreateWebhookDto) {
    await assertSafeUrl(dto.url).catch((e: Error) => { throw ApiError.invalid(`Webhook URL rejected: ${e.message}`); });
    const secret = 'whsec_' + randomBytes(24).toString('base64url');
    const hook = await this.prisma.webhook.create({ data: { teamId: actor.teamId, url: dto.url, events: dto.events, secret: seal(secret) } });
    return { ...hook, secret }; // secret shown once
  }

  @Delete(':id') @HttpCode(204)
  async remove(@CurrentActor() actor: Actor, @Param('id') id: string) {
    const r = await this.prisma.webhook.deleteMany({ where: { id, teamId: actor.teamId } });
    if (!r.count) throw ApiError.notFound('webhook', id);
  }

  @Get('events')
  events() {
    return { data: CUSTOMER_EVENTS };
  }
}
