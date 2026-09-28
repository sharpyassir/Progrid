import { describe, expect, it } from 'vitest';
import { reminderStageFor } from './dunning.service';
import { creditNoteNumber, invoiceNumber } from './pricing';
import { allowedWhileSuspended } from '../../common/auth/auth.guard';

describe('reminderStageFor', () => {
  it('sends nothing before three days', () => {
    expect(reminderStageFor(0)).toBe(0);
    expect(reminderStageFor(2)).toBe(0);
  });
  it('steps through 3, 7 and 14 days', () => {
    expect(reminderStageFor(3)).toBe(3);
    expect(reminderStageFor(6)).toBe(3);
    expect(reminderStageFor(7)).toBe(7);
    expect(reminderStageFor(13)).toBe(7);
    expect(reminderStageFor(14)).toBe(14);
    expect(reminderStageFor(40)).toBe(14);
  });
});

describe('document numbers', () => {
  it('pads the sequence to six digits', () => {
    expect(invoiceNumber(2026, 123)).toBe('PRGD-2026-000123');
    expect(creditNoteNumber(2026, BigInt(45))).toBe('CN-2026-000045');
  });
});

describe('allowedWhileSuspended', () => {
  it('allows billing reads and paying', () => {
    expect(allowedWhileSuspended('GET', '/v1/billing/invoices', ['billing:read'])).toBe(true);
    expect(allowedWhileSuspended('POST', '/v1/billing/topup', ['billing:write'])).toBe(true);
    expect(allowedWhileSuspended('POST', '/v1/billing/invoices/abc/pay', ['billing:write'])).toBe(true);
    expect(allowedWhileSuspended('GET', '/v1/account', [])).toBe(true);
  });
  it('refuses everything else', () => {
    expect(allowedWhileSuspended('GET', '/v1/servers', ['servers:read'])).toBe(false);
    expect(allowedWhileSuspended('POST', '/v1/servers', ['servers:write'])).toBe(false);
    expect(allowedWhileSuspended('GET', '/v1/projects', [])).toBe(false);
    expect(allowedWhileSuspended('POST', '/v1/tokens', ['iam:write'])).toBe(false);
  });
});
