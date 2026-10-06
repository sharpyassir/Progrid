import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { PrivacyController } from './privacy.controller';
import { PrivacyService } from './privacy.service';

/** Account deletion and other data subject requests (IamModule is global for AccountSecurityService). */
@Module({
  imports: [EventsModule],
  controllers: [PrivacyController],
  providers: [PrivacyService],
  exports: [PrivacyService],
})
export class PrivacyModule {}
