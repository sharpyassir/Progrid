import { LegalModule } from '../legal/legal.module';
import { Global, Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { AccountController, AuthController } from './iam.controller';
import { AccountSecurityController } from './account-security.controller';
import { AccountSecurityService } from './account-security.service';
import { IamService } from './iam.service';
import { TokenService } from './token.service';

@Global()
@Module({
  imports: [LegalModule, EventsModule],
  controllers: [AuthController, AccountController, AccountSecurityController],
  providers: [IamService, TokenService, AccountSecurityService],
  exports: [IamService, TokenService, AccountSecurityService],
})
export class IamModule {}
