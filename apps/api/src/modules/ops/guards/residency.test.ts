import { describe, expect, it } from 'vitest';
import { eligibility, isInternalEngineerStaff, isLeadStaff, residencyAllows, type EngineerFacts } from './residency';

const external = (country: string, over: Partial<EngineerFacts> = {}): EngineerFacts => ({
  userId: 'u1', isStaff: false, staffRoles: [], profile: { id: 'p1', kind: 'EXTERNAL', status: 'ACTIVE', country }, assigned: true, ...over,
});

describe('residency policy', () => {
  it('lets anyone work on ANY and only the right country on SAUDI_ONLY and TURKIYE_ONLY', () => {
    expect(residencyAllows('ANY', 'JO')).toBe(true);
    expect(residencyAllows('ANY', null)).toBe(true);
    expect(residencyAllows('SAUDI_ONLY', 'SA')).toBe(true);
    expect(residencyAllows('SAUDI_ONLY', 'sa')).toBe(true);
    expect(residencyAllows('SAUDI_ONLY', 'JO')).toBe(false);
    expect(residencyAllows('SAUDI_ONLY', 'TR')).toBe(false);
    expect(residencyAllows('TURKIYE_ONLY', 'TR')).toBe(true);
    expect(residencyAllows('TURKIYE_ONLY', 'SA')).toBe(false);
    expect(residencyAllows('TURKIYE_ONLY', undefined)).toBe(false);
    expect(residencyAllows('SOMETHING_NEW', 'SA')).toBe(false);
  });
});

describe('engineer eligibility for a contract', () => {
  it('needs an assignment for external engineers and the right country for everyone', () => {
    expect(eligibility(external('JO'), 'ANY')).toMatchObject({ ok: true, internal: false, country: 'JO' });
    expect(eligibility(external('JO', { assigned: false }), 'ANY')).toMatchObject({ ok: false, reason: 'not_assigned' });
    expect(eligibility(external('JO'), 'SAUDI_ONLY')).toMatchObject({ ok: false, reason: 'residency' });
    // Residency is reported before a missing assignment.
    expect(eligibility(external('JO', { assigned: false }), 'SAUDI_ONLY')).toMatchObject({ ok: false, reason: 'residency' });
    expect(eligibility(external('SA'), 'SAUDI_ONLY')).toMatchObject({ ok: true });
  });

  it('refuses suspended and offboarded engineers and people who are not engineers', () => {
    expect(eligibility(external('SA', { profile: { id: 'p', kind: 'EXTERNAL', status: 'SUSPENDED', country: 'SA' } }), 'ANY')).toMatchObject({ ok: false, reason: 'inactive' });
    expect(eligibility(external('SA', { profile: { id: 'p', kind: 'EXTERNAL', status: 'OFFBOARDED', country: 'SA' } }), 'ANY')).toMatchObject({ ok: false, reason: 'inactive' });
    expect(eligibility({ userId: 'u', isStaff: false, staffRoles: [], profile: null, assigned: false }, 'ANY')).toMatchObject({ ok: false, reason: 'not_engineer' });
    expect(eligibility({ userId: 'u', isStaff: true, staffRoles: ['finance'], profile: null, assigned: false }, 'ANY')).toMatchObject({ ok: false, reason: 'not_engineer' });
  });

  it('treats engineer staff as internal engineers on every contract, counted in Saudi Arabia without a profile', () => {
    const staff = { userId: 'u', isStaff: true, staffRoles: ['engineer'], profile: null, assigned: false };
    expect(eligibility(staff, 'ANY')).toMatchObject({ ok: true, internal: true, country: 'SA' });
    expect(eligibility(staff, 'SAUDI_ONLY')).toMatchObject({ ok: true });
    expect(eligibility(staff, 'TURKIYE_ONLY')).toMatchObject({ ok: false, reason: 'residency' });
    const turkish = { ...staff, profile: { id: 'p', kind: 'INTERNAL' as const, status: 'ACTIVE' as const, country: 'TR' } };
    expect(eligibility(turkish, 'TURKIYE_ONLY')).toMatchObject({ ok: true, internal: true });
  });

  it('knows which staff are engineers and which are leads', () => {
    expect(isInternalEngineerStaff({ isStaff: true, staffRoles: [] })).toBe(true);
    expect(isInternalEngineerStaff({ isStaff: true, staffRoles: ['support_lead'] })).toBe(true);
    expect(isInternalEngineerStaff({ isStaff: true, staffRoles: ['finance'] })).toBe(false);
    expect(isInternalEngineerStaff({ isStaff: false, staffRoles: ['engineer'] })).toBe(false);
    expect(isLeadStaff({ isStaff: true, staffRoles: ['engineer'] })).toBe(false);
    expect(isLeadStaff({ isStaff: true, staffRoles: ['engineer', 'support_lead'] })).toBe(true);
    expect(isLeadStaff({ isStaff: true, staffRoles: [] })).toBe(true);
  });
});
