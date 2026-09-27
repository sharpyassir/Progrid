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

/**
 * SigV4 GET and PUT against a platform owned bucket (path style), standard library only.
 * `b` is {endpoint, region, bucket, accessKey, secretKey}. Needs `shutil`, `urllib.request`
 * and `urllib.parse` imported.
 */
export const AGENT_S3_PY = String.raw`# ---- platform backup bucket: SigV4, path style ----
def s3_request(b, method, key, body=b'', out=None):
    import hashlib, hmac, datetime
    u = urllib.parse.urlparse(b['endpoint']); host = u.netloc; base = u.path.rstrip('/')
    now = datetime.datetime.utcnow(); amz = now.strftime('%Y%m%dT%H%M%SZ'); day = now.strftime('%Y%m%d')
    ph = hashlib.sha256(body).hexdigest(); canonical_uri = f"{base}/{b['bucket']}/{urllib.parse.quote(key)}"
    headers = {'host': host, 'x-amz-content-sha256': ph, 'x-amz-date': amz}
    signed = ';'.join(sorted(headers)); ch = ''.join(f"{k}:{headers[k]}\n" for k in sorted(headers))
    creq = '\n'.join([method, canonical_uri, '', ch, signed, ph]); scope = f"{day}/{b['region']}/s3/aws4_request"
    sts = '\n'.join(['AWS4-HMAC-SHA256', amz, scope, hashlib.sha256(creq.encode()).hexdigest()])
    def h(k, m): return hmac.new(k, m.encode(), hashlib.sha256).digest()
    sig = hmac.new(h(h(h(h(('AWS4' + b['secretKey']).encode(), day), b['region']), 's3'), 'aws4_request'), sts.encode(), hashlib.sha256).hexdigest()
    headers['Authorization'] = f"AWS4-HMAC-SHA256 Credential={b['accessKey']}/{scope}, SignedHeaders={signed}, Signature={sig}"
    req = urllib.request.Request(f"{u.scheme}://{host}{canonical_uri}", data=body if method == 'PUT' else None, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=600) as r:
        if out:
            with open(out, 'wb') as f: shutil.copyfileobj(r, f)
        else: r.read()
def s3_put(b, key, path):
    body = open(path, 'rb').read(); s3_request(b, 'PUT', key, body); return len(body)
def s3_get(b, key, path): s3_request(b, 'GET', key, out=path)`;

/** AGENT_NET_PY indented for a YAML block scalar. */
export function agentNetPy(indent = 6): string {
  return indentBlock(AGENT_NET_PY, indent);
}

/** Indents every non empty line, for pasting Python into a YAML block scalar. */
export function indentBlock(text: string, indent: number): string {
  return text.split('\n').map((l) => (l ? ' '.repeat(indent) + l : '')).join('\n');
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
