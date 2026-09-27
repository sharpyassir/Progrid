import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiError } from '../../common/errors/api-error';
import { EventsService } from '../events/events.service';
import type { Actor } from '../../common/auth/actor';
import { HYPERVISOR_DRIVER, FirewallRuleSpec, HypervisorDriver } from '../../drivers/hypervisor.driver';
import { CreateFirewallDto, FirewallRuleDto } from './network.dto';

/** Default rules for a new server: SSH + HTTP(S) in, everything out. */
export const DEFAULT_RULES: FirewallRuleSpec[] = [
  { direction: 'inbound', protocol: 'tcp', ports: '22', cidrs: ['0.0.0.0/0', '::/0'] },
  { direction: 'inbound', protocol: 'tcp', ports: '80', cidrs: ['0.0.0.0/0', '::/0'] },
  { direction: 'inbound', protocol: 'tcp', ports: '443', cidrs: ['0.0.0.0/0', '::/0'] },
  { direction: 'inbound', protocol: 'icmp', cidrs: ['0.0.0.0/0', '::/0'] },
  { direction: 'outbound', protocol: 'any', cidrs: ['0.0.0.0/0', '::/0'] },
];

/** Firewalls are enforced on the host by the driver — the customer cannot bypass them from inside the VM. */
@Injectable()
export class FirewallsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    @Inject(HYPERVISOR_DRIVER) private readonly driver: HypervisorDriver,
  ) {}

  list(projectId: string) {
    return this.prisma.firewall.findMany({ where: { projectId }, include: { rules: true, servers: { select: { serverId: true } } } });
  }

  async get(projectId: string, id: string) {
    const fw = await this.prisma.firewall.findFirst({ where: { id, projectId }, include: { rules: true, servers: { select: { serverId: true } } } });
    if (!fw) throw ApiError.notFound('firewall', id);
    return fw;
  }

  async create(actor: Actor, projectId: string, dto: CreateFirewallDto) {
    const fw = await this.prisma.firewall.create({
      data: { projectId, name: dto.name, rules: { create: dto.rules.map(toRow) } },
      include: { rules: true, servers: { select: { serverId: true } } },
    });
    await this.events.emit('firewall.created', { firewallId: fw.id }, { actor, resource: `firewall:${fw.id}` });
    return fw;
  }

  async replaceRules(actor: Actor, projectId: string, id: string, rules: FirewallRuleDto[]) {
    await this.get(projectId, id);
    await this.prisma.$transaction([
      this.prisma.firewallRule.deleteMany({ where: { firewallId: id } }),
      this.prisma.firewallRule.createMany({ data: rules.map((r) => ({ firewallId: id, ...toRow(r) })) }),
    ]);
    await this.pushToServers(id);
    await this.events.emit('firewall.updated', { firewallId: id }, { actor, resource: `firewall:${id}` });
    return this.get(projectId, id);
  }

  async attach(actor: Actor, projectId: string, id: string, serverId: string) {
    await this.get(projectId, id);
    const server = await this.prisma.server.findFirst({ where: { id: serverId, projectId } });
    if (!server) throw ApiError.notFound('server', serverId);
    await this.prisma.firewallServer.upsert({ where: { firewallId_serverId: { firewallId: id, serverId } }, create: { firewallId: id, serverId }, update: {} });
    await this.applyToServer(serverId);
    await this.events.emit('firewall.attached', { firewallId: id, serverId }, { actor, resource: `firewall:${id}` });
  }

  async detach(actor: Actor, projectId: string, id: string, serverId: string) {
    await this.get(projectId, id);
    await this.prisma.firewallServer.deleteMany({ where: { firewallId: id, serverId } });
    await this.applyToServer(serverId);
    await this.events.emit('firewall.detached', { firewallId: id, serverId }, { actor, resource: `firewall:${id}` });
  }

  async remove(actor: Actor, projectId: string, id: string) {
    const fw = await this.get(projectId, id);
    await this.prisma.firewall.delete({ where: { id } });
    for (const s of fw.servers) await this.applyToServer(s.serverId);
    await this.events.emit('firewall.deleted', { firewallId: id }, { actor, resource: `firewall:${id}` });
  }

  /** Effective rule set for a server: union of attached firewalls, or the defaults. */
  async effectiveRules(serverId: string): Promise<FirewallRuleSpec[]> {
    const rows = await this.prisma.firewallRule.findMany({ where: { firewall: { servers: { some: { serverId } } } } });
    if (!rows.length) return DEFAULT_RULES;
    return rows.map((r) => ({
      direction: r.direction,
      protocol: r.protocol,
      ports: r.ports ?? undefined,
      cidrs: r.direction === 'inbound' ? r.sources : r.destinations,
    }));
  }

  async applyToServer(serverId: string) {
    const server = await this.prisma.server.findUnique({ where: { id: serverId }, include: { host: true } });
    if (!server?.host || !server.driverRef || !['active', 'off'].includes(server.status)) return;
    await this.driver.applyFirewall(server.host.driverRef, server.driverRef, await this.effectiveRules(serverId));
  }

  private async pushToServers(firewallId: string) {
    const links = await this.prisma.firewallServer.findMany({ where: { firewallId } });
    for (const l of links) await this.applyToServer(l.serverId);
  }
}

function toRow(r: FirewallRuleDto) {
  if (r.ports && !['tcp', 'udp'].includes(r.protocol)) throw ApiError.invalid(`Ports apply to tcp and udp rules only, not ${r.protocol}`);
  return {
    direction: r.direction,
    protocol: r.protocol,
    ports: r.ports,
    sources: r.direction === 'inbound' ? r.cidrs : [],
    destinations: r.direction === 'outbound' ? r.cidrs : [],
    description: r.description,
  };
}
