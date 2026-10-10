import { Body, Controller, Get, Header, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, Length, Matches } from 'class-validator';
import { CurrentActor, RequireScopes, StaffAreas } from '../../common/auth/decorators';
import type { Actor } from '../../common/auth/actor';
import { AffiliateAdminService } from './admin.service';
import { AffiliateSettingsService } from './settings';
import { AffiliateAccountingService } from './accounting.service';
import { toCsv } from './admin.service';

class ApproveDto {
  /** Overrides the applicant's code (4 to 20 letters and digits). */
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9]{4,20}$/) code?: string;
}
class ReasonDto {
  @IsString() @Length(3, 500) reason: string;
}
class PaidDto {
  @IsString() @Length(1, 120) reference: string;
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}
class NoteDto {
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

/** Back office for the affiliate program: finance staff (docs/affiliates.md). */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/v1/affiliates')
@RequireScopes('admin')
@StaffAreas('finance')
export class AffiliateAdminController {
  constructor(private readonly admin: AffiliateAdminService, private readonly settings: AffiliateSettingsService, private readonly accounts: AffiliateAccountingService) {}

  @Get()
  list(@Query('status') status?: string, @Query('q') q?: string) {
    return this.admin.list({ status, q });
  }

  @Get('settings')
  getSettings() {
    return this.settings.present();
  }

  /** Partial update: rates, cookieDays, holdDays, commissionMonths, minPayoutMinor, promo discount, flags, applicationsOpen, termsVersion. */
  @Patch('settings')
  updateSettings(@CurrentActor() actor: Actor, @Body() body: unknown) {
    return this.settings.update(actor, body);
  }

  @Get('referrals')
  async referrals(@Query('affiliateId') affiliateId?: string) {
    return { data: await this.admin.referrals({ affiliateId }) };
  }

  @Get('commissions')
  async commissions(@Query('affiliateId') affiliateId?: string, @Query('status') status?: string, @Query('currency') currency?: string) {
    return { data: await this.admin.commissions({ affiliateId, status, currency }) };
  }

  @Get('payouts')
  async payouts(@Query('status') status?: string) {
    return { data: await this.admin.payouts({ status }) };
  }

  @Post('payouts/:id/paid') @HttpCode(200)
  markPaid(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: PaidDto) {
    return this.admin.markPaid(actor, id, dto.reference, dto.note);
  }

  @Post('payouts/:id/cancel') @HttpCode(200)
  cancelPayout(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: NoteDto) {
    return this.admin.cancelPayout(actor, id, dto.note);
  }

  @Get('flags')
  async flags(@Query('open') open?: string) {
    return { data: await this.admin.flags({ open }) };
  }

  @Post('flags/:id/resolve') @HttpCode(200)
  resolveFlag(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.admin.resolveFlag(actor, id);
  }

  // ---- accounting (docs/affiliates-tax.md) ----

  /** Monthly journal entries and the payable balance of Progrid Arabia, per currency. */
  @Get('tax/accounting')
  accounting(@Query('month') month: string, @Query('currency') currency?: string) {
    return this.accounts.accounting(month, currency === 'SAR' ? 'SAR' : 'USD');
  }

  @Get('export/journal')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('cache-control', 'no-store')
  async exportJournal(@Query('month') month: string, @Query('currency') currency?: string) {
    const r = await this.accounts.accounting(month, currency === 'SAR' ? 'SAR' : 'USD');
    return toCsv(['date', 'company', 'currency', 'account', 'debit', 'credit', 'memo'], r.lines.map((l) => [l.date, r.company, r.currency, l.account, (l.debitMinor / 100).toFixed(2), (l.creditMinor / 100).toFixed(2), l.memo]));
  }

  /** CSV download: affiliates, referrals, commissions or payouts (same filters as the lists). */
  @Get('export/:kind')
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('cache-control', 'no-store')
  export(@Param('kind') kind: string, @Query('affiliateId') affiliateId?: string, @Query('status') status?: string, @Query('currency') currency?: string) {
    return this.admin.csv(kind, { affiliateId, status, currency });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.admin.get(id);
  }

  @Post(':id/approve') @HttpCode(200)
  approve(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: ApproveDto) {
    return this.admin.approve(actor, id, dto.code);
  }

  @Post(':id/reject') @HttpCode(200)
  reject(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.admin.reject(actor, id, dto.reason);
  }

  @Post(':id/suspend') @HttpCode(200)
  suspend(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.admin.suspend(actor, id, dto.reason);
  }

  @Post(':id/reinstate') @HttpCode(200)
  reinstate(@CurrentActor() actor: Actor, @Param('id') id: string) {
    return this.admin.reinstate(actor, id);
  }
}
