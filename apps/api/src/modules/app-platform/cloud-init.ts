/**
 * cloud-init for an app host: a platform owned server that runs customer containers behind
 * Caddy. `pgcloud-appd` on :9009 receives the whole desired state (POST /config), builds
 * images from the customers' repositories, runs the instances with memory and CPU limits on
 * a private Docker network, writes the Caddyfile (one site per hostname, TLS from Let's
 * Encrypt) and reports per app state and logs (GET /status, GET /logs).
 *
 * Builds: a Dockerfile at the repository root wins. Without one, a Node (package.json),
 * Python (requirements.txt or pyproject.toml), Go (go.mod) or static (index.html) project
 * gets a generated Dockerfile. Compose files are not supported on shared hosts.
 */
import { agentNetPy } from '../../common/platform-agent';

export interface AppHostInit {
  vmSecret: string;
  acmeEmail: string;
}

export function renderAppHostCloudInit(d: AppHostInit): string {
  return `#cloud-config
package_update: true
packages: [docker.io, git, python3, ca-certificates, curl, debian-keyring, debian-archive-keyring, apt-transport-https]
write_files:
  - path: /opt/pgcloud/vm.secret
    permissions: '0600'
    content: '${d.vmSecret}'
  - path: /etc/caddy/Caddyfile
    content: |
      {
        email ${d.acmeEmail}
      }
      :80 {
        respond "pgcloud app platform" 200
      }
  - path: /etc/systemd/system/pgcloud-appd.service
    content: |
      [Unit]
      Description=pgcloud app host agent
      After=network-online.target docker.service
      [Service]
      ExecStart=/usr/bin/python3 /opt/pgcloud/appd.py
      Restart=always
      RestartSec=2
      [Install]
      WantedBy=multi-user.target
  - path: /opt/pgcloud/appd.py
    permissions: '0755'
    content: |
      #!/usr/bin/env python3
      # pgcloud app host agent. Standard library only. The control plane is the only writer of configuration.
      import http.server, json, os, shlex, shutil, subprocess, threading, time, urllib.request
      SECRET = open('/opt/pgcloud/vm.secret').read().strip()
      ROOT = '/var/lib/pgcloud/apps'
      LAST = '/opt/pgcloud/last-config.json'
      lock = threading.Lock()
      state = {'version': 0, 'apps': {}}
      building = set()

${agentNetPy(6)}

      def sh(cmd, check=True, timeout=1800, cwd=None, log=None):
          r = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout, cwd=cwd)
          if log is not None:
              with open(log, 'a') as f: f.write('$ ' + cmd.split(' -H ')[0][:200] + '\\n' + r.stdout[-20000:] + r.stderr[-20000:])
          if check and r.returncode != 0: raise RuntimeError((r.stderr.strip() or r.stdout.strip())[-600:])
          return r.stdout

      def load_state():
          global state
          try: state = json.load(open('/opt/pgcloud/state.json'))
          except Exception: pass
      def save_state(): json.dump(state, open('/opt/pgcloud/state.json', 'w'))

      def detect_dockerfile(d):
          if os.path.exists(d + '/Dockerfile'): return None
          if os.path.exists(d + '/package.json'):
              pkg = json.load(open(d + '/package.json'))
              build = 'RUN npm run build\\n' if (pkg.get('scripts') or {}).get('build') else ''
              lockcmd = 'npm ci' if os.path.exists(d + '/package-lock.json') else 'npm install'
              return 'FROM node:20-slim\\nWORKDIR /app\\nCOPY package*.json ./\\nRUN ' + lockcmd + '\\nCOPY . .\\n' + build + 'ENV NODE_ENV=production\\nCMD ["npm", "start"]\\n'
          if os.path.exists(d + '/requirements.txt') or os.path.exists(d + '/pyproject.toml'):
              entry = 'gunicorn -b 0.0.0.0:$PORT app:app' if os.path.exists(d + '/app.py') else 'python main.py'
              req = 'RUN pip install --no-cache-dir -r requirements.txt gunicorn\\n' if os.path.exists(d + '/requirements.txt') else 'RUN pip install --no-cache-dir . gunicorn\\n'
              return 'FROM python:3.12-slim\\nWORKDIR /app\\nCOPY . .\\n' + req + 'ENV PYTHONUNBUFFERED=1\\nCMD ' + entry + '\\n'
          if os.path.exists(d + '/go.mod'):
              return 'FROM golang:1.23 AS build\\nWORKDIR /src\\nCOPY . .\\nRUN CGO_ENABLED=0 go build -o /out/app .\\nFROM gcr.io/distroless/static\\nCOPY --from=build /out/app /app\\nCMD ["/app"]\\n'
          if os.path.exists(d + '/index.html'):
              return 'FROM nginx:alpine\\nCOPY . /usr/share/nginx/html\\nRUN sed -i "s/listen       80;/listen       $PORT;/" /etc/nginx/conf.d/default.conf || true\\n'
          raise RuntimeError('no Dockerfile and no Node, Python, Go or static project detected at the repository root')

      def build(app):
          aid = app['id']; d = ROOT + '/' + aid; src = d + '/src'; log = d + '/build.log'
          os.makedirs(d, exist_ok=True); open(log, 'w').write('=== build %s %s ===\\n' % (aid, time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())))
          try:
              # Every customer supplied value is shell quoted: repo, token, branch and commit come from the API.
              repo = app['repo']
              if app.get('token'): repo = 'https://x-access-token:%s@%s' % (app['token'], repo[len('https://'):])
              q = shlex.quote; repo_q = q(repo); branch = q(app['branch'])
              if os.path.isdir(src + '/.git'):
                  sh('git remote set-url origin %s' % repo_q, cwd=src)
                  sh('git fetch --depth 1 origin %s && git reset --hard origin/%s' % (branch, branch), cwd=src, log=log)
              else:
                  shutil.rmtree(src, ignore_errors=True)
                  sh('git clone --depth 1 --branch %s %s %s' % (branch, repo_q, q(src)), log=log)
              if app.get('commit'): sh('git fetch --depth 1 origin %s && git checkout -q %s' % (q(app['commit']), q(app['commit'])), cwd=src, log=log, check=False)
              commit = sh('git rev-parse HEAD', cwd=src).strip()
              gen = detect_dockerfile(src)
              if gen: open(src + '/Dockerfile.pgcloud', 'w').write(gen)
              image = 'pgcloud-app-%s:%s' % (aid, commit[:12])
              sh('docker build --build-arg PORT=%d -t %s -f %s %s' % (app['port'], image, 'Dockerfile.pgcloud' if gen else 'Dockerfile', src), cwd=src, log=log, timeout=1800)
              run(app, image, log)
              state['apps'][aid] = {'deployId': app['deployId'], 'state': 'live', 'commit': commit, 'image': image, 'error': None}
              open(log, 'a').write('=== live ===\\n')
          except Exception as e:
              state['apps'][aid] = {'deployId': app['deployId'], 'state': 'failed', 'commit': state['apps'].get(aid, {}).get('commit'), 'error': str(e)[-600:]}
              open(log, 'a').write('=== failed: %s ===\\n' % str(e)[-600:])
          finally:
              save_state(); building.discard(aid)

      def run(app, image, log):
          aid = app['id']; env = ROOT + '/' + aid + '/app.env'
          open(env, 'w').write(''.join('%s=%s\\n' % (k, str(v).replace('\\n', '')) for k, v in (app.get('env') or {}).items()) + 'PORT=%d\\n' % app['port']); os.chmod(env, 0o600)
          names = ['pgcloud-%s-%d' % (aid, i) for i in range(app['instances'])]
          # Start new instances beside the old ones, check health, then retire the old ones.
          for i, name in enumerate(names):
              sh('docker rm -f %s-next 2>/dev/null || true' % name, check=False)
              sh('docker run -d --name %s-next --network pgcloud --restart unless-stopped --memory %dm --cpus %s --env-file %s --label pgcloud.app=%s %s' % (name, app['memoryMb'], app['cpus'], env, aid, image), log=log)
              healthy(name + '-next', app['port'], app.get('healthPath'))
          for name in names:
              sh('docker rm -f %s 2>/dev/null || true' % name, check=False)
              sh('docker rename %s-next %s' % (name, name), check=False)
          for c in sh("docker ps -a --filter label=pgcloud.app=%s --format '{{.Names}}'" % aid, check=False).split():
              if c not in names: sh('docker rm -f %s' % c, check=False)
          sh('docker image prune -f >/dev/null 2>&1', check=False)

      def healthy(name, port, path):
          ip = sh("docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' %s" % name).strip()
          deadline = time.time() + 120
          while time.time() < deadline:
              try:
                  urllib.request.urlopen('http://%s:%d%s' % (ip, port, path or '/'), timeout=3).read(1); return
              except urllib.error.HTTPError:
                  return  # the app answered, whatever the code
              except Exception:
                  if 'running' not in sh("docker inspect -f '{{.State.Status}}' %s" % name, check=False): raise RuntimeError('instance exited during start; see the runtime log')
                  time.sleep(2)
          raise RuntimeError('instance did not answer on port %d within two minutes' % port)

      def caddy(apps):
          out = ['{', '  email ' + open('/opt/pgcloud/acme.email').read().strip() if os.path.exists('/opt/pgcloud/acme.email') else '', '}', ':80 {', '  respond "pgcloud app platform" 200', '}']
          for app in apps:
              st = state['apps'].get(app['id']) or {}
              if st.get('state') != 'live' or app.get('stopped'): continue
              ups = ' '.join('pgcloud-%s-%d:%d' % (app['id'], i, app['port']) for i in range(app['instances']))
              out.append('%s {\\n  encode zstd gzip\\n  reverse_proxy %s {\\n    lb_policy round_robin\\n    health_uri %s\\n    health_interval 10s\\n  }\\n}' % (', '.join(app['hostnames']), ups, app.get('healthPath') or '/'))
          open('/etc/caddy/Caddyfile', 'w').write('\\n'.join(out) + '\\n')
          sh('caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile', check=False)

      def apply(c):
          sh('docker network inspect pgcloud >/dev/null 2>&1 || docker network create pgcloud', check=False)
          wanted = {a['id'] for a in c['apps']}
          for aid in list(state['apps']):
              if aid not in wanted:
                  sh("docker ps -aq --filter label=pgcloud.app=%s | xargs -r docker rm -f" % aid, check=False)
                  shutil.rmtree(ROOT + '/' + aid, ignore_errors=True); state['apps'].pop(aid, None)
          for app in c['apps']:
              st = state['apps'].get(app['id']) or {}
              if app.get('stopped'):
                  sh("docker ps -q --filter label=pgcloud.app=%s | xargs -r docker stop" % app['id'], check=False)
                  continue
              if st.get('deployId') != app['deployId'] and app['id'] not in building:
                  building.add(app['id']); state['apps'][app['id']] = {**st, 'deployId': app['deployId'], 'state': 'building', 'error': None}
                  threading.Thread(target=build, args=(app,), daemon=True).start()
              elif st.get('state') == 'live':
                  sh("docker ps -aq --filter label=pgcloud.app=%s --filter status=exited | xargs -r docker start" % app['id'], check=False)
          save_state(); caddy(c['apps'])

      def status():
          out = {'version': state.get('version', 0), 'apps': {}}
          for aid, st in state['apps'].items():
              running = len(sh("docker ps -q --filter label=pgcloud.app=%s" % aid, check=False).split())
              tail = ''
              try:
                  with open(ROOT + '/' + aid + '/build.log', 'rb') as f:
                      f.seek(0, 2); n = f.tell(); f.seek(max(0, n - 4096)); tail = f.read().decode('utf-8', 'replace')
              except Exception: pass
              out['apps'][aid] = {**st, 'running': running, 'logTail': tail}
          mem = sh("docker stats --no-stream --format '{{.MemUsage}}'", check=False)
          out['memUsed'] = mem.count('\\n')
          return out

      class H(http.server.BaseHTTPRequestHandler):
          def log_message(self, *a): pass
          def do_GET(self):
              if self.headers.get('X-Pgcloud-Secret') != SECRET: return self._send(401, {'error': 'unauthorized'})
              if self.path == '/status': return self._send(200, status())
              if self.path.startswith('/logs'):
                  q = dict(p.split('=', 1) for p in self.path.split('?', 1)[1].split('&') if '=' in p) if '?' in self.path else {}
                  aid = q.get('app', ''); kind = q.get('type', 'build')
                  if not aid.isalnum(): return self._send(400, {'error': 'bad_app'})
                  if kind == 'runtime':
                      log = sh('docker logs --tail 300 --timestamps pgcloud-%s-0 2>&1' % aid, check=False)
                  else:
                      try:
                          with open(ROOT + '/' + aid + '/build.log', 'rb') as f:
                              f.seek(0, 2); n = f.tell(); f.seek(max(0, n - 65536)); log = f.read().decode('utf-8', 'replace')
                      except Exception: log = ''
                  return self._send(200, {'log': log})
              self._send(404, {})
          def do_POST(self):
              if self.headers.get('X-Pgcloud-Secret') != SECRET: return self._send(401, {'error': 'unauthorized'})
              n = int(self.headers.get('Content-Length') or 0); body = json.loads(self.rfile.read(n) or b'{}')
              if self.path == '/config':
                  with lock:
                      try:
                          json.dump(body, open(LAST, 'w')); os.chmod(LAST, 0o600)
                          apply(body); state['version'] = body['version']; save_state()
                      except Exception as e:
                          return self._send(500, {'error': 'apply_failed', 'detail': str(e)[-800:]})
                  return self._send(200, {'version': body['version']})
              self._send(404, {})
          def _send(self, code, body):
              b = json.dumps(body).encode(); self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)

      load_state()
      http.server.ThreadingHTTPServer((bind_address(), 9009), H).serve_forever()
runcmd:
  - echo '${d.acmeEmail}' > /opt/pgcloud/acme.email
  - curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  - curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  - apt-get update -qq && apt-get install -y -qq caddy
  - systemctl enable --now docker
  - docker network create pgcloud || true
  - systemctl restart caddy
  - mkdir -p /var/lib/pgcloud/apps && systemctl daemon-reload && systemctl enable --now pgcloud-appd
`;
}
