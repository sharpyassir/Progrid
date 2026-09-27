import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { TokenService } from './token.service';
import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentActor, Public, RequireScopes } from '../../common/auth/decorators';
import type { Actor } from '../../common/auth/actor';
import { IamService } from './iam.service';
import { CreateProjectDto, CreateSshKeyDto, CreateTokenDto, LoginDto, SignupDto } from './iam.dto';

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  constructor(private readonly iam: IamService, private readonly tokens: TokenService) {}

  @Public() @Post('signup')
  signup(@Body() dto: SignupDto, @Req() req: Request) {
    return this.iam.signup(dto, clientMeta(req));
  }

  @Public() @Post('login') @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.iam.login(dto, clientMeta(req));
  }

  /** Ends the current console session on the server, not only in the browser. */
  @ApiBearerAuth() @Post('logout') @HttpCode(204)
  async logout(@CurrentActor() actor: Actor) {
    if (actor.sessionId) await this.tokens.revokeSession(actor.userId, actor.sessionId);
  }
}

/** Where a sign in came from, for the sessions list. Caddy sets X-Forwarded-For. */
export function clientMeta(req: Request) {
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return { ip: fwd || req.ip, userAgent: String(req.headers['user-agent'] ?? '') };
}

class InterestDto {
  @IsString() @Matches(/^[a-z0-9-]{2,40}$/) product: string;
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

@ApiTags('account')
@ApiBearerAuth()
@Controller('v1')
export class AccountController {
  constructor(private readonly iam: IamService, private readonly prisma: PrismaService, private readonly tokenService: TokenService) {}

  /** "Notify me when this launches" for roadmap products shown in the console. */
  @Post('interest') @HttpCode(204)
  async interest(@CurrentActor() actor: Actor, @Body() dto: InterestDto) {
    await this.prisma.productInterest.upsert({
      where: { teamId_product: { teamId: actor.teamId, product: dto.product } },
      create: { teamId: actor.teamId, userId: actor.userId, product: dto.product, note: dto.note },
      update: { note: dto.note },
    });
  }

  /** Team audit trail, newest first (last 200). */
  @Get('audit') @RequireScopes('iam:read')
  async audit(@CurrentActor() actor: Actor) {
    const data = await this.prisma.auditLog.findMany({
      where: { teamId: actor.teamId },
      select: { id: true, at: true, action: true, resource: true, userId: true, tokenId: true, request: true, status: true },
      orderBy: { at: 'desc' },
      take: 200,
    });
    return { data };
  }

  @Get('account')
  me(@CurrentActor() actor: Actor) {
    return this.iam.me(actor);
  }

  /** Console sessions of the signed in user, newest activity first. */
  @Get('account/sessions')
  sessions(@CurrentActor() actor: Actor) {
    return this.tokenService.listSessions(actor.userId, actor.sessionId);
  }

  @Delete('account/sessions/:id') @HttpCode(204)
  revokeSession(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.tokenService.revokeSession(actor.userId, id);
  }

  /** Signs out every other device and browser. */
  @Post('account/sessions/revoke-others') @HttpCode(204)
  revokeOthers(@CurrentActor() actor: Actor) {
    return this.tokenService.revokeAllSessions(actor.userId, actor.sessionId);
  }

  @Get('projects')
  async projects(@CurrentActor() actor: Actor) {
    return { data: await this.iam.listProjects(actor) };
  }

  @Post('projects') @RequireScopes('iam:write')
  createProject(@CurrentActor() actor: Actor, @Body() dto: CreateProjectDto) {
    return this.iam.createProject(actor, dto);
  }

  @Get('tokens') @RequireScopes('iam:read')
  async tokens(@CurrentActor() actor: Actor) {
    return { data: await this.iam.listTokens(actor) };
  }

  @Post('tokens') @RequireScopes('iam:write')
  createToken(@CurrentActor() actor: Actor, @Body() dto: CreateTokenDto) {
    return this.iam.createToken(actor, dto);
  }

  @Delete('tokens/:id') @RequireScopes('iam:write') @HttpCode(204)
  revokeToken(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.iam.revokeToken(actor, id);
  }

  @Get('ssh-keys')
  async sshKeys(@CurrentActor() actor: Actor) {
    return { data: await this.iam.listSshKeys(actor) };
  }

  @Post('ssh-keys')
  createSshKey(@CurrentActor() actor: Actor, @Body() dto: CreateSshKeyDto) {
    return this.iam.createSshKey(actor, dto);
  }

  @Delete('ssh-keys/:id') @HttpCode(204)
  deleteSshKey(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.iam.deleteSshKey(actor, id);
  }
}
