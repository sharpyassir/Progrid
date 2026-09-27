import { Module } from '@nestjs/common';
import { ComputeModule } from '../compute/compute.module';
import { NetworkModule } from '../network/network.module';
import { EventsModule } from '../events/events.module';
import { BillingModule } from '../billing/billing.module';
import { LbModule } from '../lb/lb.module';
import { StorageModule } from '../storage/storage.module';
import { ObjectsModule } from '../storage/objects/objects.module';
import { KubernetesController } from './k8s.controller';
import { KubernetesService } from './k8s.service';

@Module({
  imports: [ComputeModule, NetworkModule, EventsModule, BillingModule, LbModule, StorageModule, ObjectsModule],
  controllers: [KubernetesController],
  providers: [KubernetesService],
  exports: [KubernetesService],
})
export class KubernetesModule {}
