import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { COUNTRY_CODES } from '../../common/entities/countries';
import { W8BENE_CH3, W8BENE_CH4, W9_CLASSIFICATIONS } from './tax-rules';

const COUNTRIES = COUNTRY_CODES as unknown as string[];

/**
 * One electronic tax form. Which fields are required depends on formType; the service checks
 * them (W-9: US address and SSN, ITIN or EIN; W-8BEN: foreign individual; W-8BEN-E: foreign entity).
 */
export class TaxFormDto {
  @IsIn(['W9', 'W8BEN', 'W8BENE']) formType: 'W9' | 'W8BEN' | 'W8BENE';
  /** Line 1: name as shown on the income tax return (individual) or the entity's legal name. */
  @IsString() @Length(2, 120) legalName: string;
  /** W-9 line 2: business name or disregarded entity name. */
  @IsOptional() @IsString() @Length(0, 120) businessName?: string;
  @IsOptional() @IsIn([...W9_CLASSIFICATIONS, ...W8BENE_CH3]) taxClassification?: string;
  @IsOptional() @IsString() @Matches(/^([1-9]|1[0-3])?$/) exemptPayeeCode?: string;
  @IsOptional() @IsString() @Matches(/^[A-M]?$/) fatcaCode?: string;
  @IsOptional() @IsIn(W8BENE_CH4 as unknown as string[]) fatcaStatus?: string;
  /** ssn, itin or ein for a W-9; foreign for a W-8 (the foreign tax identifying number). */
  @IsIn(['ssn', 'itin', 'ein', 'foreign']) tinType: 'ssn' | 'itin' | 'ein' | 'foreign';
  @IsOptional() @IsString() @Length(0, 40) tin?: string;
  /** W-8: the country of residence does not issue a foreign TIN (W-8BEN line 6b). */
  @IsOptional() @IsBoolean() foreignTinNotRequired?: boolean;
  @IsOptional() @IsIn(COUNTRIES) citizenshipCountry?: string;
  /** W-8BEN line 8, YYYY-MM-DD. */
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateOfBirth?: string;
  @IsString() @Length(2, 120) addressLine1: string;
  @IsOptional() @IsString() @Length(0, 120) addressLine2?: string;
  @IsString() @Length(1, 80) city: string;
  /** US state (two letters) on a W-9; province or region otherwise. */
  @IsOptional() @IsString() @Length(0, 80) region?: string;
  @IsOptional() @IsString() @Length(0, 20) postalCode?: string;
  @IsIn(COUNTRIES) country: string;
  @IsOptional() @IsString() @Length(0, 300) mailingAddress?: string;
  /** W-9: the signer crossed out certification 2 (notified by the IRS of backup withholding). */
  @IsOptional() @IsBoolean() subjectToBackupWithholding?: boolean;
  /** W-8: all services are performed outside the United States. Required. */
  @IsOptional() @IsBoolean() servicesOutsideUs?: boolean;
  /** Electronic signature: the signer types their full name and confirms the certification. */
  @IsString() @Length(2, 120) signatureName: string;
  @IsBoolean() certify: boolean;
}

export class BackupWithholdingDto {
  @IsBoolean() on: boolean;
  @IsString() @Length(3, 300) reason: string;
}

export class InvalidateTaxFormDto {
  @IsString() @Length(3, 300) reason: string;
}
