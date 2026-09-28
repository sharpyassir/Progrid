import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, Length, Matches } from 'class-validator';
import { CurrentActor, RequireScopes, StaffAreas } from '../../../common/auth/decorators';
import type { Actor } from '../../../common/auth/actor';
import { RunbooksService } from './runbooks.service';

class CreateRunbookDto {
  @IsString() @Length(2, 160) title: string;
  /** Markdown. */
  @IsString() @Length(1, 200_000) body: string;
  /** Defaults to a slug of the title. */
  @IsOptional() @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/) @Length(2, 80) slug?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) tags?: string[];
}

class UpdateRunbookDto {
  @IsOptional() @IsString() @Length(2, 160) title?: string;
  @IsOptional() @IsString() @Length(1, 200_000) body?: string;
  @IsOptional() @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/) @Length(2, 80) slug?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) tags?: string[];
}

class RunbookQuery {
  /** Matches the title or a tag. */
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsString() tag?: string;
}

/** Back office: runbooks (internal knowledge base). */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/managed/runbooks')
export class AdminManagedRunbooksController {
  constructor(private readonly runbooks: RunbooksService) {}

  @StaffAreas('engineer', 'support_lead')
  @Get() @RequireScopes('admin')
  list(@Query() q: RunbookQuery) {
    return this.runbooks.list(q);
  }

  /** By id or slug. */
  @StaffAreas('engineer', 'support_lead')
  @Get(':id') @RequireScopes('admin')
  get(@Param('id') id: string) {
    return this.runbooks.get(id);
  }

  @StaffAreas('engineer', 'support_lead')
  @Post() @RequireScopes('admin') @HttpCode(201)
  create(@CurrentActor() actor: Actor, @Body() dto: CreateRunbookDto) {
    return this.runbooks.create(actor, dto);
  }

  @StaffAreas('engineer', 'support_lead')
  @Patch(':id') @RequireScopes('admin')
  update(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: UpdateRunbookDto) {
    return this.runbooks.update(actor, id, dto);
  }

  @StaffAreas('engineer', 'support_lead')
  @Delete(':id') @RequireScopes('admin')
  remove(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.runbooks.remove(actor, id);
  }
}
