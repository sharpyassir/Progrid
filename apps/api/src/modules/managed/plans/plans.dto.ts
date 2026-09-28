import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Length, Matches, Min } from 'class-validator';

export class CreatePlanDto {
  @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,31}$/) code: string;
  @IsString() @Length(2, 80) name: string;
  @IsOptional() @IsString() @Length(0, 2000) description?: string;
  /** Monthly fee in minor units; null for a custom price set per contract. */
  @IsOptional() @IsInt() @Min(0) priceMinor?: number | null;
  @IsOptional() @IsIn(['SAR', 'USD']) currency?: 'SAR' | 'USD';
  @IsOptional() @IsInt() @Min(1) maxAssets?: number | null;
  @IsIn(['BUSINESS_HOURS', 'TWENTY_FOUR_SEVEN']) coverage: 'BUSINESS_HOURS' | 'TWENTY_FOUR_SEVEN';
  @IsInt() @Min(0) includedEngineerMinutes: number;
  @IsInt() @Min(0) hourlyRateMinor: number;
  /** Minutes per priority, e.g. {"P1":240,"P2":480,"P3":960,"P4":2400}. */
  @IsObject() responseTargets: Record<string, number>;
  @IsObject() resolveTargets: Record<string, number>;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

export class UpdatePlanDto {
  @IsOptional() @IsString() @Length(2, 80) name?: string;
  @IsOptional() @IsString() @Length(0, 2000) description?: string;
  @IsOptional() @IsInt() @Min(0) priceMinor?: number | null;
  @IsOptional() @IsIn(['SAR', 'USD']) currency?: 'SAR' | 'USD';
  @IsOptional() @IsInt() @Min(1) maxAssets?: number | null;
  @IsOptional() @IsIn(['BUSINESS_HOURS', 'TWENTY_FOUR_SEVEN']) coverage?: 'BUSINESS_HOURS' | 'TWENTY_FOUR_SEVEN';
  @IsOptional() @IsInt() @Min(0) includedEngineerMinutes?: number;
  @IsOptional() @IsInt() @Min(0) hourlyRateMinor?: number;
  @IsOptional() @IsObject() responseTargets?: Record<string, number>;
  @IsOptional() @IsObject() resolveTargets?: Record<string, number>;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}
