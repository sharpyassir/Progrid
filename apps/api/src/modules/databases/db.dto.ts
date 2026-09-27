import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

export const ENGINES = ['postgres', 'valkey', 'mysql'] as const;
export const ENGINE_VERSIONS: Record<(typeof ENGINES)[number], string[]> = { postgres: ['16'], valkey: ['8'], mysql: ['8.0'] };
export const ENGINE_PORTS: Record<(typeof ENGINES)[number], number> = { postgres: 5432, valkey: 6379, mysql: 3306 };

export class CreateDatabaseDto {
  @IsString() @Length(1, 40) @Matches(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, { message: 'name must be lowercase letters, digits and hyphens' }) name: string;
  @IsIn(ENGINES) engine: (typeof ENGINES)[number];
  @IsOptional() @IsString() version?: string;
  @IsString() size: string;
  /** 1 (single node) or 3 (high availability with automatic failover). */
  @IsOptional() @IsIn([1, 3]) nodes?: 1 | 3;
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsString() project?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(50) trustedSources?: string[];
  @IsOptional() @IsInt() @Min(0) @Max(23) backupHourUtc?: number;
}

export class UpdateDatabaseDto {
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(50) trustedSources?: string[];
  @IsOptional() @IsInt() @Min(0) @Max(23) backupHourUtc?: number;
}

export class DbNameDto {
  @IsString() @Length(1, 63) @Matches(/^[a-z_][a-z0-9_]*$/, { message: 'use lowercase letters, digits and underscores, starting with a letter' }) name: string;
}

export class RestoreDatabaseDto {
  /** A completed backup of this cluster (GET /v1/databases/:id/backups). */
  @IsString() @Length(1, 64) backupId: string;
}
