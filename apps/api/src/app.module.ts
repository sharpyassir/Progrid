import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from './common/prisma/prisma.module';
import { NatsModule } from './common/nats/nats.module';
import { RedisModule } from './common/redis/redis.module';
import { TemporalModule } from './common/temporal/temporal.module';
import { DriversModule } from './drivers/drivers.module';
import { AuthGuard } from './common/auth/auth.guard';
import { RateLimitGuard } from './common/auth/rate-limit.guard';
import { MailModule } from './common/mail/mail.module';
import { ApiExceptionFilter } from './common/errors/http-exception.filter';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.interceptor';
import { IamModule } from './modules/iam/iam.module';
import { EventsModule } from './modules/events/events.module';
import { ComputeModule } from './modules/compute/compute.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { NetworkModule } from './modules/network/network.module';
import { StorageModule } from './modules/storage/storage.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { BillingModule } from './modules/billing/billing.module';
import { TrustModule } from './modules/trust/trust.module';
import { AdminModule } from './modules/admin/admin.module';
import { DeployModule } from './modules/deploy/deploy.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { GithubModule } from './modules/github/github.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { LbModule } from './modules/lb/lb.module';
import { DnsModule } from './modules/dns/dns.module';
import { ObjectsModule } from './modules/storage/objects/objects.module';
import { DatabasesModule } from './modules/databases/db.module';
import { SupportModule } from './modules/support/support.module';
import { KubernetesModule } from './modules/kubernetes/k8s.module';
import { AppPlatformModule } from './modules/app-platform/app.module';
import { TeamModule } from './modules/team/team.module';
import { ManagedModule } from './modules/managed/managed.module';
import { OpsSettingsModule } from './modules/ops/settings/ops-settings.service';
import { OpsModule } from './modules/ops/ops.module';
import { OAuthModule } from './modules/oauth/oauth.module';
import { ConnectModule } from './modules/connect/connect.module';
import { JobsModule } from './jobs/jobs.module';
import { HealthController } from './health.controller';

/** The modular monolith. One module per bounded context (docs/adr/0001). */
@Module({
  imports: [
    // infrastructure
    PrismaModule, NatsModule, RedisModule, TemporalModule, DriversModule, MailModule,
    // domain
    IamModule,
    ApprovalsModule, EventsModule, ComputeModule, SchedulerModule, NetworkModule, StorageModule, MarketplaceModule, BillingModule, TrustModule, AdminModule, DeployModule, GithubModule, MonitoringModule, LbModule, DnsModule, ObjectsModule, DatabasesModule,
    SupportModule, KubernetesModule, AppPlatformModule, TeamModule, OpsSettingsModule, ManagedModule, OpsModule,
    OAuthModule, ConnectModule,
    // background
    JobsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard }, // after AuthGuard so limits can key by token
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
