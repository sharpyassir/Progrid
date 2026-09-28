import { IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';

export class RequestAssetDto {
  @IsIn(['PLATFORM_SERVER', 'EXTERNAL_SERVER', 'SITE']) kind: 'PLATFORM_SERVER' | 'EXTERNAL_SERVER' | 'SITE';
  @IsString() @Length(1, 120) name: string;
  /** Required for PLATFORM_SERVER: the id of a server in your team. */
  @IsOptional() @IsString() serverId?: string;
  /** Public IP, hostname or site URL. Required for EXTERNAL_SERVER and SITE. */
  @IsOptional() @IsString() @Length(1, 300) address?: string;
  @IsOptional() @IsString() @Length(1, 80) provider?: string;
  @IsOptional() @IsString() @Length(1, 80) os?: string;
  @IsOptional() @IsString() @Length(0, 2000) notes?: string;
}

export class StaffCreateAssetDto extends RequestAssetDto {
  @IsOptional() @IsString() @Length(1, 120) managementAddress?: string;
  @IsOptional() @IsBoolean() monitoringEnabled?: boolean;
  @IsOptional() @IsBoolean() backupEnabled?: boolean;
  /** Staff created assets are APPROVED unless this is false. */
  @IsOptional() @IsBoolean() approved?: boolean;
}

export class UpdateAssetDto {
  @IsOptional() @IsString() @Length(1, 120) name?: string;
  @IsOptional() @IsString() @Length(1, 300) address?: string;
  @IsOptional() @IsString() @Length(1, 120) managementAddress?: string;
  @IsOptional() @IsString() @Length(1, 80) provider?: string;
  @IsOptional() @IsString() @Length(1, 80) os?: string;
  @IsOptional() @IsBoolean() monitoringEnabled?: boolean;
  @IsOptional() @IsBoolean() backupEnabled?: boolean;
  @IsOptional() @IsString() @Length(0, 2000) notes?: string;
}

export class RejectAssetDto {
  @IsString() @Length(1, 1000) reason: string;
}
