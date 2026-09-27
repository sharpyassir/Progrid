import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiError } from '../../common/errors/api-error';
import type { Actor } from '../../common/auth/actor';
import { HYPERVISOR_DRIVER, HypervisorDriver } from '../../drivers/hypervisor.driver';
import { EventsService } from '../events/events.service';

/** Public IPv4 pool. IPs come from IpBlock rows (own RIPE block or leased). */
@Injectable()
export class IpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    @Inject(HYPERVISOR_DRIVER) private readonly driver: HypervisorDriver,
  ) {}

  /** Atomically reserves a free IP in the region for a project. */
  async reserve(regionId: string, projectId: string, serverId?: string) {
    // `updateMany` on a single free row is our compare-and-swap.
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = await this.prisma.publicIp.findFirst({ where: { regionId, status: 'free' }, orderBy: { address: 'asc' } });
      if (!candidate) throw ApiError.quota('No public IPs available in this region', { region: regionId, code: 'no_public_ips' });
      const r = await this.prisma.publicIp.updateMany({
        where: { id: candidate.id, status: 'free' },
        data: { status: serverId ? 'assigned' : 'reserved', projectId, serverId, assignedAt: serverId ? new Date() : null },
      });
      if (r.count === 1) return this.prisma.publicIp.findUniqueOrThrow({ where: { id: candidate.id }, include: { block: true } });
    }
    throw new Error('could not reserve a public IP after 5 attempts');
  }

  async release(ipId: string) {
    await this.prisma.publicIp.update({
      where: { id: ipId },
      data: { status: 'free', projectId: null, serverId: null, assignedAt: null, reverseDns: null, floating: false },
    });
  }

  async releaseForServer(serverId: string) {
    const ips = await this.prisma.publicIp.findMany({ where: { serverId } });
    for (const ip of ips) {
      if (ip.floating) {
        await this.prisma.publicIp.update({ where: { id: ip.id }, data: { serverId: null, status: 'reserved' } });
      } else {
        await this.release(ip.id);
      }
    }
  }

  /**
   * Moves a project's address onto a server's public NIC. The server must have no public
   * address of its own (detach it first), so one server never carries two. The address
   * becomes floating: it stays with the project when it is detached or the server is deleted.
   */
  async attach(actor: Actor, projectId: string, id: string, serverId: string) {
    const ip = await this.mustOwn(projectId, id);
    if (ip.serverId === serverId) return ip;
    if (ip.serverId) throw ApiError.invalidState('This address is attached to another server; detach it first');
    const server = await this.prisma.server.findFirst({ where: { id: serverId, projectId, deletedAt: null }, include: { host: true, publicIps: { select: { id: true } } } });
    if (!server) throw ApiError.notFound('server', serverId);
    if (server.managedBy) throw ApiError.invalidState('Platform owned nodes keep their addresses');
    if (!['active', 'off'].includes(server.status) || !server.driverRef || !server.host) throw ApiError.invalidState(`Cannot attach an address to a server that is ${server.status}`);
    if (server.regionId !== ip.regionId) throw ApiError.invalid('The address and the server are in different regions');
    if (server.publicIps.length) throw ApiError.invalidState('The server already has a public address; detach it first');

    // Claim the row first so two requests cannot attach the same address.
    const claimed = await this.prisma.publicIp.updateMany({ where: { id, serverId: null }, data: { serverId, status: 'assigned', floating: true, assignedAt: new Date() } });
    if (!claimed.count) throw ApiError.conflict('ip_busy', 'This address changed while attaching; try again');
    try {
      await this.driver.attachPublicIp(server.host.driverRef, server.driverRef, { address: ip.address, gateway: ip.block.gateway, prefix: IpsService.prefixOf(ip.block.cidr) });
    } catch (err) {
      await this.prisma.publicIp.updateMany({ where: { id, serverId }, data: { serverId: null, status: 'reserved', assignedAt: null } });
      throw hypervisorError(err);
    }
    await this.events.emit('public_ip.attached', { publicIpId: id, address: ip.address, serverId }, { actor, resource: `public_ip:${id}` });
    return this.mustOwn(projectId, id);
  }

  /** Takes the address off its server. It stays reserved for the project until released. */
  async detach(actor: Actor, projectId: string, id: string) {
    const ip = await this.mustOwn(projectId, id);
    if (!ip.serverId) return ip;
    const server = await this.prisma.server.findUnique({ where: { id: ip.serverId }, include: { host: true } });
    if (server?.managedBy) throw ApiError.invalidState('Platform owned nodes keep their addresses');
    if (server?.driverRef && server.host) {
      await this.driver.detachPublicIp(server.host.driverRef, server.driverRef, ip.address).catch((err) => {
        throw hypervisorError(err);
      });
    }
    await this.prisma.publicIp.update({ where: { id }, data: { serverId: null, status: 'reserved', floating: true, assignedAt: null } });
    await this.events.emit('public_ip.detached', { publicIpId: id, address: ip.address, serverId: ip.serverId }, { actor, resource: `public_ip:${id}` });
    return this.mustOwn(projectId, id);
  }

  /** Returns a detached address to the pool; billing for it stops. */
  async releaseReserved(actor: Actor, projectId: string, id: string) {
    const ip = await this.mustOwn(projectId, id);
    if (ip.serverId) throw ApiError.invalidState('Detach the address from its server first');
    await this.release(id);
    await this.events.emit('public_ip.released', { publicIpId: id, address: ip.address }, { actor, resource: `public_ip:${id}` });
  }

  private async mustOwn(projectId: string, id: string) {
    const ip = await this.prisma.publicIp.findFirst({
      where: { id, projectId },
      include: { block: true, loadBalancer: { select: { id: true } }, dbCluster: { select: { id: true } }, kubeCluster: { select: { id: true } } },
    });
    if (!ip) throw ApiError.notFound('public ip', id);
    if (ip.loadBalancer || ip.dbCluster || ip.kubeCluster) throw ApiError.invalidState('This address belongs to a managed product and cannot move');
    return ip;
  }

  list(projectId: string) {
    return this.prisma.publicIp.findMany({ where: { projectId }, orderBy: { address: 'asc' } });
  }

  static prefixOf(cidr: string) {
    return Number(cidr.split('/')[1]);
  }
}

/** A driver failure while moving an address is reported to the caller as a 502 with the agent's message. */
function hypervisorError(err: unknown) {
  return new ApiError(HttpStatus.BAD_GATEWAY, 'hypervisor_error', `The host could not change the address: ${err instanceof Error ? err.message : String(err)}`);
}
