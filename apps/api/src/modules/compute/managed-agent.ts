/**
 * Managed server tier: the care agent that runs inside the customer's VM.
 *
 * One shell script installs everything. It is delivered two ways: as a second
 * cloud-init part when the server is created managed, or served at
 * `GET /v1/managed/install/:token` for a server that turns managed on later
 * (the console shows the one line command). The script is idempotent.
 *
 * What it sets up, all with stock Ubuntu and Debian packages:
 *   - unattended-upgrades for security and regular updates, automatic reboot
 *     at 04:00 server time when a kernel or libc update needs one
 *   - fail2ban on sshd
 *   - sshd hardening (no password auth once a key is present, no root password
 *     login) and a few sysctl safety settings
 *   - a small reporter (Python, standard library only) that posts uptime, load,
 *     memory, disk, pending updates, reboot state and failed systemd units to
 *     the control plane every five minutes, authenticated by the server's own
 *     managed token
 *
 * Daily backups are switched on by the control plane, not by the agent.
 */

export const MANAGED_AGENT_VERSION = 1;
export const MANAGED_MARKER = '# prgd-managed-agent';

const REPORTER = `#!/usr/bin/env python3
# prgd managed care reporter. Standard library only.
import json, os, subprocess, time, urllib.request

ENV = dict(l.strip().split('=', 1) for l in open('/etc/prgd/managed.env') if '=' in l)

def sh(cmd):
    try:
        return subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=120).stdout
    except Exception:
        return ''

def meminfo():
    m = {}
    for line in open('/proc/meminfo'):
        k, v = line.split(':', 1)
        m[k] = int(v.strip().split()[0])
    total = m.get('MemTotal', 0)
    avail = m.get('MemAvailable', 0)
    return total // 1024, (total - avail) // 1024

def disk():
    st = os.statvfs('/')
    total = st.f_blocks * st.f_frsize
    free = st.f_bavail * st.f_frsize
    used = total - free
    return round(total / 1e9, 1), round(used / 1e9, 1), int(used * 100 / total) if total else 0

def pending_updates():
    out = sh('apt-get -s -o Debug::NoLocking=1 upgrade 2>/dev/null')
    pkgs = [l for l in out.splitlines() if l.startswith('Inst ')]
    sec = [l for l in pkgs if '-security' in l]
    return len(pkgs), len(sec)

def last_upgrade():
    for p in ('/var/lib/apt/periodic/upgrade-stamp', '/var/lib/apt/periodic/unattended-upgrades-stamp'):
        if os.path.exists(p):
            return time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(os.path.getmtime(p)))
    return None

def failed_units():
    out = sh('systemctl list-units --state=failed --no-legend --plain 2>/dev/null')
    return [l.split()[0] for l in out.splitlines() if l.strip()][:20]

def banned():
    out = sh('fail2ban-client status sshd 2>/dev/null')
    for l in out.splitlines():
        if 'Currently banned' in l:
            try:
                return int(l.split(':')[-1].strip())
            except ValueError:
                return 0
    return 0

mem_total, mem_used = meminfo()
disk_total, disk_used, disk_pct = disk()
upd, sec = pending_updates()
report = {
    'agentVersion': ${MANAGED_AGENT_VERSION},
    'hostname': os.uname().nodename,
    'kernel': os.uname().release,
    'uptimeSec': int(float(open('/proc/uptime').read().split()[0])),
    'load1': os.getloadavg()[0],
    'memTotalMb': mem_total, 'memUsedMb': mem_used,
    'diskTotalGb': disk_total, 'diskUsedGb': disk_used, 'diskUsedPct': disk_pct,
    'pendingUpdates': upd, 'securityUpdates': sec,
    'rebootRequired': os.path.exists('/var/run/reboot-required'),
    'lastUpgradeAt': last_upgrade(),
    'failedUnits': failed_units(),
    'sshBanned': banned(),
    'sshPasswordAuth': 'no' not in sh("sshd -T 2>/dev/null | grep -i '^passwordauthentication'"),
    'reportedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
}
req = urllib.request.Request(ENV['API_URL'].rstrip('/') + '/v1/managed/report', data=json.dumps(report).encode(), method='POST',
                             headers={'Content-Type': 'application/json', 'X-Prgd-Managed-Token': ENV['TOKEN']})
urllib.request.urlopen(req, timeout=20).read()
`;

/** The install script. `apiUrl` is where the reporter posts; `token` is the server's managed token. */
export function renderManagedInstallScript(opts: { apiUrl: string; token: string }): string {
  const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
  return `#!/bin/sh
${MANAGED_MARKER} v${MANAGED_AGENT_VERSION}
# Installs the prgd managed care agent. Safe to run more than once.
set -e
export DEBIAN_FRONTEND=noninteractive
mkdir -p /opt/prgd /etc/prgd
umask 077
printf 'API_URL=%s\\nTOKEN=%s\\n' ${q(opts.apiUrl)} ${q(opts.token)} > /etc/prgd/managed.env
umask 022

apt-get update -qq || true
apt-get install -y -qq unattended-upgrades fail2ban python3 >/dev/null

cat > /etc/apt/apt.conf.d/52prgd-unattended <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
Unattended-Upgrade::Allowed-Origins {
  "\${distro_id}:\${distro_codename}-security";
  "\${distro_id}ESMApps:\${distro_codename}-apps-security";
  "\${distro_id}ESM:\${distro_codename}-infra-security";
  "\${distro_id}:\${distro_codename}-updates";
};
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
EOF

cat > /etc/fail2ban/jail.d/prgd.conf <<'EOF'
[DEFAULT]
bantime = 1h
findtime = 10m
maxretry = 5
[sshd]
enabled = true
EOF

# Turn password logins off only once a key is on the box, so nobody gets locked out.
if [ -s /root/.ssh/authorized_keys ] || ls /home/*/.ssh/authorized_keys >/dev/null 2>&1; then
  mkdir -p /etc/ssh/sshd_config.d
  printf 'PasswordAuthentication no\\nPermitRootLogin prohibit-password\\nMaxAuthTries 4\\nX11Forwarding no\\n' > /etc/ssh/sshd_config.d/50-prgd.conf
fi

cat > /etc/sysctl.d/60-prgd.conf <<'EOF'
net.ipv4.tcp_syncookies = 1
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.all.send_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
kernel.kptr_restrict = 2
EOF
sysctl --system >/dev/null 2>&1 || true

cat > /opt/prgd/managed-report.py <<'EOF'
${REPORTER}EOF
chmod 0755 /opt/prgd/managed-report.py

cat > /etc/systemd/system/prgd-managed.service <<'EOF'
[Unit]
Description=prgd managed care report
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /opt/prgd/managed-report.py
EOF
cat > /etc/systemd/system/prgd-managed.timer <<'EOF'
[Unit]
Description=prgd managed care report every five minutes
[Timer]
OnBootSec=90s
OnUnitActiveSec=5min
RandomizedDelaySec=45s
[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now prgd-managed.timer >/dev/null 2>&1
systemctl enable --now fail2ban >/dev/null 2>&1 || true
systemctl restart fail2ban >/dev/null 2>&1 || true
systemctl reload ssh >/dev/null 2>&1 || systemctl reload sshd >/dev/null 2>&1 || true
systemctl restart unattended-upgrades >/dev/null 2>&1 || true
systemctl start prgd-managed.service >/dev/null 2>&1 || true
echo "prgd managed care agent installed"
`;
}

/** True when the stored user-data already carries the agent. */
export function hasManagedAgent(userData: string | null | undefined): boolean {
  return !!userData && userData.includes(MANAGED_MARKER);
}

/**
 * Combine the customer's user-data (cloud-config or script, possibly empty) with the
 * install script as a multipart cloud-init document. cloud-init runs both parts, the
 * customer's first, so app and marketplace setup is not disturbed.
 */
export function withManagedAgent(userData: string | null | undefined, script: string): string {
  const parts: { type: string; name: string; body: string }[] = [];
  if (userData?.trim()) {
    const body = userData.trimEnd() + '\n';
    parts.push({ type: body.startsWith('#!') ? 'text/x-shellscript' : 'text/cloud-config', name: 'user-data', body });
  }
  parts.push({ type: 'text/x-shellscript', name: 'prgd-managed.sh', body: script });
  const boundary = '==prgd-managed==';
  return [
    'Content-Type: multipart/mixed; boundary="' + boundary + '"',
    'MIME-Version: 1.0',
    '',
    ...parts.flatMap((p) => ['--' + boundary, `Content-Type: ${p.type}; charset="us-ascii"`, 'MIME-Version: 1.0', 'Content-Transfer-Encoding: 7bit', `Content-Disposition: attachment; filename="${p.name}"`, '', p.body]),
    '--' + boundary + '--',
    '',
  ].join('\n');
}

export interface ManagedReport {
  agentVersion?: number;
  hostname?: string;
  kernel?: string;
  uptimeSec?: number;
  load1?: number;
  memTotalMb?: number;
  memUsedMb?: number;
  diskTotalGb?: number;
  diskUsedGb?: number;
  diskUsedPct?: number;
  pendingUpdates?: number;
  securityUpdates?: number;
  rebootRequired?: boolean;
  lastUpgradeAt?: string | null;
  failedUnits?: string[];
  sshBanned?: number;
  sshPasswordAuth?: boolean;
  reportedAt?: string;
}

export type ManagedHealth = 'ok' | 'warn' | 'stale' | 'pending';

/** Reports older than this are stale: the agent stopped, or the server is off. */
export const MANAGED_STALE_MS = 15 * 60 * 1000;

/** Health from a report: warn on a nearly full disk, failed units or many security updates left. */
export function healthOf(report: ManagedReport | null, reportedAt: Date | null, now = new Date()): { health: ManagedHealth; issues: string[] } {
  if (!report || !reportedAt) return { health: 'pending', issues: [] };
  if (now.getTime() - reportedAt.getTime() > MANAGED_STALE_MS) return { health: 'stale', issues: ['No report in the last 15 minutes'] };
  const issues: string[] = [];
  if ((report.diskUsedPct ?? 0) >= 90) issues.push(`Disk is ${report.diskUsedPct}% full`);
  if (report.failedUnits?.length) issues.push(`Failed services: ${report.failedUnits.join(', ')}`);
  if ((report.memTotalMb ?? 0) > 0 && (report.memUsedMb ?? 0) / (report.memTotalMb ?? 1) >= 0.95) issues.push('Memory is nearly full');
  if ((report.securityUpdates ?? 0) >= 10) issues.push(`${report.securityUpdates} security updates waiting`);
  return { health: issues.length ? 'warn' : 'ok', issues };
}
