import type { Request } from 'express';
import { clientOf } from '../../common/auth/auth.guard';
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, Length, MinLength, ValidateIf, Equals } from 'class-validator';
import type { TeamRole } from '@prisma/client';
import { CurrentActor, Public, RequireScopes } from '../../common/auth/decorators';
import type { Actor } from '../../common/auth/actor';
import { TeamService } from './team.service';
import { COUNTRY_CODES } from '../../common/entities/countries';

const ROLES = ['owner', 'admin', 'member', 'billing', 'readonly'] as const;
const COUNTRIES = COUNTRY_CODES as unknown as string[];

class TeamProfileDto {
  @IsOptional() @IsString() @Length(2, 60) name?: string;
  @IsOptional() @ValidateIf((o) => o.billingEmail !== '' && o.billingEmail !== null) @IsEmail() billingEmail?: string | null;
  /** Buyer VAT number printed on invoices (15 digits for a Saudi VAT registration). */
  @IsOptional() @IsString() @Length(0, 40) taxId?: string | null;
  @IsOptional() @IsString() @Length(0, 500) billingAddress?: string | null;
  /**
   * Billing country: decides currency and VAT (SA: SAR with 15% VAT, else USD at 0%). A change into or
   * out of Saudi Arabia is scheduled for the first day of next month (see GET /v1/billing/balance pendingChange).
   */
  @IsOptional() @IsIn(COUNTRIES) country?: string;
}

class InviteDto {
  @IsEmail() email: string;
  @IsIn(ROLES) role: TeamRole;
}

class RoleDto {
  @IsIn(ROLES) role: TeamRole;
}

class TokenDto {
  @IsString() @Length(10, 200) token: string;
}

class AcceptSignupDto extends TokenDto {
  @IsString() @Length(1, 80) name: string;
  @IsString() @MinLength(10) password: string;
  /** The "I agree" checkbox (modules/legal). */
  @Equals(true, { message: 'You must accept the Terms of service, Acceptable use policy and Privacy policy to create an account' }) acceptTerms: boolean;
}

class CloseDto {
  /** The team slug, typed by the owner to confirm. */
  @IsString() confirm: string;
}

@ApiTags('team')
@ApiBearerAuth()
@Controller('v1/team')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  /** Any member can see the team in the console; API tokens need iam:read. */
  @Get()
  get(@CurrentActor() actor: Actor) {
    return this.team.get(actor);
  }

  /** The billing profile printed on invoices. Owners, admins and billing members may change it. */
  @Patch() @RequireScopes('billing:write')
  update(@CurrentActor() actor: Actor, @Body() dto: TeamProfileDto) {
    return this.team.updateProfile(actor, dto);
  }

  @Post('invitations') @RequireScopes('iam:write') @HttpCode(201)
  invite(@CurrentActor() actor: Actor, @Body() dto: InviteDto) {
    return this.team.invite(actor, dto.email, dto.role);
  }

  @Delete('invitations/:id') @RequireScopes('iam:write') @HttpCode(204)
  revoke(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.team.revokeInvitation(actor, id);
  }

  /** Owner only; the last owner cannot be demoted. */
  @Patch('members/:userId') @RequireScopes('iam:write')
  role(@CurrentActor() actor: Actor, @Param('userId') userId: string, @Body() dto: RoleDto) {
    return this.team.changeRole(actor, userId, dto.role);
  }

  /** Owners and admins remove members; anyone may remove themselves (leave). */
  @Delete('members/:userId') @HttpCode(204)
  remove(@CurrentActor() actor: Actor, @Param('userId') userId: string) {
    return this.team.removeMember(actor, userId);
  }

  @Post('close') @HttpCode(200)
  close(@CurrentActor() actor: Actor, @Body() dto: CloseDto) {
    return this.team.close(actor, dto.confirm);
  }
}

@ApiTags('team')
@Controller('v1/invitations')
export class InvitationsController {
  constructor(private readonly team: TeamService) {}

  @Public() @Get()
  describe(@Query('token') token: string) {
    return this.team.describeInvitation(token);
  }

  /** Signed in: accept with the account you are signed in with (its email must match). */
  @ApiBearerAuth() @Post('accept') @HttpCode(200)
  accept(@CurrentActor() actor: Actor, @Body() dto: TokenDto) {
    return this.team.accept(actor, dto.token);
  }

  /** No account yet: create one for the invited address and join. */
  @Public() @Post('accept-signup') @HttpCode(201)
  acceptSignup(@Body() dto: AcceptSignupDto, @Req() req: Request) {
    return this.team.acceptWithSignup(dto.token, dto.name, dto.password, clientOf(req));
  }
}
