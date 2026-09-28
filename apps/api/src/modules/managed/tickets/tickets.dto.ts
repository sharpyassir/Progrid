import { IsBoolean, IsIn, IsOptional, IsString, Length, ValidateIf } from 'class-validator';
import { PaginationQuery } from '../../../common/pagination';

const PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;
type P = (typeof PRIORITIES)[number];
const STATUSES = ['open', 'answered', 'closed'] as const;

export class CreateManagedTicketDto {
  @IsString() @Length(3, 140) subject: string;
  @IsString() @Length(1, 20000) body: string;
  /** P1 production down, P2 degraded, P3 normal request (default), P4 question or low impact. */
  @IsOptional() @IsIn(PRIORITIES) priority?: P;
  /** Needed only when the team has more than one open contract. */
  @IsOptional() @IsString() contractId?: string;
  @IsOptional() @IsString() assetId?: string;
}

export class ManagedMessageDto {
  @IsString() @Length(1, 20000) body: string;
}

export class StaffMessageDto extends ManagedMessageDto {
  /** Internal note: visible to staff only, never returned by customer endpoints, does not count as a response. */
  @IsOptional() @IsBoolean() internal?: boolean;
  /** Close (resolve) the ticket with this public reply. */
  @IsOptional() @IsBoolean() close?: boolean;
}

export class UpdateManagedTicketDto {
  /** Staff user id, or null to unassign. Engineers may only assign themselves. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() assigneeId?: string | null;
  @IsOptional() @IsIn(PRIORITIES) priority?: P;
  @IsOptional() @IsIn(STATUSES) status?: (typeof STATUSES)[number];
}

export class ListManagedTicketsQuery extends PaginationQuery {
  @IsOptional() @IsIn([...STATUSES, 'all']) status?: (typeof STATUSES)[number] | 'all';
  @IsOptional() @IsIn(PRIORITIES) priority?: P;
  @IsOptional() @IsString() contractId?: string;
}

export class AdminListManagedTicketsQuery extends ListManagedTicketsQuery {
  /** A staff user id, "me", or "none" for unassigned tickets. */
  @IsOptional() @IsString() assignee?: string;
  @IsOptional() @IsString() teamId?: string;
  @IsOptional() @IsIn(['true', 'false']) breached?: 'true' | 'false';
}
