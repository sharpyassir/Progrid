import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Equals } from 'class-validator';
import { CurrentActor, Public } from '../../common/auth/decorators';
import type { Actor } from '../../common/auth/actor';
import { ApiError } from '../../common/errors/api-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LEGAL_VERSION } from './legal';
import { LegalService } from './legal.service';

class AcceptDto {
  /** Must be true: the user ticked "I agree". */
  @Equals(true) accept!: boolean;
  /** The version the user saw; refused when it is no longer current so nobody accepts a text they did not see. */
  @Equals(LEGAL_VERSION, { message: 'The documents changed while you were reading them. Reload and accept the current version.' }) version!: string;
}

@ApiTags('legal')
@Controller('v1/legal')
export class LegalController {
  constructor(private readonly legal: LegalService, private readonly prisma: PrismaService) {}

  /** Current version and document links (public, for the signup form). */
  @Public()
  @Get()
  current() {
    return this.legal.summary();
  }

  @ApiBearerAuth()
  @Post('accept') @HttpCode(200)
  async accept(@CurrentActor() actor: Actor, @Body() _dto: AcceptDto) {
    if (actor.tokenId) throw ApiError.forbidden('Accept the terms in the console, signed in as yourself; an API token cannot accept them for you');
    return this.legal.acceptFromConsole(actor);
  }

  @ApiBearerAuth()
  @Get('acceptances')
  async acceptances(@CurrentActor() actor: Actor) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { legalVersion: true, legalAcceptedAt: true } });
    return { current: LEGAL_VERSION, accepted: user.legalVersion, acceptedAt: user.legalAcceptedAt, data: await this.legal.history(actor.userId) };
  }
}
