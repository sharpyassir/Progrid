# Product catalog — mapped against DigitalOcean's 2026 menu

DigitalOcean's console menu (Sep 2026) lists ~24 products. This is our answer to each:
what we ship, in which phase, and where we intend to be *better* rather than merely
present. Phases come from `architecture.md` (MVP 1–3 mo · Phase 2 4–9 mo · Phase 3 10–18 mo).

Legend: ✅ shipped in repo · 🔨 MVP scope · 2️⃣ phase 2 · 3️⃣ phase 3 · ➖ deliberately not

## Compute

| DigitalOcean | prgd | Phase | How we do it / why better |
|---|---|---|---|
| Droplet | **Servers** | ✅ | Same shape; richer live status set; agent-safe creation with spend caps. |
| GPU Droplet | GPU servers | 3️⃣ | Hourly GPU nodes once revenue funds GPUs; `Size.family = gpu` exists. |
| Kubernetes | Managed Kubernetes | 3️⃣ | k3s/RKE2 on our VMs via Cluster API; workflow-driven like servers. |
| App Platform | ➖ (Coolify one-click instead) | ✅ | PaaS is a product in itself; Coolify from the marketplace gives git-push deploys today. |
| Function | ➖ | — | Not in 18-month plan. |

## AI (our differentiator)

| DigitalOcean | prgd | Phase | How we do it / why better |
|---|---|---|---|
| Agent Runtime ("Harness Runtime") | **Agent workspace**: agent-safe tokens + MCP server | 🔨→2️⃣ | Tokens already carry scopes, monthly spend cap and `requireApprovalFor`. MCP server exposes the API as tools. **Recommendation: pull MCP into the MVP** (open decision #7) — it is the headline. |
| Action Gateway | **Approval queue** | 2️⃣ | Destructive actions from agents park in a queue a human approves in console/Slack/Telegram; DO has no per-token spend caps. |
| Serverless Inference | **Inference gateway** (OpenAI-compatible) | 3️⃣ (can start as reseller earlier) | Per-token billing in SAR with ZATCA e-invoice; routes to partner APIs first, own GPUs later. TR data residency for prompts when on our GPUs. |
| Dedicated Inference | Dedicated model endpoints on GPU servers | 3️⃣ | vLLM one-click on a GPU size. |
| Batch Inference | Batch jobs on the gateway | 3️⃣ | Queue + cheaper off-peak rate. |
| Knowledge Base | ➖ (marketplace: n8n + Open WebUI RAG) | ✅ | Templates instead of a managed product until demand is proven. |
| Vector Database | Managed PostgreSQL + pgvector | 3️⃣ | One managed DB product covers both. |
| Search | ➖ (marketplace: Meilisearch/Typesense one-click) | 🔨 | Add to launch catalog; trivial cloud-init. |

## Data

| DigitalOcean | prgd | Phase | Notes |
|---|---|---|---|
| Managed Database | Managed PostgreSQL, MySQL, Redis | 3️⃣ | Operator-driven VMs with automated backups; PITR. |
| Caching | Managed Redis/Valkey | 3️⃣ | Same product line. |
| Streaming (Kafka) | ➖ (marketplace: Redpanda one-click) | 2️⃣ | Template until demand. |

## Networking

| DigitalOcean | prgd | Phase | Notes |
|---|---|---|---|
| Firewall | **Firewalls** (host-enforced) | ✅ | Rules applied on the Proxmox host; customer cannot bypass from inside the VM. |
| Reserved IP | Floating IPs | ✅ model / 2️⃣ moves | `PublicIp.floating` exists; live re-attach via agent job in phase 2. Idle-IP charge like DO's $4. |
| Load Balancer | Managed HAProxy | 2️⃣ | Internal VMs; L4 + L7 with Let's Encrypt. |
| VPC | VPCs (VXLAN/EVPN via Proxmox SDN) | 2️⃣ | MVP has one default overlay per project; phase 2 exposes multiple. |
| Partner Network Connect | ➖ | — | Enterprise interconnect; not before a second region. |
| Domain (DNS) | DNS (PowerDNS) | 2️⃣ | Free with account, API-managed, reverse DNS. |
| Resource Alert | Monitoring & alerts | 2️⃣ | Prometheus data from host agents; alert rules per project → email/SMS/webhook. |

## Storage

| DigitalOcean | prgd | Phase | Notes |
|---|---|---|---|
| Volume Block Storage | Volumes (Ceph RBD) | 2️⃣ | Attach/detach as workflows; $0.10/GB-mo class pricing. |
| Spaces Object Storage | Object storage (Ceph RGW, S3 API) | 3️⃣ | "Spaces"-style buckets, CDN later. |
| Network File Storage | ➖ (CephFS later if asked) | — | |
| Snapshots / Backups | **Snapshots**, backups at 20 % of plan | ✅ / 🔨 schedule | Backup schedule + retention in phase 2. |

## What DO does not have (our edge)

- **SAR billing, ZATCA e-invoicing, PDPL residency, Moyasar** — table stakes for Saudi SMEs, absent from every global cloud.
- **Agent-safe tokens**: per-token monthly spend cap and approval rules for destructive actions. DO tokens have scopes only.
- **Console and docs in Saudi and Arabic (RTL)**.
- **Transparent status model** — provisioning is visible step by step, not a spinner on `new`.
- **Progrid apps** as premium marketplace listings.

## Console consequence

The console now shows the full product surface in a grouped menu, like DO, so users and
investors see the roadmap. Items not yet available link to a page stating the phase and
letting the user register interest (`POST /v1/interest`), which feeds prioritisation.
