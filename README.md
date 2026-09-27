# pgcloud — AI-Native Developer Cloud

API-first control plane on top of Proxmox VE (KVM) + Ceph. The same API powers the
web console, CLI, Terraform, SDKs and AI agents.

> `pgcloud` is a working name (the brand/domain is still an open decision — see
> `docs/architecture.md`). It is used for package scopes, the CLI binary name and
> the NATS subject prefix, and is trivial to rename later.

## Layout

```
apps/
  api/          Control plane — NestJS + Prisma modular monolith (TypeScript)
  console/      Web console — Next.js (TR / AR / EN, RTL-ready)
  www/          Marketing site — Next.js (progrid.sa), pricing pulled live from the API
cli/            `pgcloud` CLI — single Go binary (login, servers, ssh, deploy, tokens); `cli/install.sh`
agents/
  host-agent/   Go service on every Proxmox node: takes jobs from NATS, calls the
                Proxmox API, reports health + usage every minute
packages/
  openapi/      OpenAPI v1 spec, source of truth for SDKs, CLI and docs
  mcp-server/   pgcloud-mcp: MCP server for AI agents (npx -y pgcloud-mcp)
infra/
  dev/          docker-compose for local development (Postgres+Timescale, Redis,
                NATS, Temporal)
docs/
  architecture.md   The architecture document this repo implements
  adr/              Architecture decision records
```

## Quick start (local)

```bash
# 1. infrastructure
docker compose -f infra/dev/docker-compose.yml up -d

# 2. control plane
pnpm install
cp .env.example .env
pnpm --filter @pgcloud/api prisma:migrate   # creates schema + Timescale hypertable
pnpm --filter @pgcloud/api seed             # region sa1, sizes, images, price book, dev user
pnpm --filter @pgcloud/api dev              # API on http://localhost:4000  (Swagger at /docs)
pnpm --filter @pgcloud/api worker           # Temporal worker (provisioning workflows)

# 3. a fake "host" so servers can actually be created without Proxmox
HYPERVISOR_DRIVER=fake pnpm --filter @pgcloud/api worker

# 4. console
pnpm --filter @pgcloud/console dev          # http://localhost:3000
pnpm --filter @pgcloud/www dev              # http://localhost:3001 (marketing site)

# 5. host agent (real node)
cd agents/host-agent && go build ./... && ./host-agent --config /etc/pgcloud/agent.yaml
```

Create a server with the seeded dev token:

```bash
curl -X POST localhost:4000/v1/servers \
  -H "Authorization: Bearer $PGCLOUD_TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"name":"web-1","size":"s-2vcpu-4gb","image":"ubuntu-24-04","region":"sa1","project":"default"}'
```

## Design principles (from the architecture doc)

1. **API-first** — every action exists in the public API before the console.
2. **Control plane ≠ data plane** — customer VMs keep running if the API is down.
3. **Swappable engine** — all hypervisor calls go through `HypervisorDriver`
   (`apps/api/src/drivers/`). Proxmox today, OpenStack / bare KVM later.
4. **Everything is a workflow** — provisioning, resize, delete run as durable Temporal
   workflows; never fire-and-forget.
5. **AI-native** — agents are first-class API clients with scoped tokens and spend caps.
6. **Metered from day one** — every resource emits usage events for hourly billing.
7. **Multi-region ready** — `sa1` is region one; the data model has regions from day one.

## Build phases

| Phase | Months | Scope |
|---|---|---|
| MVP | 1–3 | accounts, teams, SSH keys; servers (create/resize/reboot/delete); images + snapshots; public IPs + firewalls; 15 marketplace apps; hourly billing, riyal price book with a USD view, 15% VAT at checkout; API v1 + console; back-office; abuse checks |
| 2 | 4–9 | VPCs, volumes, backups, LBs, DNS; CLI, SDKs, Terraform; MCP server, agent-safe tokens, console assistant; webhooks; status page |
| 3 | 10–18 | managed DBs, object storage, Kubernetes; vendor marketplace; inference gateway; GPU servers; second region |

## Status

This repository implements the **MVP control plane**, verified end-to-end against the
fake driver (create → `provisioning` → `active` with public + private IP in ~6 s; stop /
start / resize / rebuild / snapshot / delete; metering → hourly rating → invoices):

| Area | State |
|---|---|
| IAM: signup/login, teams, projects, RBAC scopes, API tokens, **agent-safe tokens** (spend cap, approval rules), SSH keys | ✅ |
| Approval queue: parked agent requests, owner email and webhook, approve or deny in console, CLI or API | ✅ |
| Compute: servers, sizes, images, lifecycle actions as Temporal workflows, quotas | ✅ |
| **Git Deploy**: repo → server → build → GitHub push redeploys (`POST /v1/deploys`); GitHub App installations, repo picker, build logs | ✅ |
| **CLI** `pgcloud`: login, servers create/ssh/actions, deploy, tokens, `--json` | ✅ |
| **MCP server** `pgcloud-mcp`: 12 tools for Claude Code, Cursor and other agents, behind a capped agent token | ✅ |
| Scheduler: least-loaded placement, anti-affinity, capacity from heartbeats | ✅ |
| Network: public IP pool, host-enforced firewalls | ✅ (VPCs, LBs, DNS: phase 2) |
| Storage: snapshots | ✅ (backups: phase 2) |
| Managed databases: PostgreSQL (Patroni failover, pgBouncer, pgBackRest with WAL archiving), Valkey (Sentinel, ACL users, RDB backups) and MySQL (GTID replication, XtraBackup); 1 or 3 nodes, VIP that follows the primary, TLS, users and databases, trusted sources, nightly backups to object storage, per node pricing, console, CLI, SDKs, Terraform | ✅ |
| Managed servers: opt in care tier with an in VM agent (unattended updates with reboot at 04:00, fail2ban, sshd and sysctl hardening, five minute health reports with warning and recovery events), daily backups included, sold as Managed Start, Business and Pro plans on top of Standard, Pro and Business hardware, console, CLI, SDKs, Terraform | ✅ |
| Support plans: free, developer, standard and premium with first response targets per priority, ticket system with email to owners, back office queue sorted by due time, billed monthly through the meter, console, CLI, SDKs, MCP | ✅ |
| Managed Kubernetes: kubeadm clusters on platform owned nodes, 1 or 3 control plane nodes behind a shared address, worker pools with labels and taints that scale, node agent that bootstraps and joins, cloud controller turning LoadBalancer Services into platform load balancers and pgcloud-block claims into attached volumes, kubeconfig download, console, CLI, SDKs, MCP, Terraform | ✅ |
| App Platform: push code, get a URL; shared platform owned hosts with an agent that builds from the repository (Dockerfile or detected Node, Python, Go, static), runs sized instances with Docker limits behind Caddy with TLS, rolling deploys with health checks, GitHub App push redeploys, env vars, custom domains, build and runtime logs, stop and start, per instance pricing, console, CLI, SDKs, MCP, Terraform | ✅ |
| Object storage: S3 compatible buckets on Ceph RGW (fake in dev), access keys, presigned upload and download, bucket browser in the console, per GB pricing, CLI, SDKs, Terraform | ✅ |
| DNS: hosted zones with every record type, PowerDNS backend with a fake for dev, zone file export, reverse DNS for public IPs, CLI, SDKs, Terraform | ✅ |
| Load balancers: managed HAProxy nodes with a shared IP (keepalived), forwarding rules, health checks, sticky sessions, Let's Encrypt and uploaded certificates, tag based targets, CLI, SDKs, Terraform | ✅ |
| Volumes: Ceph RBD block storage 10 GB to 16 TB, hot attach and detach, live grow, per GB pricing, CLI, SDKs, Terraform | ✅ |
| Marketplace: 15 launch apps as image + cloud-init + variables | ✅ (vendor portal: phase 3) |
| Billing: per-minute metering, hourly rating with monthly cap, USD price book converted to SAR at a stored exchange rate (hourly refresh, admin override), invoices, credits, spend limits | ✅ (payment gateways, ZATCA e-invoicing provider: integration points only) |
| Trust & safety: verification gate, abuse flags, suspension | ✅ (AI detection: phase 2) |
| Events: audit log, signed webhooks | ✅ |
| Back-office admin API | ✅ (admin UI: to do) |
| Host agent (Go) for Proxmox VE | ✅ builds; needs a real node to test |
| Console: login, servers, one-click apps, billing; EN/TR/AR with RTL | ✅ minimal |
| Account security: TOTP two factor (required for owners), email verification, password reset, rate limits | ✅ |
| Hardware plan for launch: Hetzner Falkenstein auction servers, Storage Box backups, OVH Eco failover, capacity math ([docs/hardware-plan.md](docs/hardware-plan.md)) | ✅ |
| Company and legal pages in English and Arabic: about, contact, careers, terms of service with subscription terms, acceptable use, PDPL privacy, refunds and cancellation, SLA, cookies; linked from the footer and the signup form | ✅ |
| Hosting: Dockerfiles, production compose with Caddy TLS and backups, Ansible for the management host and Proxmox nodes, deploy workflow ([docs/hosting.md](docs/hosting.md)) | ✅ |
| Payments: Moyasar checkout (mada, Visa, Mastercard, Apple Pay) in SAR or USD, credit top up, invoice pay, invoice PDF, built in test page | ✅ |
| Monitoring: per minute metrics from the host agent, graphs on the server page, alert rules with email and webhook, incidents | ✅ |
| SDKs: TypeScript (types generated from OpenAPI) and Python, both with tests | ✅ |
| Terraform provider: server, volume, load balancer, domain, DNS record, bucket, storage key, database, firewall, SSH key resources; sizes and images data sources | ✅ (registry publishing: to do) |

### Local dev without Docker

`docker compose` is the easy path. Without it: install PostgreSQL 16 + Redis, download
`nats-server` and the `temporal` CLI (`temporal server start-dev --headless`), then run
the same commands as above. The Timescale migration is a no-op on plain Postgres (usage
events stay a regular table), so nothing else changes.

Brand assets (official logo, icons, social image) live in `docs/brand/`, with copies under each app's `public/brand`.

What still has to be built before real hardware and real invoices: `docs/readiness-review.md`.
