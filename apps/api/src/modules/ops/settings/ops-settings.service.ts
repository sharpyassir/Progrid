import { Global, Injectable, Module } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ApiError } from '../../../common/errors/api-error';
import type { Actor } from '../../../common/auth/actor';
import { loadConfig } from '../../../config/config';

/**
 * Ops console settings (spec section 7). Stored as one JSON row; keys that are not stored use
 * the defaults below, so a new setting needs no migration. Full staff edit them with
 * PATCH /admin/ops/settings.
 */
export const opsSettingsSchema = z.object({
  /** An unacknowledged high urgency page goes to the support lead after this long. */
  alertAckTargetSeconds: z.number().int().min(1).max(86_400),
  /** The ops console suggests Escalate on a P1 not contained after this long. */
  escalationSuggestMinutes: z.number().int().min(1).max(1440),
  /** Auto approved grants (P1 or P2 ticket, engineer on call, asset assigned) last this long. */
  autoGrantMinutes: z.number().int().min(5).max(1440),
  /** Longest grant an engineer may request, and the longest single extension. */
  maxGrantMinutes: z.number().int().min(5).max(1440),
  /** Extensions allowed per grant, each with a reason. */
  maxExtensions: z.number().int().min(0).max(5),
  /** A request nobody approved or denied expires after this long. */
  grantRequestExpiryMinutes: z.number().int().min(5).max(10_080),
  /** A running timer without activity prompts the engineer after this long ... */
  timerIdlePromptSeconds: z.number().int().min(1).max(86_400),
  /** ... and stops on its own after this long. */
  timerAutoStopSeconds: z.number().int().min(1).max(86_400),
  /** Terminal recordings are deleted from object storage after this many months. */
  recordingRetentionMonths: z.number().int().min(1).max(120),
  /** A P1 postmortem is due this long after the ticket is resolved. */
  postmortemDueHours: z.number().int().min(1).max(720),
  /** Night window for contractor pay, contract local time (22:00 to 06:00). */
  nightStartHour: z.number().int().min(0).max(23),
  nightEndHour: z.number().int().min(0).max(23),
  /** Night multiplier for new engineer profiles (each profile keeps its own). */
  defaultNightMultiplier: z.number().min(1).max(5),
  /** Residency policy new managed contracts start with. */
  defaultAccessPolicy: z.enum(['ANY', 'SAUDI_ONLY', 'TURKIYE_ONLY']),
  /** Missing handover: reminder to the engineer this long after the scheduled shift end ... */
  handoverReminderMinutes: z.number().int().min(1).max(1440),
  /** ... and the support lead is notified this long after it. */
  handoverEscalateMinutes: z.number().int().min(1).max(1440),
});

export type OpsSettingsData = z.infer<typeof opsSettingsSchema>;

export function defaultOpsSettings(): OpsSettingsData {
  const c = loadConfig();
  return {
    alertAckTargetSeconds: c.PAGE_ACK_TIMEOUT_SECONDS,
    escalationSuggestMinutes: 45,
    autoGrantMinutes: 120,
    maxGrantMinutes: 240,
    maxExtensions: 1,
    grantRequestExpiryMinutes: 240,
    timerIdlePromptSeconds: c.PRGD_OPS_TIMER_IDLE_PROMPT_SECONDS,
    timerAutoStopSeconds: c.PRGD_OPS_TIMER_AUTO_STOP_SECONDS,
    recordingRetentionMonths: 12,
    postmortemDueHours: 48,
    nightStartHour: 22,
    nightEndHour: 6,
    defaultNightMultiplier: 1.5,
    defaultAccessPolicy: 'ANY',
    handoverReminderMinutes: 15,
    handoverEscalateMinutes: 60,
  };
}

@Injectable()
export class OpsSettingsService {
  private cache?: { at: number; value: OpsSettingsData };
  constructor(private readonly prisma: PrismaService) {}

  /** Effective settings: stored values over the defaults. Cached for ten seconds. */
  async get(): Promise<OpsSettingsData> {
    if (this.cache && Date.now() - this.cache.at < 10_000) return this.cache.value;
    const row = await this.prisma.opsSettings.findUnique({ where: { id: 'default' } });
    const stored = opsSettingsSchema.partial().safeParse(row?.data ?? {});
    const value = { ...defaultOpsSettings(), ...(stored.success ? stripUndefined(stored.data) : {}) };
    this.cache = { at: Date.now(), value };
    return value;
  }

  async present() {
    const [value, row] = await Promise.all([this.get(), this.prisma.opsSettings.findUnique({ where: { id: 'default' } })]);
    return { settings: value, defaults: defaultOpsSettings(), stored: row?.data ?? {}, updatedAt: row?.updatedAt ?? null, updatedById: row?.updatedById ?? null };
  }

  async update(actor: Actor, patch: unknown) {
    const parsed = opsSettingsSchema.partial().strict().safeParse(patch);
    if (!parsed.success) throw ApiError.invalid('Invalid settings', { issues: parsed.error.issues.slice(0, 10) });
    const row = await this.prisma.opsSettings.findUnique({ where: { id: 'default' } });
    const data = { ...((row?.data as Record<string, unknown>) ?? {}), ...stripUndefined(parsed.data) };
    const merged = { ...defaultOpsSettings(), ...data } as OpsSettingsData;
    if (merged.timerAutoStopSeconds <= merged.timerIdlePromptSeconds) throw ApiError.invalid('timerAutoStopSeconds must be longer than timerIdlePromptSeconds');
    if (merged.autoGrantMinutes > merged.maxGrantMinutes) throw ApiError.invalid('autoGrantMinutes cannot exceed maxGrantMinutes');
    await this.prisma.opsSettings.upsert({ where: { id: 'default' }, create: { id: 'default', data: data as Prisma.InputJsonValue, updatedById: actor.userId }, update: { data: data as Prisma.InputJsonValue, updatedById: actor.userId } });
    this.cache = undefined;
    return { changed: Object.keys(parsed.data), ...(await this.present()) };
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Global so the managed module (residency defaults, page timeout) and the ops module share one instance. */
@Global()
@Module({ providers: [OpsSettingsService], exports: [OpsSettingsService] })
export class OpsSettingsModule {}
