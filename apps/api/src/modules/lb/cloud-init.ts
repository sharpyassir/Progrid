import { agentNetPy } from '../../common/platform-agent';

/**
 * cloud-init for a load balancer node. Installs HAProxy, keepalived and certbot, and
 * `prgd-lbd`: a small HTTP agent on the private address, port 9009, that receives the
 * rendered config from the control plane (POST /config), validates and reloads HAProxy,
 * writes keepalived.conf, issues Let's Encrypt certificates, and reports backend health from
 * the HAProxy stats socket (GET /status). Every request carries the shared secret.
 */
export interface LbNodeInit {
  vmSecret: string;
  /** Network the VIP lives on. A load balancer VIP is a public address, so it is always public. */
  vipNetwork: 'public';
}

export function renderLbCloudInit(d: LbNodeInit): string {
  return `#cloud-config
package_update: true
packages: [haproxy, keepalived, certbot, python3, ca-certificates]
write_files:
  - path: /etc/sysctl.d/90-prgd-lb.conf
    content: |
      net.ipv4.ip_nonlocal_bind = 1
      net.ipv4.ip_forward = 1
  - path: /opt/prgd/vip.network
    content: '${d.vipNetwork}'
  - path: /opt/prgd/vm.secret
    permissions: '0600'
    content: '${d.vmSecret}'
  - path: /opt/prgd/lbd.py
    permissions: '0755'
    content: |
      #!/usr/bin/env python3
      # prgd load balancer agent. The control plane is the only writer of haproxy.cfg.
      import http.server, json, os, socket, subprocess, threading, time
      SECRET = open('/opt/prgd/vm.secret').read().strip()
      CERTS = '/etc/haproxy/certs'
      STATE = '/opt/prgd/lb.json'
      os.makedirs(CERTS, exist_ok=True)
      lock = threading.Lock()

${agentNetPy(6)}

      def keepalived(text):
          # The VIP goes on the public interface; VRRP talks unicast over the private network.
          text = text.replace('@PRIVATE_IFACE@', private_iface() or 'eth0').replace('@PRIVATE_IP@', private_ipv4() or '').replace('@VIP_IFACE@', vip_iface())
          path = '/etc/keepalived/keepalived.conf'
          old = open(path).read() if os.path.exists(path) else None
          if old == text: return
          open(path, 'w').write(text)
          subprocess.run(['systemctl', 'enable', 'keepalived'], capture_output=True)
          subprocess.run(['systemctl', 'restart', 'keepalived'], capture_output=True)

      def state():
          try: return json.load(open(STATE))
          except Exception: return {'version': 0}

      def selfsigned(path, cn):
          subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30', '-subj', '/CN=' + cn, '-keyout', path + '.key', '-out', path + '.crt'], check=True, capture_output=True)
          open(path, 'w').write(open(path + '.crt').read() + open(path + '.key').read())

      def issue(cert_id, domains):
          # Standalone certbot on 8402; HAProxy routes /.well-known/acme-challenge/ there.
          r = subprocess.run(['certbot', 'certonly', '--standalone', '--http-01-port', '8402', '--non-interactive', '--agree-tos', '--register-unsafely-without-email', '--cert-name', cert_id] + sum([['-d', d] for d in domains], []), capture_output=True, text=True)
          if r.returncode != 0:
              open('/var/log/prgd-lbd.log', 'a').write(r.stdout + r.stderr); return
          live = '/etc/letsencrypt/live/' + cert_id + '/'
          open(CERTS + '/' + cert_id + '.pem', 'w').write(open(live + 'fullchain.pem').read() + open(live + 'privkey.pem').read())
          subprocess.run(['systemctl', 'reload', 'haproxy'])

      def apply(body):
          with lock:
              for cid, pem in (body.get('certs') or {}).items():
                  open(CERTS + '/' + cid + '.pem', 'w').write(pem); os.chmod(CERTS + '/' + cid + '.pem', 0o600)
              for le in body.get('letsencrypt') or []:
                  p = CERTS + '/' + le['id'] + '.pem'
                  if not os.path.exists(p): selfsigned(p, le['domains'][0])
              open('/etc/haproxy/haproxy.cfg.new', 'w').write(body['haproxyCfg'])
              chk = subprocess.run(['haproxy', '-c', '-f', '/etc/haproxy/haproxy.cfg.new'], capture_output=True, text=True)
              if chk.returncode != 0: return 422, {'error': 'invalid_config', 'detail': chk.stderr[-2000:]}
              os.replace('/etc/haproxy/haproxy.cfg.new', '/etc/haproxy/haproxy.cfg')
              subprocess.run(['systemctl', 'reload', 'haproxy'])
              if body.get('keepalived'): keepalived(body['keepalived'])
              json.dump({'version': body['version']}, open(STATE, 'w'))
          for le in body.get('letsencrypt') or []:
              if not os.path.exists('/etc/letsencrypt/live/' + le['id']): threading.Thread(target=issue, args=(le['id'], le['domains']), daemon=True).start()
          return 200, {'version': body['version']}

      def stats():
          s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); s.settimeout(3)
          try:
              s.connect('/run/haproxy/admin.sock'); s.sendall(b'show stat\\n'); out = b''
              while True:
                  c = s.recv(65536)
                  if not c: break
                  out += c
          except Exception: return {}
          finally: s.close()
          backends = {}
          for line in out.decode().splitlines():
              cols = line.split(',')
              if len(cols) < 18 or cols[0].startswith('#') or not cols[0].startswith('be_') or cols[1] in ('FRONTEND', 'BACKEND'): continue
              backends.setdefault(cols[0], {})[cols[1]] = cols[17]
          return backends

      class H(http.server.BaseHTTPRequestHandler):
          def log_message(self, *a): pass
          def do_GET(self):
              if not secret_ok(self.headers.get('X-Prgd-Secret')): return self._send(401, {'error': 'unauthorized'})
              if self.path != '/status': return self._send(404, {})
              self._send(200, {'version': state().get('version', 0), 'backends': stats()})
          def do_POST(self):
              if not secret_ok(self.headers.get('X-Prgd-Secret')): return self._send(401, {'error': 'unauthorized'})
              if self.path != '/config': return self._send(404, {})
              n = int(self.headers.get('Content-Length') or 0)
              code, body = apply(json.loads(self.rfile.read(n)))
              self._send(code, body)
          def _send(self, code, body):
              b = json.dumps(body).encode(); self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
      http.server.ThreadingHTTPServer((bind_address(), 9009), H).serve_forever()
  - path: /etc/systemd/system/prgd-lbd.service
    content: |
      [Unit]
      Description=prgd load balancer agent
      After=network-online.target haproxy.service
      [Service]
      ExecStart=/opt/prgd/lbd.py
      Restart=always
      [Install]
      WantedBy=multi-user.target
runcmd:
  - sysctl --system
  - systemctl enable --now haproxy
  - systemctl daemon-reload && systemctl enable --now prgd-lbd
`;
}
