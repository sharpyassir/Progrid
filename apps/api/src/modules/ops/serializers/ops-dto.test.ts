import { describe, expect, it } from 'vitest';
import type { ManagedAsset, ManagedContract, Ticket, TicketMessage } from '@prisma/client';
import { maskContact, opsAsset, opsContract, opsMessage, opsTicketSummary } from './ops-dto';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

describe('ops data masking', () => {
  it('masks email addresses and phone numbers but keeps addresses, versions and dates', () => {
    expect(maskContact('mail ali@example.sa or call +966 50 123 4567, 00966501234567 or 0501234567')).toBe('mail [email hidden] or call [phone hidden], [phone hidden] or [phone hidden]');
    const technical = 'nginx 1.24.0 on 203.0.113.50:8443, since 2026-09-28T10:15:00Z, pid 12345, fd00::1';
    expect(maskContact(technical)).toBe(technical);
  });

  it('masks customer written text for external engineers only, never staff notes', () => {
    const base = { id: 'm1', ticketId: 't1', authorName: 'Customer', internal: false, rootCause: false, createdAt: new Date() };
    const customer = { ...base, fromSupport: false, authorId: 'cust-user', body: 'reach me at a@b.io' } as TicketMessage;
    const note = { ...base, fromSupport: true, internal: true, authorId: 'eng', body: 'owner is a@b.io' } as TicketMessage;
    expect(opsMessage(customer, true).body).toBe('reach me at [email hidden]');
    expect(opsMessage(customer, true).authorId).toBeNull();
    expect(opsMessage(customer, false).body).toBe('reach me at a@b.io');
    expect(opsMessage(note, true).body).toBe('owner is a@b.io');
  });

  it('serializes contracts without billing fields and assets without tokens', () => {
    const contract = {
      id: 'c1', teamId: 'team', planId: 'p', status: 'ACTIVE', calendar: 'SA', currency: 'SAR', priceOverrideMinor: 500_000, includedMinutesOverride: 60, maxAssetsOverride: 3,
      liabilityCapMinor: 1_000_000, signedByName: 'CEO', accessPolicy: 'SAUDI_ONLY', activatedAt: new Date(), suspensions: [], notes: 'secret notes',
      plan: { code: 'ESSENTIAL', name: 'Essential', coverage: 'BUSINESS_HOURS' }, team: { name: 'Acme', billingEmail: 'billing@acme.sa' },
    } as unknown as ManagedContract & { plan: { code: string; name: string; coverage: 'BUSINESS_HOURS' }; team: { name: string } };
    const out = opsContract(contract);
    expect(Object.keys(out).sort()).toEqual(['accessPolicy', 'activatedAt', 'calendar', 'customer', 'id', 'plan', 'status', 'timeZone']);
    expect(JSON.stringify(out)).not.toMatch(/Minor|currency|billing|secret/i);
    const asset = { id: 'a', contractId: 'c1', kind: 'EXTERNAL_SERVER', name: 'web', heartbeatTokenHash: 'abc', requestedById: 'u', heartbeatReport: { status: 'ok', contact: 'ops@acme.sa' } } as unknown as ManagedAsset;
    const a = opsAsset(asset);
    expect(JSON.stringify(a)).not.toMatch(EMAIL);
    expect(a).not.toHaveProperty('heartbeatTokenHash');
    expect(a).not.toHaveProperty('requestedById');
  });

  it('masks the subject and computes the SLA time left', () => {
    const now = new Date('2026-09-28T10:00:00Z');
    const t = { id: 't', number: 7, subject: 'Call +966501234567', status: 'open', managedPriority: 'P1', responseDueAt: new Date('2026-09-28T10:30:00Z'), resolveDueAt: new Date('2026-09-28T14:00:00Z'), firstRespondedAt: null, createdById: 'cust' } as unknown as Ticket;
    const out = opsTicketSummary(t, true, now);
    expect(out.subject).toBe('Call [phone hidden]');
    expect(out.slaSecondsLeft).toBe(1800);
    expect(out).not.toHaveProperty('createdById');
    expect(opsTicketSummary({ ...t, firstRespondedAt: now }, true, now).slaSecondsLeft).toBe(4 * 3600);
    expect(opsTicketSummary({ ...t, status: 'closed' }, false, now).slaSecondsLeft).toBeNull();
  });
});
