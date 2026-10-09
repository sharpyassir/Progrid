import { Module, forwardRef } from '@nestjs/common';
import { TrustModule } from '../trust/trust.module';
import { EventsModule } from '../events/events.module';
import { BillingModule } from '../billing/billing.module';
import { NetworkModule } from '../network/network.module';
import { GithubModule } from '../github/github.module';
import { DatabasesModule } from '../databases/db.module';
import { AdminAppPlatformController, AppPlatformController } from './app.controller';
import { AppPlatformService } from './app.service';

@Module({
  imports: [TrustModule, EventsModule, BillingModule, NetworkModule, DatabasesModule, forwardRef(() => GithubModule)],
  controllers: [AppPlatformController, AdminAppPlatformController],
  providers: [AppPlatformService],
  exports: [AppPlatformService],
})
export class AppPlatformModule {}
