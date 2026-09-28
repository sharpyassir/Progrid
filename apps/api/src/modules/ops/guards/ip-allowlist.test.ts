import { describe, expect, it } from 'vitest';
import { ipAllowed, isCidr } from './ip-allowlist';

describe('engineer IP allowlist', () => {
  it('matches IPv4 CIDRs and plain addresses', () => {
    expect(ipAllowed('203.0.113.7', ['203.0.113.0/24'])).toBe(true);
    expect(ipAllowed('203.0.114.7', ['203.0.113.0/24'])).toBe(false);
    expect(ipAllowed('198.51.100.9', ['198.51.100.9'])).toBe(true);
    expect(ipAllowed('198.51.100.10', ['198.51.100.9'])).toBe(false);
    expect(ipAllowed('10.1.2.3', ['0.0.0.0/0'])).toBe(true);
  });

  it('treats IPv4 mapped IPv6 as IPv4 and matches IPv6 prefixes', () => {
    expect(ipAllowed('::ffff:203.0.113.7', ['203.0.113.0/24'])).toBe(true);
    expect(ipAllowed('2001:db8::1', ['2001:db8::/32'])).toBe(true);
    expect(ipAllowed('2001:db9::1', ['2001:db8::/32'])).toBe(false);
    expect(ipAllowed('2001:db8::1', ['203.0.113.0/24'])).toBe(false);
  });

  it('refuses garbage', () => {
    expect(ipAllowed('', ['0.0.0.0/0'])).toBe(false);
    expect(ipAllowed('not-an-ip', ['0.0.0.0/0'])).toBe(false);
    expect(isCidr('10.0.0.0/8')).toBe(true);
    expect(isCidr('10.0.0.0/33')).toBe(false);
    expect(isCidr('2001:db8::/48')).toBe(true);
    expect(isCidr('example.com')).toBe(false);
  });
});
