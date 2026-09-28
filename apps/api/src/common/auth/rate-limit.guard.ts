import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request, Response } from 'express';
import { RedisService } from '../redis/redis.service';
import type { Actor } from './actor';

/**
 * Fixed window rate limits, enforced after authentication so we can key by token.
 *   public auth endpoints: per IP, tight (credential stuffing, signup spam)
 *   authenticated:         per token or session, generous
 *   other anonymous:       per IP, moderate
 * Degrades open when Redis is unavailable (RedisService.allow returns true).
 */
const RULES: { test: RegExp; limit: number; windowSec: number }[] = [
  { test: /^\/v1\/auth\/login$/, limit: 10, windowSec: 60 },
  { test: /^\/v1\/auth\/signup$/, limit: 5, windowSec: 600 },
  { test: /^\/v1\/auth\/password\/forgot$/, limit: 5, windowSec: 600 },
  { test: /^\/v1\/auth\/(verify|password\/reset|totp\/verify)$/, limit: 20, windowSec: 600 },
  { test: /^\/v1\/auth\/oauth\/(exchange|totp)$/, limit: 20, windowSec: 600 },
  { test: /^\/v1\/auth\/oauth\/[a-z]+\/(start|callback)$/, limit: 30, windowSec: 60 },
  { test: /^\/v1\/deploys\/[^/]+\/hook$/, limit: 120, windowSec: 60 },
  { test: /^\/ops\/v1\/auth\/login$/, limit: 10, windowSec: 60 },
  { test: /^\/ops\/v1\/auth\/(totp|totp\/enable|webauthn\/authenticate\/verify|password\/forgot|password\/reset)$/, limit: 20, windowSec: 600 },
];
const AUTHED = { limit: 600, windowSec: 60 };
const ANON = { limit: 120, windowSec: 60 };

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly redis: RedisService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { actor?: Actor }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim() || req.ip || 'unknown';

    const rule = RULES.find((r) => r.test.test(req.path));
    let key: string, limit: number, windowSec: number;
    if (rule) ({ limit, windowSec } = rule), (key = `ip:${ip}:${req.path}`);
    else if (req.actor) ({ limit, windowSec } = AUTHED), (key = `actor:${req.actor.tokenId ?? req.actor.userId}`);
    else ({ limit, windowSec } = ANON), (key = `ip:${ip}`);

    const allowed = await this.redis.allow(key, limit, windowSec);
    res.setHeader('X-RateLimit-Limit', String(limit));
    if (!allowed) {
      res.setHeader('Retry-After', String(windowSec));
      throw new HttpException({ code: 'rate_limited', message: `Too many requests. Try again in ${windowSec} seconds.` }, HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
