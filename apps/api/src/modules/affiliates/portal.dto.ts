import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUrl, Length, Matches } from 'class-validator';
import { COUNTRY_CODES } from '../../common/entities/countries';

export const AUDIENCE_SIZES = ['under_1k', '1k_10k', '10k_50k', '50k_250k', 'over_250k'] as const;
export const CONTENT_LANGUAGES = ['ar', 'en', 'ar_en', 'other'] as const;

export class ApplyDto {
  @IsString() @Length(2, 80) name: string;
  @IsIn(COUNTRY_CODES as unknown as string[]) country: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, { each: true }) channels: string[];
  @IsIn(AUDIENCE_SIZES as unknown as string[]) audienceSize: string;
  @IsIn(CONTENT_LANGUAGES as unknown as string[]) contentLanguage: string;
  @IsString() @Length(20, 2000) promotionPlan: string;
  @IsBoolean() acceptTerms: boolean;
  /** A code the applicant would like (4 to 20 letters and digits); a free one is chosen otherwise. */
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9]{4,20}$/) preferredCode?: string;
  /** Hidden from people; bots fill it. Must be empty. */
  @IsOptional() @IsString() @Length(0, 200) website?: string;
  /** When the form was opened (ms since epoch); applications sent within seconds are refused. */
  @IsOptional() @IsInt() formStartedAt?: number;
}

export class PayoutDetailsDto {
  @IsIn(['bank_transfer']) method: 'bank_transfer';
  @IsString() @Length(2, 120) holderName: string;
  @IsString() @Length(2, 120) bankName: string;
  @IsIn(COUNTRY_CODES as unknown as string[]) bankCountry: string;
  /** IBAN, or the account number where IBAN is not used. */
  @IsString() @Matches(/^[A-Za-z0-9 ]{6,40}$/) iban: string;
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9 ]{8,11}$/) swift?: string;
  @IsOptional() @IsString() @Length(0, 300) note?: string;
}

export class PayoutRequestDto {
  @IsIn(['USD', 'SAR']) currency: 'USD' | 'SAR';
}
