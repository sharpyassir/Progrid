import { Module } from '@nestjs/common';
import { TrustModule } from '../trust/trust.module';
import { ComputeModule } from '../compute/compute.module';
import { NetworkModule } from '../network/network.module';
import { EventsModule } from '../events/events.module';
import { BillingModule } from '../billing/billing.module';
import { ObjectsModule } from '../storage/objects/objects.module';
import { DatabasesController } from './db.controller';
import { DatabasesService } from './db.service';

@Module({
  imports: [TrustModule, ComputeModule, NetworkModule, EventsModule, BillingModule, ObjectsModule],
  controllers: [DatabasesController],
  providers: [DatabasesService],
  exports: [DatabasesService],
})
export class DatabasesModule {}
