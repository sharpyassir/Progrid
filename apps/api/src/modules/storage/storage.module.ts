import { Module } from '@nestjs/common';
import { TrustModule } from '../trust/trust.module';
import { EventsModule } from '../events/events.module';
import { SnapshotsController } from './snapshots.controller';
import { VolumesController } from './volumes.controller';
import { VolumesService } from './volumes.service';
import { BackupsService } from './backups.service';
import { BillingModule } from '../billing/billing.module';

@Module({ imports: [TrustModule, EventsModule, BillingModule], controllers: [SnapshotsController, VolumesController], providers: [VolumesService, BackupsService], exports: [VolumesService, BackupsService] })
export class StorageModule {}
