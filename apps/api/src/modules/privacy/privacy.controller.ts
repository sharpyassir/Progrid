import { Body, Controller, Delete, HttpCode } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentActor } from '../../common/auth/decorators';
import type { Actor } from '../../common/auth/actor';
import { PrivacyService } from './privacy.service';

class DeleteAccountDto {
  @IsOptional() @IsString() @MaxLength(256) password?: string;
  @IsOptional() @IsString() @MaxLength(64) totp?: string;
}

@ApiTags('account')
@ApiBearerAuth()
@Controller('v1/account')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  /** Deletes (anonymises) the signed in user's account. Needs the password (or a fresh sign in) and the TOTP code when enabled. */
  @Delete() @HttpCode(200)
  remove(@CurrentActor() actor: Actor, @Body() dto: DeleteAccountDto) {
    return this.privacy.deleteAccount(actor, dto ?? {});
  }
}
