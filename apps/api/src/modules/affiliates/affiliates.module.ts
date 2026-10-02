import { Global, Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { AttributionService } from './attribution.service';
import { AffiliateSettingsService } from './settings';
import { TrackingController } from './tracking.controller';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';
import { AffiliateMailer } from './mailer';
import { CommissionService } from './commission.service';

/** Affiliate program (docs/affiliates.md). Global so signup (iam, oauth) and billing can attribute and pay commission. */
@Global()
@Module({
  imports: [EventsModule],
  controllers: [TrackingController, PortalController],
  providers: [AttributionService, AffiliateSettingsService, PortalService, AffiliateMailer, CommissionService],
  exports: [AttributionService, AffiliateSettingsService, PortalService, AffiliateMailer, CommissionService],
})
export class AffiliatesModule {}
