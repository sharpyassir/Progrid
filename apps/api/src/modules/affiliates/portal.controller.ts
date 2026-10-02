import { Body, Controller, Get, HttpCode, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentActor } from '../../common/auth/decorators';
import type { Actor } from '../../common/auth/actor';
import { ApiError } from '../../common/errors/api-error';
import { clientIpOf } from '../../common/net/client-ip';
import { PortalService } from './portal.service';
import { ApplyDto, PayoutDetailsDto, PayoutRequestDto } from './portal.dto';
import { TaxFormDto } from './tax.dto';

/** Console sessions only: payout details and money requests never go through API tokens. */
function session(actor: Actor) {
  if (!actor.sessionId) throw ApiError.forbidden('The affiliate portal is available in the console only.');
  return actor;
}

/** The affiliate portal in the console (docs/affiliates.md). Works on the signed in person, not the team. */
@ApiTags('affiliates')
@ApiBearerAuth()
@Controller('v1/affiliates')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('me')
  me(@CurrentActor() actor: Actor) {
    return this.portal.me(session(actor));
  }

  @Post('apply') @HttpCode(201)
  async apply(@CurrentActor() actor: Actor, @Body() dto: ApplyDto, @Req() req: Request) {
    return { affiliate: await this.portal.apply(session(actor), dto, clientIpOf(req) || actor.ip) };
  }

  @Get('me/dashboard')
  dashboard(@CurrentActor() actor: Actor, @Query('from') from?: string, @Query('to') to?: string) {
    return this.portal.dashboard(session(actor), { from, to });
  }

  @Get('me/referrals')
  referrals(@CurrentActor() actor: Actor, @Query('cursor') cursor?: string) {
    return this.portal.referrals(session(actor), { cursor });
  }

  @Get('me/payout-details')
  payoutDetails(@CurrentActor() actor: Actor) {
    return this.portal.payoutDetails(session(actor));
  }

  @Put('me/payout-details')
  setPayoutDetails(@CurrentActor() actor: Actor, @Body() dto: PayoutDetailsDto) {
    return this.portal.setPayoutDetails(session(actor), dto);
  }

  /** US tax information (Form W-9, W-8BEN or W-8BEN-E) for payouts in US dollars. */
  @Get('me/tax-form')
  taxForm(@CurrentActor() actor: Actor) {
    return this.portal.taxForm(session(actor));
  }

  @Post('me/tax-form') @HttpCode(201)
  submitTaxForm(@CurrentActor() actor: Actor, @Body() dto: TaxFormDto, @Req() req: Request) {
    return this.portal.submitTaxForm(session(actor), dto, clientIpOf(req) || actor.ip);
  }

  @Get('me/payouts')
  payouts(@CurrentActor() actor: Actor) {
    return this.portal.payouts(session(actor));
  }

  @Post('me/payouts') @HttpCode(201)
  requestPayout(@CurrentActor() actor: Actor, @Body() dto: PayoutRequestDto) {
    return this.portal.requestPayout(session(actor), dto.currency);
  }
}
