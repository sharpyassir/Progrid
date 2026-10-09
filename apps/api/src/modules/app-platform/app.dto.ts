import { IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, IsUrl, Length, Matches, Max, Min } from 'class-validator';
import { ENV_KEY, IsEnvMap } from '../../common/http/env-map.validator';

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
/** Commands travel as one argument to `sh -c` in the container: anything but a NUL byte. */
const NO_NUL = /^[^\0]*$/;
export const MAX_PRE_DEPLOY = 1000;
export const MAX_RUN_COMMAND = 2000;
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
  /** Runs before every deploy goes live, e.g. `npx prisma migrate deploy`. */
  @IsOptional() @IsString() @Length(0, MAX_PRE_DEPLOY) @Matches(NO_NUL) preDeployCommand?: string;
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
  /** An empty string removes it. */
  @IsOptional() @IsString() @Length(0, MAX_PRE_DEPLOY) @Matches(NO_NUL) preDeployCommand?: string;
}

export class CreateRunDto {
  /** Run with `sh -c` in a fresh container from the app's live image; no TTY, stdin closed. */
  @IsString() @Length(1, MAX_RUN_COMMAND) @Matches(NO_NUL, { message: 'command must not contain NUL bytes' }) command: string;
  @IsOptional() @IsInt() @Min(30) @Max(3600) timeoutSeconds?: number;
}

export class AttachDatabaseDto {
  /** A managed database (cluster) in the app's project. */
  @IsString() @Length(1, 64) databaseId: string;
  /** Variable that receives the connection URL. */
  @IsOptional() @IsString() @Matches(ENV_KEY, { message: 'envName must be upper case letters, digits and _, not starting with a digit' }) envName?: string;
  /** An existing database on the cluster to use; by default a new one named after the app. */
  @IsOptional() @IsString() @Length(1, 63) @Matches(/^[a-z_][a-z0-9_]*$/, { message: 'database must be lowercase letters, digits and underscores, starting with a letter' }) database?: string;
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
