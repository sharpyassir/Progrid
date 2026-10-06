import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { EventsService } from './events.service';
import { WebhooksController } from './webhooks.controller';
import { AuditAdminController } from './audit-admin.controller';
import { AuditMiddleware } from './audit.middleware';

@Module({
  controllers: [WebhooksController, AuditAdminController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule implements NestModule {
  /** Request level audit trail for every route of the app (see AuditMiddleware). */
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuditMiddleware).forRoutes('*');
  }
}
