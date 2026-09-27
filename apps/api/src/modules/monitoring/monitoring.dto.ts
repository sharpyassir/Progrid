import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export const METRICS = ['cpu', 'memory', 'disk', 'net_in', 'net_out', 'db_node_unreachable', 'app_deploy_failed'] as const;
/** Metrics that fire on an event instead of a threshold; they cover every database or app of the team. */
export const EVENT_METRICS = ['db_node_unreachable', 'app_deploy_failed'] as const;

export class CreateAlertDto {
  @IsString() @Length(1, 80) name: string;
  @IsIn(METRICS) metric: (typeof METRICS)[number];
  @IsOptional() @IsIn(['above', 'below']) comparator?: 'above' | 'below';
  /** Percent for cpu, memory and disk; megabits per second for network. */
  @IsNumber() @Min(0) threshold: number;
  @IsOptional() @IsInt() @Min(1) @Max(1440) windowMinutes?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(200) serverIds?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(20) tags?: string[];
  @IsOptional() @IsArray() @IsEmail({}, { each: true }) @ArrayMaxSize(10) emails?: string[];
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class UpdateAlertDto {
  @IsOptional() @IsString() @Length(1, 80) name?: string;
  @IsOptional() @IsIn(METRICS) metric?: (typeof METRICS)[number];
  @IsOptional() @IsIn(['above', 'below']) comparator?: 'above' | 'below';
  @IsOptional() @IsNumber() @Min(0) threshold?: number;
  @IsOptional() @IsInt() @Min(1) @Max(1440) windowMinutes?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(200) serverIds?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(20) tags?: string[];
  @IsOptional() @IsArray() @IsEmail({}, { each: true }) @ArrayMaxSize(10) emails?: string[];
  @IsOptional() @IsBoolean() enabled?: boolean;
}
