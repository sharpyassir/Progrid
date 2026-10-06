import { IsArray, IsInt, IsObject, IsOptional, IsString, IsUrl, Matches, Max, Min } from 'class-validator';
import { IsEnvMap } from '../../common/http/env-map.validator';

export class CreateDeployDto {
  /** Either repoUrl (any public repo, or private with gitToken) or installationId + repo (GitHub App). */
  @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) repoUrl?: string;
  @IsOptional() @IsString() installationId?: string;
  @IsOptional() @IsString() @Matches(/^[\w.-]+\/[\w.-]+$/) repo?: string;
  @IsOptional() @IsString() @Matches(/^[\w./-]{1,100}$/) branch?: string;
  @IsOptional() @IsString() @Matches(/^[a-z0-9]([a-z0-9-]{0,40}[a-z0-9])?$/) name?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsString() size?: string;
  @IsOptional() @IsString() project?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) sshKeys?: string[];
  @IsOptional() @IsEnvMap() env?: Record<string, string>;
  /** Token for private repos; stored only inside the server's cloud-init, never in our DB. */
  @IsOptional() @IsString() gitToken?: string;
}
