import type { Me } from './types';

/**
 * Defaults of the ops settings (docs/devops-console.md, Settings). Engineers cannot read the live
 * values, so the console shows these; the API enforces the real ones.
 */
export const MAX_GRANT_MINUTES = 240;
export const AUTO_GRANT_MINUTES = 120;

/** On call now: a started, not ended PRIMARY or SECONDARY shift covering this moment (the auto approval rule). */
export function onCallNow(me: Me | null) {
  const s = me?.currentShift;
  const now = Date.now();
  return !!s && !!s.startedAt && !s.endedAt && new Date(s.startsAt).getTime() <= now && new Date(s.endsAt).getTime() > now;
}
