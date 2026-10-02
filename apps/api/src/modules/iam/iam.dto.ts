import { ArrayNotEmpty, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Length, Matches, Min, MinLength } from 'class-validator';
import { ALL_SCOPES } from '../../common/auth/actor';
import { COUNTRY_CODES } from '../../common/entities/countries';

export class SignupDto {
  @IsEmail() email: string;
  @IsString() @MinLength(10) password: string;
  @IsString() @Length(1, 80) name: string;
  @IsString() @Length(2, 60) teamName: string;
  /**
   * Billing country (ISO 3166-1 alpha-2). It decides the contracting company: SA is Progrid Arabia
   * (SAR), every other country Progrid Technologies LLC (USD). Omitted: SA on the progrid.sa
   * domain, otherwise the country of the caller's IP address, otherwise US.
   */
  @IsOptional() @IsIn(COUNTRY_CODES as unknown as string[]) country?: string;
  @IsOptional() @IsIn(['en', 'tr', 'ar']) locale?: string;
  /** A partner's code: links the account to the partner (who earns commission) and gives the signup discount. */
  @IsOptional() @IsString() @Length(0, 40) promoCode?: string;
}

export class LoginDto {
  @IsEmail() email: string;
  @IsString() password: string;
  @IsOptional() @IsString() totp?: string;
}

export class CreateProjectDto {
  @IsString() @Length(1, 60) name: string;
  @IsString() @Matches(/^[a-z0-9-]{2,40}$/) slug: string;
  @IsOptional() @IsInt() @Min(0) spendLimitMinor?: number;
}

export class CreateTokenDto {
  @IsString() @Length(1, 80) name: string;
  @IsArray() @ArrayNotEmpty() @IsIn(ALL_SCOPES, { each: true }) scopes: string[];
  @IsOptional() @IsString() projectId?: string;
  /** Marks the token as an AI agent: spend cap + approval rules apply. */
  @IsOptional() @IsBoolean() isAgent?: boolean;
  @IsOptional() @IsInt() @Min(0) spendCapMinor?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) requireApprovalFor?: string[];
  @IsOptional() @IsInt() @Min(1) expiresInDays?: number;
}

export class CreateSshKeyDto {
  @IsString() @Length(1, 80) name: string;
  @IsString() @Matches(/^(ssh-(rsa|ed25519)|ecdsa-sha2-nistp(256|384|521)) [A-Za-z0-9+/=]+( .*)?$/, {
    message: 'publicKey must be an OpenSSH public key',
  })
  publicKey: string;
}
