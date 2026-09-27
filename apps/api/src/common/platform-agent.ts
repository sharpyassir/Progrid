import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

/**
 * Shared pieces of the platform agents (load balancer, database, Kubernetes, app host and
 * Git Deploy agents on :9009).
 *
 * Network layout of every platform VM: net0 is the private bridge (the project network) and
 * net1 the public one. Interface names differ between images, so the agents detect them at
 * run time: the public interface carries the default route, the private interface is the
 * other one. Agents listen on the private address only and the control plane calls them
 * there.
 */

/** Python helpers pasted into every agent. Needs `os`, `subprocess` and `time` imported. */
export const AGENT_NET_PY = String.raw`# ---- network: the default route marks the public interface, the other one is private ----
def _out(cmd):
    try: return subprocess.run(cmd, capture_output=True, text=True, timeout=10).stdout
    except Exception: return ''
def public_iface():
    out = _out(['ip', 'route', 'show', 'default']).split()
    return out[out.index('dev') + 1] if 'dev' in out else None
def private_iface():
    pub = public_iface()
    nics = sorted(n for n in os.listdir('/sys/class/net') if n != pub and os.path.exists('/sys/class/net/' + n + '/device'))
    return nics[0] if nics else None
def iface_ipv4(name):
    out = _out(['ip', '-4', '-o', 'addr', 'show', 'dev', name, 'scope', 'global']).split() if name else []
    return out[out.index('inet') + 1].split('/')[0] if 'inet' in out else None
def private_ipv4():
    return iface_ipv4(private_iface())
def vip_iface():
    # /opt/pgcloud/vip.network is written by cloud-init: the network that carries the virtual IP.
    which = open('/opt/pgcloud/vip.network').read().strip() if os.path.exists('/opt/pgcloud/vip.network') else 'public'
    return (private_iface() if which == 'private' else public_iface()) or public_iface() or 'eth0'
def bind_address():
    # Listen on the private address only. DHCP on the private network may still be running at boot.
    for _ in range(150):
        a = private_ipv4()
        if a: return a
        time.sleep(2)
    open('/var/log/pgcloud-agent.log', 'a').write('no private address after five minutes; listening on all addresses\n')
    return '0.0.0.0'`;

/** AGENT_NET_PY indented for a YAML block scalar. */
export function agentNetPy(indent = 6): string {
  return AGENT_NET_PY.split('\n').map((l) => (l ? ' '.repeat(indent) + l : '')).join('\n');
}

/**
 * Which network a keepalived virtual IP belongs on. An address from the private ranges goes
 * on the private interface; a public address must sit on the public interface, where its
 * subnet and gateway live, or nothing outside the node can reach it.
 */
export function vipNetworkFor(address: string | null | undefined): 'public' | 'private' {
  if (!address || isIP(address) !== 4) return 'public';
  const [a, b] = address.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ? 'private' : 'public';
}

/** VRRP PASS authentication takes eight characters; derived from the cluster secret. */
export function vrrpPass(vmSecret: string): string {
  return createHash('sha256').update(`vrrp:${vmSecret}`).digest('base64url').slice(0, 8);
}

const log = new Logger('PlatformAgent');
const warned = new Set<string>();

/**
 * Address the control plane uses to reach a platform agent: the private IP, or the first
 * public IP with a warning (once per server and process) when the private one is unknown.
 */
export function agentHost(s: { id?: string; name?: string; privateIp?: string | null; publicIps: { address: string }[] }): string | null {
  if (s.privateIp) return s.privateIp;
  const pub = s.publicIps[0]?.address ?? null;
  const key = s.id ?? s.name ?? pub ?? '';
  if (pub && !warned.has(key)) {
    warned.add(key);
    log.warn(`server ${s.name ?? s.id ?? pub} has no private IP recorded; calling its agent on the public address ${pub}`);
  }
  return pub;
}
