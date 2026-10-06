import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiError } from '../../common/errors/api-error';
import { EventsService } from '../events/events.service';
import type { Actor } from '../../common/auth/actor';
import { HYPERVISOR_DRIVER, FirewallRuleSpec, HypervisorDriver, NicAddresses } from '../../drivers/hypervisor.driver';
import { vipNetworkFor } from '../../common/platform-agent';
import { loadConfig } from '../../config/config';
import { CreateFirewallDto, FirewallRuleDto } from './network.dto';
import { PrivateNetworksService, intToIp, parseCidr, perRegion } from './private-networks.service';

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
    // The rules are re-applied to this server, so it must be one of the project's.
    const server = await this.prisma.server.findFirst({ where: { id: serverId, projectId }, select: { id: true } });
    if (!server) throw ApiError.notFound('server', serverId);
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

  /**
   * Effective rule set for a server: the platform guard rails (drop rules, evaluated first), then
   * the union of attached firewalls, or the defaults.
   */
  async effectiveRules(serverId: string): Promise<FirewallRuleSpec[]> {
    const rows = await this.prisma.firewallRule.findMany({ where: { firewall: { servers: { some: { serverId } } } } });
    const rules: FirewallRuleSpec[] = rows.length
      ? rows.map((r) => ({
          direction: r.direction,
          protocol: r.protocol,
          ports: r.ports ?? undefined,
          cidrs: r.direction === 'inbound' ? r.sources : r.destinations,
        }))
      : DEFAULT_RULES;
    return [...(await this.guardRules(serverId)), ...rules];
  }

  /**
   * Drop rules the customer cannot remove:
   * - shared_bridge regions: every tenant's net0 sits on one L2 segment, so inbound traffic on
   *   net0 from the region's private pool is dropped except from the server's own project
   *   network (and the control plane range, should it overlap the pool).
   * - SMTP: outbound tcp/25 is dropped unless SMTP_EGRESS_DEFAULT=allow or the team is trusted.
   */
  async guardRules(serverId: string): Promise<FirewallRuleSpec[]> {
    const s = await this.prisma.server.findUnique({ where: { id: serverId }, select: { projectId: true, regionId: true, project: { select: { teamId: true, team: { select: { kycLevel: true } } } } } });
    if (!s) return [];
    const cfg = loadConfig();
    const shared = PrivateNetworksService.mode(s.regionId) === 'shared_bridge';
    const own = shared ? await this.prisma.privateNetwork.findUnique({ where: { projectId_regionId: { projectId: s.projectId, regionId: s.regionId } }, select: { cidr: true } }) : null;
    const allowTeams = cfg.SMTP_EGRESS_ALLOW_TEAMS.split(',').map((t) => t.trim()).filter(Boolean);
    return guardRulesFor({
      sharedBridge: shared,
      pool: perRegion(cfg.PRIVATE_NETWORK_POOL, s.regionId) ?? '10.96.0.0/12',
      ownCidr: own?.cidr ?? null,
      controlPlaneCidr: cfg.CONTROL_PLANE_CIDR,
      blockSmtp: cfg.SMTP_EGRESS_DEFAULT === 'block' && s.project.team.kycLevel < cfg.SMTP_EGRESS_MIN_KYC && !allowTeams.includes(s.project.teamId),
    });
  }

  async applyToServer(serverId: string) {
    const server = await this.prisma.server.findUnique({ where: { id: serverId }, include: { host: true } });
    if (!server?.host || !server.driverRef || !['active', 'off'].includes(server.status)) return;
    await this.driver.applyFirewall(server.host.driverRef, server.driverRef, await this.effectiveRules(serverId), await this.nicAddresses(serverId));
  }

  /**
   * What each NIC of the server may send from, for the hypervisor's IP filter (anti spoofing):
   * the private address on net0, the public addresses on net1, and for a load balancer,
   * database or Kubernetes node the cluster VIP keepalived may move onto it. The agent turns
   * the filter on only for NICs whose configured address is in this list.
   */
  async nicAddresses(serverId: string): Promise<NicAddresses | undefined> {
    const s = await this.prisma.server.findUnique({ where: { id: serverId }, select: { privateIp: true, managedBy: true, publicIps: { select: { address: true } } } });
    if (!s) return undefined;
    const out: NicAddresses = {};
    const add = (nic: string, address: string) => {
      if (!(out[nic] ??= []).includes(address)) out[nic].push(address);
    };
    if (s.privateIp) add('net0', s.privateIp);
    for (const ip of s.publicIps) add('net1', ip.address);
    const vip = await this.clusterVip(s.managedBy);
    if (vip) add(vipNetworkFor(vip) === 'private' ? 'net0' : 'net1', vip);
    return Object.keys(out).length ? out : undefined;
  }

  private async clusterVip(managedBy: string | null): Promise<string | undefined> {
    const [kind, id] = (managedBy ?? '').split(':');
    if (!id) return undefined;
    const select = { publicIp: { select: { address: true } } };
    if (kind === 'lb') return (await this.prisma.loadBalancer.findUnique({ where: { id }, select }))?.publicIp?.address;
    if (kind === 'db') return (await this.prisma.dbCluster.findUnique({ where: { id }, select }))?.publicIp?.address;
    if (kind === 'k8s') return (await this.prisma.kubeCluster.findUnique({ where: { id }, select }))?.publicIp?.address;
    return undefined;
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

/**
 * The platform drop rules for one server (see FirewallsService.guardRules). A server without a
 * project network (created before allocation existed) gets no east-west rule: its address is not
 * known to be inside its project's range, and dropping the whole pool would cut it off.
 */
export function guardRulesFor(o: { sharedBridge: boolean; pool: string; ownCidr: string | null; controlPlaneCidr: string; blockSmtp: boolean }): FirewallRuleSpec[] {
  const out: FirewallRuleSpec[] = [];
  if (o.sharedBridge && o.ownCidr) {
    const keep = [o.ownCidr, ...(o.controlPlaneCidr.includes(':') ? [] : [o.controlPlaneCidr])];
    const cidrs = subtractCidrs(o.pool, keep);
    if (cidrs.length) out.push({ direction: 'inbound', protocol: 'any', cidrs, action: 'drop', iface: 'net0' });
  }
  if (o.blockSmtp) out.push({ direction: 'outbound', protocol: 'tcp', ports: '25', cidrs: ['0.0.0.0/0', '::/0'], action: 'drop' });
  return out;
}

/** IPv4 CIDR `base` minus every CIDR in `exclude`, as the smallest list of CIDRs covering the rest. */
export function subtractCidrs(base: string, exclude: string[]): string[] {
  let blocks = [parseCidr(base)];
  for (const e of exclude) {
    const x = parseCidr(e);
    const next: { base: number; bits: number }[] = [];
    for (const b of blocks) {
      if (!overlaps(b, x)) next.push(b);
      else if (x.bits > b.bits) next.push(...splitAround(b, x)); // x lies inside b
      // otherwise b lies inside x: dropped entirely
    }
    blocks = next;
  }
  return blocks.map((b) => `${intToIp(b.base)}/${b.bits}`);
}

function overlaps(a: { base: number; bits: number }, b: { base: number; bits: number }) {
  const bits = Math.min(a.bits, b.bits);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return ((a.base & mask) >>> 0) === ((b.base & mask) >>> 0);
}

/** The halves of `b` that do not contain `x`, walking down from b to x (x strictly inside b). */
function splitAround(b: { base: number; bits: number }, x: { base: number; bits: number }) {
  const out: { base: number; bits: number }[] = [];
  let cur = b;
  while (cur.bits < x.bits) {
    const bits = cur.bits + 1;
    const lo = { base: cur.base, bits };
    const hi = { base: (cur.base + 2 ** (32 - bits)) >>> 0, bits };
    if (overlaps(lo, x)) {
      out.push(hi);
      cur = lo;
    } else {
      out.push(lo);
      cur = hi;
    }
  }
  return out;
}
