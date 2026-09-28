import type { INestApplicationContext } from '@nestjs/common';
import { TimersService, type IdlePlan } from '../../modules/ops/timers/timers.service';

/**
 * Activities of the ops console workflows: thin wrappers over the ops services, every one safe
 * to retry. Merged into the worker's activities in ../activities.ts.
 */
export interface OpsActivities {
  opsTimerIdlePlan(timerId: string): Promise<IdlePlan>;
  opsTimerIdlePrompt(timerId: string): Promise<'prompted' | 'active' | 'stopped'>;
  opsTimerIdleStop(timerId: string): Promise<'stopped' | 'active'>;
}

export function createOpsActivities(app: INestApplicationContext): OpsActivities {
  const timers = app.get(TimersService);
  return {
    opsTimerIdlePlan: (timerId) => timers.idlePlan(timerId),
    opsTimerIdlePrompt: (timerId) => timers.idlePrompt(timerId),
    opsTimerIdleStop: (timerId) => timers.idleStop(timerId),
  };
}
