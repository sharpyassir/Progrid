# Infrastructure hardening

What the Ansible roles and the production compose bundle do to meet the ISO 27001 / NCA
infrastructure controls, the variables that steer them, the order to roll them onto the live
management droplet and `pve1`, and what is left as residual risk.

Everything here is in `infra/`: `infra/ansible` (roles `baseline`, `management`, `pve_node`) and
`infra/prod` (`docker-compose.yml`, `Caddyfile`, `backup.sh`). Settings that could lock an operator
out or change production behaviour are opt-in variables whose defaults keep today's behaviour.

## Controls

### Operating system baseline (role `baseline`, every host)

`site.yml` runs it on `management:pve_nodes` after WireGuard. Run it alone with `--tags baseline`.

| Control | What it does | Where |
|---|---|---|
| Preflight | Stops the run if Ansible logs in with a password, or if the host has no `authorized_keys` entry at all (the management host runs Ansible locally, so the login itself proves nothing there). `baseline_skip_key_check: true` skips the second check. | `roles/baseline/tasks/main.yml` |
| SSH | `/etc/ssh/sshd_config.d/10-prgd.conf`: `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin prohibit-password`, `MaxAuthTries 3`, `LoginGraceTime 30`, `X11Forwarding no`, `AllowAgentForwarding no`. The candidate is validated as part of the whole configuration (`sshd -t` on a copy of `sshd_config` that includes it first), so a typo never reaches sshd. `10-` sorts before cloud-init's `50-cloud-init.conf`, and sshd keeps the first value it reads. Reload is `systemctl try-reload-or-restart ssh`: open sessions stay up. A warning is printed if `sshd -T` still reports password login. | `templates/sshd-prgd.conf.j2` |
| Kernel | `/etc/sysctl.d/60-prgd-hardening.conf`: reverse path filter 1 (strict) on the management host and 2 (loose) on Proxmox nodes, where strict mode drops bridged, routed and VXLAN traffic; no ICMP redirects sent or accepted; no source routing; SYN cookies; `kptr_restrict 2`, `dmesg_restrict 1`; protected hard and symbolic links; `suid_dumpable 0`; `unprivileged_bpf_disabled 1`. IP forwarding is not touched (Docker and the routed public blocks need it). | `templates/sysctl-hardening.conf.j2` |
| Time (NCA, control 101) | chrony installed, enabled and running (it replaces systemd-timesyncd). `chrony_servers` adds servers in `/etc/chrony/conf.d/prgd.conf`. | tasks |
| Patching | `20auto-upgrades` (daily lists, daily unattended upgrade) and `52prgd-unattended-upgrades`: security origins only (Ubuntu `-security` and ESM, Debian `-security`), unused kernels removed, automatic reboot off. A separate file, not an edited `50unattended-upgrades`: that one is a package conffile, and unattended-upgrades holds back a package whose conffile was changed. `#clear` drops the distribution's origin list. Docker and Proxmox packages are not upgraded automatically. | `templates/unattended-upgrades.j2` |
| Brute force | fail2ban `jail.d/sshd.local`, systemd backend (Debian 13 has no `auth.log`), 5 failures in 10 minutes ban for 1 hour. `wireguard_cidr` and `ssh_allow_from` are never banned. | tasks |
| Audit | auditd with `/etc/audit/rules.d/60-prgd.rules`: writes to `/etc/prgd`, `/opt/prgd`, `/etc/wireguard`, `/etc/sudoers*`, `/etc/ssh/sshd_config*`, `/etc/passwd`, `/etc/shadow`, `/etc/group`, `/etc/gshadow`, and every run of `sudo`. No `execve` by root (too noisy with Docker and Proxmox). `ausearch -k sudo_use`, `aureport -k`. | `templates/audit.rules.j2` |
| Logs | journald persistent, compressed, `SystemMaxUse=1G`, 3 months retention. | tasks |

### Management host (role `management`)

| Control | What it does |
|---|---|
| SSH sources | With `ssh_allow_from` set, ufw allows 22 only from those CIDRs and `wireguard_cidr`. The source rules are added before the open rule is deleted and ufw keeps established connections, so the run never cuts the operator's session. With it empty, 22 stays open to the world and the run prints a warning. |
| DOCKER-USER | Ports Docker publishes (Caddy 80/443, PowerDNS 53, NATS on `MGMT_IP`, Temporal UI on 127.0.0.1) bypass ufw; they are filtered only in the `DOCKER-USER` chain. Each is meant to be public or bound to a private address, so nothing is added there; source filtering for a published port goes into `DOCKER-USER`, never ufw. |
| Deploy user | User `deploy` (`deploy_user`), password `*` (no password, not locked, so key login works under PAM), shell `/bin/sh` (sshd needs one for the forced command). `~deploy/.ssh/authorized_keys` is root owned and holds one line: `command="sudo -n /opt/prgd/deploy.sh",restrict <deploy_authorized_key>`. The key can run nothing but the deploy script: no shell, no port forwarding, no pty. The workflow's argument (the image tag) arrives in `SSH_ORIGINAL_COMMAND`, which `deploy.sh` reads and checks against `[A-Za-z0-9._-]`. |
| sudo | `/etc/sudoers.d/prgd-deploy`: `deploy ALL=(root) NOPASSWD: /opt/prgd/deploy.sh ""` (no arguments allowed) and `Defaults!/opt/prgd/deploy.sh env_keep += "SSH_ORIGINAL_COMMAND"` so the tag survives sudo. The old line for the Ansible user stays while `legacy_ci_deploy_user` is true. Validated with `visudo -cf`. |
| WAL archive | `/var/backups/prgd/wal` is created owned by uid/gid 70 (the postgres user of the `timescale/timescaledb` Alpine image, `postgres_container_uid`), mode 0700, and mounted into the postgres container at the path `archive_command` writes to. Before this the directory did not exist in the container, so every `archive_command` failed (see rollout, step 4). |

### Control plane containers (`infra/prod/docker-compose.yml`)

- Every service: `no-new-privileges`, json-file logs capped at 5 x 20 MB, `mem_limit` and `pids_limit`.
  Each limit is overridable in `prgd.env` (`API_MEM_LIMIT`, `WORKER_MEM_LIMIT`, `POSTGRES_MEM_LIMIT`,
  `CADDY_MEM_LIMIT`, `..._PIDS_LIMIT`; names in the compose file). Defaults for a 4 to 8 GB droplet:
  postgres 2g, api 1g, worker 1g, temporal 1g, console 512m, www 512m, gateway 512m, nats 512m,
  backup 512m, ops 384m, redis 384m, caddy 256m, pdns 256m, temporal-ui 256m. They are ceilings, not
  reservations.
- First party images (api, worker, console, www, ops, gateway): `cap_drop: [ALL]` and a read only
  root file system with a tmpfs `/tmp`. The Next.js apps also get a tmpfs at
  `/app/apps/<app>/.next/cache` (the standalone server's only write: fetch and image cache; www caches
  the affiliate program fetch there). The gateway writes only to its spool volume. The one shot jobs
  (migrate, seed, staff) keep a writable root file system: the Prisma CLI and ts-node may write caches
  and a failure there would fail a deploy. Third party images (postgres, redis, nats, temporal, pdns,
  caddy) are not read only; their entrypoints chown and drop privileges.
- Networks: `edge` (caddy, www, console, ops, api, gateway), `backend` (api, worker, migrate, seed,
  staff, backup, postgres, redis, nats, temporal, temporal-ui, pdns) and `bus` (nats, gateway). Caddy is
  never on `backend`; the gateway reaches the API (edge) and NATS (bus) but not Postgres, Redis or
  Temporal. None is `internal: true`: api and worker call payment, mail and model providers, the backup
  goes to S3, and the gateway opens SSH over WireGuard through the host. `backend` has a fixed subnet,
  `BACKEND_SUBNET` (default `172.29.10.0/24`).
- PowerDNS API (8081): `webserver_allow_from` is `127.0.0.1,::1,$BACKEND_SUBNET` instead of `0.0.0.0/0`.
- Redis AUTH: with `REDIS_PASSWORD` set, Redis starts with `--requirepass` (through the image's
  entrypoint, which still drops to the redis user; redis-server hides its arguments from `ps`) and
  `REDIS_URL` becomes `redis://:<password>@redis:6379`. Empty keeps Redis without a password. Use a hex
  password (`openssl rand -hex 32`): it is part of a URL.
- Postgres mounts `/var/backups/prgd/wal`; the backup container sees the same directory as `/backups/wal`.

### Caddy (`infra/prod/Caddyfile`)

- `(common)` and the ops and gateway sites: HSTS `max-age=63072000; includeSubDomains; preload`,
  `Cross-Origin-Opener-Policy same-origin`, a `Permissions-Policy` that turns off camera, microphone,
  geolocation, USB, serial, Bluetooth and motion sensors (payment and passkeys stay allowed for the
  console), a 10 MB default body limit (the api site keeps 2 MB; the smaller wins), and a JSON access
  log on stdout. Caddy redacts `Cookie` and `Authorization` in the log.
- api site, `/internal`: answered 404 by Caddy, because the gateway (`PRGD_API_URL=http://api:4000`)
  and the backup container call the API on the Docker network. Two endpoints stay published on purpose,
  because they are called from outside and authenticate themselves: `/internal/alerts/alertmanager`
  (Alertmanager webhook, shared secret) and `/internal/agents/heartbeat` (monitoring agents on customer
  servers, per asset token), docs/managed-cloud-operations.md.
- api site, `/admin/*` and the Swagger UI (`/docs`, `/docs-json`, `/docs-yaml`): 403 unless the
  client address is in `ADMIN_ALLOW_CIDRS` (space separated). The compose default is `0.0.0.0/0 ::/0`,
  so nothing changes until it is set. The API applies the same list itself as `STAFF_IP_ALLOWLIST`
  (comma separated), and serves `/docs` in production only with `ENABLE_API_DOCS=true`.

### Backups (`infra/prod/backup.sh`)

With `BACKUP_AGE_RECIPIENT` (an age public key, several separated by spaces) the nightly dump is
piped through `age` before it touches the disk: only `all-<stamp>.sql.gz.age` exists, locally and in
S3. The archived WAL goes off the server as encrypted copies (`/backups/wal-age/*.age`, synced to
`<BACKUP_S3_URL>/wal/`). The container installs `age` (and `rclone` when `BACKUP_S3_URL` is set) with
`apk` at start. If `age` is missing the night's backup fails with status `age-missing`; it never falls
back to a plain dump. A failing `pg_dumpall` now fails the backup (before, gzip's exit status hid it).
Without a recipient the behaviour is unchanged (`all-<stamp>.sql.gz`). Restore: docs/hosting.md,
"Backups and restore" (`age -d -i key.txt file | gunzip | psql -d postgres`; install `age` on the
restore host).

### Proxmox nodes (role `pve_node`)

- Datacenter firewall, opt in (`pve_manage_cluster_firewall: true`): writes
  `/etc/pve/firewall/cluster.fw`, mirroring docs/first-proxmox-node.md step 15 (`policy_in: DROP`,
  WireGuard UDP, ICMP, 8006 from `wireguard_cidr`) with two changes: 8006 is also allowed from
  `ssh_allow_from`, and with `ssh_allow_from` set SSH is accepted only from `wireguard_cidr`,
  `ssh_allow_from` and `pve_firewall_ssh_extra_sources` (default: the management host's public address,
  `wireguard_endpoint`, which Ansible connects from). `pve_firewall_cluster_sources` accepts everything
  from the other nodes (Ceph, VXLAN UDP 4789, migration: Proxmox only auto-allows corosync and its
  management ports from `local_network`); `pve_firewall_extra_rules` adds raw lines. The file is
  rendered to `/etc/prgd/pve-cluster.fw` and copied into `/etc/pve` only when it differs (pmxcfs
  refuses the chmod of an atomic write); `pve-firewall compile` runs after a change.
- host-agent unit: `NoNewPrivileges`, `ProtectSystem=full` (with `/etc/lvm` writable for `lvextend`),
  `ProtectHome`, `PrivateTmp`, `ProtectKernelModules`, `ProtectKernelTunables`, `ProtectControlGroups`,
  `RestrictSUIDSGID`, `LockPersonality`, `RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK`.
  The agent runs `rbd du/resize`, `pvesm path` and `lvextend` and writes `/var/lib/vz/snippets`, so it
  keeps root and `/dev` (no `PrivateDevices`); `/var` and `/run` stay writable.
- Agent TLS to the local API: `pve_agent_tls_ca_file` (recommended `/etc/pve/pve-root-ca.pem`, which
  signs the node's default certificate and survives its renewal) or `pve_agent_tls_fingerprint` (pins
  the certificate; breaks at each renewal). Both empty keeps `insecure: true`. Needs a host agent built
  with the `ca_file`/`fingerprint` settings (agents/host-agent/internal/config).

### Development (`infra/dev/docker-compose.yml`)

Every port is published on 127.0.0.1 only.

## Variables

| Variable | Default | Where | Meaning |
|---|---|---|---|
| `ssh_allow_from` | `[]` | group_vars | CIDRs allowed to SSH (and to 8006 on the nodes) besides `wireguard_cidr`. Empty keeps 22 open to the world, with a warning. |
| `ssh_permit_root_login` | `prohibit-password` | baseline | Root by key only. Proxmox clustering and Ansible on the nodes need root key login. |
| `ssh_max_auth_tries`, `ssh_login_grace_time` | 3, 30 | baseline | |
| `baseline_rp_filter` | 1 (management), 2 (pve_nodes) | baseline | |
| `baseline_skip_key_check` | false | baseline | Skip the "a key exists" preflight. |
| `chrony_servers` | `[]` | baseline | Extra NTP servers. |
| `unattended_upgrades_enabled` | true | baseline | |
| `unattended_upgrades_reboot` / `_reboot_time` | false / 03:30 | baseline | |
| `fail2ban_maxretry`, `_findtime`, `_bantime`, `_ignoreip` | 5, 10m, 1h, wg + ssh_allow_from | baseline | |
| `journald_system_max_use`, `journald_max_retention` | 1G, 3month | baseline | |
| `deploy_user` | `deploy` | management | |
| `deploy_authorized_key` | unset | group_vars | Public key of the GitHub deploy key pair. Unset: the user exists but cannot log in. |
| `legacy_ci_deploy_user` | true | management | Keep the Ansible user's sudo line for deploy.sh. `legacy_ci_user` overrides the user name. |
| `postgres_container_uid` | 70 | management | Owner of `/var/backups/prgd/wal`. |
| `admin_allow_cidrs` | unset | group_vars | List (or comma/space separated string). Renders `ADMIN_ALLOW_CIDRS` and `STAFF_IP_ALLOWLIST`. |
| `vault_redis_password` | `''` | vault.yml | `REDIS_PASSWORD`. |
| `backup_age_recipient` | `''` | group_vars | `BACKUP_AGE_RECIPIENT`. |
| `private_network_mode` | `shared_bridge` in the template, `sdn_vnet` in the example | group_vars | `PRIVATE_NETWORK_MODE`. A live host whose vars.yml lacks it keeps `shared_bridge`. |
| `vault_secrets_key` | required (already) | vault.yml | `SECRETS_KEY`; was already in prgd.env.j2. |
| `pve_manage_cluster_firewall` | false | group_vars | Write `cluster.fw`. |
| `pve_firewall_ssh_extra_sources` | management `wireguard_endpoint` | pve_node | |
| `pve_firewall_cluster_sources`, `pve_firewall_extra_rules` | `[]` | pve_node | |
| `pve_agent_tls_ca_file`, `pve_agent_tls_fingerprint` | `''` | pve_node | |
| `compose_env_overrides` | `{}` | group_vars | Extra prgd.env lines for compose: `BACKEND_SUBNET`, `*_MEM_LIMIT`, `*_PIDS_LIMIT` (names in docker-compose.yml). |

## Rollout on the live droplet and pve1

Keep a second root SSH session open on each host during every step, and the provider console
(DigitalOcean droplet console, the server provider's KVM for pve1) at hand.

**0. Prepare, off the servers.**

1. Backup key: `age-keygen -o prgd-backup-key.txt` on an operator machine. Put the private key in the
   password manager and on offline media; it never goes to the droplet. Note the public key (`age1...`).
2. Deploy key: `ssh-keygen -t ed25519 -N '' -C github-deploy -f prgd-deploy`.
3. Redis password: `openssl rand -hex 32`.
4. Decide `ssh_allow_from` (operators' fixed addresses) and `admin_allow_cidrs` (where staff and
   on call engineers use the console and the ops console from: the ops console calls `/admin/ops/*`
   from the engineer's browser).
5. On the droplet, check that `172.29.10.0/24` is free (`docker network inspect $(docker network ls -q) | grep Subnet`, `ip route`); otherwise pick another and set `compose_env_overrides: {BACKEND_SUBNET: <cidr>}` in group_vars (prgd.env is rendered by Ansible, so hand edits do not last).
6. On the droplet, check the WAL backlog: `docker compose --env-file /etc/prgd/prgd.env exec postgres du -sh /var/lib/postgresql/data/pg_wal`. Archiving never worked (the archive directory was not mounted), so Postgres has kept every WAL segment since the first start. Once the directory is mounted it copies the backlog into `/var/backups/prgd/wal`: make sure the disk has room for it (`df -h /var/backups`).

**1. Variables.** In `/opt/progrid-src` (the checkout Ansible runs from), pull this change, then in
`group_vars/all/vars.yml` add `backup_age_recipient`, `deploy_authorized_key` (contents of
`prgd-deploy.pub`), `admin_allow_cidrs` only once you have confirmed the addresses, and leave
`ssh_allow_from: []`, `legacy_ci_deploy_user: true` and `pve_manage_cluster_firewall: false` for now. If
the live host is on `shared_bridge`, set `private_network_mode: shared_bridge` explicitly (or leave it
out: the template default is `shared_bridge`). In `vault.yml` add `vault_redis_password`.

**2. Baseline on the droplet.**

```sh
ansible-playbook -i inventory.ini site.yml --limit management --tags baseline --check --diff --ask-vault-pass
ansible-playbook -i inventory.ini site.yml --limit management --tags baseline --ask-vault-pass
sshd -T | grep -Ei 'passwordauth|permitroot|maxauthtries'   # no / prohibit-password / 3
```

Then open a new SSH session with your key before closing anything. With many keys in your agent,
`MaxAuthTries 3` can refuse you before the right key is tried: use `-o IdentitiesOnly=yes -i <key>`.

**3. Baseline on pve1.** Same with `--limit pve1`. Check `ssh root@pve1` with the key from the
management host, `pvecm status` (if clustered) and a VM's network (rp_filter is loose there).

**4. Management role on the droplet (maintenance window, 2 to 5 minutes).**

```sh
ansible-playbook -i inventory.ini site.yml --limit management --ask-vault-pass
```

The compose file changes the networks, so every container is recreated (Redis gets its password, api
and worker the new `REDIS_URL`, Postgres the WAL mount). Afterwards:

```sh
cd /opt/prgd && C="docker compose --env-file /etc/prgd/prgd.env -f docker-compose.yml"
$C ps                                                   # everything up, healthy
curl -fsS https://api.progrid.co/healthz
curl -s -o /dev/null -w '%{http_code}\n' https://api.progrid.co/internal/gateway/session-check   # 404
$C exec postgres psql -U prgd -c 'select archived_count, failed_count, last_failed_time from pg_stat_archiver'
ls /var/backups/prgd/wal | head                         # segments arriving
$C logs --tail 20 backup                                # "installing age"
docker network rm prgd_internal                         # the old network, now unused
```

Open a terminal in the ops console to check the gateway (it now reaches NATS over `bus`).

**5. GitHub.** In the repository's `production` environment (or repository secrets) set
`DEPLOY_USER=deploy`, `DEPLOY_SSH_KEY` = contents of `prgd-deploy` (private key), and
`DEPLOY_KNOWN_HOSTS` = output of `ssh-keyscan -t ed25519 <droplet address>`. Compare that key with
`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` on the droplet itself before saving it. The
deploy workflow (.github/workflows/deploy.yml) now refuses to connect without `DEPLOY_KNOWN_HOSTS`,
uses `StrictHostKeyChecking=yes`, and only sends the tag: the forced command does the rest. Run the
workflow once by hand (workflow_dispatch) and check `journalctl -t prgd-deploy` on the droplet.
Delete the local copy of `prgd-deploy` afterwards.

**6. Retire the legacy CI login.** Set `legacy_ci_deploy_user: false`, remove the old CI key from the
Ansible user's `authorized_keys`, re-run the management role.

**7. Restrict SSH.** Set `ssh_allow_from` and re-run with `--tags baseline` and the management role.
GitHub hosted runners connect from changing addresses, so with `ssh_allow_from` set the deploy job can
no longer reach port 22. Choose one before setting it: keep 22 open to the world (the deploy key only
runs deploy.sh, password login is off, fail2ban is on: this is the documented residual risk), or run
the deploy job on a self hosted runner whose address is in `ssh_allow_from` or on the WireGuard
network. GitHub's published Actions ranges are thousands of CIDRs and change; do not list them.

**8. pve1 firewall and agent.** Compare `cat /etc/pve/firewall/cluster.fw` with what the role would
write (`--check --diff --limit pve1` shows `/etc/prgd/pve-cluster.fw`), add the other nodes to
`pve_firewall_cluster_sources` on a cluster, set `pve_manage_cluster_firewall: true` and run
`--limit pve_nodes`. Keep the second session open and run `pve-firewall status`. The run also installs
the sandboxed host-agent unit and restarts the agent: check `systemctl status host-agent`,
`journalctl -u host-agent` (heartbeats), and on an lvmthin node resize a test volume. For TLS, check
`openssl s_client -connect 127.0.0.1:8006 -CAfile /etc/pve/pve-root-ca.pem -verify_return_error </dev/null | grep 'Verify return code'`
(0 = ok), then set `pve_agent_tls_ca_file: /etc/pve/pve-root-ca.pem` and re-run.

**9. Backups.** The next night's dump is `all-<stamp>.sql.gz.age`. Restore it on a scratch host with
the private key (docs/hosting.md) to prove the key works, then shred the key there. Old plain
`.sql.gz` files age out after `BACKUP_KEEP_DAYS`; delete them sooner by hand (also from S3) if
they must not exist.

**10. Admin allowlist.** Set `admin_allow_cidrs`, re-run the management role (Caddy and the API pick
it up on restart). From outside the list `curl -s -o /dev/null -w '%{http_code}' https://api.progrid.co/admin/v1/me`
returns 403.

**11. HSTS preload.** The header now carries `preload`, which only takes effect once the domains are
submitted at hstspreload.org. Submit only when every subdomain of progrid.co and progrid.sa serves
HTTPS; removal from browser lists takes months.

## Residual risks

- **SSH open to the internet** while `ssh_allow_from` is empty, and as long as the deploy runs on
  GitHub hosted runners (step 7). Mitigated by keys only, `MaxAuthTries 3`, fail2ban and the forced
  command of the deploy key.
- **Deploy key**: whoever holds it can redeploy any tag in the registry, including an older image
  (tags are only checked for characters). Image signature or attestation checks before the roll are
  not done on the host.
- **Proxmox ACL scope**: the agent's role is granted with propagate on `/vms`, `/storage`,
  `/nodes/<node>` and `/sdn`, so each node's token can act on every VM, storage and SDN object of the
  cluster, not only its own node's. Scoping per node needs a resource pool per node (`/pool/<node>`)
  and VMs placed into it at creation; not done.
- **Agent TLS** stays unverified until `pve_agent_tls_ca_file` or `pve_agent_tls_fingerprint` is set
  (loopback only, so the exposure is to local processes).
- **Proxmox firewall** stays as written by hand until `pve_manage_cluster_firewall` is enabled; Proxmox
  always accepts 22 and 8006 from its `local_network`. On a multi node cluster Ceph and VXLAN need
  `pve_firewall_cluster_sources`.
- **Docker published ports** are outside ufw (DOCKER-USER is not managed). All published ports are
  intended; a new one would be public.
- **Containers**: third party images are not read only and keep their default capabilities; networks
  are not internal, so a compromised backend container has internet egress; the gateway can reach the
  www, console and ops containers on `edge`.
- **Redis password** is visible to root in `docker inspect` (environment) and is a URL component.
- **Backups**: the local WAL archive and Postgres data are not encrypted at rest (only what is
  written by backup.sh and what leaves the server). The backup container installs `age` and `rclone`
  from Alpine's repositories at start; a custom image with them pinned would remove that dependency.
- **Audit and logs** are local only (no remote log shipping) and the audit rules are not immutable
  (`-e 2`), so root can change them; changes to the rules are themselves audited.
- **Patching**: kernel and library updates install, but reboots are manual; Docker, Proxmox and the
  container images are patched by hand or by the deploy pipeline.
- **Caddy `/internal` filter** is defence in depth: the API's own secrets remain the control; two
  `/internal` endpoints are public by design.
- **Admin allowlist** is open until `admin_allow_cidrs` is set.
