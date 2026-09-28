# Competitor reference

Two products we benchmark against while building. DigitalOcean sets the bar for
developer experience and pricing shape; the local comparison set is the Saudi hosting and cloud market: STC Cloud, Mobily, Alibaba Cloud through SCCC, Oracle and Google regions in the Kingdom, and the domestic hosting companies serving SMEs in SAR.

> DigitalOcean figures below are from memory of their public pricing (2024–2025 list
> prices) and must be re-verified against https://www.digitalocean.com/pricing/droplets
> before we publish a price list. the local incumbent figures are **to be filled in** from
> the local incumbent's public price list (to be captured; not reachable from the build environment).

## DigitalOcean — Droplets

### Pricing shape (what we copied)

| Concept | DigitalOcean | prgd |
|---|---|---|
| Billing | Hourly, capped at the monthly price; **672 h/month** | Same (`BILLING_HOURS_PER_MONTH=672`) |
| Basic (regular) sizes | $4 · 1 vCPU/512 MB/10 GB/500 GB · $6 · 1/1 GB/25/1 TB · $12 · 1/2 GB/50/2 TB · $18 · 2/2 GB/60/3 TB · $24 · 2/4 GB/80/4 TB · $48 · 4/8 GB/160/5 TB · $96 · 8/16 GB/320/6 TB | Same ladder, `s-<vcpu>vcpu-<ram>` ids; SAR book ≈ ×40 placeholder |
| Premium (NVMe, newer CPU) | +~$1–2 per tier, e.g. $7/$14/$28 | Phase 2 (`Size.family = "premium"`) |
| CPU-/Memory-optimized | from $42 (2 dedicated vCPU/4 GB) / $84 (2 vCPU/16 GB) | Phase 2 (`family = "dedicated"`) |
| Bandwidth overage | $0.01/GB beyond the pooled allowance | Same (`bandwidth_gb` price) |
| Snapshots | $0.06/GB-month | Same (`snapshot_gb`) |
| Backups | Weekly = 20 % of plan price; daily = 30 % | **Added**: `backups_pct` price (20 %) |
| Reserved (floating) IP | Free while assigned, $4/month when reserved but unassigned | `PublicIp.floating` exists; idle-IP charge is phase 2 |
| Volumes | $0.10/GB-month | Phase 2 |
| Load balancer | from $12/month per node | Phase 2 |
| Free credit | $200 for 60 days for new accounts (promo, varies) | `Credit.kind = promo` supports it |

### Developer experience (what we copied)

- One public REST API (`api.digitalocean.com/v2`), bearer tokens with **read/write
  scopes** (fine-grained scopes since 2024) → ours: `prgd_` tokens with `servers:write`-style
  scopes, plus agent-safe caps DO does not have.
- Resources: `droplets`, `images`, `sizes`, `regions`, `ssh_keys`, `firewalls`,
  `reserved_ips`, `snapshots`, `volumes`, `load_balancers`, `domains`, `projects`,
  `tags`, `actions`, `1-clicks` → ours mirrors names but says `servers` and `apps`.
- Droplet `status`: `new | active | off | archive` → ours adds
  `provisioning | rebooting | resizing | rebuilding | deleting | failed | suspended`
  so the console can show live progress instead of a spinner on `new`.
- **Actions** sub-resource (`POST /droplets/{id}/actions {type}`) with types
  `reboot, power_cycle, shutdown, power_off, power_on, resize, rebuild, snapshot,
  enable_backups, …` → ours: `POST /servers/{id}/actions {type}` with the same idea;
  every action is a `ServerAction` row backed by a workflow.
- Pagination: `?page=&per_page=` with `links.pages.next` → ours is cursor-based
  (`meta.next_cursor`); simpler for agents, no offset drift.
- Errors: `{ "id": "not_found", "message": "…" }` → ours `{ "error": { "code", "message" } }`.
- Rate limit: 5,000 requests/hour per token, 250/min burst → ours: TODO in `RedisService.allow`.
- `doctl` CLI, Terraform provider, Go/Python/JS/Ruby SDKs generated from OpenAPI → phase 2.
- Marketplace 1-Clicks are Droplet images built with Packer + a `cloud-init`
  post-install, vendor-submitted through a GitHub repo with automated image
  validation → exactly our marketplace model.
- Console: project switcher, tags, "Create" mega-button, Droplet creation page with
  region → image/marketplace → size → auth (SSH key/password) → options (backups, VPC,
  monitoring, user-data) → hostname/tags → ours follows the same order.
- Free bundled: cloud firewalls, VPC, monitoring agent + alerts, DNS hosting, team
  management, 2FA, activity log.

### Gaps vs DO we accept for the MVP

VPC, volumes, load balancers, DNS, floating IP moves, monitoring graphs, password
auth (we are SSH-key only), IPv6, Kubernetes, managed databases, Spaces.

### Where we aim to beat DO

- Saudi region with SAR billing, ZATCA e-invoicing, PDPL residency.
- Agent-safe tokens (spend caps, approval for destructive actions) and an MCP server.
- Console + docs in Saudi and Arabic (RTL).

## the local incumbent — Bulut Sunucu (to fill in)

Capture from the local incumbent's price page:

| Item | the local incumbent | Notes for us |
|---|---|---|
| Plans (vCPU / RAM / disk / traffic) | | Match or undercut the entry plan |
| Price (SAR/month, VAT included?) | | Our SAR book is USD × 3.75 at the peg |
| Hourly billing? | | If monthly-only, hourly is our differentiator |
| Data center | | Riyadh, Jeddah or Dammam? which provider? |
| Disk type (SSD/NVMe), Ceph? | | |
| Snapshots / backups (price, schedule) | | |
| Firewall, DDoS protection | | |
| IPv4 included, extra IP price | | |
| OS images, panels (cPanel/Plesk), one-click apps | | Plesk/cPanel licenses are common Saudi asks |
| API / Terraform | | Likely none → our advantage |
| Support (7/24, Saudi), SLA % | | |
| Payment (Saudi cards, havale), ZATCA e-invoice | | |
| Trial / promo | | |

Typical Saudi market expectations to confirm against local providers: prices shown VAT included
(**+20 %**), monthly billing, Windows Server licenses, cPanel/Plesk add-ons, 7/24
Saudi-language support, payment by havale/EFT as well as card.
