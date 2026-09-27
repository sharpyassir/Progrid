import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiError } from '../../common/errors/api-error';
import { loadConfig } from '../../config/config';

export type PrivateNetworkMode = 'shared_bridge' | 'sdn_vnet';

/**
 * Per project private networks. Each project gets one network per region, a /24 (by default)
 * from the region pool, and every server of the project in that region gets a static address
 * from it on its private NIC (net0). The agent writes it into the cloud-init network config, so
 * the address is known before the VM boots and nothing depends on DHCP.
 *
 * Addresses: .0 is the network, .1 stays free for a future gateway, the last one is broadcast;
 * servers get .2 upward. Reservation is atomic through the unique (network, address) index.
 */
@Injectable()
export class PrivateNetworksService {
  private readonly log = new Logger(PrivateNetworksService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** The network of a project in a region, created from the region pool on first use. */
  async ensureNetwork(projectId: string, regionId: string) {
    const existing = await this.prisma.privateNetwork.findUnique({ where: { projectId_regionId: { projectId, regionId } } });
    if (existing) return existing;
    const cfg = loadConfig();
    const pool = parseCidr(perRegion(cfg.PRIVATE_NETWORK_POOL, regionId) ?? '10.96.0.0/12');
    const prefix = cfg.PRIVATE_NETWORK_PREFIX;
    if (prefix < pool.bits) throw new Error(`PRIVATE_NETWORK_PREFIX /${prefix} is larger than the pool /${pool.bits}`);
    const size = 2 ** (prefix - pool.bits);
    for (let attempt = 0; attempt < 10; attempt++) {
      const used = new Set((await this.prisma.privateNetwork.findMany({ where: { regionId }, select: { poolIndex: true } })).map((n) => n.poolIndex));
      let index = 0;
      while (used.has(index)) index++;
      if (index >= size) throw ApiError.quota('The private network pool of this region is exhausted', { region: regionId, code: 'no_private_networks' });
      const tag = cfg.PRIVATE_NETWORK_VXLAN_BASE + index;
      if (tag > 16_777_215) throw ApiError.quota('No VXLAN tag left for a new private network in this region', { region: regionId, code: 'no_private_networks' });
      try {
        return await this.prisma.privateNetwork.create({
          data: { projectId, regionId, poolIndex: index, cidr: `${intToIp(pool.base + index * 2 ** (32 - prefix))}/${prefix}`, vxlanTag: tag, vnet: vnetId(tag) },
        });
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        // Either another request created this project's network, or took the same index: look again.
        const raced = await this.prisma.privateNetwork.findUnique({ where: { projectId_regionId: { projectId, regionId } } });
        if (raced) return raced;
      }
    }
    throw new Error(`could not allocate a private network for project ${projectId} in ${regionId}`);
  }

  /**
   * Reserves the server's private address, or returns the one it already holds (retries,
   * rebuilds). Servers created before allocation existed get one here on their next create.
   */
  async reserveForServer(server: { id: string; projectId: string; regionId: string }) {
    const held = await this.prisma.privateIp.findUnique({ where: { serverId: server.id }, include: { network: true } });
    if (held) return { address: held.address, prefix: prefixOf(held.network.cidr), network: held.network };
    const network = await this.ensureNetwork(server.projectId, server.regionId);
    const { base, bits } = parseCidr(network.cidr);
    const last = base + 2 ** (32 - bits) - 2; // the address before broadcast
    for (let attempt = 0; attempt < 30; attempt++) {
      const used = new Set((await this.prisma.privateIp.findMany({ where: { networkId: network.id }, select: { address: true } })).map((r) => r.address));
      const free: number[] = [];
      for (let a = base + 2; a <= last && free.length < 16; a++) if (!used.has(intToIp(a))) free.push(a);
      if (!free.length) throw ApiError.quota('The private network of this project is full', { network: network.cidr, code: 'private_network_full' });
      // The lowest free address first; after a collision a random one of the next few, so
      // concurrent creates (a cluster's nodes) stop racing for the same address.
      const candidate = attempt === 0 ? free[0] : free[Math.floor(Math.random() * free.length)];
      try {
        const row = await this.prisma.privateIp.create({ data: { networkId: network.id, serverId: server.id, address: intToIp(candidate) } });
        return { address: row.address, prefix: bits, network };
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
        const raced = await this.prisma.privateIp.findUnique({ where: { serverId: server.id } });
        if (raced) return { address: raced.address, prefix: bits, network };
      }
    }
    throw new Error(`could not reserve a private address for server ${server.id}`);
  }

  /** Frees the server's private address. The network itself stays with the project. */
  async releaseForServer(serverId: string) {
    await this.prisma.privateIp.deleteMany({ where: { serverId } });
  }

  list(projectId: string) {
    return this.prisma.privateNetwork.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' }, include: { _count: { select: { ips: true } } } });
  }

  /** Warns when the guest does not carry the address the control plane allocated to it. */
  checkGuestAddresses(server: { id: string; name?: string; privateIp: string | null }, guest: string[] | undefined) {
    if (!server.privateIp || !guest?.length) return true;
    if (guest.includes(server.privateIp)) return true;
    this.log.warn(`server ${server.name ?? server.id} reports ${guest.join(', ')} but was allocated the private address ${server.privateIp}`);
    return false;
  }

  static mode(regionId: string): PrivateNetworkMode {
    return (perRegion(loadConfig().PRIVATE_NETWORK_MODE, regionId) as PrivateNetworkMode | undefined) ?? 'shared_bridge';
  }
}

/**
 * Reads a setting that is either one value for every region or a "region=value" list. A list
 * without an entry for the region yields undefined.
 */
export function perRegion(setting: string, regionId: string): string | undefined {
  const parts = setting.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1 && !parts[0].includes('=')) return parts[0];
  for (const p of parts) {
    const [region, value] = p.split('=').map((x) => x.trim());
    if (region === regionId && value) return value;
  }
  return undefined;
}

/** Proxmox VNet ids are at most 8 lowercase letters and digits, starting with a letter. */
export function vnetId(tag: number): string {
  return `pn${tag.toString(36)}`;
}

export function parseCidr(cidr: string): { base: number; bits: number } {
  const [addr, bitsText] = cidr.split('/');
  const bits = Number(bitsText);
  const n = ipToInt(addr);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32 || n === null) throw new Error(`invalid IPv4 CIDR ${cidr}`);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return { base: (n & mask) >>> 0, bits };
}

export function prefixOf(cidr: string): number {
  return Number(cidr.split('/')[1]);
}

export function ipToInt(ip: string): number | null {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

export function intToIp(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

function isUniqueViolation(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}
