import { Injectable } from '@nestjs/common';
import type { ManagedCalendar, ManagedContract, ManagedPlan, ManagedPriority } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { parseTargets } from '../managed.constants';
import { CALENDARS, addSlaMinutes, dueDates, slaMinutesBetween, type SlaCalendar } from './sla-calculator';

type ContractWithPlan = ManagedContract & { plan: ManagedPlan };

/**
 * The calendar helper: turns a contract into an SlaCalendar (coverage, country, holidays from
 * the Holiday table) and computes ticket due times. Holidays are cached for five minutes.
 */
@Injectable()
export class SlaService {
  private cache = new Map<ManagedCalendar, { at: number; dates: Set<string> }>();
  constructor(private readonly prisma: PrismaService) {}

  async holidays(country: ManagedCalendar) {
    const hit = this.cache.get(country);
    if (hit && Date.now() - hit.at < 5 * 60_000) return hit.dates;
    const rows = await this.prisma.holiday.findMany({ where: { country }, select: { date: true } });
    const dates = new Set(rows.map((r) => r.date.toISOString().slice(0, 10)));
    this.cache.set(country, { at: Date.now(), dates });
    return dates;
  }

  /** Drop the cache after the holiday table changes. */
  invalidate() {
    this.cache.clear();
  }

  async calendarFor(c: ContractWithPlan): Promise<SlaCalendar> {
    return { coverage: c.plan.coverage, country: c.calendar, holidays: await this.holidays(c.calendar) };
  }

  targets(c: ContractWithPlan) {
    return { response: parseTargets(c.plan.responseTargets, 'responseTargets'), resolve: parseTargets(c.plan.resolveTargets, 'resolveTargets') };
  }

  async dueDates(c: ContractWithPlan, priority: ManagedPriority, openedAt: Date) {
    return dueDates(openedAt, priority, this.targets(c), await this.calendarFor(c));
  }

  /** When a timer of `targetMinutes` started at `openedAt` reaches `fraction` of its target. */
  async pointAt(c: ContractWithPlan, openedAt: Date, targetMinutes: number, fraction: number) {
    return addSlaMinutes(openedAt, targetMinutes * fraction, await this.calendarFor(c));
  }

  async minutesBetween(c: ContractWithPlan, from: Date, to: Date) {
    return slaMinutesBetween(from, to, await this.calendarFor(c));
  }

  /** Public holidays for the back office calendar view. */
  async list(country?: ManagedCalendar, year?: number) {
    const rows = await this.prisma.holiday.findMany({
      where: { ...(country ? { country } : {}), ...(year ? { date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } } : {}) },
      orderBy: [{ date: 'asc' }, { country: 'asc' }],
    });
    return { data: rows.map((h) => ({ id: h.id, country: h.country, date: h.date.toISOString().slice(0, 10), name: h.name })), calendars: CALENDARS };
  }

  async upsertHoliday(country: ManagedCalendar, date: string, name: string) {
    const d = new Date(`${date}T00:00:00Z`);
    const h = await this.prisma.holiday.upsert({ where: { country_date: { country, date: d } }, update: { name }, create: { country, date: d, name } });
    this.invalidate();
    return { id: h.id, country: h.country, date, name: h.name };
  }

  async deleteHoliday(id: string) {
    await this.prisma.holiday.delete({ where: { id } }).catch(() => undefined);
    this.invalidate();
    return { deleted: true };
  }
}
