import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { IsEmail, IsObject, IsOptional, IsString, Length } from 'class-validator';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { CurrentActor, Public } from '../../../common/auth/decorators';
import type { Actor } from '../../../common/auth/actor';
import { ApiError } from '../../../common/errors/api-error';
import { clientOf, OPS_SESSION_COOKIE } from '../../../common/auth/auth.guard';
import { loadConfig } from '../../../config/config';
import { TokenService } from '../../iam/token.service';
import { AccountSecurityService } from '../../iam/account-security.service';
import { OpsAuthService } from './ops-auth.service';

class LoginDto {
  @IsEmail() email: string;
  @IsString() @Length(1, 200) password: string;
}
class ChallengeDto {
  /** The token POST /ops/v1/auth/login returned. */
  @IsString() challenge: string;
}
class OptionalChallengeDto {
  /** Sign in challenge, for enrolling the first second factor. Omit when calling with an ops session. */
  @IsOptional() @IsString() challenge?: string;
}
class TotpDto extends ChallengeDto {
  @IsString() @Length(6, 20) code: string;
}
class TotpEnableDto extends OptionalChallengeDto {
  @IsString() @Length(6, 20) code: string;
}
class WebAuthnRegisterDto extends OptionalChallengeDto {
  /** The browser's RegistrationResponseJSON (from @simplewebauthn/browser startRegistration). */
  @IsObject() response: RegistrationResponseJSON;
  @IsOptional() @IsString() @Length(1, 80) name?: string;
}
class WebAuthnAuthDto extends ChallengeDto {
  /** The browser's AuthenticationResponseJSON (from @simplewebauthn/browser startAuthentication). */
  @IsObject() response: AuthenticationResponseJSON;
}
class ForgotDto {
  @IsEmail() email: string;
}
class ResetDto {
  @IsString() token: string;
  @IsString() @Length(10, 200) password: string;
}

/**
 * Ops console sign in, /ops/v1/auth. The flow and every payload are in docs/devops-console.md.
 * A successful second factor answers `{session, expiresAt, user, engineer}` and also sets the
 * HttpOnly `prgd_ops_session` cookie (used only for GET requests such as the maintenance log
 * stream). API tokens and console sessions are not accepted anywhere under /ops/v1.
 */
@ApiTags('ops')
@ApiBearerAuth()
@Controller('ops/v1/auth')
export class OpsAuthController {
  constructor(private readonly auth: OpsAuthService, private readonly tokens: TokenService, private readonly security: AccountSecurityService) {}

  @Public() @Post('login') @HttpCode(200)
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto.email, dto.password, clientOf(req));
  }

  @Public() @Post('totp') @HttpCode(200)
  async totp(@Body() dto: TotpDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return withCookie(res, await this.auth.loginTotp(dto.challenge, dto.code, clientOf(req)));
  }

  @Public() @Post('totp/setup') @HttpCode(200)
  async totpSetup(@Body() dto: OptionalChallengeDto, @Req() req: Request) {
    return this.auth.totpSetup(await this.who(dto, req), clientOf(req));
  }

  @Public() @Post('totp/enable') @HttpCode(200)
  async totpEnable(@Body() dto: TotpEnableDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return withCookie(res, await this.auth.totpEnable(await this.who(dto, req), dto.code, clientOf(req)));
  }

  @Public() @Post('webauthn/register/options') @HttpCode(200)
  async registerOptions(@Body() dto: OptionalChallengeDto, @Req() req: Request) {
    return this.auth.webauthnRegisterOptions(await this.who(dto, req), clientOf(req));
  }

  @Public() @Post('webauthn/register/verify') @HttpCode(200)
  async registerVerify(@Body() dto: WebAuthnRegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return withCookie(res, await this.auth.webauthnRegisterVerify(await this.who(dto, req), dto.response, dto.name ?? 'Security key', clientOf(req)));
  }

  @Public() @Post('webauthn/authenticate/options') @HttpCode(200)
  authOptions(@Body() dto: ChallengeDto, @Req() req: Request) {
    return this.auth.webauthnAuthOptions(dto.challenge, clientOf(req));
  }

  @Public() @Post('webauthn/authenticate/verify') @HttpCode(200)
  async authVerify(@Body() dto: WebAuthnAuthDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return withCookie(res, await this.auth.webauthnAuthVerify(dto.challenge, dto.response, clientOf(req)));
  }

  @Public() @Post('password/forgot') @HttpCode(200)
  forgot(@Body() dto: ForgotDto) {
    return this.auth.forgotPassword(dto.email);
  }

  @Public() @Post('password/reset') @HttpCode(200)
  reset(@Body() dto: ResetDto) {
    return this.security.resetPassword(dto.token, dto.password);
  }

  /** Second factors of the signed in engineer. */
  @Get('credentials')
  credentials(@CurrentActor() actor: Actor) {
    return this.auth.credentials(actor.userId);
  }

  @Delete('webauthn/credentials/:id')
  removeCredential(@CurrentActor() actor: Actor, @Param('id') id: string, @Req() req: Request) {
    return this.auth.removeCredential(actor.userId, id, clientOf(req));
  }

  @Post('logout') @HttpCode(204)
  async logout(@CurrentActor() actor: Actor, @Res({ passthrough: true }) res: Response) {
    if (actor.sessionId) await this.auth.logout(actor.userId, actor.sessionId);
    res.clearCookie(OPS_SESSION_COOKIE, { path: '/ops' });
  }

  /** Enrollment runs with a sign in challenge, or from an ops session (Bearer). */
  private async who(dto: { challenge?: string }, req: Request) {
    if (dto.challenge) return { challenge: dto.challenge };
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    const session = scheme?.toLowerCase() === 'bearer' && token ? await this.tokens.resolveOpsSession(token) : null;
    if (!session) throw ApiError.unauthorized('Pass the sign in challenge or an ops session');
    return { userId: session.userId };
  }
}

function withCookie<T extends object>(res: Response, body: T): T {
  const b = body as { session?: string; expiresAt?: Date };
  if (b.session && b.expiresAt) {
    res.cookie(OPS_SESSION_COOKIE, b.session, {
      httpOnly: true,
      secure: loadConfig().PRGD_OPS_URL.startsWith('https://'),
      sameSite: 'lax',
      path: '/ops',
      expires: b.expiresAt,
    });
  }
  return body;
}
