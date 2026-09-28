import { Injectable } from '@nestjs/common';
import type { OnboardingItem } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ApiError } from '../../../common/errors/api-error';
import type { Actor } from '../../../common/auth/actor';
import { loadConfig } from '../../../config/config';
import { EventsService } from '../../events/events.service';
import { DEFAULT_ONBOARDING } from '../managed.constants';
import { ManagedWorkflows } from '../managed-workflows.service';
import { ManagedNotify } from '../managed-notify.service';

export function presentOnboardingItem(i: OnboardingItem) {
  return { id: i.id, key: i.key, title: i.title, done: i.done, doneById: i.doneById, doneAt: i.doneAt, note: i.note, sortOrder: i.sortOrder };
}

/**
 * The onboarding checklist. Activating a contract creates it and starts `managedOnboarding`,
 * which waits for a `checklistUpdated` signal after each change and moves the contract to
 * ACTIVE (billing starts) once every item is done. When the signal cannot be delivered the
 * same check runs inline, so a Temporal outage never strands a contract.
 */
@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly workflows: ManagedWorkflows,
    private readonly notify: ManagedNotify,
  ) {}

  /** Creates the default checklist items that are missing. Idempotent. */
  async ensureChecklist(contractId: string) {
    await this.prisma.onboardingItem.createMany({
      data: DEFAULT_ONBOARDING.map((d, i) => ({ contractId, key: d.key, title: d.title, sortOrder: i })),
      skipDuplicates: true,
    });
    return this.list(contractId);
  }

  async list(contractId: string, withChecks = false) {
    const items = await this.prisma.onboardingItem.findMany({ where: { contractId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    const checks = withChecks ? await this.checks(contractId) : null;
    return { data: items.map((i) => ({ ...presentOnboardingItem(i), ...(checks ? { check: checks[i.key] ?? null } : {}) })), done: items.filter((i) => i.done).length, total: items.length };
  }

  /**
   * What the system can see for each default item, shown next to the checklist in the back
   * office. Advisory only: the engineer ticks the item.
   */
  async checks(contractId: string): Promise<Record<string, { ready: boolean; hint: string }>> {
    const assets = await this.prisma.managedAsset.findMany({ where: { contractId, status: 'APPROVED', removedAt: null } });
    const servers = assets.filter((a) => a.kind !== 'SITE');
    const silent = servers.filter((a) => a.kind === 'EXTERNAL_SERVER' && !a.lastHeartbeatAt);
    const unmonitored = assets.filter((a) => !a.monitoringEnabled);
    const noBackup = servers.filter((a) => !a.backupEnabled);
    const noAccess = servers.filter((a) => !a.managementAddress && a.kind === 'EXTERNAL_SERVER');
    const [restoreTests, runbooks, matrix] = await Promise.all([
      this.prisma.maintenanceRun.count({ where: { status: 'SUCCEEDED', task: { contractId, kind: 'BACKUP_TEST' } } }),
      this.prisma.runbook.count({ where: { tags: { has: `contract:${contractId}` } } }),
      this.prisma.responsibility.count({ where: { contractId } }),
    ]);
    const names = (xs: { name: string }[]) => xs.map((x) => x.name).join(', ');
    return {
      monitoring: !assets.length ? { ready: false, hint: 'No approved assets yet' }
        : unmonitored.length ? { ready: false, hint: `Monitoring is off for ${names(unmonitored)}` }
        : silent.length ? { ready: false, hint: `No heartbeat yet from ${names(silent)}` }
        : { ready: true, hint: `${assets.length} assets monitored` },
      backups: noBackup.length ? { ready: false, hint: `Backups are off for ${names(noBackup)}` }
        : !restoreTests ? { ready: false, hint: 'No successful backup restore test yet' }
        : { ready: true, hint: `${restoreTests} successful restore tests` },
      access: noAccess.length ? { ready: false, hint: `No management address for ${names(noAccess)}` } : { ready: servers.length > 0, hint: servers.length ? 'Every server is reachable over the management network' : 'No servers yet' },
      documentation: runbooks ? { ready: true, hint: `${runbooks} runbooks tagged contract:${contractId}` } : { ready: false, hint: `Write a runbook tagged contract:${contractId}` },
      responsibility_matrix: { ready: matrix > 0, hint: `${matrix} areas in the matrix` },
    };
  }

  async addItem(actor: Actor, contractId: string, dto: { key: string; title: string }) {
    const c = await this.contract(contractId);
    if (c.status !== 'ONBOARDING' && c.status !== 'DRAFT') throw ApiError.invalidState('Checklist items can only be added before the contract is active');
    const max = await this.prisma.onboardingItem.aggregate({ where: { contractId }, _max: { sortOrder: true } });
    const item = await this.prisma.onboardingItem.create({ data: { contractId, key: dto.key, title: dto.title, sortOrder: (max._max.sortOrder ?? 0) + 1 } }).catch(() => {
      throw ApiError.conflict('already_exists', `Checklist item ${dto.key} already exists`);
    });
    await this.events.emit('managed.onboarding_item_added', { contractId, key: dto.key }, { teamId: c.teamId, actor, resource: `managed_contract:${contractId}` });
    return presentOnboardingItem(item);
  }

  /** Ticks or unticks an item, then lets the onboarding workflow decide whether the contract is ready. */
  async setItem(actor: Actor, contractId: string, key: string, dto: { done: boolean; note?: string }) {
    const c = await this.contract(contractId);
    if (c.status !== 'ONBOARDING') throw ApiError.invalidState(`The checklist can only change while the contract is onboarding (it is ${c.status})`);
    const item = await this.prisma.onboardingItem.findUnique({ where: { contractId_key: { contractId, key } } });
    if (!item) throw ApiError.notFound('onboarding item', key);
    const updated = await this.prisma.onboardingItem.update({
      where: { id: item.id },
      data: { done: dto.done, doneById: dto.done ? actor.userId : null, doneAt: dto.done ? new Date() : null, ...(dto.note !== undefined ? { note: dto.note } : {}) },
    });
    await this.events.emit(dto.done ? 'managed.onboarding_item_done' : 'managed.onboarding_item_reopened', { contractId, key }, { teamId: c.teamId, actor, resource: `managed_contract:${contractId}` });
    const signalled = await this.workflows.signal(ManagedWorkflows.onboardingId(contractId), 'checklistUpdated');
    if (!signalled) await this.activateIfComplete(contractId, 'inline');
    return presentOnboardingItem(updated);
  }

  /**
   * ONBOARDING to ACTIVE once every checklist item is done. Returns the resulting state:
   * `active` (now or already), `waiting` (items left) or `stopped` (suspended, cancelled or gone).
   */
  async activateIfComplete(contractId: string, via: 'workflow' | 'inline'): Promise<'active' | 'waiting' | 'stopped'> {
    const c = await this.prisma.managedContract.findUnique({ where: { id: contractId }, include: { plan: true } });
    if (!c) return 'stopped';
    if (c.status === 'ACTIVE') return 'active';
    if (c.status !== 'ONBOARDING') return 'stopped';
    const [total, open] = await Promise.all([
      this.prisma.onboardingItem.count({ where: { contractId } }),
      this.prisma.onboardingItem.count({ where: { contractId, done: false } }),
    ]);
    if (total === 0 || open > 0) return 'waiting';
    const now = new Date();
    const termEndsAt = new Date(now);
    termEndsAt.setUTCMonth(termEndsAt.getUTCMonth() + c.termMonths);
    const moved = await this.prisma.managedContract.updateMany({ where: { id: contractId, status: 'ONBOARDING' }, data: { status: 'ACTIVE', activatedAt: now, termEndsAt } });
    if (moved.count === 1) {
      await this.events.emit('managed.contract_activated', { contractId, plan: c.plan.code, activatedAt: now.toISOString(), via }, { teamId: c.teamId, resource: `managed_contract:${contractId}` });
      await this.notify.toOwners(c.teamId, {
        subject: `Your ${c.plan.name} managed cloud contract is active`,
        text: `Onboarding is complete and your ${c.plan.name} contract is now active. Our engineers monitor and maintain your assets from today, and the monthly fee is billed from today on your regular invoice.\n\nOpen a ticket or follow your assets here:\n${loadConfig().CONSOLE_URL}/managed`,
      });
    }
    return 'active';
  }

  private async contract(id: string) {
    const c = await this.prisma.managedContract.findUnique({ where: { id } });
    if (!c) throw ApiError.notFound('managed contract', id);
    return c;
  }
}
