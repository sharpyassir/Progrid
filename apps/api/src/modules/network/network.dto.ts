import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsIn, IsOptional, IsString, Length, Matches, ValidateNested } from 'class-validator';

export class FirewallRuleDto {
  @IsIn(['inbound', 'outbound']) direction: 'inbound' | 'outbound';
  @IsIn(['tcp', 'udp', 'icmp', 'vrrp', 'any']) protocol: 'tcp' | 'udp' | 'icmp' | 'vrrp' | 'any';
  /** "22", "8000-9000". Only for tcp and udp; omit for icmp, vrrp and any. */
  @IsOptional() @Matches(/^\d{1,5}(-\d{1,5})?$/) ports?: string;
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) cidrs: string[];
  @IsOptional() @IsString() @Length(0, 120) description?: string;
}

export class CreateFirewallDto {
  @IsString() @Length(1, 60) name: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => FirewallRuleDto) rules: FirewallRuleDto[];
  @IsOptional() @IsString() project?: string;
}

export class ReplaceRulesDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => FirewallRuleDto) rules: FirewallRuleDto[];
}

export class AttachServerDto {
  @IsString() serverId: string;
}
