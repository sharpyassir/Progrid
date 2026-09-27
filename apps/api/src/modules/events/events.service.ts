import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { assertSafeUrl } from '../../common/net/safe-url';
import { open } from '../../common/crypto/secretbox';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NatsService, Subjects } from '../../common/nats/nats.service';
import type { Actor } from '../../common/auth/actor';

/** Public event names customers can subscribe to via webhooks. */
export const CUSTOMER_EVENTS = [
  'database.created', 'database.updated', 'database.deleted', 'database.failover', 'database.backup_completed', 'database.backup_failed',
  'bucket.created', 'bucket.deleted', 'storage_key.created', 'storage_key.revoked',
  'domain.created', 'domain.deleted', 'domain.record_changed',
  'load_balancer.created', 'load_balancer.updated', 'load_balancer.deleted', 'load_balancer.target_unhealthy', 'load_balancer.target_healthy',
  'volume.created', 'volume.attached', 'volume.detached', 'volume.resized', 'volume.deleted',
  'server.created', 'server.active', 'server.failed', 'server.deleted', 'server.resized',
  'app.created', 'app.deployed', 'app.deploy_failed', 'app.deleted', 'app.stopped', 'app.started', 'app.domain_added',
  'kubernetes.created', 'kubernetes.updated', 'kubernetes.deleted', 'kubernetes.failed', 'kubernetes.pool_added', 'kubernetes.pool_scaled', 'kubernetes.pool_removed', 'kubernetes.cloud_updated',
  'ticket.opened', 'ticket.replied', 'ticket.answered', 'ticket.closed', 'support.plan_changed',
  'server.managed_enabled', 'server.managed_disabled', 'server.managed_warning', 'server.managed_recovered',
  'snapshot.completed', 'invoice.issued', 'invoice.paid', 'payment.failed',
  'spend.alert', 'spend.limit_reached', 'account.suspended',
  'approval.requested', 'approval.decided',
  'payment.started', 'payment.succeeded',
  'alert.triggered', 'alert.resolved',
] as const;

export type EventName = (typeof CUSTOMER_EVENTS)[number] | (string & {});

interface EmitContext {
  teamId?: string;
  actor?: Actor;
  resource?: string;
}

/**
 * Single place every domain event goes through:
 *  1. audit log row
 *  2. internal NATS fan-out (`pgcloud.events.<name>`) for other modules / AI ops
 *  3. queued webhook deliveries for customer-facing events
 */
@Injectable()
export class EventsService {
  private readonly log = new Logger(EventsService.name);

  constructor(private readonly prisma: PrismaService, private readonly nats: NatsService) {}

  async emit(name: EventName, payload: Record<string, unknown>, ctx: EmitContext = {}) {
    const teamId = ctx.teamId ?? ctx.actor?.teamId;
    this.log.debug(`${name} ${JSON.stringify(payload)}`);

    await this.prisma.auditLog.create({
      data: {
        teamId,
        userId: ctx.actor?.userId,
        tokenId: ctx.actor?.tokenId,
        action: name,
        resource: ctx.resource,
        request: payload as Prisma.InputJsonValue,
        status: 200,
      },
    });

    this.nats.publish(Subjects.event(name), { name, teamId, payload, at: new Date().toISOString() });

    if (teamId && (CUSTOMER_EVENTS as readonly string[]).includes(name)) {
      const hooks = await this.prisma.webhook.findMany({ where: { teamId, active: true, events: { has: name } } });
      if (hooks.length) {
        await this.prisma.webhookDelivery.createMany({
          data: hooks.map((h) => ({ webhookId: h.id, event: name, payload: payload as Prisma.InputJsonValue, nextAttemptAt: new Date() })),
        });
      }
    }
  }

  /** Delivers queued webhooks. Called by the scheduler every 10s; retries with backoff. */
  async deliverPending(batch = 50) {
    const due = await this.prisma.webhookDelivery.findMany({
      where: { deliveredAt: null, nextAttemptAt: { lte: new Date() }, attempts: { lt: 8 } },
      include: { webhook: true },
      take: batch,
    });
    for (const d of due) {
      const body = JSON.stringify({ id: d.id, event: d.event, created_at: d.createdAt, data: d.payload });
      // The signature covers a timestamp so a captured delivery cannot be replayed later.
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = createHmac('sha256', open(d.webhook.secret)).update(`${timestamp}.${body}`).digest('hex');
      let status: number | undefined;
      try {
        // Re-check the destination on every delivery; DNS can change after registration.
        await assertSafeUrl(d.webhook.url);
        const res = await fetch(d.webhook.url, {
          method: 'POST',
          redirect: 'manual',
          headers: { 'content-type': 'application/json', 'x-pgcloud-signature': `t=${timestamp},v1=${signature}`, 'x-pgcloud-timestamp': timestamp, 'x-pgcloud-event': d.event },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        status = res.status;
      } catch {
        status = 0;
      }
      const ok = status >= 200 && status < 300;
      await this.prisma.webhookDelivery.update({
        where: { id: d.id },
        data: {
          attempts: { increment: 1 },
          lastStatus: status,
          deliveredAt: ok ? new Date() : null,
          nextAttemptAt: ok ? null : new Date(Date.now() + Math.min(2 ** d.attempts * 30_000, 6 * 3600_000)),
        },
      });
    }
    return due.length;
  }
}
