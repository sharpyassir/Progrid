import { IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, IsUrl, Length, Matches, Max, Min } from 'class-validator';
import { IsEnvMap } from '../../common/http/env-map.validator';

/** Container sizes. Prices live in the price book as `app-<size>`; memory and CPU are enforced by Docker on the host. */
export const APP_SIZES = {
  'app-xs': { memoryMb: 512, cpus: 0.5, usd: 500 },
  'app-s': { memoryMb: 1024, cpus: 1, usd: 1200 },
  'app-m': { memoryMb: 2048, cpus: 2, usd: 2400 },
  'app-l': { memoryMb: 4096, cpus: 4, usd: 4800 },
} as const;
export type AppSizeId = keyof typeof APP_SIZES;
export const APP_SIZE_IDS = Object.keys(APP_SIZES) as AppSizeId[];
export const MAX_INSTANCES = 5;
export const MAX_DOMAINS = 5;

const SLUG = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;
const HOSTNAME = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

export class CreateAppDto {
  /** Hostname label under the apps domain; must be unique across the platform. */
  @IsString() @Matches(SLUG, { message: 'name must be 1 to 40 lowercase letters, digits and hyphens' }) name: string;
  /** Either repoUrl (public, or private with gitToken) or installationId + repo (GitHub App). */
  @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) repoUrl?: string;
  @IsOptional() @IsString() installationId?: string;
  @IsOptional() @IsString() @Matches(/^[\w.-]+\/[\w.-]+$/) repo?: string;
  @IsOptional() @IsString() gitToken?: string;
  @IsOptional() @IsString() @Matches(/^[\w./-]{1,100}$/) branch?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsIn(APP_SIZE_IDS) size?: AppSizeId;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_INSTANCES) instances?: number;
  @IsOptional() @IsEnvMap() env?: Record<string, string>;
  @IsOptional() @IsString() @Matches(/^\/[\w./-]{0,200}$/) healthPath?: string;
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsString() project?: string;
}

export class UpdateAppDto {
  @IsOptional() @IsString() @Matches(/^[\w./-]{1,100}$/) branch?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsIn(APP_SIZE_IDS) size?: AppSizeId;
  @IsOptional() @IsInt() @Min(1) @Max(MAX_INSTANCES) instances?: number;
  /** Replaces the whole set of variables. */
  @IsOptional() @IsEnvMap() env?: Record<string, string>;
  @IsOptional() @IsString() @Matches(/^\/[\w./-]{0,200}$/) healthPath?: string;
  @IsOptional() @IsString() gitToken?: string;
}

export class DomainDto {
  @IsString() @Length(4, 253) @Matches(HOSTNAME, { message: 'domain must be a hostname such as app.example.com' }) domain: string;
}

export class ProvisionHostDto {
  @IsOptional() @IsString() region?: string;
  @IsOptional() @IsString() size?: string;
}

export class LogsQuery {
  @IsOptional() @IsIn(['build', 'runtime']) type?: 'build' | 'runtime';
}

export class EnvDto {
  @IsArray() @IsString({ each: true }) keys: string[];
}
