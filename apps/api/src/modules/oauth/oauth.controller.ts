import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { IsString, Length } from 'class-validator';
import { CurrentActor, Public } from '../../common/auth/decorators';
import type { Actor } from '../../common/auth/actor';
import { clientMeta } from '../iam/iam.controller';
import { BROWSER_COOKIE, OAuthService } from './oauth.service';
import { refFromCookieHeader } from '../affiliates/rules';

class ExchangeDto { @IsString() @Length(20, 200) code: string; }
class TotpDto { @IsString() @Length(20, 200) ticket: string; @IsString() @Length(6, 12) code: string; }

const COOKIE_PATH = '/v1/auth/oauth';

@ApiTags('auth')
@Controller('v1/auth')
export class OAuthController {
  constructor(private readonly oauth: OAuthService) {}

  /** Which social sign in buttons the console shows. */
  @Public() @Get('providers')
  providers() {
    return this.oauth.listProviders();
  }

  /** Signed in: a one time ticket (60 seconds) that lets /start link an account to this user. */
  @ApiBearerAuth() @Post('oauth/link-ticket') @HttpCode(201)
  linkTicket(@CurrentActor() actor: Actor) {
    return this.oauth.linkTicket(actor);
  }

  /** The browser navigates here; answers with a redirect to Google or Microsoft. */
  @Public() @Get('oauth/:provider/start')
  async start(@Param('provider') provider: string, @Query() q: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    // The partner referral: passed by the console, else the prgd_ref cookie the website set on the parent domain.
    const ref = q.ref || refFromCookieHeader(req.headers.cookie);
    const r = await this.oauth.start(provider, { intent: q.intent, return: q.return, invite: q.invite, ticket: q.ticket, locale: q.locale, country: q.country, ref, promo: q.promo });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (r.error) return res.redirect(302, r.error);
    res.cookie(BROWSER_COOKIE, r.browser, { httpOnly: true, secure: true, sameSite: 'lax', path: COOKIE_PATH, maxAge: 600_000 });
    return res.redirect(302, r.url!);
  }

  /** The provider sends the browser back here; answers with a redirect to the console. */
  @Public() @Get('oauth/:provider/callback')
  async callback(@Param('provider') provider: string, @Query() q: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    const url = await this.oauth.callback(provider, { code: q.code, state: q.state, error: q.error }, readCookie(req, BROWSER_COOKIE), clientMeta(req));
    res.clearCookie(BROWSER_COOKIE, { httpOnly: true, secure: true, sameSite: 'lax', path: COOKIE_PATH });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    return res.redirect(302, url);
  }

  /** Redeems the one time code from the console callback page. Same answer as password login. */
  @Public() @Post('oauth/exchange') @HttpCode(200)
  exchange(@Body() dto: ExchangeDto, @Req() req: Request) {
    return this.oauth.exchange(dto.code, clientMeta(req));
  }

  /** Second factor for an account with two factor sign in. */
  @Public() @Post('oauth/totp') @HttpCode(200)
  totp(@Body() dto: TotpDto, @Req() req: Request) {
    return this.oauth.totp(dto.ticket, dto.code, clientMeta(req));
  }
}

@ApiTags('account')
@ApiBearerAuth()
@Controller('v1/account/identities')
export class IdentitiesController {
  constructor(private readonly oauth: OAuthService) {}

  /** Linked Google and Microsoft accounts, and whether a password is set. */
  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.oauth.identities(actor);
  }

  @Delete(':id') @HttpCode(204)
  unlink(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.oauth.unlink(actor, id);
  }
}

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}
