import { Module } from '@nestjs/common';
import { PrismaModule } from './common/prisma/prisma.module';
import { NatsModule } from './common/nats/nats.module';
import { RedisModule } from './common/redis/redis.module';
import { DriversModule } from './drivers/drivers.module';
import { EventsModule } from './modules/events/events.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { NetworkModule } from './modules/network/network.module';
import { BillingModule } from './modules/billing/billing.module';
import { IamModule } from './modules/iam/iam.module';
import { MailModule } from './common/mail/mail.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { TemporalModule } from './common/temporal/temporal.module';
import { LbModule } from './modules/lb/lb.module';
import { DatabasesModule } from './modules/databases/db.module';
import { KubernetesModule } from './modules/kubernetes/k8s.module';
import { AppPlatformModule } from './modules/app-platform/app.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { ManagedModule } from './modules/managed/managed.module';
import { OpsSettingsModule } from './modules/ops/settings/ops-settings.service';

/** Dependency graph for the worker process: no HTTP, no controllers. */
@Module({
  imports: [PrismaModule, NatsModule, RedisModule, MailModule, DriversModule, IamModule, EventsModule, SchedulerModule, NetworkModule, BillingModule, MonitoringModule, TemporalModule, ApprovalsModule, LbModule, DatabasesModule, KubernetesModule, AppPlatformModule, OpsSettingsModule, ManagedModule],
})
export class WorkerModule {}
