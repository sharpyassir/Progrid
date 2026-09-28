import type { INestApplicationContext } from '@nestjs/common';
import { TimersService, type IdlePlan } from '../../modules/ops/timers/timers.service';
import { GrantsService, type GrantPlan } from '../../modules/ops/access/grants.service';

/**
 * Activities of the ops console workflows: thin wrappers over the ops services, every one safe
 * to retry. Merged into the worker's activities in ../activities.ts.
 */
export interface OpsActivities {
  opsTimerIdlePlan(timerId: string): Promise<IdlePlan>;
  opsTimerIdlePrompt(timerId: string): Promise<'prompted' | 'active' | 'stopped'>;
  opsTimerIdleStop(timerId: string): Promise<'stopped' | 'active'>;
  opsGrantPlan(grantId: string): Promise<GrantPlan>;
  opsGrantActivate(grantId: string): Promise<string>;
  opsGrantExpire(grantId: string): Promise<string>;
}

export function createOpsActivities(app: INestApplicationContext): OpsActivities {
  const timers = app.get(TimersService);
  const grants = app.get(GrantsService);
  return {
    opsTimerIdlePlan: (timerId) => timers.idlePlan(timerId),
    opsTimerIdlePrompt: (timerId) => timers.idlePrompt(timerId),
    opsTimerIdleStop: (timerId) => timers.idleStop(timerId),
    opsGrantPlan: (grantId) => grants.plan(grantId),
    opsGrantActivate: (grantId) => grants.activate(grantId),
    opsGrantExpire: (grantId) => grants.expire(grantId),
  };
}
