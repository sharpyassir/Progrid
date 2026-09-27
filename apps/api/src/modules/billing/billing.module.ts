import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { TrustModule } from '../trust/trust.module';
import { DunningService } from './dunning.service';
import { BillingController, PricingController } from './billing.controller';
import { InvoicesService } from './invoices.service';
import { MeteringService } from './metering.service';
import { RatingService } from './rating.service';
import { SpendService } from './spend.service';
import { FxService } from './fx.service';
import { PaymentsService } from './payments/payments.service';
import { PaymentsController } from './payments/payments.controller';
import { BillingAdminService } from './billing-admin.service';

@Module({
  imports: [EventsModule, TrustModule],
  controllers: [BillingController, PricingController, PaymentsController],
  providers: [FxService, SpendService, MeteringService, RatingService, InvoicesService, PaymentsService, BillingAdminService, DunningService],
  exports: [FxService, SpendService, MeteringService, RatingService, InvoicesService, PaymentsService, BillingAdminService, DunningService],
})
export class BillingModule {}
