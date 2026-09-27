import { beforeAll, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { guestAddressMismatch, intToIp, ipToInt, parseCidr, perRegion, PrivateNetworksService, vnetId } from './private-networks.service';

beforeAll(() => {
  process.env.DATABASE_URL ??= 'postgresql://test@localhost/test';
});

describe('address helpers', () => {
  it('round trips IPv4 addresses', () => {
    expect(intToIp(ipToInt('10.96.3.254')!)).toBe('10.96.3.254');
    expect(ipToInt('10.96.300.1')).toBeNull();
  });
  it('masks a CIDR to its network', () => {
    expect(parseCidr('10.96.7.9/12')).toEqual({ base: ipToInt('10.96.0.0'), bits: 12 });
  });
  it('reads one value or a per region list', () => {
    expect(perRegion('sdn_vnet', 'sa1')).toBe('sdn_vnet');
    expect(perRegion('sa1=sdn_vnet, sa2=shared_bridge', 'sa2')).toBe('shared_bridge');
    expect(perRegion('sa1=sdn_vnet', 'eu1')).toBeUndefined();
  });
  it('flags a guest that does not carry its allocated address', () => {
    expect(guestAddressMismatch('10.96.0.2', ['10.96.0.2', '203.0.113.10', '172.17.0.1'])).toBe(false);
    expect(guestAddressMismatch('10.96.0.2', ['10.96.0.77'])).toBe(true);
    expect(guestAddressMismatch('10.96.0.2', [])).toBe(false);
    expect(guestAddressMismatch(null, ['10.10.0.5'])).toBe(false);
  });
  it('derives a short VNet id from the tag', () => {
    expect(vnetId(100_000)).toBe('pn255s');
    expect(vnetId(16_777_215).length).toBeLessThanOrEqual(8);
  });
});

/** Just enough of Prisma for the allocator, with the unique indexes enforced. */
function fakePrisma() {
  const nets: Array<{ id: string; projectId: string; regionId: string; poolIndex: number; cidr: string; vxlanTag: number; vnet: string; sdnAppliedAt: Date | null }> = [];
  const ips: Array<{ id: string; networkId: string; serverId: string | null; address: string }> = [];
  const dup = () => new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'test' });
  return {
    nets,
    ips,
    privateNetwork: {
      findUnique: async ({ where }: any) => nets.find((n) => n.projectId === where.projectId_regionId.projectId && n.regionId === where.projectId_regionId.regionId) ?? null,
      findMany: async ({ where }: any) => nets.filter((n) => n.regionId === where.regionId),
      create: async ({ data }: any) => {
        if (nets.some((n) => (n.projectId === data.projectId && n.regionId === data.regionId) || (n.regionId === data.regionId && n.poolIndex === data.poolIndex))) throw dup();
        const row = { id: `net${nets.length}`, sdnAppliedAt: null, ...data };
        nets.push(row);
        return row;
      },
    },
    privateIp: {
      findUnique: async ({ where, include }: any) => {
        const row = ips.find((r) => r.serverId === where.serverId);
        return row ? { ...row, ...(include?.network ? { network: nets.find((n) => n.id === row.networkId) } : {}) } : null;
      },
      findMany: async ({ where }: any) => ips.filter((r) => r.networkId === where.networkId),
      create: async ({ data }: any) => {
        if (ips.some((r) => r.serverId === data.serverId || (r.networkId === data.networkId && r.address === data.address))) throw dup();
        const row = { id: `ip${ips.length}`, ...data };
        ips.push(row);
        return row;
      },
      deleteMany: async ({ where }: any) => {
        const i = ips.findIndex((r) => r.serverId === where.serverId);
        if (i >= 0) ips.splice(i, 1);
      },
    },
  };
}

describe('PrivateNetworksService', () => {
  it('gives each project its own /24 from the pool and servers .2 upward', async () => {
    const db = fakePrisma();
    const svc = new PrivateNetworksService(db as any);
    const a1 = await svc.reserveForServer({ id: 's1', projectId: 'pA', regionId: 'sa1' });
    const a2 = await svc.reserveForServer({ id: 's2', projectId: 'pA', regionId: 'sa1' });
    const b1 = await svc.reserveForServer({ id: 's3', projectId: 'pB', regionId: 'sa1' });
    expect([a1.address, a1.prefix, a2.address, b1.address]).toEqual(['10.96.0.2', 24, '10.96.0.3', '10.96.1.2']);
    expect(db.nets.map((n) => [n.cidr, n.vxlanTag])).toEqual([['10.96.0.0/24', 100_000], ['10.96.1.0/24', 100_001]]);
  });

  it('keeps the address across retries and reuses a released one', async () => {
    const db = fakePrisma();
    const svc = new PrivateNetworksService(db as any);
    const first = await svc.reserveForServer({ id: 's1', projectId: 'pA', regionId: 'sa1' });
    expect((await svc.reserveForServer({ id: 's1', projectId: 'pA', regionId: 'sa1' })).address).toBe(first.address);
    await svc.releaseForServer('s1');
    expect(db.ips).toHaveLength(0);
    expect((await svc.reserveForServer({ id: 's9', projectId: 'pA', regionId: 'sa1' })).address).toBe('10.96.0.2');
  });

  it('never hands out the same address to concurrent creates', async () => {
    const db = fakePrisma();
    const svc = new PrivateNetworksService(db as any);
    const got = await Promise.all(Array.from({ length: 20 }, (_, i) => svc.reserveForServer({ id: `s${i}`, projectId: 'pA', regionId: 'sa1' })));
    expect(new Set(got.map((g) => g.address)).size).toBe(20);
    expect(db.nets).toHaveLength(1);
  });
});
