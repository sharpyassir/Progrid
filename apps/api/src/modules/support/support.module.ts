import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { BillingModule } from '../billing/billing.module';
import { MailModule } from '../../common/mail/mail.module';
import { AdminSupportController, SupportController } from './support.controller';
import { SupportService } from './support.service';
import { ResendInboundService } from './resend-inbound.service';

@Module({
  imports: [EventsModule, BillingModule, MailModule],
  controllers: [SupportController, AdminSupportController],
  providers: [SupportService, ResendInboundService],
  exports: [SupportService],
})
export class SupportModule {}
