import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { PaginationQuery } from '../../../common/pagination';

class ContractRequestBase {
  /** Plan code, e.g. ESSENTIAL. */
  @IsString() @Length(2, 32) plan: string;
  /** What should be managed and anything the team wants us to know. */
  @IsOptional() @IsString() @Length(0, 4000) notes?: string;
}

/** Customer request. Customers are offered Saudi business hours only; the TR calendar is set by staff. */
export class RequestContractDto extends ContractRequestBase {
  @IsOptional() @IsIn(['SA']) calendar?: 'SA';
}

export class StaffCreateContractDto extends ContractRequestBase {
  @IsOptional() @IsIn(['SA', 'TR']) calendar?: 'SA' | 'TR';
  @IsString() teamId: string;
  @IsOptional() @IsInt() @Min(0) priceOverrideMinor?: number;
  @IsOptional() @IsInt() @Min(0) includedMinutesOverride?: number;
  @IsOptional() @IsInt() @Min(1) maxAssetsOverride?: number;
  @IsOptional() @IsInt() @Min(1) @Max(60) termMonths?: number;
}

export class UpdateContractDto {
  @IsOptional() @IsIn(['SA', 'TR']) calendar?: 'SA' | 'TR';
  @IsOptional() @IsString() @Length(0, 4000) notes?: string;
  @IsOptional() @IsInt() @Min(0) priceOverrideMinor?: number | null;
  @IsOptional() @IsInt() @Min(0) includedMinutesOverride?: number | null;
  @IsOptional() @IsInt() @Min(1) maxAssetsOverride?: number | null;
  @IsOptional() @IsInt() @Min(0) liabilityCapMinor?: number;
  @IsOptional() @IsInt() @Min(1) @Max(60) termMonths?: number;
  /** Renew for another term when the term ends. */
  @IsOptional() @IsBoolean() autoRenew?: boolean;
}

/** Customer (owner): the only contract field a team changes itself. */
export class CustomerUpdateContractDto {
  /** Renew for another term when the term ends; when false the contract ends at termEndsAt. */
  @IsBoolean() autoRenew: boolean;
}

export class ActivateContractDto {
  /** Liability cap agreed in the signed contract, in the contract currency minor units. */
  @IsInt() @Min(0) liabilityCapMinor: number;
  /** Customer signatory named on the contract. */
  @IsString() @Length(2, 120) signedByName: string;
  /** When the customer signed; defaults to now. */
  @IsOptional() @Type(() => Date) @IsDate() signedAt?: Date;
  /** Activate a 24/7 plan although fewer than two people are on call in the next 14 days. Recorded in the audit log. */
  @IsOptional() @IsBoolean() overrideOnCallRule?: boolean;
}

export class ReasonDto {
  @IsOptional() @IsString() @Length(0, 2000) reason?: string;
}

export class RenewContractDto {
  @IsOptional() @IsInt() @Min(1) @Max(60) termMonths?: number;
}

export class AdminListContractsQuery extends PaginationQuery {
  @IsOptional() @IsIn(['DRAFT', 'ONBOARDING', 'ACTIVE', 'SUSPENDED', 'CANCELLED']) status?: 'DRAFT' | 'ONBOARDING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
  @IsOptional() @IsString() teamId?: string;
}
