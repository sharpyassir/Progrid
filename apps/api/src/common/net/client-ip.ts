import type { Request } from 'express';

/**
 * The caller's address. In production only Caddy reaches the API, and it sets X-Real-IP and
 * X-Forwarded-For to the address it saw (it ignores what the client sent, since no proxy in
 * front of it is trusted). Without them (development) the socket address is used.
 */
export function clientIpOf(req: Pick<Request, 'headers' | 'ip'>): string {
  const real = String(req.headers['x-real-ip'] ?? '').trim();
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return real || fwd || req.ip || '';
}
