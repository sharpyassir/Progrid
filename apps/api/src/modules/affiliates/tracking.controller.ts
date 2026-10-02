import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { IsOptional, IsString, Length } from 'class-validator';
import { CurrentActor, Public, RequireScopes } from '../../common/auth/decorators';
import type { Actor } from '../../common/auth/actor';
import { clientIpOf } from '../../common/net/client-ip';
import { AttributionService } from './attribution.service';

class ClickDto {
  @IsString() @Length(1, 40) code: string;
  @IsOptional() @IsString() @Length(0, 300) path?: string;
  @IsOptional() @IsString() @Length(0, 500) referrer?: string;
}

class PromoDto {
  @IsString() @Length(1, 40) code: string;
}

/** Referral link clicks, promo code checks, and the promo code on the billing page. */
@ApiTags('affiliates')
@Controller('v1')
export class TrackingController {
  constructor(private readonly attribution: AttributionService) {}

  /** Sent by the website when a page opens with ?ref=CODE. Always 204, valid code or not. */
  @Public() @Post('affiliates/clicks') @HttpCode(204)
  async click(@Body() dto: ClickDto, @Req() req: Request) {
    await this.attribution.recordClick({ code: dto.code, ip: clientIpOf(req), path: dto.path, referrer: dto.referrer });
  }

  /** Whether a promo code is valid and the discount it gives. */
  @Public() @Get('affiliates/codes/:code')
  code(@Param('code') code: string) {
    return this.attribution.describe(code);
  }

  /** The promo code and discount applied to this team, if any. */
  @ApiBearerAuth() @Get('billing/referral') @RequireScopes('billing:read')
  async referral(@CurrentActor() actor: Actor) {
    return { referral: await this.attribution.forTeam(actor.teamId) };
  }

  /** Adds a promo code before the team's first paid invoice. */
  @ApiBearerAuth() @Post('billing/promo-code') @RequireScopes('billing:write')
  async promo(@CurrentActor() actor: Actor, @Body() dto: PromoDto, @Req() req: Request) {
    return { referral: await this.attribution.applyPromo(actor, dto.code, clientIpOf(req) || actor.ip) };
  }
}
