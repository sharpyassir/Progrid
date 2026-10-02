import { describe, expect, it } from 'vitest';
import { refCodeFrom, refCookieValue } from './referral';

describe('referral links', () => {
  it('reads a valid code from the query', () => {
    expect(refCodeFrom('?ref=sara10')).toBe('SARA10');
    expect(refCodeFrom('?utm_source=yt&ref=SARA10&x=1')).toBe('SARA10');
  });

  it('ignores missing or malformed codes', () => {
    expect(refCodeFrom('')).toBeNull();
    expect(refCodeFrom('?ref=ab')).toBeNull();
    expect(refCodeFrom('?ref=%3Cscript%3E')).toBeNull();
  });

  it('stores the click time with the code', () => {
    expect(refCookieValue('SARA10', 1_760_000_000_999)).toBe('SARA10.1760000000');
  });
});
