import { LegalModule } from '../legal/legal.module';
import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { TeamModule } from '../team/team.module';
import { IdentitiesController, OAuthController } from './oauth.controller';
import { OAuthService } from './oauth.service';
import { OAuthStore } from './oauth.store';
import { OidcProviders } from './providers';

/** Sign in and sign up with Google and Microsoft (docs/social-sign-in.md). */
@Module({
  imports: [EventsModule, TeamModule, LegalModule],
  controllers: [OAuthController, IdentitiesController],
  providers: [OAuthService, OAuthStore, OidcProviders],
  exports: [OidcProviders],
})
export class OAuthModule {}
