import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDefined, IsOptional, IsString, Length, ValidateNested } from 'class-validator';
import { AssignmentGuard, EngineerGuard, ResidencyGuard } from '../guards/ops.guards';
import { Ops, type OpsContext } from '../guards/ops-context';
import { ShiftsService } from './shifts.service';

class ChecklistDto {
  @IsBoolean() pagingAppOnline: boolean;
  @IsBoolean() vpnWorking: boolean;
  @IsBoolean() twoFactorWorking: boolean;
  @IsBoolean() lastHandoverRead: boolean;
}

class StartShiftDto {
  /** Default: your shift that starts within 30 minutes or is running. */
  @IsOptional() @IsString() shiftId?: string;
  @IsDefined() @ValidateNested() @Type(() => ChecklistDto) checklist: ChecklistDto;
}

class HandoverDto {
  @IsString() @Length(0, 10_000) risks: string;
  @IsString() @Length(0, 10_000) pendingMaintenance: string;
  @IsString() @Length(0, 20_000) notes: string;
  /** Extra tickets to hand over; your open tickets are always included. */
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) ticketIds?: string[];
}

class EndShiftDto {
  @IsOptional() @IsString() shiftId?: string;
  @IsDefined() @ValidateNested() @Type(() => HandoverDto) handover: HandoverDto;
}

/** Shift start (checklist), end (handover) and the last handover (/ops/v1/shifts). */
@ApiTags('ops')
@ApiBearerAuth()
@UseGuards(EngineerGuard, AssignmentGuard, ResidencyGuard)
@Controller('ops/v1/shifts')
export class OpsShiftsController {
  constructor(private readonly shifts: ShiftsService) {}

  /** Your shifts from a week ago to four weeks ahead, and the start checklist items. */
  @Get()
  mine(@Ops() ops: OpsContext) {
    return this.shifts.mine(ops);
  }

  @Post('start') @HttpCode(200)
  start(@Ops() ops: OpsContext, @Body() dto: StartShiftDto) {
    return this.shifts.start(ops, dto);
  }

  @Post('end') @HttpCode(200)
  end(@Ops() ops: OpsContext, @Body() dto: EndShiftDto) {
    return this.shifts.end(ops, dto);
  }

  /** The latest handover; reading it is part of the start checklist. */
  @Get('handover/latest')
  latest(@Ops() ops: OpsContext) {
    return this.shifts.latestHandover(ops);
  }
}
