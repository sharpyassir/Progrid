import { MonitoringModule } from '../modules/monitoring/monitoring.module';
import { LbModule } from '../modules/lb/lb.module';
import { DnsModule } from '../modules/dns/dns.module';
import { ObjectsModule } from '../modules/storage/objects/objects.module';
import { StorageModule } from '../modules/storage/storage.module';
import { DatabasesModule } from '../modules/databases/db.module';
import { KubernetesModule } from '../modules/kubernetes/k8s.module';
import { AppPlatformModule } from '../modules/app-platform/app.module';
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { BillingModule } from '../modules/billing/billing.module';
import { EventsModule } from '../modules/events/events.module';
import { TeamModule } from '../modules/team/team.module';
import { JobsService } from './jobs.service';

@Module({ imports: [MonitoringModule, LbModule, DnsModule, ObjectsModule, StorageModule, DatabasesModule, KubernetesModule, AppPlatformModule, ScheduleModule.forRoot(), BillingModule, EventsModule, TeamModule], providers: [JobsService] })
export class JobsModule {}
