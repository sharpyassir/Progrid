import { Global, Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { AttributionService } from './attribution.service';
import { AffiliateSettingsService } from './settings';
import { TrackingController } from './tracking.controller';

/** Affiliate program (docs/affiliates.md). Global so signup (iam, oauth) and billing can attribute and pay commission. */
@Global()
@Module({
  imports: [EventsModule],
  controllers: [TrackingController],
  providers: [AttributionService, AffiliateSettingsService],
  exports: [AttributionService, AffiliateSettingsService],
})
export class AffiliatesModule {}
