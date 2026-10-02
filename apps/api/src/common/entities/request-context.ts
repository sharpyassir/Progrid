import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';
import { clientIpOf } from '../net/client-ip';

/** The parts of the current HTTP request that decide which public domain a link should use. */
export interface RequestContext {
  /** Host the request arrived at (api.progrid.co), lower case, without the port. */
  host?: string;
  /** Browser Origin header, when sent (https://console.progrid.sa). */
  origin?: string;
  /** Caller's address (X-Real-IP from Caddy). */
  ip?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Express middleware: remembers Host and Origin for the rest of the request. */
export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim().toLowerCase().replace(/:\d+$/, '') || undefined;
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin.replace(/\/+$/, '') : undefined;
  storage.run({ host, origin, ip: clientIpOf(req) || undefined }, () => next());
}

export function currentRequest(): RequestContext | undefined {
  return storage.getStore();
}

/** Runs `fn` as if it handled a request with these headers (tests and jobs). */
export function withRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}
