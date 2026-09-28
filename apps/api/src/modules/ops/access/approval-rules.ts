import type { ManagedPriority } from '@prisma/client';

/**
 * Access grant approval rules (spec section 3, rule 4). Pure, for tests.
 *
 *   P1 or P2 ticket + the engineer is on call now + the asset is on a contract the engineer may
 *   work on  ->  approved automatically for autoGrantMinutes (two hours), as an emergency grant.
 *   Anything else (lower priority, not on call, a maintenance run)  ->  a support lead decides.
 *   No grant is longer than maxGrantMinutes (four hours); one extension with a reason.
 */
export interface GrantFacts {
  priority: ManagedPriority | null;
  onCall: boolean;
  assetAssigned: boolean;
  requestedMinutes: number;
}

export interface GrantRules {
  autoGrantMinutes: number;
  maxGrantMinutes: number;
  maxExtensions: number;
}

export type GrantDecision =
  | { ok: false; code: 'too_long' | 'not_assigned'; message: string }
  | { ok: true; auto: boolean; minutes: number; emergency: boolean; why: string };

export const isUrgent = (p: ManagedPriority | null) => p === 'P1' || p === 'P2';

export function decideGrant(f: GrantFacts, r: GrantRules): GrantDecision {
  if (!f.assetAssigned) return { ok: false, code: 'not_assigned', message: 'The asset is not on a contract you are assigned to' };
  if (f.requestedMinutes < 1 || f.requestedMinutes > r.maxGrantMinutes) return { ok: false, code: 'too_long', message: `A grant lasts at most ${r.maxGrantMinutes} minutes` };
  const emergency = isUrgent(f.priority);
  if (emergency && f.onCall) return { ok: true, auto: true, minutes: r.autoGrantMinutes, emergency, why: `${f.priority} ticket and the engineer is on call` };
  const why = !f.priority ? 'maintenance run' : !emergency ? `${f.priority} ticket` : 'the engineer is not on call';
  return { ok: true, auto: false, minutes: f.requestedMinutes, emergency, why: `needs a support lead: ${why}` };
}

export type ExtensionDecision = { ok: false; code: 'extension_used' | 'too_long' | 'not_active'; message: string } | { ok: true; expiresAt: Date };

/** One extension (maxExtensions) of at most maxGrantMinutes, counted from the current expiry. */
export function decideExtension(g: { status: string; expiresAt: Date | null; extensions: number }, minutes: number, r: GrantRules, now = new Date()): ExtensionDecision {
  if (g.status !== 'ACTIVE' || !g.expiresAt || g.expiresAt <= now) return { ok: false, code: 'not_active', message: 'Only an active grant can be extended' };
  if (g.extensions >= r.maxExtensions) return { ok: false, code: 'extension_used', message: `A grant can be extended ${r.maxExtensions === 1 ? 'once' : `${r.maxExtensions} times`}` };
  if (minutes < 1 || minutes > r.maxGrantMinutes) return { ok: false, code: 'too_long', message: `An extension is at most ${r.maxGrantMinutes} minutes` };
  return { ok: true, expiresAt: new Date(g.expiresAt.getTime() + minutes * 60_000) };
}

/** The SSH principal of an asset: the only principal certificates for it carry. */
export const assetPrincipal = (assetId: string) => `prgd-asset-${assetId}`;
