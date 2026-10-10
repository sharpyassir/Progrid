# Control register

All 160 controls of the customer checklist "Cybersecurity Architecture & ISO/NCA Readiness Checklist", with owner, status, evidence and next action. The same data is in [control-register.csv](control-register.csv) for spreadsheets; edit both together (the CSV is the source of truth when they differ).

This is a readiness register. It does not claim certification or compliance with ISO/IEC 27001 or any NCA control set. Status reflects the code and documents in this repository on 6 October 2026, including the changes on branch `feat/security-iso` that are not yet deployed.

## Status values

| Status | Meaning |
|---|---|
| Implemented | In production before `feat/security-iso`, with evidence available in code or configuration |
| Implemented on feat/security-iso (pending deploy) | Built on this branch; becomes Implemented once deployed and evidenced |
| Partial | Some of the requirement is in place; the gap column says what is missing |
| Policy written — operate & evidence | A process control defined in `docs/security`; it now has to be run and its records filed under `evidence/` |
| Planned | Not in place; on the roadmap with an owner and a target |

Owners are role placeholders from [roles-and-responsibilities.md](roles-and-responsibilities.md) until people are named. Target dates are placeholders with the roadmap phase of the checklist (1 Foundation, 2 Platform security, 3 AI security, 4 Assurance, 5 Certification readiness). NCA mapping is at domain level; see [nca-mapping.md](nca-mapping.md).

## Summary

| Status | Controls |
|---|---:|
| Implemented | 5 |
| Implemented on feat/security-iso (pending deploy) | 56 |
| Partial | 33 |
| Policy written — operate & evidence | 57 |
| Planned | 9 |
| **Total** | **160** |

By layer (Impl. = Implemented, Branch = implemented on feat/security-iso, Policy = policy written):

| Layer | Impl. | Branch | Partial | Policy | Planned |
|---|---:|---:|---:|---:|---:|
| 1. Governance & ISMS | 0 | 0 | 0 | 8 | 0 |
| 2. Identity & Access Management | 0 | 3 | 4 | 1 | 0 |
| 3. Privileged Access & Management Plane | 1 | 2 | 3 | 1 | 0 |
| 4. Network Security | 1 | 3 | 2 | 1 | 0 |
| 5. Edge, WAF & DDoS | 0 | 1 | 2 | 1 | 3 |
| 6. Application & API Security | 1 | 5 | 0 | 1 | 1 |
| 7. AI App Builder / Workload Isolation | 0 | 7 | 2 | 0 | 0 |
| 8. Data Protection & Cryptography | 0 | 4 | 3 | 1 | 0 |
| 9. Secrets & Credential Security | 0 | 3 | 4 | 0 | 0 |
| 10. Secure Infrastructure & Containers | 0 | 6 | 3 | 0 | 0 |
| 11. DevSecOps & Supply Chain | 0 | 7 | 2 | 1 | 0 |
| 12. Vulnerability & Patch Management | 0 | 1 | 1 | 5 | 1 |
| 13. Logging, Monitoring & SIEM | 1 | 5 | 2 | 0 | 1 |
| 14. Incident Response | 0 | 0 | 0 | 8 | 0 |
| 15. Backup, DR & Business Continuity | 0 | 1 | 2 | 5 | 1 |
| 16. Third-Party & Supplier Security | 0 | 1 | 1 | 6 | 0 |
| 17. Privacy, Data Lifecycle & Tenant Isolation | 1 | 5 | 1 | 1 | 0 |
| 18. Physical & Data Center Security | 0 | 0 | 1 | 5 | 0 |
| 19. People Security & Awareness | 0 | 2 | 0 | 5 | 1 |
| 20. Audit, Assurance & Continuous Improvement | 0 | 0 | 0 | 7 | 1 |


## 1. Governance & ISMS

| ID | Requirement | ISO 27001:2022 | NCA | Owner | Status | Evidence | Gap / next action | Target |
|---|---|---|---|---|---|---|---|---|
| 1 | Define ISMS scope, boundaries, interested parties and security objectives. | Cl. 4.1-4.3, 6.2 | ECC Governance: strategy, management | [Management] | Policy written — operate & evidence | docs/security/isms-scope.md; docs/security/information-security-policy.md (objectives) | Management to approve scope; record approval in evidence/01-governance | [Date] (Phase 1) |
| 2 | Maintain an approved information-security policy. | Cl. 5.2; A.5.1 | ECC Governance: policies and procedures | [Management] | Policy written — operate & evidence | docs/security/information-security-policy.md | Policy is a draft: management sign-off and communication to staff and contractors | [Date] (Phase 1) |
| 3 | Maintain a risk methodology and risk register. | Cl. 6.1.2, 6.1.3, 8.2, 8.3 | ECC Governance: risk management | [Security owner] | Policy written — operate & evidence | docs/security/risk-methodology.md; docs/security/risk-register.csv | Owners to accept treatment plans; first quarterly risk review | [Date] (Phase 1) |
| 4 | Identify assets, owners, business impact and security requirements. | A.5.9, A.5.12; Cl. 8.2 | ECC Defense: asset management | [Security owner] | Policy written — operate & evidence | docs/security/asset-register.csv | Name owners; reconcile against DigitalOcean, Hetzner and GitHub inventories quarterly | [Date] (Phase 1) |
| 5 | Maintain a Statement of Applicability (SoA) and control evidence. | Cl. 6.1.3 d); A.5.36 | ECC Governance: compliance, periodic review | [Security owner] | Policy written — operate & evidence | docs/security/statement-of-applicability.csv; docs/security/control-register.csv | Approve SoA; link each control to evidence as it is produced | [Date] (Phase 1) |
| 6 | Define security roles, responsibilities and segregation of duties. | Cl. 5.3; A.5.2, A.5.3 | ECC Governance: roles and responsibilities | [Management] | Policy written — operate & evidence | docs/security/roles-and-responsibilities.md | Appoint named people to each role; record the appointment | [Date] (Phase 1) |
| 7 | Run internal audits, management reviews and corrective-action tracking. | Cl. 9.2, 9.3, 10.2 | ECC Governance: periodic review and audit | [Security owner] | Policy written — operate & evidence | docs/security/internal-audit-and-management-review.md | First internal audit and management review not held yet | [Date] (Phase 4) |
| 8 | Maintain document/version control and security evidence retention. | Cl. 7.5; A.5.33, A.5.37 | ECC Governance: policies and procedures | [Security owner] | Policy written — operate & evidence | docs/security/README.md (document control); git history of docs/security; evidence/README.md | Enable branch protection so ISMS documents change only through reviewed pull requests | [Date] (Phase 1) |

## 2. Identity & Access Management

| ID | Requirement | ISO 27001:2022 | NCA | Owner | Status | Evidence | Gap / next action | Target |
|---|---|---|---|---|---|---|---|---|
| 9 | Enforce MFA for all administrative accounts and strongly encourage/require it for customers. | A.5.17, A.8.5 | ECC Defense: identity and access management | [Engineering lead] | Partial | apps/api/src/common/auth/auth.guard.ts (staff TOTP, REQUIRE_TOTP_FOR_STAFF); ops TOTP/WebAuthn (docs/devops-console.md); REQUIRE_TOTP_FOR_OWNERS=true in infra/prod/prgd.env.example | On this branch: admin-scope tokens need staff with TOTP and expire within 24h, WebAuthn user verification, owner setting parsing. Still open: MFA on DigitalOcean, Hetzner, GitHub, registrar and SaaS admin accounts must be verified and evidenced (access-control-policy.md); MFA for non-owner customer members is optional | [Date] (Phase 1) |
| 10 | Implement RBAC with least-privilege roles. | A.5.15, A.5.18, A.8.2 | ECC Defense: identity and access management | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | Team roles and token scopes (apps/api/src/modules/iam); staff areas; explicit full_admin staff role (migration on feat/security-iso) | Deploy; review the staff role list in the first quarterly access review | [Date] (Phase 1) |
| 11 | Separate standard accounts from privileged administrator accounts. | A.8.2, A.5.16 | ECC Defense: identity and access management | [Security owner] | Partial | Staff IP allowlist (STAFF_IP_ALLOWLIST), 30 min staff idle timeout, Caddy ADMIN_ALLOW_CIDRS (feat/security-iso); access-control-policy.md §4 | Staff still use a flag on a customer account. Create dedicated staff identities (separate email, no customer team) as required by the access policy; longer term a separate admin app | [Date] (Phase 2) |
| 12 | Disable shared administrative accounts; uniquely identify every person. | A.5.16, A.8.2 | ECC Defense: identity and access management | [Operations lead] | Partial | Personal app accounts; dedicated forced-command deploy user (feat/security-iso); access-control-policy.md | Hosts still administered as root with personal keys: create named sudo accounts on the management host and Proxmox nodes; no shared DigitalOcean/Hetzner logins | [Date] (Phase 1) |
| 13 | Use SSO/SAML/OIDC for enterprise customers where practical. | A.5.16, A.8.5 | ECC Defense: identity and access management | [Engineering lead] | Partial | Google and Microsoft OIDC sign in (docs/social-sign-in.md) | Per-team SAML/OIDC SSO for enterprise customers is on the roadmap | [Date] (Phase 3) |
| 14 | Implement joiner/mover/leaver access workflows. | A.5.16, A.5.18, A.6.5 | ECC Governance: cybersecurity in human resources | [Security owner] | Implemented on feat/security-iso (pending deploy) | Engineer offboarding (docs/devops-console.md, Offboarding); token and session revocation on member and staff removal (feat/security-iso); access-control-policy.md §6 | Use the joiner/mover/leaver checklist in people-security.md and file each record | [Date] (Phase 1) |
| 15 | Review privileged access periodically. | A.5.18, A.8.2 | ECC Defense: identity and access management | [Security owner] | Policy written — operate & evidence | docs/security/access-control-policy.md §7 (quarterly review) | No review held yet; automated reminder job is on the roadmap | [Date] (Phase 1) |
| 16 | Expire/revoke API keys, sessions and credentials according to policy. | A.5.17, A.8.5 | ECC Defense: identity and access management | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | Console sessions 24h with 120 min idle timeout, staff 30 min, ops 12h with 30 min idle; optional API token expiry of 1-365 days, admin-scope tokens 24h (feat/security-iso) | Deploy; tokens without expiry still last until revoked: make expiry mandatory or default; review old tokens in the access review | [Date] (Phase 1) |

## 3. Privileged Access & Management Plane

| ID | Requirement | ISO 27001:2022 | NCA | Owner | Status | Evidence | Gap / next action | Target |
|---|---|---|---|---|---|---|---|---|
| 17 | Separate the management plane from customer-facing workloads. | A.8.22, A.8.27 | ECC Defense: network security; CCC Defense | [Engineering lead] | Partial | Control plane on its own DigitalOcean droplet; Proxmox API over WireGuard (docs/hosting.md); /internal/* blocked at Caddy (feat/security-iso) | Back office still shares the public API and console hostnames; App Platform hosts and the gateway share the management host's network path; move admin to its own hostname behind an allowlist | [Date] (Phase 2) |
| 18 | Restrict administrative interfaces to trusted networks/VPN/ZTNA where practical. | A.8.20, A.8.22 | ECC Defense: network security | [Operations lead] | Partial | Per-engineer IP allowlist (ops); STAFF_IP_ALLOWLIST and ADMIN_ALLOW_CIDRS (feat/security-iso); Proxmox 8006 only from 10.9.0.0/24 | Set the allowlists in production; consider ZTNA for staff | [Date] (Phase 2) |
| 19 | Use hardened bastion/jump hosts or equivalent controlled access. | A.8.2, A.8.20 | ECC Defense: identity and access management | [Operations lead] | Partial | prgd-gateway with recorded sessions for managed assets (docs/devops-console.md); WireGuard for Proxmox; ssh_allow_from fix (feat/security-iso) | No bastion for infrastructure SSH: restrict SSH to ssh_allow_from / WireGuard and route admin SSH through one hardened path | [Date] (Phase 2) |
| 20 | Disable direct root login and password-based server administration. | A.8.2, A.8.5, A.8.9 | ECC Defense: information system protection | [Operations lead] | Implemented on feat/security-iso (pending deploy) | Baseline hardening role: PasswordAuthentication no, PermitRootLogin prohibit-password, MaxAuthTries 3, fail2ban (see infra-hardening.md) | Deploy to every host; move to named users and then PermitRootLogin no | [Date] (Phase 1) |
| 21 | Log privileged actions and retain them for investigation. | A.8.2, A.8.15 | ECC Defense: event logs and monitoring | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | Ops audit (OpsAudit); global audit interceptor for every non-GET request and every back-office read, append-only hash-chained audit table (feat/security-iso) | Deploy; ship host auditd logs off the host (layer 13) | [Date] (Phase 1) |
| 22 | Use just-in-time or time-bound privileged access where practical. | A.8.2, A.5.18 | ECC Defense: identity and access management | [Operations lead] | Implemented | Access grants with approval, expiry and step-ca certificates for managed assets (docs/devops-console.md, Access flow) | Infrastructure (Proxmox, management host) access is still standing key access; evaluate time-bound access there | [Date] (Phase 2) |
| 23 | Protect break-glass accounts and test emergency access procedures. | A.8.2, A.5.17, A.5.29 | ECC Defense: identity and access management | [Security owner] | Policy written — operate & evidence | Emergency grants (auto-approved P1/P2); docs/security/access-control-policy.md §8 (break-glass) | Create sealed break-glass credentials and run the first test; record in evidence/03-privileged-access | [Date] (Phase 1) |

## 4. Network Security

| ID | Requirement | ISO 27001:2022 | NCA | Owner | Status | Evidence | Gap / next action | Target |
|---|---|---|---|---|---|---|---|---|
| 24 | Use private networks for databases, queues and internal services. | A.8.20, A.8.22 | ECC Defense: network security | [Operations lead] | Implemented | infra/prod/docker-compose.yml: Postgres, Redis, Temporal not published; NATS bound to the WireGuard address; Temporal UI on 127.0.0.1; Redis password and dev ports on 127.0.0.1 (feat/security-iso) | Keep under change review | [Date] (Phase 1) |
| 25 | Segment management, production, customer workloads and backup systems. | A.8.22 | ECC Defense: network security; CCC Defense | [Operations lead] | Partial | Edge/backend Docker network split and PowerDNS API restriction (feat/security-iso); WireGuard management network 10.9.0.0/24 | Backups are on the same host as production until off-site copy is configured; phase 1 hosting splits app, data and workflow VMs | [Date] (Phase 2) |
| 26 | Default-deny inbound firewall rules; open only required ports. | A.8.20 | ECC Defense: network security | [Operations lead] | Implemented on feat/security-iso (pending deploy) | ufw default deny on the management host; SSH source restriction fix; Proxmox datacenter firewall; opt-in cluster.fw template (feat/security-iso) | Deploy; evidence: ufw status export each quarter | [Date] (Phase 1) |
| 27 | Restrict east-west traffic between workloads where practical. | A.8.22 | ECC Defense: network security; CCC Defense | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | Per-VM firewall and IP filter; shared_bridge mode drops traffic between tenant pools (feat/security-iso); per-app Docker networks on App Platform | Layer 2 is still shared in shared_bridge mode: move regions to sdn_vnet before external customers (docs/hosting.md) | [Date] (Phase 2) |
| 28 | Control and log outbound traffic from high-risk workloads. | A.8.20, A.8.16 | ECC Defense: network security | [Engineering lead] | Partial | Outbound SMTP 25 blocked by default; App Platform containers blocked from private ranges (feat/security-iso); Connect outbound SSRF guard (docs/connect.md) | Outbound flow logging for customer workloads is not in place | [Date] (Phase 3) |
| 29 | Prevent untrusted workloads from accessing cloud metadata endpoints. | A.8.22, A.8.20 | CCC Defense: cloud tenant protection | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | Proxmox has no HTTP metadata service (cloud-init via config drive); App Platform blocks 169.254.0.0/16 (feat/security-iso); Connect guard blocks 169.254.0.0/16 | Re-check if a metadata service is ever added | [Date] (Phase 3) |
| 30 | Review firewall/security-group rules periodically. | A.8.20, A.8.9 | ECC Defense: network security | [Operations lead] | Policy written — operate & evidence | docs/security/access-control-policy.md §7 and change-management.md (quarterly firewall review) | First review not held | [Date] (Phase 1) |

## 5. Edge, WAF & DDoS

| ID | Requirement | ISO 27001:2022 | NCA | Owner | Status | Evidence | Gap / next action | Target |
|---|---|---|---|---|---|---|---|---|
| 31 | Place public applications behind a hardened edge/CDN where appropriate. | A.8.20, A.8.21 | ECC Defense: network security; web application security | [Operations lead] | Partial | Caddy edge with automatic TLS (infra/prod/Caddyfile) | No CDN in front; decide Cloudflare (or similar) vs. provider-only edge | [Date] (Phase 2) |
| 32 | Deploy a WAF for internet-facing web/API services. | A.8.20, A.8.26 | ECC Defense: web application security | [Operations lead] | Planned | Decision recorded in threat-model.md (edge) | No WAF: options Cloudflare WAF or Coraza in Caddy | [Date] (Phase 2) |
| 33 | Implement DDoS detection and mitigation. | A.8.20, A.5.30 | ECC Defense: network security; ECC Resilience | [Operations lead] | Partial | Provider network DDoS filtering only (DigitalOcean, Hetzner) | No application-layer DDoS mitigation; see incident-response-plan.md (emergency filtering) | [Date] (Phase 2) |
| 34 | Rate-limit authentication, APIs and expensive operations. | A.8.5, A.8.6 | ECC Defense: web application security | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | apps/api/src/common/auth/rate-limit.guard.ts; fail-closed on auth routes, per-email login limit and account lockout (feat/security-iso) | Deploy; tune limits from logs | [Date] (Phase 1) |
| 35 | Use bot/abuse controls where appropriate. | A.8.16, A.8.26 | ECC Defense: web application security | [Engineering lead] | Planned | Trust module (KYC, fraud scoring) exists in apps/api/src/modules/trust | No CAPTCHA/bot challenge on signup (roadmap: Turnstile or similar) | [Date] (Phase 2) |
| 36 | Block malicious traffic and suspicious sources according to risk. | A.8.20, A.8.16 | ECC Defense: network security | [Operations lead] | Planned | fail2ban on SSH (feat/security-iso) | No IP denylist at the edge; add with the WAF/edge decision | [Date] (Phase 2) |
| 37 | Maintain an emergency traffic-filtering procedure. | A.5.26, A.8.20 | ECC Defense: incident and threat management | [Operations lead] | Policy written — operate & evidence | docs/security/incident-response-plan.md (playbook: emergency traffic filtering) | Rehearse in the first tabletop | [Date] (Phase 2) |

## 6. Application & API Security

| ID | Requirement | ISO 27001:2022 | NCA | Owner | Status | Evidence | Gap / next action | Target |
|---|---|---|---|---|---|---|---|---|
| 38 | Adopt a secure software development lifecycle (SSDLC). | A.8.25, A.8.26, A.8.28 | ECC Governance: cybersecurity in projects; web application security | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | docs/security/secure-development-lifecycle.md; .github/workflows/security.yml (CodeQL, gitleaks, dependency review, pnpm audit, govulncheck, Trivy) | Owner must enable branch protection and required checks | [Date] (Phase 1) |
| 39 | Perform threat modeling for critical applications and architecture changes. | A.8.27, A.5.8 | ECC Governance: cybersecurity in projects | [Security owner] | Policy written — operate & evidence | docs/security/threat-model.md | Re-run for each architecture change (change-management.md) | [Date] (Phase 1) |
| 40 | Use secure authentication, authorization and session management. | A.8.5, A.8.26 | ECC Defense: identity and access management; web application security | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | argon2id, revocable sessions, dummy hash against user enumeration, login audit, lockout (feat/security-iso) | Residual: console token in browser storage (mitigated by CSP); consider HttpOnly cookie sessions | [Date] (Phase 2) |
| 41 | Validate input and encode output to prevent injection/XSS classes of attacks. | A.8.28, A.8.26 | ECC Defense: web application security | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | Global validation with forbidNonWhitelisted, env DTO validation, raw SQL hardening, docs markdown sanitising (feat/security-iso) | Add CodeQL findings to triage | [Date] (Phase 1) |
| 42 | Protect APIs with authentication, authorization, rate limits and schema validation. | A.8.26, A.8.5 | ECC Defense: web application security | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | Auth guard, scopes, rate limits fail-closed, OpenAPI spec (packages/openapi), DTO validation | Contract tests against the OpenAPI schema | [Date] (Phase 1) |
| 43 | Use CSRF protections where applicable. | A.8.26 | ECC Defense: web application security | [Engineering lead] | Implemented | Bearer tokens (no ambient cookies) for /v1 and /admin; ops cookie accepted on GET only (docs/devops-console.md) | Keep the GET-only cookie rule under code review | [Date] (Phase 1) |
| 44 | Do not expose internal errors, secrets or stack traces to users. | A.8.26, A.8.28 | ECC Defense: web application security | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | Swagger off in production, security headers, error filter (feat/security-iso) | Verify with an external scan after deploy | [Date] (Phase 1) |
| 45 | Conduct independent penetration testing before major launch and periodically. | A.8.29, A.5.35 | ECC Defense: penetration testing | [Security owner] | Planned | docs/security/vulnerability-and-patch-management.md §6 (pen test programme) | Independent penetration test before general availability, then yearly | [Date] (Phase 4) |

## 7. AI App Builder / Workload Isolation

| ID | Requirement | ISO 27001:2022 | NCA | Owner | Status | Evidence | Gap / next action | Target |
|---|---|---|---|---|---|---|---|---|
| 46 | Treat AI-generated code as untrusted until scanned and validated. | A.8.25, A.8.29 | CCC Defense; ECC Defense: web application security | [Engineering lead] | Partial | Connect: approvals for mutating tools, SSRF guard, secret redaction (docs/connect.md); App Platform build hardening (feat/security-iso) | Customer image/code scanning on App Platform is on the roadmap | [Date] (Phase 3) |
| 47 | Execute generated applications in isolated containers/sandboxes. | A.8.22, A.8.27 | CCC Defense: tenant isolation | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | App Platform: per-app Docker networks, cap-drop ALL, no-new-privileges, pids limit, optional gVisor, userns-remap on new hosts (feat/security-iso); one KVM VM per server | Enable gVisor by default once tested | [Date] (Phase 3) |
| 48 | Apply CPU, memory, process, filesystem and execution-time limits. | A.8.6 | CCC Defense: tenant isolation | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | pids, log and ulimit limits, build CPU/memory limits, 15 min build timeout (feat/security-iso) | Run-time CPU quotas per plan | [Date] (Phase 3) |
| 49 | Prevent generated workloads from reaching internal management networks. | A.8.22 | CCC Defense: tenant isolation | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | DOCKER-USER rules drop traffic to private ranges; app agent bound to the private interface (feat/security-iso) | Verify on a real app host | [Date] (Phase 3) |
| 50 | Block access to cloud metadata services from customer workloads. | A.8.22 | CCC Defense: tenant isolation | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | App Platform blocks 169.254.0.0/16 (feat/security-iso); no metadata service on Proxmox | — | [Date] (Phase 3) |
| 51 | Use per-tenant namespaces/projects/accounts where architecture supports it. | A.8.22, A.8.3 | CCC Defense: tenant isolation | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | Per-app networks (feat/security-iso); per-tenant VMs for servers, databases and Kubernetes | App Platform hosts remain shared between tenants (see risk register) | [Date] (Phase 3) |
| 52 | Scan generated code, dependencies, images and infrastructure definitions. | A.8.8, A.8.29 | ECC Defense: vulnerability management | [Engineering lead] | Partial | Trivy on platform images (deploy.yml); FROM of other tenants' images rejected (feat/security-iso) | Customer image and dependency scanning on App Platform is on the roadmap | [Date] (Phase 3) |
| 53 | Use a controlled deployment pipeline rather than direct AI-to-production execution. | A.8.32, A.8.31 | ECC Governance: cybersecurity in projects | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | Deploy pipeline hardening: fork-PR guard, tag validation, pinned host key, provenance (feat/security-iso); Connect actions go through approvals | — | [Date] (Phase 3) |
| 54 | Log AI deployment actions and customer-triggered infrastructure changes. | A.8.15 | ECC Defense: event logs and monitoring | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | Audit interceptor; git token redaction in build logs (feat/security-iso); Connect run steps and approvals | — | [Date] (Phase 3) |

## 8. Data Protection & Cryptography

| ID | Requirement | ISO 27001:2022 | NCA | Owner | Status | Evidence | Gap / next action | Target |
|---|---|---|---|---|---|---|---|---|
| 55 | Encrypt sensitive data in transit using modern TLS configurations. | A.8.24, A.5.14 | ECC Defense: cryptography; DCC | [Engineering lead] | Partial | Caddy TLS (Let's Encrypt), HSTS; WireGuard for control plane to nodes | Platform agents on port 9009 speak HTTP on the private network; NATS plain inside WireGuard; add TLS to the agent channel | [Date] (Phase 2) |
| 56 | Encrypt databases, disks, object storage and backups at rest. | A.8.24, A.8.13 | ECC Defense: cryptography; DCC | [Operations lead] | Partial | Backups encrypted with age before leaving the host (feat/security-iso); sensitive fields sealed with AES-256-GCM (common/crypto/secretbox.ts) | No full disk encryption on the droplet or Proxmox storage (planned); see cryptography-policy.md | [Date] (Phase 2) |
| 57 | Use managed KMS/HSM-backed key management where appropriate. | A.8.24 | ECC Defense: cryptography | [Security owner] | Partial | Keyring with key ids (feat/security-iso); key-management.md | Keys live in the environment file; Vault Transit or a KMS is on the roadmap | [Date] (Phase 3) |
| 58 | Separate encryption keys from the data they protect. | A.8.24 | ECC Defense: cryptography | [Security owner] | Implemented on feat/security-iso (pending deploy) | HKDF sub-keys; SECRETS_KEY required and separate from JWT_SECRET (feat/security-iso); age private key held off the host | Document custody of the age private key (key-management.md) | [Date] (Phase 1) |
| 59 | Define key generation, storage, rotation, revocation and destruction procedures. | A.8.24 | ECC Defense: cryptography | [Security owner] | Implemented on feat/security-iso (pending deploy) | Key ids and reseal script (feat/security-iso); key-management.md; docs/security/cryptography-policy.md | First rotation exercise to be recorded | [Date] (Phase 2) |
| 60 | Classify data and define handling rules. | A.5.12, A.5.13 | DCC: data classification; ECC Defense: data protection | [Privacy lead] | Policy written — operate & evidence | docs/security/data-classification-and-handling.md | Train staff; label exports | [Date] (Phase 1) |
| 61 | Minimize collection and retention of customer data. | A.5.34, A.8.10 | DCC; PDPL | [Privacy lead] | Implemented on feat/security-iso (pending deploy) | Retention purge jobs (audit archive, webhook deliveries, Connect runs, sessions) (feat/security-iso); docs/security/data-retention-and-deletion.md | Jobs for some categories still pending (see retention table) | [Date] (Phase 2) |
| 62 | Securely delete data at end of retention or contract requirements. | A.8.10, A.7.14 | DCC: secure data disposal | [Privacy lead] | Implemented on feat/security-iso (pending deploy) | Account deletion/anonymisation endpoint (feat/security-iso); docs/security/physical-and-shared-responsibility.md (media sanitisation) | Backups expire on schedule; document certificate of deletion process | [Date] (Phase 2) |

## 9. Secrets & Credential Security

| ID | Requirement | ISO 27001:2022 | NCA | Owner | Status | Evidence | Gap / next action | Target |
|---|---|---|---|---|---|---|---|---|
| 63 | Use a dedicated secrets manager/vault. | A.5.17, A.8.24 | ECC Defense: identity and access management | [Operations lead] | Partial | Ansible vault for host secrets; Vault/Infisical adapters for managed-asset secrets (docs/devops-console.md) | Production secrets are rendered into /etc/prgd/prgd.env; move to OpenBao/Vault with agent templates (docs/hosting.md, phase 1) | [Date] (Phase 3) |
| 64 | Never hard-code production secrets in source code or images. | A.8.28, A.5.17 | ECC Defense: secure configuration | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | Production config refuses weak/default secrets (apps/api/src/config/config.ts, feat/security-iso); gitleaks | — | [Date] (Phase 1) |
| 65 | Scan repositories and CI/CD pipelines for leaked secrets. | A.8.28, A.8.12 | ECC Defense: vulnerability management | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | .gitleaks.toml; gitleaks job in .github/workflows/security.yml | Enable GitHub secret scanning and push protection in repository settings | [Date] (Phase 1) |
| 66 | Rotate high-risk credentials automatically where practical. | A.5.17 | ECC Defense: identity and access management | [Operations lead] | Partial | Heartbeat and gateway tokens rotatable; offboarding opens rotate-credential tickets | No automatic rotation of database, NATS or provider API credentials; see key-management.md | [Date] (Phase 3) |
| 67 | Use short-lived credentials instead of permanent credentials where possible. | A.5.17, A.8.5 | ECC Defense: identity and access management | [Operations lead] | Partial | Short-lived SSH certificates for managed assets; GitHub App installation tokens; one-time gateway tokens | CI deploy uses a long-lived SSH key; provider API tokens are long-lived | [Date] (Phase 2) |
| 68 | Restrict which workloads can retrieve each secret. | A.8.3, A.5.15 | ECC Defense: identity and access management | [Engineering lead] | Partial | Gateway gets only its own settings (compose); constant-time secret compare in agents (feat/security-iso) | API and worker read the whole prgd.env; split per service | [Date] (Phase 3) |
| 69 | Audit secret access and investigate anomalous retrieval. | A.8.15, A.8.16 | ECC Defense: event logs and monitoring | [Security owner] | Implemented on feat/security-iso (pending deploy) | ops.secret_resolved audit events; audit of credential views (feat/security-iso) | Alert on unusual credential views once SIEM exists | [Date] (Phase 3) |

## 10. Secure Infrastructure & Containers

| ID | Requirement | ISO 27001:2022 | NCA | Owner | Status | Evidence | Gap / next action | Target |
|---|---|---|---|---|---|---|---|---|
| 70 | Harden OS images using recognized security baselines. | A.8.9 | ECC Defense: information system protection | [Operations lead] | Implemented on feat/security-iso (pending deploy) | Baseline hardening role (sysctl, auditd, chrony, unattended-upgrades, fail2ban, sshd); infra-hardening.md | Measure against a CIS benchmark and record deviations | [Date] (Phase 2) |
| 71 | Remove unnecessary services, packages and open ports. | A.8.9, A.8.19 | ECC Defense: information system protection | [Operations lead] | Implemented on feat/security-iso (pending deploy) | Baseline role removes unneeded services; ufw default deny | Quarterly open port review (external scan) | [Date] (Phase 2) |
| 72 | Keep operating systems, runtimes and container engines patched. | A.8.8, A.8.19 | ECC Defense: vulnerability management | [Operations lead] | Implemented on feat/security-iso (pending deploy) | unattended-upgrades for security updates (baseline role); infra/ansible/maintenance/patching.yml | Weekly rebuild of platform images is on the roadmap | [Date] (Phase 2) |
| 73 | Use signed/trusted container images where practical. | A.8.21, A.5.21 | ECC Defense: information system protection | [Engineering lead] | Partial | Build provenance attestation (deploy.yml, actions/attest-build-provenance) | Image signing with cosign and verification at deploy is on the roadmap | [Date] (Phase 3) |
| 74 | Scan container images for known vulnerabilities. | A.8.8 | ECC Defense: vulnerability management | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | Trivy image scan blocks critical findings (deploy.yml) | — | [Date] (Phase 2) |
| 75 | Run containers as non-root wherever possible. | A.8.9 | CCC Defense | [Engineering lead] | Partial | First-party images run as non-root; hardening of third-party images (feat/security-iso) | Postgres, Temporal and Caddy images run with their default users | [Date] (Phase 2) |
| 76 | Use read-only filesystems and dropped Linux capabilities where practical. | A.8.9 | CCC Defense | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | no-new-privileges, cap_drop, read_only where safe (compose, feat/security-iso) | — | [Date] (Phase 2) |
| 77 | Apply resource limits to prevent noisy-neighbor/resource-exhaustion attacks. | A.8.6 | CCC Defense | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | Memory and pids limits (compose, feat/security-iso); per-VM quotas on Proxmox | — | [Date] (Phase 2) |
| 78 | Protect orchestration control planes and administrative APIs. | A.8.2, A.8.22 | CCC Defense | [Operations lead] | Partial | Proxmox API only over WireGuard; Proxmox TLS pinning option (feat/security-iso); NATS token | Per-node NATS credentials are on the roadmap | [Date] (Phase 3) |

## 11. DevSecOps & Supply Chain

| ID | Requirement | ISO 27001:2022 | NCA | Owner | Status | Evidence | Gap / next action | Target |
|---|---|---|---|---|---|---|---|---|
| 79 | Require code review for production changes. | A.8.32, A.8.4 | ECC Governance: cybersecurity in projects | [Engineering lead] | Partial | .github/CODEOWNERS (feat/security-iso); docs/security/secure-development-lifecycle.md §5 | Owner must enable branch protection with required review; a second reviewer is needed for a real four-eyes check | [Date] (Phase 1) |
| 80 | Run SAST on application code. | A.8.28, A.8.29 | ECC Defense: web application security | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | CodeQL job (.github/workflows/security.yml) | Triage alerts weekly | [Date] (Phase 1) |
| 81 | Run dependency/SCA scanning. | A.8.8, A.5.21 | ECC Defense: vulnerability management | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | .github/dependabot.yml; dependency review, pnpm audit, govulncheck (security.yml) | — | [Date] (Phase 1) |
| 82 | Run secret scanning. | A.8.12, A.8.28 | ECC Defense: vulnerability management | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | gitleaks (security.yml) | — | [Date] (Phase 1) |
| 83 | Scan infrastructure-as-code for security misconfiguration. | A.8.9, A.8.29 | ECC Defense: secure configuration | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | Trivy config scan of the repository (security.yml, iac job) | Add Ansible-specific checks if Trivy coverage is not enough | [Date] (Phase 2) |
| 84 | Scan container images before deployment. | A.8.8, A.8.29 | ECC Defense: vulnerability management | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | Trivy before deploy (deploy.yml) | — | [Date] (Phase 2) |
| 85 | Separate development, staging and production environments. | A.8.31 | ECC Governance: cybersecurity in projects | [Engineering lead] | Partial | Development (local, CI) and production are separate; demo box | No staging environment; plan one before external customers | [Date] (Phase 3) |
| 86 | Protect CI/CD credentials and runners. | A.8.2, A.8.4, A.5.17 | ECC Defense: identity and access management | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | Deploy workflow: fork-PR guard, per-job permissions, no third-party action holds the SSH key, pinned host key, tag validation, forced-command deploy user (feat/security-iso) | Use a GitHub environment with required reviewers for production | [Date] (Phase 1) |
| 87 | Maintain dependency/build provenance where practical. | A.5.21, A.8.25 | ECC Third-party & cloud; supply chain | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | SBOM and build provenance attestation (deploy.yml) | Verify attestations at deploy | [Date] (Phase 3) |
| 88 | Use change approvals for high-risk production modifications. | A.8.32 | ECC Governance: change management | [Engineering lead] | Policy written — operate & evidence | docs/security/change-management.md | Owner to set required reviewers on the production environment | [Date] (Phase 1) |

## 12. Vulnerability & Patch Management

| ID | Requirement | ISO 27001:2022 | NCA | Owner | Status | Evidence | Gap / next action | Target |
|---|---|---|---|---|---|---|---|---|
| 89 | Continuously or regularly scan internet-facing assets. | A.8.8 | ECC Defense: vulnerability management | [Operations lead] | Partial | Weekly scheduled code, dependency and IaC scan (security.yml) | No scan of the internet-facing hosts yet: add a scheduled external scan (TLS, ports, headers) | [Date] (Phase 2) |
| 90 | Maintain an authoritative asset inventory. | A.5.9 | ECC Defense: asset management | [Security owner] | Policy written — operate & evidence | docs/security/asset-register.csv | Reconcile quarterly | [Date] (Phase 1) |
| 91 | Prioritize vulnerabilities using severity plus business exposure. | A.8.8 | ECC Defense: vulnerability management | [Security owner] | Policy written — operate & evidence | docs/security/vulnerability-and-patch-management.md §4 | — | [Date] (Phase 1) |
| 92 | Define remediation SLAs for critical/high/medium findings. | A.8.8 | ECC Defense: vulnerability management | [Security owner] | Policy written — operate & evidence | docs/security/vulnerability-and-patch-management.md §5 (Critical 7d, High 30d, Medium 90d, Low 180d) | Start measuring against SLA | [Date] (Phase 1) |
| 93 | Track exceptions with owner, justification and expiry date. | A.8.8 | ECC Defense: vulnerability management | [Security owner] | Policy written — operate & evidence | docs/security/vulnerability-and-patch-management.md §7; .trivyignore entries need owner and expiry | Exception log in evidence/12-vulnerability | [Date] (Phase 1) |
| 94 | Verify remediation after patches. | A.8.8, A.8.29 | ECC Defense: vulnerability management | [Operations lead] | Policy written — operate & evidence | docs/security/vulnerability-and-patch-management.md §8 | — | [Date] (Phase 2) |
| 95 | Perform authenticated infrastructure scanning where practical. | A.8.8 | ECC Defense: vulnerability management | [Operations lead] | Planned | docs/security/vulnerability-and-patch-management.md §3 | Authenticated host scanning (e.g. OpenSCAP or Trivy on the host) not set up | [Date] (Phase 3) |
| 96 | Monitor newly disclosed vulnerabilities affecting your technology stack. | A.5.7, A.8.8 | ECC Defense: vulnerability management; incident and threat management | [Security owner] | Implemented on feat/security-iso (pending deploy) | Dependabot; SECURITY.md; /.well-known/security.txt (feat/security-iso) | Subscribe to advisories for Proxmox, Ceph, Caddy, NATS, Temporal, Postgres | [Date] (Phase 1) |

## 13. Logging, Monitoring & SIEM

| ID | Requirement | ISO 27001:2022 | NCA | Owner | Status | Evidence | Gap / next action | Target |
|---|---|---|---|---|---|---|---|---|
| 97 | Centralize security-relevant logs. | A.8.15 | ECC Defense: event logs and monitoring | [Operations lead] | Partial | JSON access logs, Docker log limits (feat/security-iso); audit table in Postgres | No central log store (Loki or SIEM) yet | [Date] (Phase 2) |
| 98 | Log authentication, authorization and privileged actions. | A.8.15 | ECC Defense: event logs and monitoring | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | Login success and failure, ops failures, audit interceptor (feat/security-iso) | — | [Date] (Phase 1) |
| 99 | Log security configuration and infrastructure changes. | A.8.15, A.8.9 | ECC Defense: event logs and monitoring | [Operations lead] | Implemented on feat/security-iso (pending deploy) | auditd watches (baseline role); deploys logged (feat/security-iso) | Ship auditd logs off the host | [Date] (Phase 2) |
| 100 | Log important customer/platform actions such as deployment and deletion. | A.8.15 | ECC Defense: event logs and monitoring | [Engineering lead] | Implemented | Audit events for resource create/delete and deploys (apps/api/src/modules/events) | — | [Date] (Phase 1) |
| 101 | Synchronize system clocks using trusted time sources. | A.8.17 | ECC Defense: event logs and monitoring | [Operations lead] | Implemented on feat/security-iso (pending deploy) | chrony in the baseline role | — | [Date] (Phase 1) |
| 102 | Protect logs from unauthorized alteration/deletion. | A.8.15 | ECC Defense: event logs and monitoring | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | Append-only trigger and hash chain on the audit table (feat/security-iso) | Copy audit exports off the host | [Date] (Phase 2) |
| 103 | Define log retention periods by use case and regulatory need. | A.8.15, A.5.33 | ECC Defense: event logs and monitoring | [Privacy lead] | Implemented on feat/security-iso (pending deploy) | Retention jobs (feat/security-iso); docs/security/logging-and-monitoring-policy.md §5 | Host and Caddy log retention depend on Docker rotation until central logging exists | [Date] (Phase 2) |
| 104 | Send high-value events to a SIEM or equivalent security monitoring system. | A.8.16 | ECC Defense: event logs and monitoring | [Operations lead] | Planned | docs/security/logging-and-monitoring-policy.md §7 | No SIEM; roadmap: Loki + Grafana alerting, later a managed SIEM | [Date] (Phase 2) |
| 105 | Create alerts for brute force, privilege escalation, unusual data access and anomalous infrastructure activity. | A.8.16 | ECC Defense: event logs and monitoring | [Operations lead] | Partial | Account lockout and security events (feat/security-iso); alert rules defined in logging-and-monitoring-policy.md §6 | Alert delivery not built until central logging exists | [Date] (Phase 2) |

## 14. Incident Response

| ID | Requirement | ISO 27001:2022 | NCA | Owner | Status | Evidence | Gap / next action | Target |
|---|---|---|---|---|---|---|---|---|
| 106 | Maintain a documented incident-response plan. | A.5.24 | ECC Defense: incident and threat management | [Security owner] | Policy written — operate & evidence | docs/security/incident-response-plan.md | Approve and distribute | [Date] (Phase 1) |
| 107 | Define severity levels, escalation paths and decision authority. | A.5.24, A.5.25 | ECC Defense: incident and threat management | [Security owner] | Policy written — operate & evidence | docs/security/incident-response-plan.md §3-4 | — | [Date] (Phase 1) |
| 108 | Maintain 24/7 or risk-appropriate incident contact procedures. | A.5.24, A.6.8 | ECC Defense: incident and threat management | [Operations lead] | Policy written — operate & evidence | docs/security/incident-response-plan.md §5 (24/7 contact placeholder); on-call paging (docs/managed-cloud-operations.md) | Name the security on-call rota and publish the number | [Date] (Phase 1) |
| 109 | Define containment, eradication, recovery and evidence-preservation steps. | A.5.26, A.5.28 | ECC Defense: incident and threat management | [Security owner] | Policy written — operate & evidence | docs/security/incident-response-plan.md §6-7 | — | [Date] (Phase 1) |
| 110 | Maintain customer/regulatory notification procedures. | A.5.24, A.5.26, A.5.5 | ECC Defense: incident and threat management; PDPL | [Privacy lead] | Policy written — operate & evidence | docs/security/incident-response-plan.md §8 (72h customer notice per DPA; GDPR, SDAIA/PDPL, NCA — legal review needed) | Legal review of regulator notification duties | [Date] (Phase 1) |
| 111 | Run tabletop incident exercises. | A.5.24, A.5.27 | ECC Defense: incident and threat management | [Security owner] | Policy written — operate & evidence | docs/security/incident-response-plan.md §11 (tabletop schedule) | First tabletop not held | [Date] (Phase 4) |
| 112 | Perform root-cause analysis and corrective actions after material incidents. | A.5.27 | ECC Defense: incident and threat management | [Security owner] | Policy written — operate & evidence | Managed P1 postmortems (docs/devops-console.md); docs/security/incident-response-plan.md §9 | Apply the same postmortem rule to platform incidents | [Date] (Phase 1) |
| 113 | Maintain an incident register and evidence. | A.5.24, A.5.28 | ECC Defense: incident and threat management | [Security owner] | Policy written — operate & evidence | docs/security/incident-response-plan.md §10; evidence/14-incident-response/incident-register.csv | Start the register | [Date] (Phase 1) |

## 15. Backup, DR & Business Continuity

| ID | Requirement | ISO 27001:2022 | NCA | Owner | Status | Evidence | Gap / next action | Target |
|---|---|---|---|---|---|---|---|---|
| 114 | Define RPO/RTO for each critical service. | A.5.30 | ECC Resilience: business continuity | [Operations lead] | Policy written — operate & evidence | docs/security/business-continuity-and-dr.md §3 | Owner to approve targets | [Date] (Phase 1) |
| 115 | Back up critical databases and configuration. | A.8.13 | ECC Defense: backup and recovery | [Operations lead] | Partial | Nightly pg_dumpall of all databases and WAL archive (infra/prod/backup.sh, docker-compose.yml) | Copies stay on the same host until off-site storage is configured; no backup of /etc/prgd or Caddy data | [Date] (Phase 1) |
| 116 | Encrypt backups. | A.8.13, A.8.24 | ECC Defense: backup and recovery; cryptography | [Operations lead] | Implemented on feat/security-iso (pending deploy) | age encryption before upload (feat/security-iso) | Configure the recipient key in production | [Date] (Phase 1) |
| 117 | Keep backups logically separated from production. | A.8.13 | ECC Defense: backup and recovery | [Operations lead] | Partial | Off-site copy via rclone to BACKUP_S3_URL (supported, not configured in production) | Configure off-site storage at a second provider or region | [Date] (Phase 1) |
| 118 | Use immutable or otherwise protected backups for critical systems. | A.8.13 | ECC Defense: backup and recovery | [Operations lead] | Planned | docs/security/business-continuity-and-dr.md §5 (object lock / append-only target) | Choose a target with object lock or append-only credentials | [Date] (Phase 2) |
| 119 | Test restoration regularly. | A.8.13, A.5.30 | ECC Defense: backup and recovery | [Operations lead] | Policy written — operate & evidence | docs/security/business-continuity-and-dr.md §6 (monthly restore test) | No restore has been tested yet | [Date] (Phase 1) |
| 120 | Document disaster-recovery runbooks. | A.5.30, A.5.37 | ECC Resilience: business continuity | [Operations lead] | Policy written — operate & evidence | docs/security/business-continuity-and-dr.md §7 (runbooks); docs/hosting.md (restore) | — | [Date] (Phase 1) |
| 121 | Test failover/recovery scenarios and record results. | A.5.30 | ECC Resilience: business continuity | [Operations lead] | Policy written — operate & evidence | docs/security/business-continuity-and-dr.md §8 | First DR exercise not held | [Date] (Phase 4) |
| 122 | Maintain business-continuity plans for critical people, suppliers and infrastructure. | A.5.29, A.5.30 | ECC Resilience: business continuity | [Management] | Policy written — operate & evidence | docs/security/business-continuity-and-dr.md §9 (people, suppliers, infrastructure) | Key person dependency: the owner | [Date] (Phase 2) |

## 16. Third-Party & Supplier Security

| ID | Requirement | ISO 27001:2022 | NCA | Owner | Status | Evidence | Gap / next action | Target |
|---|---|---|---|---|---|---|---|---|
| 123 | Maintain a supplier/vendor register. | A.5.19 | ECC Third-party & cloud: third-party cybersecurity | [Security owner] | Policy written — operate & evidence | docs/security/supplier-register.csv | — | [Date] (Phase 1) |
| 124 | Classify suppliers by security and business criticality. | A.5.19 | ECC Third-party & cloud: third-party cybersecurity | [Security owner] | Policy written — operate & evidence | docs/security/supplier-register.csv (criticality column); supplier-security-policy.md §3 | — | [Date] (Phase 1) |
| 125 | Assess security posture before onboarding critical suppliers. | A.5.19, A.5.21 | ECC Third-party & cloud: third-party cybersecurity | [Security owner] | Policy written — operate & evidence | docs/security/supplier-security-policy.md §4 | Retroactive assessment of existing critical suppliers | [Date] (Phase 2) |
| 126 | Review certifications/reports such as ISO 27001 or SOC reports where available. | A.5.19, A.5.22 | ECC Third-party & cloud: third-party cybersecurity | [Security owner] | Policy written — operate & evidence | docs/security/supplier-security-policy.md §4; supplier-register.csv (certifications to obtain) | Download and file each provider's reports | [Date] (Phase 2) |
| 127 | Define security, confidentiality, incident-notification and data-handling requirements contractually. | A.5.20 | ECC Third-party & cloud: third-party cybersecurity | [Privacy lead] | Partial | Provider standard terms and DPAs accepted at signup (not yet filed) | File signed/accepted DPAs per supplier; check incident-notice terms | [Date] (Phase 1) |
| 128 | Track sub-processors and material changes. | A.5.22, A.5.34 | ECC Third-party & cloud; PDPL | [Privacy lead] | Implemented on feat/security-iso (pending deploy) | apps/www/content/pages/*/subprocessors.md (Postmark and Infisical added on feat/security-iso) | Keep in step with the supplier register | [Date] (Phase 1) |
| 129 | Review critical suppliers periodically. | A.5.22 | ECC Third-party & cloud: third-party cybersecurity | [Security owner] | Policy written — operate & evidence | docs/security/supplier-security-policy.md §6 (yearly review) | — | [Date] (Phase 2) |
| 130 | Maintain exit/portability plans for critical providers. | A.5.23, A.5.30 | ECC Third-party & cloud: cloud computing and hosting | [Management] | Policy written — operate & evidence | docs/security/supplier-security-policy.md §8 (exit plans) | Test the control plane rebuild on another provider | [Date] (Phase 3) |

## 17. Privacy, Data Lifecycle & Tenant Isolation

| ID | Requirement | ISO 27001:2022 | NCA | Owner | Status | Evidence | Gap / next action | Target |
|---|---|---|---|---|---|---|---|---|
| 131 | Define data ownership and processing responsibilities. | A.5.34, A.5.31 | DCC; PDPL | [Privacy lead] | Implemented | Privacy policy, DPA, subprocessor list of Progrid Arabia, the only contracting entity (apps/www/content/pages/sa and pages/shared); docs/legal.md | Placeholders for representatives and registrations remain | [Date] (Phase 1) |
| 132 | Maintain data-flow diagrams for sensitive information. | A.5.34, A.5.14 | DCC | [Privacy lead] | Policy written — operate & evidence | docs/security/threat-model.md §2 (data flows); data-classification-and-handling.md | Review on each new integration | [Date] (Phase 1) |
| 133 | Enforce logical tenant isolation at application, database and infrastructure layers as appropriate. | A.8.3, A.8.22 | CCC Defense: tenant isolation | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | Authorization fixes R1-R8 (SSH key scopes, project-scoped tokens in deploy/snapshots/alerts, approval escalation, SSE auth, firewall detach, non-public images) (feat/security-iso) | — | [Date] (Phase 1) |
| 134 | Prevent insecure direct object references and cross-tenant authorization failures. | A.8.3, A.8.26 | ECC Defense: web application security | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | Project and team scoping in services; fixes R1-R8 (feat/security-iso) | — | [Date] (Phase 1) |
| 135 | Define retention and deletion schedules. | A.5.33, A.8.10 | DCC; PDPL | [Privacy lead] | Implemented on feat/security-iso (pending deploy) | Purge jobs (feat/security-iso); docs/security/data-retention-and-deletion.md | Categories still without a job are listed there | [Date] (Phase 2) |
| 136 | Secure exports, downloads and support access. | A.5.14, A.8.3 | DCC; ECC Defense: data protection | [Privacy lead] | Partial | Ops masking mappers, recordings via 5-min URLs (docs/devops-console.md); user erasure (feat/security-iso) | Self-service account export is on the roadmap | [Date] (Phase 3) |
| 137 | Restrict employee access to customer data and log support access. | A.8.3, A.8.11, A.8.15 | DCC; ECC Defense: data protection | [Privacy lead] | Implemented on feat/security-iso (pending deploy) | Ops data masking; staff reads audited by the audit interceptor (feat/security-iso) | Quarterly review of staff reads | [Date] (Phase 2) |
| 138 | Perform tests specifically designed to detect cross-tenant data leakage. | A.8.29, A.8.3 | CCC Defense: tenant isolation | [Engineering lead] | Implemented on feat/security-iso (pending deploy) | Tenant isolation test suite in the integration tests (feat/security-iso) | Add to the pen test scope | [Date] (Phase 2) |

## 18. Physical & Data Center Security

| ID | Requirement | ISO 27001:2022 | NCA | Owner | Status | Evidence | Gap / next action | Target |
|---|---|---|---|---|---|---|---|---|
| 139 | Use reputable data centers with appropriate physical/security controls. | A.7.1-7.5, A.5.23 | ECC Defense: physical security; CCC | [Security owner] | Partial | DigitalOcean FRA1 and Hetzner Falkenstein data centres | Provider certificates to verify and file | [Date] (Phase 1) |
| 140 | Obtain and retain provider security/certification evidence. | A.5.19, A.5.22 | ECC Third-party & cloud | [Security owner] | Policy written — operate & evidence | docs/security/physical-and-shared-responsibility.md §3; evidence/18-physical | Download and file the provider certificates and reports | [Date] (Phase 1) |
| 141 | Understand physical security, power, cooling, fire protection and redundancy. | A.7.5, A.7.11 | ECC Defense: physical security | [Security owner] | Policy written — operate & evidence | docs/security/physical-and-shared-responsibility.md §3 | Record provider statements on power, cooling, fire | [Date] (Phase 2) |
| 142 | Document shared-responsibility boundaries with infrastructure providers. | A.5.23 | ECC Third-party & cloud: cloud computing and hosting | [Security owner] | Policy written — operate & evidence | docs/security/physical-and-shared-responsibility.md §2 | — | [Date] (Phase 1) |
| 143 | Control physical access to company-owned equipment. | A.7.9, A.8.1, A.7.7 | ECC Defense: physical security | [People owner] | Policy written — operate & evidence | docs/security/physical-and-shared-responsibility.md §5; people-security.md | Inventory company laptops (if any) | [Date] (Phase 2) |
| 144 | Secure retired storage media through approved destruction/erasure processes. | A.7.10, A.7.14, A.8.10 | DCC: secure data disposal | [Operations lead] | Policy written — operate & evidence | docs/security/physical-and-shared-responsibility.md §4 (Hetzner server decommissioning) | — | [Date] (Phase 2) |

## 19. People Security & Awareness

| ID | Requirement | ISO 27001:2022 | NCA | Owner | Status | Evidence | Gap / next action | Target |
|---|---|---|---|---|---|---|---|---|
| 145 | Perform appropriate pre-employment screening consistent with law and role risk. | A.6.1 | ECC Governance: cybersecurity in human resources | [People owner] | Policy written — operate & evidence | docs/security/people-security.md §2 | Legal check of screening in each contractor country | [Date] (Phase 2) |
| 146 | Require confidentiality obligations. | A.6.2, A.6.6 | ECC Governance: cybersecurity in human resources | [People owner] | Policy written — operate & evidence | docs/security/people-security.md §3 | Collect signed NDAs / contracts for every person with access | [Date] (Phase 1) |
| 147 | Provide security awareness training at onboarding and periodically. | A.6.3 | ECC Governance: awareness and training | [People owner] | Policy written — operate & evidence | docs/security/people-security.md §5 | Run first training | [Date] (Phase 2) |
| 148 | Train privileged users on secure administration. | A.6.3, A.8.2 | ECC Governance: awareness and training | [Security owner] | Policy written — operate & evidence | docs/security/people-security.md §5 (privileged users) | — | [Date] (Phase 2) |
| 149 | Run phishing/security awareness exercises where appropriate. | A.6.3 | ECC Governance: awareness and training | [Security owner] | Planned | docs/security/people-security.md §5 | Phishing exercise once the team is more than a few people | [Date] (Phase 4) |
| 150 | Define acceptable use of company systems and customer data. | A.5.10, A.6.2 | ECC Governance: policies and procedures | [People owner] | Policy written — operate & evidence | docs/security/people-security.md §6 (acceptable use) | Acknowledgement by every person | [Date] (Phase 1) |
| 151 | Revoke access promptly on termination or role change. | A.6.5, A.5.18 | ECC Governance: cybersecurity in human resources | [Security owner] | Implemented on feat/security-iso (pending deploy) | Engineer offboarding; member/staff removal revokes tokens and sessions (feat/security-iso); people-security.md §4 checklist | Run the checklist for external SaaS accounts | [Date] (Phase 1) |
| 152 | Maintain a security contact/reporting mechanism for employees. | A.6.8 | ECC Defense: incident and threat management | [Security owner] | Implemented on feat/security-iso (pending deploy) | SECURITY.md and /.well-known/security.txt (security@progrid.co) (feat/security-iso); people-security.md §7 | Confirm the mailbox exists and is monitored | [Date] (Phase 1) |

## 20. Audit, Assurance & Continuous Improvement

| ID | Requirement | ISO 27001:2022 | NCA | Owner | Status | Evidence | Gap / next action | Target |
|---|---|---|---|---|---|---|---|---|
| 153 | Maintain an evidence repository mapped to policies and controls. | A.5.36; Cl. 7.5 | ECC Governance: periodic review and audit | [Security owner] | Policy written — operate & evidence | docs/security/evidence/README.md | Start filing evidence | [Date] (Phase 1) |
| 154 | Perform periodic internal ISMS audits. | Cl. 9.2 | ECC Governance: periodic review and audit | [Security owner] | Policy written — operate & evidence | docs/security/internal-audit-and-management-review.md §2 | Choose an auditor independent of the work audited | [Date] (Phase 4) |
| 155 | Track nonconformities and corrective actions. | Cl. 10.2 | ECC Governance: periodic review and audit | [Security owner] | Policy written — operate & evidence | docs/security/internal-audit-and-management-review.md §5 (CAPA log) | — | [Date] (Phase 1) |
| 156 | Conduct management reviews. | Cl. 9.3 | ECC Governance: strategy, management | [Management] | Policy written — operate & evidence | docs/security/internal-audit-and-management-review.md §4 | — | [Date] (Phase 4) |
| 157 | Perform periodic penetration tests and vulnerability assessments. | A.8.8, A.5.35 | ECC Defense: penetration testing; vulnerability management | [Security owner] | Planned | docs/security/vulnerability-and-patch-management.md §6 | Commission the first independent test | [Date] (Phase 4) |
| 158 | Review security metrics and trends. | Cl. 9.1 | ECC Governance: periodic review and audit | [Security owner] | Policy written — operate & evidence | docs/security/information-security-policy.md §4 (KPIs); internal-audit-and-management-review.md §3 | — | [Date] (Phase 2) |
| 159 | Reassess risk when major architecture, product or supplier changes occur. | Cl. 6.1, 8.2; A.5.8 | ECC Governance: risk management | [Security owner] | Policy written — operate & evidence | docs/security/risk-methodology.md §6 (triggers); change-management.md | — | [Date] (Phase 1) |
| 160 | Maintain certification/audit readiness continuously rather than only before an audit. | Cl. 9-10 | ECC Governance: periodic review and audit | [Security owner] | Policy written — operate & evidence | docs/security/internal-audit-and-management-review.md §6 (operating calendar) | Run the calendar for one full cycle before a certification audit | [Date] (Phase 5) |
