import { describe, expect, it } from 'vitest';
import { backupWithholding, exemptFrom1099Nec, formatTin, validEin, validItin, validSsn, w8ExpiresAt } from './tax-rules';

describe('taxpayer identification numbers', () => {
  it('accepts valid SSNs and rejects numbers the SSA never issues', () => {
    expect(validSsn('123-45-6789')).toBe(true);
    expect(validSsn('123456789')).toBe(true);
    for (const bad of ['000-12-3456', '666-12-3456', '912-34-5678', '123-00-4567', '123-45-0000', '12345678', 'abc-de-fghi']) expect(validSsn(bad)).toBe(false);
  });

  it('checks ITIN ranges', () => {
    expect(validItin('912-70-1234')).toBe(true);
    expect(validItin('900-93-1234')).toBe(false);
    expect(validItin('812-70-1234')).toBe(false);
  });

  it('checks EIN prefixes', () => {
    expect(validEin('12-3456789')).toBe(true);
    expect(validEin('07-3456789')).toBe(false);
    expect(validEin('12-345678')).toBe(false);
  });

  it('formats numbers as printed on a 1099', () => {
    expect(formatTin('ssn', '123456789')).toBe('123-45-6789');
    expect(formatTin('ein', '123456789')).toBe('12-3456789');
  });
});

describe('form rules', () => {
  it('keeps a W-8 valid until the end of the third calendar year after signing', () => {
    expect(w8ExpiresAt(new Date('2026-10-02T12:00:00Z')).toISOString()).toBe('2029-12-31T23:59:59.999Z');
    expect(w8ExpiresAt(new Date('2026-01-01T00:00:00Z')).toISOString()).toBe('2029-12-31T23:59:59.999Z');
  });

  it('withholds 24% under backup withholding', () => {
    expect(backupWithholding(100_000)).toBe(24_000);
    expect(backupWithholding(12_345)).toBe(2_963);
    expect(backupWithholding(0)).toBe(0);
  });

  it('reports individuals, partnerships and LLCs taxed as such, but not corporations or foreign persons', () => {
    const w9 = (taxClassification: string, exemptPayeeCode: string | null = null) => ({ formType: 'W9', taxClassification, exemptPayeeCode });
    expect(exemptFrom1099Nec(w9('individual'))).toBe(false);
    expect(exemptFrom1099Nec(w9('llc_p'))).toBe(false);
    expect(exemptFrom1099Nec(w9('partnership'))).toBe(false);
    expect(exemptFrom1099Nec(w9('c_corporation'))).toBe(true);
    expect(exemptFrom1099Nec(w9('llc_s'))).toBe(true);
    expect(exemptFrom1099Nec(w9('individual', '5'))).toBe(true);
    expect(exemptFrom1099Nec({ formType: 'W8BEN', taxClassification: null, exemptPayeeCode: null })).toBe(true);
  });
});
