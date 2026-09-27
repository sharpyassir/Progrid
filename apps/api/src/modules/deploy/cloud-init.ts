/**
 * cloud-init for a Git Deploy server. Installs Docker, clones the repo, builds and runs it
 * (docker-compose.yml wins over a Dockerfile), publishes the app on :80, and installs
 * `pgcloud-deployd`: a tiny HTTP hook on :9009 that re-pulls and rebuilds when the control
 * plane forwards a GitHub push. Everything is plain bash + python3 so it runs on any image.
 */
import { agentNetPy } from '../../common/platform-agent';

export interface DeployInit {
  repoUrl: string;
  branch: string;
  port: number;
  vmSecret: string;
  envVars: Record<string, string>;
  /** Initial token for private repos: a customer PAT, or a one hour GitHub App installation token that redeploys refresh. */
  gitToken?: string;
}

export function renderDeployCloudInit(d: DeployInit): string {
  // The clone URL never carries credentials. deploy.sh reads /opt/pgcloud/git.token at run time, which the
  // control plane refreshes on every redeploy (GitHub App tokens live one hour) or a customer PAT fills once.
  const envFile = Object.entries(d.envVars).map(([k, v]) => `${k}=${v.replace(/\n/g, '')}`).join('\n');
  return `#cloud-config
package_update: true
packages: [docker.io, docker-compose-v2, git, python3, ca-certificates]
write_files:
  - path: /opt/pgcloud/app.env
    permissions: '0600'
    content: |
${indent(envFile || '# no env vars', 6)}
  - path: /opt/pgcloud/deploy.sh
    permissions: '0755'
    content: |
      #!/usr/bin/env bash
      # Clone or update the repo, then build and run it. Idempotent; safe to re-run on every push.
      set -euo pipefail
      REPO='${d.repoUrl}'
      TOKEN=$(cat /opt/pgcloud/git.token 2>/dev/null || true)
      if [ -n "$TOKEN" ]; then REPO="https://x-access-token:$TOKEN@${'${REPO#https://}'}"; fi
      BRANCH='${d.branch}'
      PORT='${d.port}'
      DIR=/srv/app
      LOG=/var/log/pgcloud-deploy.log
      exec >>"$LOG" 2>&1
      echo "=== deploy $(date -Is) ==="
      if [ -d "$DIR/.git" ]; then
        git -C "$DIR" remote set-url origin "$REPO"
        git -C "$DIR" fetch --depth 1 origin "$BRANCH" && git -C "$DIR" reset --hard "origin/$BRANCH"
      else
        git clone --depth 1 --branch "$BRANCH" "$REPO" "$DIR"
      fi
      cd "$DIR"
      git rev-parse HEAD > /opt/pgcloud/last-commit
      cp /opt/pgcloud/app.env .env 2>/dev/null || true
      if [ -f docker-compose.yml ] || [ -f compose.yml ] || [ -f docker-compose.yaml ]; then
        docker compose pull --ignore-buildable 2>/dev/null || true
        docker compose up -d --build --remove-orphans
      elif [ -f Dockerfile ]; then
        docker build -t pgcloud-app .
        docker rm -f pgcloud-app 2>/dev/null || true
        docker run -d --name pgcloud-app --restart unless-stopped --env-file /opt/pgcloud/app.env -p 80:"$PORT" pgcloud-app
      else
        echo "no Dockerfile or docker-compose.yml found in $DIR" >&2
        echo failed > /opt/pgcloud/status
        exit 1
      fi
      echo live > /opt/pgcloud/status
      echo "=== done $(date -Is) ==="
  - path: /opt/pgcloud/deployd.py
    permissions: '0755'
    content: |
      #!/usr/bin/env python3
      # Redeploy hook on the private address. The control plane POSTs /redeploy after a GitHub push; every request carries X-Pgcloud-Secret.
      import http.server, subprocess, os, json, time
      SECRET = open('/opt/pgcloud/vm.secret').read().strip()
${agentNetPy(6)}

      class H(http.server.BaseHTTPRequestHandler):
          def log_message(self, *a): pass
          def do_GET(self):
              if self.headers.get('X-Pgcloud-Secret') != SECRET: return self._send(401, {'error': 'unauthorized'})
              st = open('/opt/pgcloud/status').read().strip() if os.path.exists('/opt/pgcloud/status') else 'deploying'
              commit = open('/opt/pgcloud/last-commit').read().strip() if os.path.exists('/opt/pgcloud/last-commit') else None
              if self.path == '/status': return self._send(200, {'status': st, 'commit': commit})
              if self.path.startswith('/logs'):
                  log = ''
                  if os.path.exists('/var/log/pgcloud-deploy.log'):
                      with open('/var/log/pgcloud-deploy.log', 'rb') as f:
                          f.seek(0, 2); size = f.tell(); f.seek(max(0, size - 65536)); log = f.read().decode('utf-8', 'replace')
                  return self._send(200, {'status': st, 'commit': commit, 'log': log})
              self._send(404, {})
          def do_POST(self):
              if self.headers.get('X-Pgcloud-Secret') != SECRET: return self._send(401, {'error': 'unauthorized'})
              if self.path != '/redeploy': return self._send(404, {})
              n = int(self.headers.get('Content-Length') or 0)
              body = json.loads(self.rfile.read(n) or b'{}') if n else {}
              if body.get('token'):
                  with open('/opt/pgcloud/git.token', 'w') as f: f.write(body['token'])
                  os.chmod('/opt/pgcloud/git.token', 0o600)
              open('/opt/pgcloud/status', 'w').write('deploying')
              subprocess.Popen(['/opt/pgcloud/deploy.sh'])
              self._send(202, {'status': 'deploying'})
          def _send(self, code, body):
              b = json.dumps(body).encode(); self.send_response(code); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(b))); self.end_headers(); self.wfile.write(b)
      http.server.ThreadingHTTPServer((bind_address(), 9009), H).serve_forever()
  - path: /opt/pgcloud/vm.secret
    permissions: '0600'
    content: '${d.vmSecret}'
${d.gitToken ? `  - path: /opt/pgcloud/git.token
    permissions: '0600'
    content: '${d.gitToken}'
` : ''}  - path: /etc/systemd/system/pgcloud-deployd.service
    content: |
      [Unit]
      Description=pgcloud redeploy hook
      After=network-online.target docker.service
      [Service]
      ExecStart=/opt/pgcloud/deployd.py
      Restart=always
      [Install]
      WantedBy=multi-user.target
runcmd:
  - systemctl enable --now docker
  - systemctl enable --now pgcloud-deployd
  - echo deploying > /opt/pgcloud/status
  - /opt/pgcloud/deploy.sh || true
`;
}

function indent(s: string, n: number) {
  return s.split('\n').map((l) => ' '.repeat(n) + l).join('\n');
}
