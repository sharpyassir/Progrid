import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrentActor, RequireScopes, StaffAreas } from '../../common/auth/decorators';
import { STAFF_ROLES, type Actor } from '../../common/auth/actor';
import { TrustService } from '../trust/trust.service';
import { EventsService } from '../events/events.service';
import { BOOK_CURRENCY } from '../billing/pricing';
import { RatingService } from '../billing/rating.service';
import { InvoicesService } from '../billing/invoices.service';
import { BillingAdminService } from '../billing/billing-admin.service';
import { DunningService } from '../billing/dunning.service';
import { BackupsService } from '../storage/backups.service';
import { FxService } from '../billing/fx.service';
import { startOfMonth } from '../billing/pricing';
import { ApiError } from '../../common/errors/api-error';

class RegisterHostDto {
  @IsString() name: string;
  @IsString() regionId: string;
  @IsOptional() @IsString() driver?: 'proxmox' | 'fake';
  @IsString() driverRef: string; // {"hostId":"…","node":"pve1"} — hostId is filled in by us
  @IsInt() @Min(1) totalVcpu: number;
  @IsInt() @Min(1) totalMemoryMb: number;
  @IsInt() @Min(1) totalDiskGb: number;
}

class HostStatusDto {
  @IsIn(['active', 'draining', 'maintenance', 'down']) status: 'active' | 'draining' | 'maintenance' | 'down';
}

class CreditDto {
  @IsIn(['promo', 'prepaid', 'refund', 'goodwill']) kind: 'promo' | 'prepaid' | 'refund' | 'goodwill';
  @IsInt() @Min(1) amountMinor: number;
  @IsOptional() @IsString() reason?: string;
}

class SuspendDto {
  @IsString() reason: string;
}

class PriceDto {
  @IsString() sku: string;
  @IsInt() @Min(0) monthlyMinor: number;
}

class RefundDto {
  /** Omit to refund whatever is left of the payment. */
  @IsOptional() @IsInt() @Min(1) amountMinor?: number;
  @IsOptional() @IsString() @Length(0, 500) reason?: string;
}

class CreditNoteDto {
  @IsInt() @Min(1) amountMinor: number;
  @IsString() @Length(3, 500) reason: string;
}

class ReasonDto {
  @IsOptional() @IsString() @Length(0, 500) reason?: string;
}

class ManualPaymentDto {
  @IsIn(['bank_transfer', 'manual']) provider: 'bank_transfer' | 'manual';
  /** Omit to record exactly what is due. */
  @IsOptional() @IsInt() @Min(1) amountMinor?: number;
  /** Bank transfer reference or receipt number. */
  @IsOptional() @IsString() @Length(0, 200) reference?: string;
  @IsOptional() @IsDateString() receivedAt?: string;
}

class ResolveDto {
  @IsIn(['false_positive', 'warned', 'suspended']) resolution: 'false_positive' | 'warned' | 'suspended';
}

/**
 * Back-office API for support, capacity and finance. Requires the `admin` scope, which
 * only staff tokens carry (issued out-of-band; never via /v1/tokens).
 */
@ApiTags('admin')
@ApiBearerAuth()
class SetStaffDto {
  @IsBoolean() isStaff: boolean;
  @IsOptional() @IsArray() @IsIn(STAFF_ROLES as unknown as string[], { each: true }) staffRoles?: string[];
}

@Controller('admin/v1')
@RequireScopes('admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trust: TrustService,
    private readonly events: EventsService,
    private readonly rating: RatingService,
    private readonly invoices: InvoicesService,
    private readonly billingAdmin: BillingAdminService,
    private readonly dunningService: DunningService,
    private readonly fx: FxService,
    private readonly backups: BackupsService,
  ) {}

  /** Runs the daily backup pass now (idempotent within the day). */
  @StaffAreas('ops')
  @Post('backups/run') @RequireScopes('admin') @HttpCode(200)
  runBackups() {
    return this.backups.runDaily();
  }

  // ---- overview ----

  @StaffAreas('any')
  @Get('overview')
  async overview() {
    const month = startOfMonth(new Date());
    const [teams, teamsNew, servers, hosts, pendingApprovals, abuse, openInvoices, mtd, payments, recentTeams] = await Promise.all([
      this.prisma.team.groupBy({ by: ['status'], _count: true }),
      this.prisma.team.count({ where: { createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
      this.prisma.server.groupBy({ by: ['status'], where: { deletedAt: null }, _count: true }),
      this.prisma.host.findMany({ select: { id: true, name: true, status: true, totalVcpu: true, totalMemoryMb: true, totalDiskGb: true, usedVcpu: true, usedMemoryMb: true, usedDiskGb: true, lastHeartbeatAt: true } }),
      this.prisma.approval.count({ where: { status: 'pending' } }),
      this.prisma.abuseFlag.count({ where: { resolvedAt: null } }),
      this.prisma.invoice.aggregate({ where: { status: 'open' }, _count: true, _sum: { totalMinor: true } }),
      this.prisma.usageRecord.groupBy({ by: ['currency'], where: { hourStart: { gte: month } }, _sum: { amountMinor: true } }),
      this.prisma.payment.groupBy({ by: ['currency'], where: { status: 'succeeded', paidAt: { gte: month } }, _sum: { amountMinor: true } }),
      this.prisma.team.findMany({ orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, name: true, slug: true, country: true, currency: true, status: true, createdAt: true } }),
    ]);
    return {
      teams: Object.fromEntries(teams.map((t) => [t.status, t._count])), teamsNewThisWeek: teamsNew,
      servers: Object.fromEntries(servers.map((s) => [s.status, s._count])),
      hosts,
      pendingApprovals, openAbuseFlags: abuse,
      openInvoices: { count: openInvoices._count, totalMinor: openInvoices._sum.totalMinor ?? 0 },
      monthToDate: Object.fromEntries(mtd.map((m) => [m.currency, m._sum.amountMinor ?? 0])),
      paymentsThisMonth: Object.fromEntries(payments.map((m) => [m.currency, m._sum.amountMinor ?? 0])),
      recentTeams,
    };
  }

  @StaffAreas('ops')
  @Get('servers')
  async servers(@Query('q') q?: string, @Query('status') status?: string) {
    return {
      data: await this.prisma.server.findMany({
        where: { deletedAt: null, ...(status ? { status: status as never } : {}), ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { id: q }, { project: { team: { name: { contains: q, mode: 'insensitive' } } } }] } : {}) },
        include: { project: { select: { name: true, team: { select: { id: true, name: true, slug: true } } } }, host: { select: { name: true } }, publicIps: { select: { address: true } }, size: { select: { id: true } } },
        orderBy: { createdAt: 'desc' }, take: 100,
      }),
    };
  }

  @StaffAreas('finance')
  @Get('invoices')
  async listInvoices(@Query('status') status?: string) {
    return { data: await this.billingAdmin.listInvoices(status) };
  }

  /** Recent payments of every kind, for refunds of top ups and invoice payments alike. */
  @StaffAreas('finance')
  @Get('payments')
  async listPayments(@Query('status') status?: string) {
    return {
      data: await this.prisma.payment.findMany({
        where: status ? { status: status as never } : {},
        include: { team: { select: { id: true, name: true, slug: true } }, invoice: { select: { number: true } } },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    };
  }

  /** Refunds a card payment to the card (Moyasar refund API; the test provider always succeeds). */
  @StaffAreas('finance')
  @Post('payments/:id/refund') @HttpCode(200)
  refund(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: RefundDto) {
    return this.billingAdmin.refund(actor, id, dto.amountMinor, dto.reason);
  }

  @StaffAreas('finance')
  @Post('invoices/:id/credit-notes')
  creditNote(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: CreditNoteDto) {
    return this.billingAdmin.creditNote(actor, id, dto.amountMinor, dto.reason);
  }

  @StaffAreas('finance')
  @Post('invoices/:id/void') @HttpCode(200)
  voidInvoice(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.billingAdmin.void(actor, id, dto.reason);
  }

  @StaffAreas('finance')
  @Post('invoices/:id/payments')
  recordPayment(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: ManualPaymentDto) {
    return this.billingAdmin.recordPayment(actor, id, { provider: dto.provider, amountMinor: dto.amountMinor, reference: dto.reference, receivedAt: dto.receivedAt ? new Date(dto.receivedAt) : undefined });
  }

  @StaffAreas('finance')
  @Post('invoices/:id/uncollectible') @HttpCode(200)
  uncollectible(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: ReasonDto) {
    return this.billingAdmin.markUncollectible(actor, id, dto.reason);
  }

  @StaffAreas('finance')
  @Get('prices')
  async prices() {
    return { data: await this.prisma.price.findMany({ where: { currency: BOOK_CURRENCY, validTo: null }, orderBy: [{ resourceType: 'asc' }, { monthlyMinor: 'asc' }] }) };
  }

  /** Changes a list price (in the book currency, riyals) from now on: the old row is closed, a new one opens. Running hours keep the old rate. */
  @StaffAreas('finance')
  @Post('prices')
  async setPrice(@CurrentActor() actor: Actor, @Body() dto: PriceDto) {
    const cur = await this.prisma.price.findFirst({ where: { sku: dto.sku, currency: BOOK_CURRENCY, validTo: null } });
    if (!cur) throw ApiError.notFound('price', dto.sku);
    const now = new Date();
    const [, next] = await this.prisma.$transaction([
      this.prisma.price.update({ where: { id: cur.id }, data: { validTo: now } }),
      this.prisma.price.create({ data: { resourceType: cur.resourceType, sku: cur.sku, sizeId: cur.sizeId, currency: BOOK_CURRENCY, monthlyMinor: dto.monthlyMinor, unit: cur.unit, validFrom: now } }),
    ]);
    await this.events.emit('admin.price_set', { sku: dto.sku, from: cur.monthlyMinor, to: dto.monthlyMinor }, { actor });
    return next;
  }

  @StaffAreas('support')
  @Post('abuse/:id/resolve') @HttpCode(204)
  async resolveAbuse(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: ResolveDto) {
    const flag = await this.prisma.abuseFlag.update({ where: { id }, data: { resolvedAt: new Date(), resolution: dto.resolution } });
    if (dto.resolution === 'suspended') await this.trust.suspend(flag.teamId, `abuse: ${flag.kind}`);
    await this.events.emit('admin.abuse_resolved', { flagId: id, resolution: dto.resolution }, { actor });
  }

  @StaffAreas('support')
  @Get('audit')
  async audit(@Query('limit') limit = '100') {
    return { data: await this.prisma.auditLog.findMany({ orderBy: { at: 'desc' }, take: Math.min(Number(limit) || 100, 500), include: { user: { select: { email: true } } } }) };
  }

  // ---- capacity ----

  @StaffAreas('ops')
  @Get('hosts')
  async hosts() {
    return { data: await this.prisma.host.findMany({ include: { _count: { select: { servers: true } } }, orderBy: { name: 'asc' } }) };
  }

  @StaffAreas('ops')
  @Post('hosts')
  async registerHost(@CurrentActor() actor: Actor, @Body() dto: RegisterHostDto) {
    const host = await this.prisma.host.create({ data: { ...dto, driver: dto.driver ?? 'proxmox', driverRef: '{}' } });
    const ref = { ...JSON.parse(dto.driverRef), hostId: host.id };
    const updated = await this.prisma.host.update({ where: { id: host.id }, data: { driverRef: JSON.stringify(ref) } });
    await this.events.emit('admin.host_registered', { hostId: host.id, name: host.name }, { actor });
    return updated;
  }

  @StaffAreas('ops')
  @Post('hosts/:id/status') @HttpCode(204)
  async hostStatus(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: HostStatusDto) {
    await this.prisma.host.update({ where: { id }, data: { status: dto.status } });
    await this.events.emit('admin.host_status', { hostId: id, status: dto.status }, { actor });
  }

  // ---- support ----

  @StaffAreas('support')
  @Get('teams')
  async teams(@Query('q') q?: string) {
    return {
      data: await this.prisma.team.findMany({
        where: q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { slug: { contains: q } }, { members: { some: { user: { email: { contains: q, mode: 'insensitive' } } } } }] } : {},
        include: { _count: { select: { projects: true, abuseFlags: true } } },
        take: 50,
      }),
    };
  }

  @StaffAreas('support')
  @Get('teams/:id')
  team(@Param('id') id: string) {
    return this.prisma.team.findUniqueOrThrow({
      where: { id },
      include: { members: { include: { user: { select: { id: true, email: true, name: true } } } }, projects: { include: { _count: { select: { servers: true } } } }, abuseFlags: { where: { resolvedAt: null } }, credits: true, invoices: { take: 12, orderBy: { periodStart: 'desc' } } },
    });
  }

  @StaffAreas('support')
  @Post('teams/:id/suspend') @HttpCode(204)
  async suspend(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: SuspendDto) {
    await this.trust.suspend(id, `manual: ${dto.reason}`);
    await this.events.emit('admin.team_suspended', { teamId: id, reason: dto.reason }, { actor });
  }

  @StaffAreas('support')
  @Post('teams/:id/reinstate') @HttpCode(204)
  async reinstate(@CurrentActor() actor: Actor, @Param('id') id: string) {
    await this.trust.reinstate(id);
    await this.events.emit('admin.team_reinstated', { teamId: id }, { actor });
  }

  @StaffAreas('support')
  @Post('teams/:id/verify') @HttpCode(204)
  async verify(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() body: { kycLevel: number }) {
    await this.prisma.team.update({ where: { id }, data: { kycLevel: body.kycLevel, status: body.kycLevel >= 1 ? 'active' : undefined } });
    await this.events.emit('admin.team_verified', { teamId: id, kycLevel: body.kycLevel }, { actor });
  }

  // ---- finance ----

  @StaffAreas('finance')
  @Post('teams/:id/credits')
  async credit(@CurrentActor() actor: Actor, @Param('id') id: string, @Body() dto: CreditDto) {
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id } });
    const credit = await this.prisma.credit.create({ data: { teamId: id, kind: dto.kind, currency: team.currency, amountMinor: dto.amountMinor, remainingMinor: dto.amountMinor, reason: dto.reason } });
    await this.events.emit('admin.credit_added', { teamId: id, creditId: credit.id, amountMinor: dto.amountMinor }, { actor });
    return credit;
  }

  @StaffAreas('finance')
  @Post('billing/rollup')
  async rollup(@Body() body: { hourStart?: string }) {
    const n = body.hourStart ? await this.rating.rollupHour(new Date(body.hourStart)) : await this.rating.rollupPreviousHour();
    return { rated: n };
  }

  @StaffAreas('finance')
  @Post('billing/issue-invoices')
  async issue() {
    return { issued: await this.invoices.issueForPreviousMonth() };
  }

  /** Runs the daily overdue reminders and suspensions now (a rerun never mails a stage twice). */
  @StaffAreas('finance')
  @Post('billing/dunning') @HttpCode(200)
  dunning() {
    return this.dunningService.run();
  }

  // ---- exchange rate ----

  @StaffAreas('finance')
  @Get('fx')
  async fx_() {
    return { base: 'USD', quote: 'SAR', rate: await this.fx.rate('SAR'), history: await this.prisma.fxRate.findMany({ orderBy: { at: 'desc' }, take: 20 }) };
  }

  /** Set the USD→SAR rate by hand (the peg is 3.75; only needed if it ever moves). */
  @StaffAreas('finance')
  @Post('fx')
  async setFx(@CurrentActor() actor: Actor, @Body() body: { rate: number }) {
    if (!(body.rate > 0)) throw new Error('rate must be positive');
    const row = await this.fx.set('SAR', body.rate, `admin:${actor.userId}`);
    await this.events.emit('admin.fx_set', { rate: body.rate }, { actor });
    return row;
  }

  @StaffAreas('finance')
  @Post('fx/refresh')
  async refreshFx() {
    return { rate: await this.fx.refresh() };
  }

  @StaffAreas('support')
  @Get('abuse')
  async abuse() {
    return { data: await this.prisma.abuseFlag.findMany({ where: { resolvedAt: null }, include: { team: { select: { id: true, name: true, slug: true } } }, orderBy: { score: 'desc' }, take: 100 }) };
  }

  // ---- staff ----

  /** Grants or removes back office access. Full staff only; an empty role list means full access. */
  @Post('staff/:userId')
  async setStaff(@CurrentActor() actor: Actor, @Param('userId') userId: string, @Body() body: SetStaffDto) {
    if (userId === actor.userId && !body.isStaff) throw ApiError.invalid('You cannot remove your own staff access');
    // External engineers work only in the ops console; they are never staff.
    if (body.isStaff && (await this.prisma.engineerProfile.findUnique({ where: { userId }, select: { kind: true } }))?.kind === 'EXTERNAL') {
      throw ApiError.invalid('This user is an external engineer; external engineers cannot be staff');
    }
    const user = await this.prisma.user.update({ where: { id: userId }, data: { isStaff: body.isStaff, staffRoles: body.isStaff ? body.staffRoles ?? [] : [] } });
    await this.events.emit('staff.updated', { userId, isStaff: user.isStaff, staffRoles: user.staffRoles }, { actor });
    // Access changes take effect on the next request; end old sessions so nothing lingers.
    await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return { id: user.id, email: user.email, isStaff: user.isStaff, staffRoles: user.staffRoles };
  }
}

