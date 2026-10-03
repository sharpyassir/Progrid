import { LegalModule } from '../legal/legal.module';
import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { ComputeModule } from '../compute/compute.module';
import { DatabasesModule } from '../databases/db.module';
import { KubernetesModule } from '../kubernetes/k8s.module';
import { AppPlatformModule } from '../app-platform/app.module';
import { LbModule } from '../lb/lb.module';
import { StorageModule } from '../storage/storage.module';
import { ObjectsModule } from '../storage/objects/objects.module';
import { DnsModule } from '../dns/dns.module';
import { NetworkModule } from '../network/network.module';
import { MonitoringModule } from '../monitoring/monitoring.module';
import { InvitationsController, TeamController } from './team.controller';
import { TeamService } from './team.service';

@Module({
  imports: [LegalModule, EventsModule, ComputeModule, DatabasesModule, KubernetesModule, AppPlatformModule, LbModule, StorageModule, ObjectsModule, DnsModule, NetworkModule, MonitoringModule],
  controllers: [TeamController, InvitationsController],
  providers: [TeamService],
  exports: [TeamService],
})
export class TeamModule {}
