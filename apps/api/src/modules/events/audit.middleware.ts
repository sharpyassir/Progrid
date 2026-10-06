import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { clientIpOf } from '../../common/net/client-ip';
import type { Actor } from '../../common/auth/actor';
import { EventsService } from './events.service';

const PREFIXES = ['/v1/', '/admin/v1/', '/ops/v1/'];
/** Noise that says nothing about who changed what: activity pings of the ops console. */
const SKIP = [/^\/ops\/v1\/activity$/];

/** True when the request is recorded: every change under the APIs, and staff reads under /admin/v1. */
export function auditable(method: string, path: string): boolean {
  const p = path.endsWith('/') ? path : `${path}/`;
  if (!PREFIXES.some((x) => p.startsWith(x))) return false;
  if (SKIP.some((r) => r.test(path))) return false;
  const m = method.toUpperCase();
  if (m === 'OPTIONS') return false;
  if (m === 'GET' || m === 'HEAD') return p.startsWith('/admin/v1/') && m === 'GET';
  return true;
}

/**
 * Request level audit trail (ISO 27001 A.8.15): one row per state changing call under /v1,
 * /admin/v1 and /ops/v1, and per staff read under /admin/v1, with the actor, the route pattern,
 * the path parameters (resource ids), the status code, client address, user agent and duration.
 * Bodies are never recorded (passwords, tokens, customer secrets).
 *
 * A middleware rather than an interceptor so requests refused by the guards (401, 403, 428) and
 * by validation are recorded too; the row is written when the response has finished. Handlers
 * still emit their domain events (`server.created`...); this row is the request record next to
 * it, with action `http.<METHOD> <route>`.
 */
@Injectable()
export class AuditMiddleware implements NestMiddleware {
  private readonly log = new Logger('audit');

  constructor(private readonly events: EventsService) {}

  use(req: Request & { actor?: Actor }, res: Response, next: NextFunction) {
    const path = (req.originalUrl ?? req.url).split('?')[0];
    if (!auditable(req.method, path)) return next();
    const started = process.hrtime.bigint();
    let done = false;
    const record = (aborted: boolean) => {
      if (done) return;
      done = true;
      const actor = req.actor;
      const route = (req.route as { path?: string } | undefined)?.path;
      const params = Object.fromEntries(Object.entries(req.params ?? {}).map(([k, v]) => [k, String(v).slice(0, 200)]));
      const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
      void this.events
        .audit({
          teamId: actor?.teamId || null,
          userId: actor && actor.userId !== 'system' ? actor.userId : null,
          tokenId: actor?.tokenId ?? null,
          action: `http.${req.method.toUpperCase()} ${route ?? path}`.slice(0, 300),
          resource: null,
          ip: (actor?.ip ?? clientIpOf(req))?.slice(0, 64) ?? null,
          userAgent: (actor?.userAgent ?? req.headers['user-agent'])?.slice(0, 300) ?? null,
          request: {
            method: req.method.toUpperCase(),
            path: path.slice(0, 500),
            route: route ?? null,
            params,
            durationMs,
            ...(aborted ? { aborted: true } : {}),
            actor: actor ? { isAgent: actor.isAgent, staff: [...actor.scopes].some((s) => s === 'admin' || s.startsWith('admin:')), audience: actor.audience ?? 'console', sessionId: actor.sessionId ?? null } : null,
          },
          status: aborted && !res.headersSent ? 499 : res.statusCode,
        })
        .catch((e) => this.log.error(`audit row for ${req.method} ${path} not written: ${(e as Error).message}`));
    };
    res.on('finish', () => record(false));
    res.on('close', () => record(!res.writableFinished));
    next();
  }
}
