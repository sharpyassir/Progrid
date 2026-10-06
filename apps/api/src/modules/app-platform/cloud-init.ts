/**
 * cloud-init for an app host: a platform owned server that runs customer containers behind
 * Caddy. Every app has its own Docker network (`prgd-app-<id>`); Caddy runs as a container on
 * its own `prgd` network, is attached to every app network and reaches instances by container
 * name. `prgd-appd` on the private address, port 9009, receives the whole desired state
 * (POST /config), builds images from the customers' repositories, runs the instances with
 * memory, CPU, pids and capability limits, writes the Caddyfile (one site per verified
 * hostname, TLS from Let's Encrypt) and reports per app state, logs and whether Docker and
 * Caddy are running (GET /status, GET /logs). The agent itself is in appd.ts.
 *
 * Builds: a Dockerfile at the repository root wins. Without one, a Node (package.json),
 * Python (requirements.txt or pyproject.toml), Go (go.mod) or static (index.html) project
 * gets a generated Dockerfile. Compose files are not supported on shared hosts.
 *
 * Docker daemon (NEW hosts only; existing hosts keep their daemon.json):
 * - userns-remap "default" (APP_PLATFORM_USERNS): root in a container is an unprivileged uid
 *   on the host;
 * - default-address-pools outside APPS_RANGE, so Docker's own networks never land in the range
 *   the agent carves app networks from;
 * - APP_PLATFORM_RUNTIME=runsc installs gVisor from its apt repository and registers it; the
 *   agent then runs instances with --runtime runsc.
 */
import { AGENT_NET_PY, indentBlock } from '../../common/platform-agent';
import { loadConfig } from '../../config/config';
import { APPD_PY } from './appd';

export interface AppHostInit {
  vmSecret: string;
  acmeEmail: string;
  /** Container runtime; defaults to APP_PLATFORM_RUNTIME. */
  runtime?: 'runc' | 'runsc';
  /** userns-remap in daemon.json; defaults to APP_PLATFORM_USERNS. */
  userns?: boolean;
}

/** /etc/docker/daemon.json of a new app host. */
export function appHostDaemonJson(o: { userns: boolean }): string {
  return JSON.stringify(
    {
      ...(o.userns ? { 'userns-remap': 'default' } : {}),
      'default-address-pools': [{ base: '172.24.0.0/14', size: 24 }],
      'log-driver': 'json-file',
      'log-opts': { 'max-size': '10m', 'max-file': '3' },
    },
    null,
    2,
  );
}

/** The agent's Python source with the shared network helpers pasted in. */
export function appdSource(): string {
  return APPD_PY.replace('@@NET@@', AGENT_NET_PY);
}

export function renderAppHostCloudInit(d: AppHostInit): string {
  const runtime = d.runtime ?? loadConfig().APP_PLATFORM_RUNTIME;
  const userns = d.userns ?? loadConfig().APP_PLATFORM_USERNS;
  const caddyUserns = userns ? '--userns=host ' : '';
  return `#cloud-config
package_update: true
packages: [docker.io, git, python3, ca-certificates, curl, iptables${runtime === 'runsc' ? ', gnupg' : ''}]
write_files:
  - path: /etc/docker/daemon.json
    permissions: '0644'
    content: |
${indentBlock(appHostDaemonJson({ userns }), 6)}
  - path: /opt/prgd/runtime
    content: '${runtime}'
  - path: /opt/prgd/vm.secret
    permissions: '0600'
    content: '${d.vmSecret}'
  - path: /etc/caddy/Caddyfile
    content: |
      {
        email ${d.acmeEmail}
      }
      :80 {
        respond "prgd app platform" 200
      }
${runtime === 'runsc' ? `  - path: /opt/prgd/install-gvisor.sh
    permissions: '0755'
    content: |
      #!/bin/sh
      # gVisor (runsc) from its apt repository, registered with Docker as the "runsc" runtime.
      set -eu
      curl -fsSL https://gvisor.dev/archive.key | gpg --dearmor --yes -o /usr/share/keyrings/gvisor-archive-keyring.gpg
      echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" > /etc/apt/sources.list.d/gvisor.list
      apt-get update -q && DEBIAN_FRONTEND=noninteractive apt-get install -y -q runsc
      runsc install
      systemctl restart docker
` : ''}  - path: /etc/systemd/system/prgd-appd.service
    content: |
      [Unit]
      Description=prgd app host agent
      After=network-online.target docker.service
      [Service]
      ExecStart=/usr/bin/python3 /opt/prgd/appd.py
      Restart=always
      RestartSec=2
      [Install]
      WantedBy=multi-user.target
  - path: /opt/prgd/appd.py
    permissions: '0755'
    content: |
${indentBlock(appdSource(), 6)}
runcmd:
  - echo '${d.acmeEmail}' > /opt/prgd/acme.email
  - systemctl enable --now docker
${runtime === 'runsc' ? '  - /opt/prgd/install-gvisor.sh\n' : ''}  - python3 /opt/prgd/appd.py --egress-only || true
  - docker network create prgd || true
  - mkdir -p /var/lib/caddy/data /var/lib/caddy/config
  - docker run -d --name caddy --restart unless-stopped ${caddyUserns}--network prgd -p 80:80 -p 443:443 -p 443:443/udp -v /etc/caddy:/etc/caddy -v /var/lib/caddy/data:/data -v /var/lib/caddy/config:/config caddy:2 || true
  - mkdir -p /var/lib/prgd/apps && systemctl daemon-reload && systemctl enable --now prgd-appd
`;
}
