import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { Public } from '../../../common/auth/decorators';
import { ApiError } from '../../../common/errors/api-error';
import { loadConfig } from '../../../config/config';
import { ManagedAlertsService } from './alerts.service';

/** Constant time comparison that does not leak the length of the secret. */
export function secretMatches(given: string, expected: string | undefined) {
  if (!expected || !given) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function bearer(header?: string) {
  const [scheme, value] = (header ?? '').split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value.trim() : '';
}

/**
 * Receivers for monitoring. Not part of the public API.
 *
 * POST /internal/alerts/alertmanager: Alertmanager webhook. The shared secret
 * ALERTMANAGER_WEBHOOK_SECRET is sent as a Bearer token (http_config.authorization) or as the
 * X-Prgd-Webhook-Secret header. A secret in the query string is refused, so it never lands in
 * access logs.
 *
 * POST /internal/agents/heartbeat: the monitoring agent on an external server, authenticated
 * by its per asset token as a Bearer token.
 */
@ApiExcludeController()
@Controller('internal')
export class ManagedInternalController {
  constructor(private readonly alerts: ManagedAlertsService) {}

  @Public() @Post('alerts/alertmanager') @HttpCode(200)
  alertmanager(@Req() req: Request, @Body() body: unknown, @Headers('authorization') auth?: string, @Headers('x-prgd-webhook-secret') header?: string) {
    if (Object.keys(req.query ?? {}).some((k) => /secret|token/i.test(k))) throw ApiError.invalid('Send the webhook secret in a header, never in the query string');
    const given = bearer(auth) || header || '';
    if (!secretMatches(given, loadConfig().ALERTMANAGER_WEBHOOK_SECRET)) throw ApiError.unauthorized('Bad webhook secret');
    return this.alerts.ingest(body);
  }

  @Public() @Post('agents/heartbeat') @HttpCode(200)
  heartbeat(@Body() body: unknown, @Headers('authorization') auth?: string) {
    const token = bearer(auth);
    if (!token) throw ApiError.unauthorized('Send the heartbeat token as a Bearer token');
    return this.alerts.heartbeat(token, body);
  }
}
