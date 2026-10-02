import { Injectable } from '@nestjs/common';
import { connect as tlsConnect } from 'node:tls';
import { isIP, Socket } from 'node:net';
import { lookup } from 'node:dns/promises';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { loadConfig } from '../../../config/config';
import type { CheckKey } from './catalog';

export type CheckStatus = 'pass' | 'warn' | 'fail';
export interface CheckResult { status: CheckStatus; summary: string; details: Record<string, unknown>; items: { label: string; status: CheckStatus; detail: string }[] }

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const worst = (items: { status: CheckStatus }[]): CheckStatus => (items.some((i) => i.status === 'fail') ? 'fail' : items.some((i) => i.status === 'warn') ? 'warn' : 'pass');
const pct = (used: number, total: number) => (total > 0 ? Math.round((used * 100) / total) : 0);

/** Ports probed on the management host's public address in the quarterly security audit. */
const PROBE_PORTS = [21, 22, 23, 25, 80, 443, 2375, 2376, 3000, 3001, 3002, 3306, 4000, 4100, 4222, 5432, 6379, 7233, 8006, 8080, 8081, 8222, 9090, 9093, 9100, 11211, 27017];

/**
 * The automatic checks behind the platform task list. Each reads the platform's own state (or
 * probes its public endpoints) and returns pass, warn or fail with one line per finding.
 * Injectable probes keep the network parts testable.
 */
@Injectable()
export class PlatformChecks {
  /** Overridable in tests. */
  probes = { tlsDaysLeft, portOpen, resolve: async (host: string) => (await lookup(host)).address };

  constructor(private readonly prisma: PrismaService) {}

  async run(key: CheckKey, now = new Date()): Promise<CheckResult> {
    const items = await this[key](now);
    const status = worst(items);
    const bad = items.filter((i) => i.status !== 'pass');
    const summary = bad.length ? bad.map((i) => `${i.label}: ${i.detail}`).slice(0, 3).join(' · ') : items.map((i) => `${i.label}: ${i.detail}`).slice(0, 2).join(' · ') || 'Nothing to check yet';
    return { status, summary: summary.slice(0, 500), details: { checkedAt: now.toISOString() }, items };
  }

  /** Hosts reporting, open alerts, platform services. */
  private async monitoring(now: Date) {
    const items: CheckResult['items'] = [];
    const hosts = await this.prisma.host.findMany({ where: { status: { in: ['active', 'draining'] } } });
    if (!hosts.length) items.push({ label: 'Hosts', status: 'warn', detail: 'no compute host is registered yet' });
    for (const h of hosts) {
      const age = h.lastHeartbeatAt ? now.getTime() - h.lastHeartbeatAt.getTime() : Infinity;
      const used = Math.max(pct(h.usedVcpu, h.totalVcpu * h.overcommitCpu), pct(h.usedMemoryMb, h.totalMemoryMb), pct(h.usedDiskGb, h.totalDiskGb));
      items.push({ label: `Host ${h.name}`, status: age > 10 * 60_000 ? 'fail' : used >= 90 ? 'warn' : 'pass', detail: `${Number.isFinite(age) ? `last report ${Math.round(age / 60_000)} min ago` : 'never reported'}, ${used}% allocated` });
    }
    const [incidents, managed] = await Promise.all([
      this.prisma.alertIncident.count({ where: { resolvedAt: null, startedAt: { lt: new Date(now.getTime() - DAY) } } }),
      this.prisma.alert.count({ where: { status: 'FIRING', createdAt: { lt: new Date(now.getTime() - DAY) } } }),
    ]);
    items.push({ label: 'Customer alerts open over a day', status: incidents > 0 ? 'warn' : 'pass', detail: String(incidents) });
    items.push({ label: 'Managed alerts firing over a day', status: managed > 0 ? 'warn' : 'pass', detail: String(managed) });
    await this.prisma.$queryRaw`SELECT 1`;
    items.push({ label: 'Database', status: 'pass', detail: 'reachable' });
    return items;
  }

  /** Daily platform backups of customer servers, and the platform's own database backup. */
  private async backups(now: Date) {
    const items: CheckResult['items'] = [];
    const servers = await this.prisma.server.findMany({ where: { backupsEnabled: true, status: { in: ['active', 'off'] }, createdAt: { lt: new Date(now.getTime() - DAY) } }, select: { id: true, name: true } });
    let missing = 0, failed = 0;
    const late: string[] = [];
    for (const s of servers) {
      const last = await this.prisma.snapshot.findFirst({ where: { serverId: s.id, kind: 'backup' }, orderBy: { createdAt: 'desc' }, select: { status: true, createdAt: true } });
      if (!last || now.getTime() - last.createdAt.getTime() > 26 * HOUR) { missing++; late.push(s.name); } else if (last.status === 'failed') { failed++; late.push(s.name); }
    }
    items.push({ label: 'Customer server backups', status: failed ? 'fail' : missing ? 'warn' : 'pass', detail: servers.length ? `${servers.length - missing - failed} of ${servers.length} backed up in the last day${late.length ? ` (late or failed: ${late.slice(0, 5).join(', ')})` : ''}` : 'no servers with backups on' });
    const recentFailed = await this.prisma.snapshot.count({ where: { kind: 'backup', status: 'failed', createdAt: { gte: new Date(now.getTime() - 7 * DAY) } } });
    items.push({ label: 'Failed backups this week', status: recentFailed ? 'warn' : 'pass', detail: String(recentFailed) });
    // The control plane database: infra/prod/backup.sh reports every nightly result (POST /internal/platform/backup).
    const [done, failedRun] = await Promise.all([
      this.prisma.auditLog.findFirst({ where: { action: 'platform.backup_completed' }, orderBy: { at: 'desc' }, select: { at: true, request: true } }),
      this.prisma.auditLog.findFirst({ where: { action: 'platform.backup_failed' }, orderBy: { at: 'desc' }, select: { at: true } }),
    ]);
    const age = done ? now.getTime() - done.at.getTime() : Infinity;
    const offsite = (done?.request as { offsite?: boolean } | null)?.offsite === true;
    items.push({
      label: 'Platform database backup',
      status: !done || age > 26 * HOUR || (failedRun && failedRun.at > done.at) ? 'fail' : offsite ? 'pass' : 'warn',
      detail: !done
        ? 'no backup has reported yet: set PRGD_PLATFORM_HEARTBEAT_SECRET for the backup job'
        : failedRun && failedRun.at > done.at
          ? `the last run failed (${failedRun.at.toISOString().slice(0, 16)}); last good one ${Math.round(age / HOUR)} h ago`
          : `last ${Math.round(age / HOUR)} h ago${offsite ? ', copied off the server' : ', but only on the same server: set BACKUP_S3_URL'}`,
    });
    return items;
  }

  /** Abuse flags on customer servers. */
  private async abuse(now: Date) {
    const [open, week] = await Promise.all([
      this.prisma.abuseFlag.count({ where: { resolvedAt: null } }),
      this.prisma.abuseFlag.count({ where: { createdAt: { gte: new Date(now.getTime() - 7 * DAY) } } }),
    ]);
    return [
      { label: 'Open abuse flags', status: (open ? 'fail' : 'pass') as CheckStatus, detail: `${open}${open ? ' (Back office, Abuse)' : ''}` },
      { label: 'New this week', status: (week ? 'warn' : 'pass') as CheckStatus, detail: String(week) },
    ];
  }

  /** Failed sign ins, staff without a second factor, stale API tokens, access grants. */
  private async access(now: Date) {
    const since = new Date(now.getTime() - 30 * DAY);
    const failed = await this.prisma.auditLog.findMany({ where: { action: { in: ['auth.login_failed', 'ops.signin_failed'] }, at: { gte: since } }, select: { ip: true } });
    const byIp = new Map<string, number>();
    for (const f of failed) if (f.ip) byIp.set(f.ip, (byIp.get(f.ip) ?? 0) + 1);
    const top = [...byIp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    const noTotp = await this.prisma.user.findMany({ where: { isStaff: true, totpEnabled: false }, select: { email: true } });
    const external = await this.prisma.engineerProfile.findMany({ where: { kind: 'EXTERNAL', status: 'ACTIVE' }, include: { user: { select: { email: true, totpEnabled: true } } } });
    const staleTokens = await this.prisma.apiToken.count({ where: { revokedAt: null, OR: [{ lastUsedAt: null, createdAt: { lt: new Date(now.getTime() - 90 * DAY) } }, { lastUsedAt: { lt: new Date(now.getTime() - 90 * DAY) } }] } });
    const grants = await this.prisma.accessGrant.count({ where: { createdAt: { gte: since } } });
    return [
      { label: 'Failed sign ins (30 days)', status: (top.some(([, n]) => n >= 20) ? 'warn' : 'pass') as CheckStatus, detail: `${failed.length}${top.length ? `; most from ${top.map(([ip, n]) => `${ip} (${n})`).join(', ')}` : ''}` },
      { label: 'Staff without two factor sign in', status: (noTotp.length ? 'fail' : 'pass') as CheckStatus, detail: noTotp.length ? noTotp.map((u) => u.email).join(', ') : 'none' },
      { label: 'Contract engineers without two factor', status: (external.some((e) => !e.user.totpEnabled) ? 'fail' : 'pass') as CheckStatus, detail: `${external.filter((e) => !e.user.totpEnabled).length} of ${external.length}` },
      { label: 'API tokens unused for 90 days', status: (staleTokens ? 'warn' : 'pass') as CheckStatus, detail: `${staleTokens}${staleTokens ? ' (customers can revoke them; consider a reminder)' : ''}` },
      { label: 'Server access grants (30 days)', status: 'pass' as CheckStatus, detail: `${grants}, each recorded in the ops audit` },
    ];
  }

  /** Allocation of compute hosts and the public address pool. */
  private async capacity() {
    const items: CheckResult['items'] = [];
    const hosts = await this.prisma.host.findMany({ where: { status: { in: ['active', 'draining'] } } });
    let cpu = 0, cpuT = 0, mem = 0, memT = 0, disk = 0, diskT = 0;
    for (const h of hosts) { cpu += h.usedVcpu; cpuT += h.totalVcpu * h.overcommitCpu; mem += h.usedMemoryMb; memT += h.totalMemoryMb; disk += h.usedDiskGb; diskT += h.totalDiskGb; }
    const level = (p: number): CheckStatus => (p >= 85 ? 'fail' : p >= 70 ? 'warn' : 'pass');
    if (!hosts.length) items.push({ label: 'Compute hosts', status: 'warn', detail: 'none registered; customers cannot create servers' });
    else {
      items.push({ label: 'vCPU allocated', status: level(pct(cpu, cpuT)), detail: `${pct(cpu, cpuT)}% of ${cpuT} (with overcommit)` });
      items.push({ label: 'Memory allocated', status: level(pct(mem, memT)), detail: `${pct(mem, memT)}% of ${Math.round(memT / 1024)} GB` });
      items.push({ label: 'Disk allocated', status: level(pct(disk, diskT)), detail: `${pct(disk, diskT)}% of ${diskT} GB` });
    }
    const [free, all] = await Promise.all([this.prisma.publicIp.count({ where: { status: 'free' } }), this.prisma.publicIp.count()]);
    items.push({ label: 'Free public IPv4 addresses', status: all === 0 || free / Math.max(all, 1) < 0.1 ? 'warn' : 'pass', detail: `${free} of ${all}` });
    if (items.some((i) => i.status !== 'pass')) items.push({ label: 'Advice', status: 'warn', detail: 'order another server (or an IP block) before allocation passes 85%' });
    return items;
  }

  /** TLS certificates of every public host name, unexpected open ports, staff second factors. */
  private async security() {
    const c = loadConfig();
    const items: CheckResult['items'] = [];
    for (const host of platformHostnames()) {
      try {
        const days = await this.probes.tlsDaysLeft(host);
        items.push({ label: `TLS ${host}`, status: days < 14 ? 'fail' : days < 30 ? 'warn' : 'pass', detail: `expires in ${days} days` });
      } catch (err) {
        items.push({ label: `TLS ${host}`, status: 'fail', detail: `no valid certificate (${(err as Error).message.slice(0, 80)})` });
      }
    }
    const expected = new Set(c.PRGD_PLATFORM_EXPECTED_PORTS.split(',').map((p) => Number(p.trim())).filter(Boolean));
    const apiHost = new URL(c.PUBLIC_API_URL).hostname;
    try {
      const ip = await this.probes.resolve(apiHost);
      const open: number[] = [];
      for (const port of PROBE_PORTS) if (await this.probes.portOpen(ip, port)) open.push(port);
      const unexpected = open.filter((p) => !expected.has(p));
      items.push({ label: `Open ports on ${ip}`, status: unexpected.length ? 'fail' : 'pass', detail: unexpected.length ? `unexpected: ${unexpected.join(', ')} (expected only ${[...expected].join(', ')})` : `only ${open.join(', ') || 'none'}` });
    } catch (err) {
      items.push({ label: 'Open ports', status: 'warn', detail: `could not resolve ${apiHost}: ${(err as Error).message.slice(0, 80)}` });
    }
    const noTotp = await this.prisma.user.count({ where: { isStaff: true, totpEnabled: false } });
    items.push({ label: 'Staff without two factor sign in', status: noTotp ? 'fail' : 'pass', detail: String(noTotp) });
    items.push({ label: 'Still by hand', status: 'warn', detail: 'rotate server and database passwords and the vault secrets, review user permissions, attach the evidence' });
    return items;
  }

  /** Runbooks reviewed this quarter, postmortems written. */
  private async runbooks(now: Date) {
    const q = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1));
    const [total, updated] = await Promise.all([this.prisma.runbook.count(), this.prisma.runbook.count({ where: { updatedAt: { gte: q } } })]);
    return [
      { label: 'Runbooks updated this quarter', status: (updated ? 'pass' : 'warn') as CheckStatus, detail: `${updated} of ${total}` },
      { label: 'Still by hand', status: 'warn' as CheckStatus, detail: 'add what the last incidents and the drill taught to the incident runbook' },
    ];
  }

  /** What the engineer patches: the hosts, and how long since the control plane was redeployed. */
  private async patching() {
    const hosts = await this.prisma.host.findMany({ where: { status: { in: ['active', 'draining', 'maintenance'] } }, select: { name: true } });
    const uptimeDays = Math.floor(process.uptime() / 86_400);
    return [
      { label: 'Control plane', status: (uptimeDays > 14 ? 'warn' : 'pass') as CheckStatus, detail: `API running for ${uptimeDays} days since the last deploy` },
      { label: 'Hosts to patch', status: 'warn' as CheckStatus, detail: `${hosts.map((h) => h.name).join(', ') || 'none registered'}, plus the management server: apt upgrade on staging first, then production, reboot if a new kernel` },
    ];
  }
}

/** Public host names whose certificates are watched: API, console, ops, website, plus any configured. */
export function platformHostnames(): string[] {
  const c = loadConfig();
  const set = new Set<string>();
  for (const u of [c.PUBLIC_API_URL, c.CONSOLE_URL, c.PRGD_OPS_URL]) {
    try { const h = new URL(u).hostname; if (h.includes('.') && !isIP(h)) set.add(h); } catch { /* not a URL */ }
  }
  const consoleHost = [...set].find((h) => h.startsWith('console.'));
  if (consoleHost) set.add(consoleHost.slice('console.'.length));
  for (const h of c.PRGD_PLATFORM_HOSTNAMES.split(',').map((x) => x.trim()).filter(Boolean)) set.add(h);
  return [...set];
}

/** Days until the TLS certificate served on host:443 expires. Throws when there is no valid certificate. */
export function tlsDaysLeft(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = tlsConnect({ host, port: 443, servername: host, timeout: 8_000 }, () => {
      const cert = s.getPeerCertificate();
      const ok = s.authorized;
      const err = s.authorizationError;
      s.end();
      if (!ok) return reject(new Error(String(err ?? 'certificate not trusted')));
      resolve(Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / DAY));
    });
    s.on('timeout', () => { s.destroy(); reject(new Error('timeout')); });
    s.on('error', reject);
  });
}

/** Whether a TCP port accepts connections (2 second timeout). */
export function portOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = new Socket();
    const done = (v: boolean) => { s.destroy(); resolve(v); };
    s.setTimeout(2_000);
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
    s.connect(port, host);
  });
}
