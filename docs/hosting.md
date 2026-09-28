# Hosting the control plane

This page answers one question: what do we run ourselves, and where. Everything in this repo is
ours to host. There is no managed platform underneath, so there are no platform environment
variables. Settings and secrets live in one file on the management host, rendered by Ansible.

## What runs where

| Piece | Runs on | How |
|---|---|---|
| API (`apps/api`, `node dist/main.js`) | management host | container, behind Caddy at `api.<domain>` |
| Worker (`apps/api`, `node dist/worker.js`) | management host | container, Temporal task queue |
| Console (`apps/console`) | management host | container, `console.<domain>` |
| Website (`apps/www`) | management host | container, `<domain>` |
| Postgres with TimescaleDB, Redis, NATS, Temporal | management host | containers with named volumes |
| Caddy | management host | container, ports 80 and 443, Let's Encrypt |
| Nightly backups | management host | container writing `/var/backups/pgcloud`, optional S3 copy |
| Host agent (`agents/host-agent`) | every Proxmox node | static binary under systemd, talks to NATS over the management network |
| Customer servers | Proxmox nodes | virtual machines on Ceph, created by the host agent |
| CLI, MCP server | the developer's machine | GitHub release binaries, npm package |

The management host is the only machine with a public address besides the customer IP blocks.
Proxmox nodes sit on the management network and reach the host through NATS on port 4222.

## Phase 0: one rented box

Goal: a public demo and the first design partners, before our own hardware is racked.

1. Rent one dedicated server with a public IP (8 cores, 32 GB, NVMe is plenty). Install Ubuntu 24.04.
2. Point DNS: `<domain>`, `www.<domain>`, `console.<domain>`, `api.<domain>` to that address.
3. Fill `infra/ansible/inventory.ini`, `group_vars/all/vars.yml` and the vault in `group_vars/all/vault.yml`. Set `hypervisor_driver: fake`
   if there is no Proxmox yet, or install Proxmox on the same box and point the agent at it.
4. `ansible-playbook -i inventory.ini site.yml --ask-vault-pass`. The role installs Docker, copies the
   compose bundle to `/opt/pgcloud`, writes `/etc/pgcloud/pgcloud.env`, opens the firewall and starts everything.
5. Add the GitHub secrets (`DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`). The public addresses baked into the
   website and console default to progrid.sa; see `docs/deploy-digitalocean.md` for a full first deploy.
   From then on every push to `main` builds images and rolls the host.

Everything is on one machine, so a disk failure means restoring from the nightly dump. Acceptable for a demo,
not for paying customers. Move to phase 1 before charging money.

## Phase 1: our own cluster

Three management virtual machines on the Proxmox cluster itself, each running part of the bundle:

| VM | Services |
|---|---|
| `mgmt-app` | Caddy, API, worker, console, website |
| `mgmt-data` | Postgres (with streaming replica on a second node), Redis, NATS |
| `mgmt-workflow` | Temporal and its UI |

The compose file already separates these by service name, so splitting is a matter of running a subset on
each VM and pointing `DATABASE_URL`, `REDIS_URL`, `NATS_URL` and `TEMPORAL_ADDRESS` at the data VMs
(they are plain environment variables in `pgcloud.env`). Backups go to object storage off the cluster.
Secrets move from the Ansible vault to OpenBao with agent templates when more than two people deploy.

## Images and releases

`.github/workflows/deploy.yml` builds `pgcloud-api`, `pgcloud-console` and `pgcloud-www` on every push to
`main` and pushes them to GitHub Container Registry tagged with the short commit sha and `latest`; a `v*`
tag adds the version. The deploy job then runs `/opt/pgcloud/deploy.sh <tag>` over SSH, which pulls, runs
`prisma migrate deploy` in a one shot container, restarts the services and checks `/healthz`.

To roll back: `sudo /opt/pgcloud/deploy.sh <previous sha>`. Migrations are forward only, so a rollback
across a migration needs a restore or a follow up migration.

## The settings file

`/etc/pgcloud/pgcloud.env` holds every setting the API reads plus what compose needs (domain, image tag,
Postgres password, NATS token). `infra/prod/pgcloud.env.example` shows the shape. Ansible renders it from
`group_vars/all/vars.yml` and the vault in `group_vars/all/vault.yml`; do not edit it by hand on the host.

Production values to set deliberately: `REQUIRE_TOTP_FOR_OWNERS=true`, a real `MAIL_PROVIDER` with its key,
`CONSOLE_URL` for the links in emails, and `HYPERVISOR_DRIVER=proxmox` with the control plane token.

## Private networks and Proxmox SDN

Every project gets a private network per region, a /24 carved from a pool, and every server a static
address from it on net0 (no gateway; the default route stays on the public NIC net1). The settings:

| Setting | Default | Meaning |
|---|---|---|
| `PRIVATE_NETWORK_POOL` | `10.96.0.0/12` | Pool the project networks come from. One CIDR, or per region: `sa1=10.96.0.0/12,sa2=10.112.0.0/12` |
| `PRIVATE_NETWORK_PREFIX` | `24` | Size of each project network |
| `PRIVATE_NETWORK_MODE` | `shared_bridge` | `shared_bridge` or `sdn_vnet`, one value or per region: `sa1=sdn_vnet` (unlisted regions use `shared_bridge`) |
| `PROXMOX_VXLAN_ZONE` | `customers` | SDN zone the project VNets are created in (`sdn_vnet` only) |
| `PRIVATE_NETWORK_VXLAN_BASE` | `100000` | VXLAN tag of the first pool network; a network's tag is this plus its index in the pool |

The pool must not overlap the management network, a DHCP range on the shared bridge or any other routed
range. `CONTROL_PLANE_CIDR` (who may call the platform agents on port 9009) should name the management
addresses only. It defaults to `10.0.0.0/12`, which stays clear of the default tenant pool; keep it that way
if you change either range.

**shared_bridge** puts every net0 on the agent's `proxmox.bridge` (`customers`). Projects are on
different subnets and the IP filter stops a guest from sending from an address it was not given, but they
share one layer 2 segment. Fine for development and a single tenant; not isolation.

**sdn_vnet** gives each project network its own VNet. The first server of a project in a region asks the
agent of its host to create the VNet (id `pn<tag in base 36>`, tag from the network) in
`PROXMOX_VXLAN_ZONE` and to apply the SDN config (`PUT /cluster/sdn`); the VM's net0 then sits on that
VNet. Prerequisites, done once per cluster before switching a region:

1. SDN installed on every node (`libpve-network-perl` and `ifupdown2`, which Proxmox VE 8 ships, and
   `source /etc/network/interfaces.d/*` at the end of `/etc/network/interfaces`).
2. The VXLAN zone, listing every node's underlay address as a peer and not restricted to a subset of
   nodes, so it exists on every node. A VNet bridge exists only on nodes the zone covers; a VM placed
   on any other node fails to start.

   ```sh
   pvesh create /cluster/sdn/zones --type vxlan --zone customers --peers 10.0.0.11,10.0.0.12,10.0.0.13 --mtu 1450
   pvesh set /cluster/sdn
   ```
3. UDP 4789 open between the nodes' underlay addresses.
4. MTU: VXLAN adds 50 bytes, so with a 1500 byte underlay the guests get 1450. The agent sets `mtu=1` on
   net0 so virtio hands the VNet's MTU to the guest, and cloud images honor it. Alternatively raise the
   underlay MTU to 1550 or more (jumbo frames on the switch) and give the zone 1500.
5. The agent's API token needs the `PVESDNAdmin` role on `/sdn` (create VNets, apply, and use them in a
   VM config) in addition to its VM and storage roles.
6. The datacenter firewall enabled (`/cluster/firewall/options enable=1`), or the per VM firewall, and
   with it the IP filter, is not enforced.
7. A path from the control plane into the tenant VNets. A VXLAN zone does not route, so platform agents
   on private addresses are unreachable from the management VMs until one exists (an EVPN zone with a VRF
   per project and an exit node, or a management NIC on platform VMs). Until then keep `shared_bridge`.

Switch a region with `PRIVATE_NETWORK_MODE=<region>=sdn_vnet` only when all of the above holds on every
node of that region. Servers created before the switch stay on the shared bridge until they are rebuilt,
so a region is best switched before it has customers.

The IP filter works in both modes: on each firewall push the agent writes the allowed addresses into the
VM's `ipfilter-net0` and `ipfilter-net1` IP sets and sets `ipfilter: 1`, but only for NICs whose
cloud-init address matches the allocation, so servers still on DHCP are not cut off.

## Backups and restore

The backup container dumps Postgres every night at 02:15 UTC to `/var/backups/pgcloud`, keeps
`BACKUP_KEEP_DAYS` days, and copies to `BACKUP_S3_URL` when set. Restore on a fresh host:

```sh
ansible-playbook -i inventory.ini site.yml --limit management --ask-vault-pass
cd /opt/pgcloud && docker compose --env-file /etc/pgcloud/pgcloud.env stop api worker
gunzip -c /var/backups/pgcloud/pgcloud-YYYYMMDD-0215.sql.gz | docker compose --env-file /etc/pgcloud/pgcloud.env exec -T postgres psql -U pgcloud pgcloud
docker compose --env-file /etc/pgcloud/pgcloud.env start api worker
```

Redis holds only locks, rate limit counters and idempotency keys; losing it is harmless. NATS JetStream
holds in flight host agent jobs; the worker retries them. Temporal state lives in Postgres.

## Operations

- **Logs**: `docker compose logs -f api worker` on the host. JSON file logging is capped at 100 MB per service.
- **Temporal UI**: `ssh -L 8080:127.0.0.1:8080 ops@<host>` then open `http://localhost:8080`. It is never public.
- **Health**: Caddy answers `https://api.<domain>/healthz`. Point an external uptime check at it.
- **Firewall**: ufw allows 22, 80, 443 to the world and 4222 only from the management network.
- **Adding a Proxmox node**: create the `Host` row through the admin API, put its id in the inventory, run
  the playbook with `--limit pve_nodes`. The agent starts sending heartbeats within a minute.

## Object storage (Ceph RADOS Gateway)

Buckets live on the same Ceph cluster as the VM disks, served by RADOS Gateway on two or
more nodes behind Caddy or a load balancer at `S3_ENDPOINT`. Create an admin user once with
`radosgw-admin user create --uid=pgcloud-admin --display-name="pgcloud control plane"
--caps="users=*;buckets=*;usage=read"` and put its keys in the settings file as
`RGW_ADMIN_ACCESS_KEY` and `RGW_ADMIN_SECRET_KEY`. The API creates one RGW user per project,
issues keys on it, creates buckets and links them to the project user, and reads bucket
stats every ten minutes for billing. Enable `rgw_dns_name` in the gateway config so virtual
host style addressing (`bucket.s3.<region>...`) works, and point a wildcard DNS record at it.

## DNS (PowerDNS)

Hosted zones and reverse DNS are served by PowerDNS Authoritative with the Postgres backend.
Create the `pdns` database once, load the schema from the image, start the service with
`docker compose --profile dns up -d pdns`, and set `DNS_PROVIDER=powerdns` with the API key in
the settings file. The API pushes every zone whole through the PowerDNS HTTP API and the
minute job retries anything that did not land. Glue: register `ns1` and `ns2` at your registrar
pointing at the hosts that run PowerDNS, and set the same names in `DNS_NAMESERVERS`. Reverse
DNS needs the in-addr.arpa zones of your IP blocks delegated to the same nameservers by your
RIR or upstream.

## GitHub App (Git Deploy)

Create one app per environment at github.com/settings/apps (or under the organization):

| Setting | Value |
|---|---|
| Webhook URL | `https://api.<domain>/v1/github/webhook` |
| Webhook secret | a random string, also set as `GITHUB_APP_WEBHOOK_SECRET` |
| Setup URL | `https://console.<domain>/github/callback`, with "Redirect on update" on |
| Repository permissions | Contents: read, Metadata: read |
| Subscribe to events | Push, Installation |
| Where can it be installed | Any account |

Then put the app id, slug and the generated private key (PEM, newlines as `\n`) into `pgcloud.env` as
`GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`. Without these the console falls back to
repository URLs with an optional token, and the API answers `github_app_unavailable` on the connect endpoint.
