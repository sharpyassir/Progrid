import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
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
  imports: [EventsModule],
  controllers: [BillingController, PricingController, PaymentsController],
  providers: [FxService, SpendService, MeteringService, RatingService, InvoicesService, PaymentsService, BillingAdminService],
  exports: [FxService, SpendService, MeteringService, RatingService, InvoicesService, PaymentsService, BillingAdminService],
})
export class BillingModule {}
