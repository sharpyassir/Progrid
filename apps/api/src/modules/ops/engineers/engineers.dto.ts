import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, Min, ValidateIf } from 'class-validator';

const KINDS = ['EXTERNAL', 'INTERNAL'] as const;
const STATUSES = ['ACTIVE', 'SUSPENDED', 'OFFBOARDED'] as const;
const CHANNELS = ['SMS', 'WHATSAPP', 'PUSH', 'EMAIL'] as const;
export const ACCESS_POLICIES = ['ANY', 'SAUDI_ONLY', 'TURKIYE_ONLY'] as const;

export class CreateEngineerDto {
  /** Link an existing user. Otherwise `email` and `name` create a new user, who gets a set password mail. */
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsIn(KINDS) kind: (typeof KINDS)[number];
  /** ISO 3166-1 alpha-2, e.g. SA, TR, JO, IN. */
  @Matches(/^[A-Za-z]{2}$/) country: string;
  @IsOptional() @IsString() timezone?: string;
  /** Full staff only. */
  @IsOptional() @IsInt() @Min(0) hourlyRateMinor?: number;
  /** Full staff only. */
  @IsOptional() @IsInt() @Min(0) standbyFeeMinor?: number;
  @IsOptional() @IsIn(['USD', 'SAR']) currency?: 'USD' | 'SAR';
  /** Full staff only. */
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(5) nightMultiplier?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) ipAllowlist?: string[];
  /** Paging phone (E.164), stored on the user. */
  @IsOptional() @Matches(/^\+[1-9]\d{6,14}$/) phone?: string;
  @IsOptional() @IsIn(CHANNELS) pagingChannel?: (typeof CHANNELS)[number];
  /** Contracts to assign right away. */
  @IsOptional() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) contractIds?: string[];
}

export class UpdateEngineerDto {
  @IsOptional() @Matches(/^[A-Za-z]{2}$/) country?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) hourlyRateMinor?: number | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsInt() @Min(0) standbyFeeMinor?: number | null;
  @IsOptional() @IsIn(['USD', 'SAR']) currency?: 'USD' | 'SAR';
  @IsOptional() @Type(() => Number) @IsNumber() @Min(1) @Max(5) nightMultiplier?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) ipAllowlist?: string[];
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(/^\+[1-9]\d{6,14}$/) phone?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsIn(CHANNELS) pagingChannel?: (typeof CHANNELS)[number] | null;
  /** SUSPENDED or OFFBOARDED revokes grants, kills sessions and ends shifts (docs/devops-console.md). */
  @IsOptional() @IsIn(STATUSES) status?: (typeof STATUSES)[number];
  @IsOptional() @IsString() @Length(0, 500) statusReason?: string;
}

export class ListEngineersQuery {
  @IsOptional() @IsIn(STATUSES) status?: (typeof STATUSES)[number];
  @IsOptional() @IsIn(KINDS) kind?: (typeof KINDS)[number];
  @IsOptional() @IsString() contractId?: string;
}

export class AssignDto {
  @IsString() contractId: string;
}

export class AccessPolicyDto {
  @IsIn(ACCESS_POLICIES) accessPolicy: (typeof ACCESS_POLICIES)[number];
}
