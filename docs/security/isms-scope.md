# ISMS scope

| | |
|---|---|
| Document owner | [Security owner — to be named] |
| Approved by | [Management — to be named], [Date] |
| Version | Draft, 6 October 2026 |
| Review | Yearly, and when the services, entities, locations or suppliers change |
| ISO/IEC 27001:2022 | Clauses 4.1, 4.2, 4.3 |
| Checklist | Control 1 |

## 1. Organisation

Progrid is a developer cloud: virtual servers, volumes, object storage, networking, DNS, managed
databases, Kubernetes, an App Platform with Git Deploy, the Progrid Connect AI agent builder, a
marketplace, and managed cloud operations. One platform, one account system and one database
serve one legal entity on two domains (see `docs/domains-and-entities.md`):

| Entity | Domains | Customers | Role for account data |
|---|---|---|---|
| Progrid Arabia (Saudi Arabia) | progrid.co (primary) and progrid.sa | Every account | Controller |

For customer content (what customers store or run on the platform) Progrid Arabia is the
customer's processor under its Data processing addendum. Progrid Technologies LLC (United States)
contracted with accounts created on progrid.co until October 2026; it no longer contracts, and only
the invoices and records it issued remain in the platform as history.

## 2. Scope statement

> The information security management system of Progrid Arabia
> covering the design, development, operation and support of the Progrid developer cloud
> platform — the control plane (website, console, public API, back office, ops console,
> terminal gateway, workflow engine and their data stores) hosted on DigitalOcean in Frankfurt,
> Germany; the data plane (Proxmox VE hypervisor nodes, customer virtual machines, storage and
> networking) hosted on Hetzner dedicated servers in Germany; the managed cloud operations
> service delivered by employed and contracted engineers; and the supporting processes of
> software development, billing, customer support and supplier management — in accordance with
> the Statement of Applicability dated [Date].

## 3. Boundaries

### In scope

| Area | Components |
|---|---|
| Control plane | Management host on a DigitalOcean droplet (Frankfurt): Caddy, API, worker, console, website, ops console, `prgd-gateway`, Postgres with TimescaleDB, Redis, NATS, Temporal, PowerDNS (when enabled), backup container (`infra/prod/docker-compose.yml`) |
| Data plane | Hetzner dedicated servers in Germany running Proxmox VE, the host agent (`agents/host-agent`), customer VMs, platform VMs for managed databases, Kubernetes, load balancers and App Platform hosts, Ceph/LVM storage, tenant networks |
| Management network | WireGuard `wg0`, `10.9.0.0/24`, between the management host and the nodes |
| Software | This repository: `apps/api`, `apps/console`, `apps/ops`, `apps/www`, `agents/`, `services/prgd-gateway`, CLI, SDKs, Terraform provider, `infra/` |
| Delivery pipeline | GitHub repository, GitHub Actions, GitHub Container Registry (`ghcr.io/sharpyassir/prgd-*`) |
| People | Founders and employees, contracted engineers using the ops console (for example in Jordan or India), any developer with repository write access |
| Processes | Development and change, deployment, access management, incident response, backup and recovery, billing and payments, customer support and abuse handling, supplier management, managed cloud operations |
| Information | Account data, billing data, verification and fraud data, customer content (as processor), credentials and keys, audit logs and session recordings, source code |

### Out of scope

| Exclusion | Reason | Interface that stays in scope |
|---|---|---|
| Physical data centre operations | Run by DigitalOcean and Hetzner | Supplier management, shared responsibility (physical-and-shared-responsibility.md) |
| Operating systems and applications inside customer VMs, customer Kubernetes workloads, customer apps | Customer responsibility under the terms and DPA | Isolation between tenants, the hypervisor and the platform agents stay in scope |
| Customer servers outside Progrid that are covered by a managed cloud contract | Customer owns them | Progrid's access to them (grants, gateway, recordings) and the engineers' conduct are in scope |
| Internal systems of SaaS suppliers (Resend, Moyasar, Anthropic, Twilio, Google, Microsoft, GitHub, Infisical) | Supplier responsibility | Their configuration, our accounts on them and the data we send |
| Corporate IT beyond the platform (accounting software, office productivity) | [Owner to confirm whether to include] | Accounts with access to platform data are in scope through access control |

Future Saudi hosting (region `sa1` currently runs in Germany, see `docs/readiness-review.md`) will
enter scope by a scope change when the first Saudi host is ordered.

## 4. Interested parties and requirements

| Party | Relevant requirements |
|---|---|
| Customers (developers, companies, public sector buyers) | Confidentiality and integrity of their data, tenant isolation, availability within the SLA (`pages/shared/en/sla.md`), DPA commitments (72-hour incident notice, deletion within 30 days of closure, subprocessor notice), evidence for their due diligence |
| Customers' end users and data subjects | Privacy rights under GDPR, UK GDPR, US state laws, PDPL |
| Saudi regulators: NCA, SDAIA, ZATCA, CST | NCA control sets where applicable (formal applicability assessment needed); PDPL and its implementing regulations, including breach notification and cross-border transfer rules; ZATCA e-invoicing for Progrid Arabia; CST rules for cloud service providers [legal review needed] |
| EU and UK supervisory authorities | GDPR as processor and controller; transfer safeguards |
| US authorities | State privacy laws, sanctions and export controls (`pages/*/export-sanctions.md`) |
| Payment provider (Moyasar; Stripe no longer used) and card schemes | Card data never touches Progrid; fraud controls; their acceptable use terms |
| Hosting providers (DigitalOcean, Hetzner) | Their acceptable use policies; abuse report handling within their deadlines |
| Staff and contractors | Clear rules, safe tooling, privacy of their own data, fair contractor pay records |
| Investors and owners | Protection of the business, readiness for ISO 27001 certification in year 2 (`docs/architecture.md`) |
| Security researchers | A way to report (`SECURITY.md`, `/.well-known/security.txt`) |

## 5. Internal and external issues (clause 4.1)

- Very small team; one person holds most privileges (key person and segregation-of-duties risk).
- Early stage: much of the platform has run only against simulators (`docs/readiness-review.md`).
- Control plane on a single host; backups on the same host until off-site storage is configured.
- Two legal entities and three legal regimes (US, EU/GDPR via hosting location, Saudi Arabia).
- Contracted engineers in other countries access customer servers.
- AI features (Connect agents, AI-generated apps) introduce new abuse and data-flow risks.
- Public cloud attracts fraud, crypto-mining, spam and DDoS.

## 6. Interfaces and dependencies

| Interface | Direction | Protection |
|---|---|---|
| Internet to Caddy (ports 80/443) | Inbound | TLS, rate limits, security headers |
| Management host to Proxmox nodes | Both | WireGuard, NATS token, Proxmox API token |
| Gateway to managed customer servers | Outbound | WireGuard, short-lived SSH certificates, recordings |
| API to SaaS suppliers (mail, payments, AI model, SMS, OAuth, GitHub) | Outbound | TLS, API keys in the settings file |
| Supplier webhooks to API (Moyasar, Resend, GitHub, Alertmanager; the Stripe webhook only with `PAYMENT_PROVIDER=stripe`) | Inbound | Signature or shared-secret verification |
| GitHub Actions to management host (deploy) | Inbound SSH | Deploy key, forced command, pinned host key |
| Engineers' and staff browsers to console/ops/back office | Inbound | MFA, sessions, IP allowlists |

## 7. Objectives

The security objectives and their measures are in
[information-security-policy.md](information-security-policy.md) §4.
