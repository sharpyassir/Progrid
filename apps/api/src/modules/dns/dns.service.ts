import { Inject, Injectable, Logger } from '@nestjs/common';
import { isIP } from 'node:net';
import type { DnsRecord, DnsRecordType, DnsZone } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { Actor } from '../../common/auth/actor';
import { ApiError } from '../../common/errors/api-error';
import { loadConfig } from '../../config/config';
import { IamService } from '../iam/iam.service';
import { EventsService } from '../events/events.service';
import { DNS_PROVIDER, DnsProvider, RRSet } from './dns.provider';
import { CreateDomainDto, CreateRecordDto, ReverseDnsDto, UpdateRecordDto } from './dns.dto';

const MAX_RECORDS = 1000;
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)*[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?$/i;

/**
 * Hosted DNS. Zones and records live in Postgres; every change bumps the zone serial and
 * pushes the whole zone to the nameserver provider. A failed push leaves the zone in
 * `error` with the message and the minute job retries until syncedSerial catches up.
 * DNS is free.
 */
@Injectable()
export class DnsService {
  private readonly log = new Logger(DnsService.name);
  readonly nameservers: string[];
  private readonly hostmaster: string;

  constructor(private readonly prisma: PrismaService, private readonly iam: IamService, private readonly events: EventsService, @Inject(DNS_PROVIDER) private readonly provider: DnsProvider) {
    const cfg = loadConfig();
    this.nameservers = cfg.DNS_NAMESERVERS.split(',').map((s) => s.trim().replace(/\.$/, '')).filter(Boolean);
    this.hostmaster = cfg.DNS_HOSTMASTER;
  }

  // ---- zones ----

  async list(actor: Actor, project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    const zones = await this.prisma.dnsZone.findMany({ where: { projectId: p.id, deletedAt: null }, include: { _count: { select: { records: true } } }, orderBy: { name: 'asc' } });
    return { data: zones.map((z) => this.presentZone(z, z._count.records)), nameservers: this.nameservers };
  }

  async get(actor: Actor, name: string, project?: string) {
    const z = await this.own(actor, name, project);
    const records = await this.prisma.dnsRecord.findMany({ where: { zoneId: z.id }, orderBy: [{ name: 'asc' }, { type: 'asc' }] });
    return { ...this.presentZone(z, records.length), records: records.map(presentRecord) };
  }

  async create(actor: Actor, dto: CreateDomainDto) {
    const p = await this.iam.resolveProject(actor, dto.project);
    const name = dto.name.toLowerCase();
    if (this.nameservers.some((ns) => ns === name || ns.endsWith(`.${name}`))) throw ApiError.invalid('That name is reserved');
    const taken = await this.prisma.dnsZone.findFirst({ where: { name, deletedAt: null }, select: { project: { select: { teamId: true } } } });
    if (taken) throw ApiError.conflict('name_taken', taken.project.teamId === actor.teamId ? `Zone ${name} already exists in your team` : `Zone ${name} is hosted by another account`);
    // A parent zone owned by someone else means the delegation is theirs to make.
    const parents = name.split('.').slice(1).map((_, i, arr) => arr.slice(i).join('.')).filter((x) => x.includes('.'));
    if (parents.length) {
      const parent = await this.prisma.dnsZone.findFirst({ where: { name: { in: parents }, deletedAt: null, project: { teamId: { not: actor.teamId } } } });
      if (parent) throw ApiError.conflict('parent_zone_taken', `${parent.name} is hosted by another account; ask them to delegate ${name}`);
    }
    if (dto.ip && isIP(dto.ip) !== 4) throw ApiError.invalid('ip must be an IPv4 address');
    if ((await this.prisma.dnsZone.count({ where: { projectId: p.id, deletedAt: null } })) >= 100) throw ApiError.quota('Project zone limit (100) reached');

    const z = await this.prisma.dnsZone.create({ data: { projectId: p.id, name, records: dto.ip ? { create: { name: '@', type: 'A', content: dto.ip, ttl: 3600 } } : undefined } });
    await this.events.emit('domain.created', { domain: name, zoneId: z.id }, { actor, resource: `domain:${name}` });
    await this.sync(z.id);
    return this.get(actor, name, dto.project);
  }

  async remove(actor: Actor, name: string, project?: string) {
    const z = await this.own(actor, name, project);
    await this.prisma.dnsZone.update({ where: { id: z.id }, data: { status: 'deleting' } });
    try {
      await this.provider.deleteZone(z.name);
      await this.prisma.dnsZone.update({ where: { id: z.id }, data: { status: 'deleted', deletedAt: new Date() } });
    } catch (err) {
      await this.prisma.dnsZone.update({ where: { id: z.id }, data: { statusMessage: `delete failed: ${(err as Error).message}` } });
      throw new ApiError(502, 'nameserver_unavailable', 'The nameservers did not accept the change; try again in a minute');
    }
    await this.events.emit('domain.deleted', { domain: name }, { actor, resource: `domain:${name}` });
    return { name, deleted: true };
  }

  /** BIND style text of the zone as we publish it. */
  async zoneFile(actor: Actor, name: string, project?: string) {
    const z = await this.own(actor, name, project);
    const records = await this.prisma.dnsRecord.findMany({ where: { zoneId: z.id }, orderBy: [{ name: 'asc' }, { type: 'asc' }] });
    const lines = [`$ORIGIN ${z.name}.`, '$TTL 3600', `@\tIN\tSOA\t${this.nameservers[0]}. ${this.hostmaster.replace('@', '.')}. ${z.serial} 10800 3600 604800 3600`, ...this.nameservers.map((ns) => `@\tIN\tNS\t${ns}.`)];
    for (const r of records) lines.push(`${r.name}\t${r.ttl}\tIN\t${r.type}\t${r.priority != null ? `${r.priority} ` : ''}${wire(r, z.name)}`);
    return lines.join('\n') + '\n';
  }

  // ---- records ----

  async addRecord(actor: Actor, zoneName: string, dto: CreateRecordDto, project?: string) {
    const z = await this.own(actor, zoneName, project);
    if ((await this.prisma.dnsRecord.count({ where: { zoneId: z.id } })) >= MAX_RECORDS) throw ApiError.quota(`Zone record limit (${MAX_RECORDS}) reached`);
    const data = await this.validateRecord(z, { ...dto, name: relative(dto.name, z.name) });
    const r = await this.prisma.dnsRecord.create({ data: { zoneId: z.id, ...data } });
    await this.touch(z.id, actor, 'created', r);
    return presentRecord(r);
  }

  async updateRecord(actor: Actor, zoneName: string, id: string, dto: UpdateRecordDto, project?: string) {
    const z = await this.own(actor, zoneName, project);
    const r = await this.prisma.dnsRecord.findFirst({ where: { id, zoneId: z.id } });
    if (!r) throw ApiError.notFound('record', id);
    const merged = { name: dto.name !== undefined ? relative(dto.name, z.name) : r.name, type: r.type, content: dto.content ?? r.content, ttl: dto.ttl ?? r.ttl, priority: dto.priority !== undefined ? dto.priority : (r.priority ?? undefined) };
    const data = await this.validateRecord(z, merged, id);
    const updated = await this.prisma.dnsRecord.update({ where: { id }, data });
    await this.touch(z.id, actor, 'updated', updated);
    return presentRecord(updated);
  }

  async deleteRecord(actor: Actor, zoneName: string, id: string, project?: string) {
    const z = await this.own(actor, zoneName, project);
    const r = await this.prisma.dnsRecord.findFirst({ where: { id, zoneId: z.id } });
    if (!r) throw ApiError.notFound('record', id);
    await this.prisma.dnsRecord.delete({ where: { id } });
    await this.touch(z.id, actor, 'deleted', r);
    return { id, deleted: true };
  }

  // ---- reverse DNS ----

  async setReverseDns(actor: Actor, ipId: string, dto: ReverseDnsDto, project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    const ip = await this.prisma.publicIp.findFirst({ where: { id: ipId, projectId: p.id } });
    if (!ip) throw ApiError.notFound('public_ip', ipId);
    const name = dto.name ? dto.name.toLowerCase().replace(/\.$/, '') : null;
    if (name && (!HOSTNAME.test(name) || !name.includes('.'))) throw ApiError.invalid('name must be a hostname such as mail.example.com');
    await this.prisma.publicIp.update({ where: { id: ipId }, data: { reverseDns: name, reverseDnsSynced: false } });
    await this.pushPtr(ipId);
    await this.events.emit('public_ip.reverse_dns_set', { publicIpId: ipId, address: ip.address, name }, { actor, resource: `public_ip:${ipId}` });
    const fresh = await this.prisma.publicIp.findUniqueOrThrow({ where: { id: ipId } });
    return { id: fresh.id, address: fresh.address, reverseDns: fresh.reverseDns, synced: fresh.reverseDnsSynced };
  }

  // ---- sync (also called by the minute job) ----

  async sync(zoneId: string) {
    const z = await this.prisma.dnsZone.findUnique({ where: { id: zoneId }, include: { records: true } });
    if (!z || z.deletedAt) return;
    try {
      await this.provider.ensureZone(z.name, this.nameservers, this.hostmaster);
      await this.provider.syncZone(z.name, toRRSets(z, z.records));
      await this.prisma.dnsZone.update({ where: { id: zoneId }, data: { status: 'active', statusMessage: null, syncedSerial: z.serial } });
    } catch (err) {
      this.log.warn(`zone ${z.name} sync failed: ${(err as Error).message}`);
      await this.prisma.dnsZone.update({ where: { id: zoneId }, data: { status: 'error', statusMessage: (err as Error).message.slice(0, 500) } });
    }
  }

  async pushPtr(ipId: string) {
    const ip = await this.prisma.publicIp.findUnique({ where: { id: ipId } });
    if (!ip) return;
    try {
      await this.provider.setPtr(ip.address, ip.reverseDns, this.nameservers, this.hostmaster);
      await this.prisma.publicIp.update({ where: { id: ipId }, data: { reverseDnsSynced: true } });
    } catch (err) {
      this.log.warn(`PTR for ${ip.address} failed: ${(err as Error).message}`);
    }
  }

  /** Minute job: retry zones whose nameserver copy is behind, and unsynced PTRs. */
  async resyncPending() {
    const zones = await this.prisma.dnsZone.findMany({ where: { deletedAt: null, OR: [{ status: { in: ['pending', 'error'] } }, { syncedSerial: { lt: this.prisma.dnsZone.fields.serial } }] }, select: { id: true } });
    for (const z of zones) await this.sync(z.id);
    const ips = await this.prisma.publicIp.findMany({ where: { reverseDnsSynced: false }, select: { id: true } });
    for (const ip of ips) await this.pushPtr(ip.id);
    return zones.length + ips.length;
  }

  // ---- helpers ----

  private async own(actor: Actor, name: string, project?: string) {
    const p = await this.iam.resolveProject(actor, project);
    const z = await this.prisma.dnsZone.findFirst({ where: { name: name.toLowerCase().replace(/\.$/, ''), projectId: p.id, deletedAt: null } });
    if (!z) throw ApiError.notFound('domain', name);
    return z;
  }

  private async touch(zoneId: string, actor: Actor, change: string, r: DnsRecord) {
    const z = await this.prisma.dnsZone.update({ where: { id: zoneId }, data: { serial: { increment: 1 } } });
    await this.events.emit('domain.record_changed', { domain: z.name, change, record: presentRecord(r) }, { actor, resource: `domain:${z.name}` });
    await this.sync(zoneId);
  }

  private async validateRecord(z: DnsZone, r: { name: string; type: DnsRecordType; content: string; ttl?: number; priority?: number }, selfId?: string) {
    const name = r.name;
    if (name !== '@' && !HOSTNAME.test(name.replace(/^\*\./, '').replace(/^\*$/, 'x'))) throw ApiError.invalid(`"${r.name}" is not a valid record name`);
    if (name.endsWith(`.${z.name}`) || name === z.name) throw ApiError.invalid('Use a name relative to the zone, or @ for the zone itself');
    let content = r.content.trim();
    let priority = r.priority;
    const host = (v: string) => {
      const h = v.toLowerCase().replace(/\.$/, '');
      if (!HOSTNAME.test(h) || !h.includes('.')) throw ApiError.invalid(`"${v}" is not a valid hostname`);
      return h;
    };
    switch (r.type) {
      case 'A':
        if (isIP(content) !== 4) throw ApiError.invalid('A records need an IPv4 address');
        break;
      case 'AAAA':
        if (isIP(content) !== 6) throw ApiError.invalid('AAAA records need an IPv6 address');
        break;
      case 'CNAME':
        if (name === '@') throw ApiError.invalid('A CNAME cannot sit at the zone apex; use an A record');
        content = host(content);
        break;
      case 'NS':
        if (name === '@') throw ApiError.invalid('The apex NS set is managed by prgd');
        content = host(content);
        break;
      case 'MX':
        if (priority == null) priority = 10;
        content = host(content);
        break;
      case 'SRV': {
        if (!/^_[a-z0-9-]+\._(tcp|udp|tls)(\..+)?$|^@$/.test(name)) throw ApiError.invalid('SRV names look like _service._tcp');
        const m = content.match(/^(\d+)\s+(\d+)\s+(\S+)$/);
        if (!m) throw ApiError.invalid('SRV content is "weight port target", for example 5 5060 sip.example.com');
        if (priority == null) priority = 10;
        content = `${m[1]} ${m[2]} ${host(m[3])}`;
        break;
      }
      case 'CAA': {
        const m = content.match(/^(\d+)\s+(issue|issuewild|iodef)\s+"?([^"]*)"?$/);
        if (!m) throw ApiError.invalid('CAA content is "flags tag value", for example 0 issue letsencrypt.org');
        content = `${m[1]} ${m[2]} "${m[3]}"`;
        break;
      }
      case 'TXT':
        if (content.length > 4000) throw ApiError.invalid('TXT content is too long');
        break;
    }
    // A CNAME must be alone at its name.
    const siblings = await this.prisma.dnsRecord.findMany({ where: { zoneId: z.id, name, ...(selfId ? { id: { not: selfId } } : {}) }, select: { type: true } });
    if (r.type === 'CNAME' && siblings.length) throw ApiError.conflict('cname_conflict', `"${name}" already has other records; a CNAME must stand alone`);
    if (r.type !== 'CNAME' && siblings.some((s) => s.type === 'CNAME')) throw ApiError.conflict('cname_conflict', `"${name}" is a CNAME; delete it before adding other records`);
    return { name, type: r.type, content, ttl: r.ttl ?? 3600, priority: r.type === 'MX' || r.type === 'SRV' ? priority : null };
  }

  private presentZone(z: DnsZone, recordCount: number) {
    return { id: z.id, name: z.name, status: z.status, statusMessage: z.statusMessage, serial: z.serial, synced: z.syncedSerial >= z.serial && z.status === 'active', nameservers: this.nameservers, recordCount, createdAt: z.createdAt };
  }
}

/** "www.example.com" → "www" inside example.com; "" and "example.com" → "@". */
function relative(name: string, zone: string) {
  const n = name.trim().toLowerCase().replace(/\.$/, '');
  if (n === '' || n === '@' || n === zone) return '@';
  return n.endsWith(`.${zone}`) ? n.slice(0, -zone.length - 1) : n;
}

/** Record content in wire presentation form: hostnames absolute, TXT quoted. */
function wire(r: DnsRecord, _zone: string) {
  switch (r.type) {
    case 'CNAME':
    case 'NS':
    case 'MX':
      return `${r.content}.`;
    case 'SRV': {
      const [w, p, t] = r.content.split(' ');
      return `${w} ${p} ${t}.`;
    }
    case 'TXT':
      return `"${r.content.replace(/"/g, '\\"')}"`;
    default:
      return r.content;
  }
}

function toRRSets(z: DnsZone, records: DnsRecord[]): RRSet[] {
  const groups = new Map<string, RRSet>();
  for (const r of records) {
    const fq = r.name === '@' ? `${z.name}.` : `${r.name}.${z.name}.`;
    const key = `${fq}|${r.type}`;
    const g = groups.get(key) ?? { name: fq, type: r.type, ttl: r.ttl, records: [] };
    g.ttl = Math.min(g.ttl, r.ttl);
    g.records.push(`${r.priority != null ? `${r.priority} ` : ''}${wire(r, z.name)}`);
    groups.set(key, g);
  }
  return [...groups.values()];
}

export function presentRecord(r: DnsRecord) {
  return { id: r.id, name: r.name, type: r.type, content: r.content, ttl: r.ttl, priority: r.priority, updatedAt: r.updatedAt };
}
