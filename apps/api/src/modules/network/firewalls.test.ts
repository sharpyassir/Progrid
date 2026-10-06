import { describe, expect, it } from 'vitest';
import { guardRulesFor, subtractCidrs } from './firewalls.service';
import { parseCidr } from './private-networks.service';

/** Number of addresses a CIDR list covers. */
const size = (cidrs: string[]) => cidrs.reduce((n, c) => n + 2 ** (32 - parseCidr(c).bits), 0);
const contains = (cidr: string, ip: string) => {
  const c = parseCidr(cidr);
  const i = parseCidr(`${ip}/32`).base;
  return i >= c.base && i < c.base + 2 ** (32 - c.bits);
};

describe('subtractCidrs', () => {
  it('removes a project network from the pool', () => {
    const rest = subtractCidrs('10.96.0.0/12', ['10.96.5.0/24']);
    expect(rest).toHaveLength(12);
    expect(size(rest)).toBe(2 ** 20 - 256);
    expect(rest.some((c) => contains(c, '10.96.5.7'))).toBe(false);
    expect(rest.some((c) => contains(c, '10.96.4.7'))).toBe(true);
    expect(rest.some((c) => contains(c, '10.111.255.254'))).toBe(true);
  });
  it('ignores ranges outside the pool and drops a pool fully covered', () => {
    expect(subtractCidrs('10.96.0.0/12', ['10.0.0.0/12'])).toEqual(['10.96.0.0/12']);
    expect(subtractCidrs('10.96.0.0/12', ['10.0.0.0/8'])).toEqual([]);
  });
});

describe('guardRulesFor', () => {
  const base = { pool: '10.96.0.0/12', ownCidr: '10.96.3.0/24', controlPlaneCidr: '10.0.0.0/12' };
  it('drops other tenants on the shared bridge, on net0, before everything else', () => {
    const [r] = guardRulesFor({ ...base, sharedBridge: true, blockSmtp: false });
    expect(r).toMatchObject({ direction: 'inbound', protocol: 'any', action: 'drop', iface: 'net0' });
    expect(r.cidrs.some((c) => contains(c, '10.96.3.9'))).toBe(false);
    expect(r.cidrs.some((c) => contains(c, '10.96.4.9'))).toBe(true);
    expect(size(r.cidrs)).toBe(2 ** 20 - 256);
  });
  it('keeps the control plane range when it overlaps the pool', () => {
    const [r] = guardRulesFor({ ...base, controlPlaneCidr: '10.100.0.0/16', sharedBridge: true, blockSmtp: false });
    expect(r.cidrs.some((c) => contains(c, '10.100.1.1'))).toBe(false);
  });
  it('adds nothing for sdn_vnet or a server without a project network', () => {
    expect(guardRulesFor({ ...base, sharedBridge: false, blockSmtp: false })).toEqual([]);
    expect(guardRulesFor({ ...base, ownCidr: null, sharedBridge: true, blockSmtp: false })).toEqual([]);
  });
  it('blocks outbound SMTP when asked', () => {
    expect(guardRulesFor({ ...base, sharedBridge: false, blockSmtp: true })).toEqual([{ direction: 'outbound', protocol: 'tcp', ports: '25', cidrs: ['0.0.0.0/0', '::/0'], action: 'drop' }]);
  });
});
