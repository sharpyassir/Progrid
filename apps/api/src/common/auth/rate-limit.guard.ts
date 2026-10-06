import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { RedisService } from '../redis/redis.service';
import { clientIpOf } from '../net/client-ip';
import type { Actor } from './actor';

/**
 * Fixed window rate limits, enforced after authentication so we can key by token.
 *   public auth endpoints: per IP, tight (credential stuffing, signup spam); sign in and
 *                          password reset also per email address, against attacks spread over many IPs
 *   authenticated:         per token or session, generous
 *   other anonymous:       per IP, moderate
 * Without Redis the sign in, signup, reset, TOTP and OAuth endpoints fail closed (503
 * auth_unavailable): brute force protection must not silently switch off. Everything else
 * degrades open so an outage of Redis does not take the API down.
 */
type Rule = { test: RegExp; limit: number; windowSec: number; auth?: true; perEmail?: { limit: number; windowSec: number } };
const RULES: Rule[] = [
  { test: /^\/v1\/auth\/login$/, limit: 10, windowSec: 60, auth: true, perEmail: { limit: 20, windowSec: 600 } },
  { test: /^\/v1\/auth\/signup$/, limit: 5, windowSec: 600, auth: true },
  { test: /^\/v1\/auth\/password\/forgot$/, limit: 5, windowSec: 600, auth: true, perEmail: { limit: 5, windowSec: 3600 } },
  { test: /^\/v1\/auth\/(verify|password\/reset|totp\/verify)$/, limit: 20, windowSec: 600, auth: true },
  { test: /^\/v1\/auth\/oauth\/(exchange|totp)$/, limit: 20, windowSec: 600, auth: true },
  { test: /^\/v1\/auth\/oauth\/[a-z]+\/(start|callback)$/, limit: 30, windowSec: 60, auth: true },
  { test: /^\/v1\/deploys\/[^/]+\/hook$/, limit: 120, windowSec: 60 },
  { test: /^\/v1\/affiliates\/clicks$/, limit: 30, windowSec: 60 },
  { test: /^\/v1\/affiliates\/codes\/[^/]+$/, limit: 30, windowSec: 60 },
  { test: /^\/v1\/billing\/promo-code$/, limit: 10, windowSec: 600 },
  { test: /^\/v1\/affiliates\/apply$/, limit: 5, windowSec: 3600 },
  { test: /^\/ops\/v1\/auth\/login$/, limit: 10, windowSec: 60, auth: true, perEmail: { limit: 20, windowSec: 600 } },
  { test: /^\/ops\/v1\/auth\/password\/forgot$/, limit: 20, windowSec: 600, auth: true, perEmail: { limit: 5, windowSec: 3600 } },
  { test: /^\/ops\/v1\/auth\/(totp|totp\/setup|totp\/enable|webauthn\/(register|authenticate)\/(options|verify)|password\/reset)$/, limit: 20, windowSec: 600, auth: true },
];
const AUTHED = { limit: 600, windowSec: 60 };
const ANON = { limit: 120, windowSec: 60 };

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly log = new Logger(RateLimitGuard.name);
  constructor(private readonly redis: RedisService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request & { actor?: Actor }>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const ip = clientIpOf(req) || 'unknown';

    const rule = RULES.find((r) => r.test.test(req.path));
    const checks: { key: string; limit: number; windowSec: number }[] = [];
    if (rule) {
      checks.push({ key: `ip:${ip}:${req.path}`, limit: rule.limit, windowSec: rule.windowSec });
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      // Keyed by a hash so addresses people typed (or pasted passwords) never sit in Redis.
      if (rule.perEmail && email) checks.push({ key: `email:${createHash('sha256').update(email).digest('hex').slice(0, 32)}:${req.path}`, ...rule.perEmail });
    } else if (req.actor) checks.push({ key: `actor:${req.actor.tokenId ?? req.actor.userId}`, ...AUTHED });
    else checks.push({ key: `ip:${ip}`, ...ANON });

    res.setHeader('X-RateLimit-Limit', String(checks[0].limit));
    for (const c of checks) {
      let allowed: boolean;
      if (rule?.auth) {
        try {
          allowed = await this.redis.allowStrict(c.key, c.limit, c.windowSec);
        } catch (err) {
          this.log.error(`rate limit store unavailable, refusing ${req.path}: ${(err as Error).message}`);
          res.setHeader('Retry-After', '30');
          throw new HttpException({ code: 'auth_unavailable', message: 'Sign in is temporarily unavailable. Try again in a minute.' }, HttpStatus.SERVICE_UNAVAILABLE);
        }
      } else allowed = await this.redis.allow(c.key, c.limit, c.windowSec);
      if (!allowed) {
        res.setHeader('Retry-After', String(c.windowSec));
        throw new HttpException({ code: 'rate_limited', message: `Too many requests. Try again in ${c.windowSec} seconds.` }, HttpStatus.TOO_MANY_REQUESTS);
      }
    }
    return true;
  }
}
