import { describe, expect, it } from 'vitest';
import { assetPrincipal, decideExtension, decideGrant } from './approval-rules';

const rules = { autoGrantMinutes: 120, maxGrantMinutes: 240, maxExtensions: 1 };

describe('access grant approval rules', () => {
  it('auto approves P1 and P2 work by the on call engineer on an assigned asset for two hours', () => {
    for (const priority of ['P1', 'P2'] as const) {
      expect(decideGrant({ priority, onCall: true, assetAssigned: true, requestedMinutes: 30 }, rules)).toMatchObject({ ok: true, auto: true, minutes: 120, emergency: true });
      expect(decideGrant({ priority, onCall: true, assetAssigned: true, requestedMinutes: 240 }, rules)).toMatchObject({ ok: true, auto: true, minutes: 120 });
    }
  });

  it('sends everything else to a support lead with the requested duration', () => {
    expect(decideGrant({ priority: 'P1', onCall: false, assetAssigned: true, requestedMinutes: 60 }, rules)).toMatchObject({ ok: true, auto: false, minutes: 60, emergency: true });
    expect(decideGrant({ priority: 'P3', onCall: true, assetAssigned: true, requestedMinutes: 90 }, rules)).toMatchObject({ ok: true, auto: false, minutes: 90, emergency: false });
    expect(decideGrant({ priority: 'P4', onCall: false, assetAssigned: true, requestedMinutes: 90 }, rules)).toMatchObject({ ok: true, auto: false });
    // A maintenance run has no priority.
    expect(decideGrant({ priority: null, onCall: true, assetAssigned: true, requestedMinutes: 45 }, rules)).toMatchObject({ ok: true, auto: false, emergency: false });
  });

  it('refuses unassigned assets and grants over four hours', () => {
    expect(decideGrant({ priority: 'P1', onCall: true, assetAssigned: false, requestedMinutes: 60 }, rules)).toMatchObject({ ok: false, code: 'not_assigned' });
    expect(decideGrant({ priority: 'P3', onCall: false, assetAssigned: true, requestedMinutes: 241 }, rules)).toMatchObject({ ok: false, code: 'too_long' });
    expect(decideGrant({ priority: 'P3', onCall: false, assetAssigned: true, requestedMinutes: 0 }, rules)).toMatchObject({ ok: false, code: 'too_long' });
  });

  it('extends an active grant once, from its current expiry', () => {
    const now = new Date('2026-09-28T10:00:00Z');
    const expiresAt = new Date('2026-09-28T11:00:00Z');
    expect(decideExtension({ status: 'ACTIVE', expiresAt, extensions: 0 }, 60, rules, now)).toEqual({ ok: true, expiresAt: new Date('2026-09-28T12:00:00Z') });
    expect(decideExtension({ status: 'ACTIVE', expiresAt, extensions: 1 }, 60, rules, now)).toMatchObject({ ok: false, code: 'extension_used' });
    expect(decideExtension({ status: 'ACTIVE', expiresAt, extensions: 0 }, 300, rules, now)).toMatchObject({ ok: false, code: 'too_long' });
    expect(decideExtension({ status: 'EXPIRED', expiresAt, extensions: 0 }, 60, rules, now)).toMatchObject({ ok: false, code: 'not_active' });
    expect(decideExtension({ status: 'ACTIVE', expiresAt: new Date('2026-09-28T09:59:00Z'), extensions: 0 }, 60, rules, now)).toMatchObject({ ok: false, code: 'not_active' });
    expect(assetPrincipal('abc')).toBe('prgd-asset-abc');
  });
});
