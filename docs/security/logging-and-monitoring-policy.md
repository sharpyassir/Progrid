# Logging and monitoring policy

| | |
|---|---|
| Document owner | [Operations lead — to be named] |
| Approved by | [Management — to be named], [Date] |
| Version | Draft, 6 October 2026 |
| Review | Yearly |
| ISO/IEC 27001:2022 | Annex A 8.15, 8.16, 8.17, 5.28 |
| NCA | ECC Defense domain (event logs and monitoring management) |
| Checklist | Controls 21, 54, 69, 97-105 |

## 1. Purpose

Record what happens on the platform so that attacks and mistakes can be detected, investigated
and proven, and protect those records.

## 2. Scope

API, worker, ops module and gateway, Caddy, databases, hosts (management host, Proxmox nodes),
CI/CD, and the admin logs of suppliers (GitHub, DigitalOcean, Hetzner, payment providers).

## 3. What is logged

| Source | Events | Where today |
|---|---|---|
| API audit log (`prgd_audit_logs`) | Every state-changing API call (non-GET) and every back-office read, with actor (user, token), team, action, resource, IP, user agent and status; sign in success and failure; token creation and revocation; staff and role changes; deploys; credential views (*feat/security-iso*) | Postgres, append-only with hash chain |
| Domain events | Resource lifecycle, billing, `managed.*`, `ops.*` (grants, sessions, secret resolutions with key names only, offboarding), Connect runs and approvals | Postgres (audit and domain tables) |
| Engineer terminal sessions | Full asciicast recordings, start/stop, host key | Recordings bucket, 12 months |
| Caddy access logs | Request line, status, latency, client IP, host (JSON, *branch*) | Docker JSON log on the host |
| Application logs | Errors, job results, retention counts | Docker JSON log on the host |
| Host logs | sshd, sudo, auditd watches on identity, SSH, sudoers, Docker and Progrid config files (*branch*), fail2ban, ufw | journald / `/var/log` on each host |
| Proxmox | Task log, API access, firewall log | Each node |
| CI/CD | Workflow runs, deploy job output, attestations | GitHub |
| Supplier admin logs | GitHub audit log, DigitalOcean and Hetzner account activity, Moyasar dashboard logs | Suppliers |

Never logged: passwords, full tokens, TOTP codes, secret values, card data, customer content
(redaction in Connect steps and build logs; sudo password redacted from recordings).

## 4. Time

All hosts synchronise with chrony to trusted NTP sources (baseline role, *branch*). Logs use UTC.

## 5. Retention

| Log | Retention | Enforcement |
|---|---|---|
| API audit log | 1 year (published); kept 400 days in the database, then archived to `AUDIT_ARCHIVE_BUCKET` and deleted | Retention job (see data-retention-and-deletion.md) |
| Session recordings | 12 months | Daily job |
| Caddy, application and host logs | 90 days target | **Today**: Docker rotation by size (20 MB x 5); journald defaults. Time-based retention arrives with central logging |
| Security incident evidence | 3 years after the incident closes, or longer under legal hold | Manual (evidence store) |
| CI logs | GitHub default (90 days) | GitHub |

## 6. Alert rules

Defined now; delivered once central logging exists (§7). Until then the Operations lead reviews
the sources weekly (§8).

| # | Rule | Source | Severity |
|---|---|---|---|
| A1 | ≥ 20 failed sign ins for one account in 10 minutes, or an account lockout | Audit log | Medium |
| A2 | ≥ 100 failed sign ins from one IP in 10 minutes (credential stuffing) | Audit log, Caddy | High |
| A3 | Staff role or `full_admin` granted; staff flag set; new admin-scope token | Audit log | High |
| A4 | Back-office read of more than 50 distinct teams by one staff member in an hour | Audit log | High |
| A5 | Credential view or `ops.secret_resolved` outside an active grant, or more than 10 in an hour | Audit log | High |
| A6 | Break-glass account used; root SSH login; new key in `authorized_keys` | Host auth logs, auditd | Critical |
| A7 | Change to `/etc/prgd`, `/etc/ssh`, sudoers, ufw or Docker config outside a change window | auditd | High |
| A8 | Audit hash chain verification fails | Chain verifier | Critical |
| A9 | Backup status not `ok` for 24 hours | Backup status file | High |
| A10 | Deploy not from the GitHub workflow (manual `deploy.sh` run) | Host log | Medium |
| A11 | Spike in 5xx or 429 at Caddy (possible DDoS) | Caddy logs | High |
| A12 | New Proxmox API token or user; firewall disabled on a node | Proxmox | Critical |
| A13 | Outbound SMTP or connection floods from a tenant VM (abuse) | Node firewall / metrics | Medium |
| A14 | GitHub: branch protection changed, new deploy key or Actions secret, new collaborator | GitHub audit log | High |

## 7. Central logging and SIEM (roadmap)

1. Phase 2: ship host, Caddy and application logs to a central Loki (or equivalent) outside the
   management host, with Grafana alerting for the rules above, routed to the on-call paging
   (`PAGING_MODE=live`).
2. Export audit log chain heads daily off the host so tampering with the database is detectable
   even if the host is compromised.
3. Later: a managed SIEM when the team or customer requirements justify it.

## 8. Review cadence

| Review | Frequency | By |
|---|---|---|
| Alerts | As they fire (once delivered) | On-call |
| Manual review of auth failures, staff actions, host auth logs, backup status | Weekly until alerts are automated | Operations lead |
| Sample of back-office reads and engineer recordings | Quarterly, in the access review | Security owner |
| Audit chain verification | Monthly run of the chain verifier (`verify-audit-chain`, *branch*), recorded; daily once scheduled | Security owner |
| Effectiveness of rules | Yearly and after incidents | Security owner |

## 9. Protection of logs

1. The audit table refuses UPDATE, DELETE and TRUNCATE except for the retention job (trigger) and
   each row is hash-chained.
2. Access to logs follows least privilege; customers see only their own team's audit log.
3. Logs used as incident evidence are copied, hashed (sha256) and stored under
   `evidence/14-incident-response/` with chain of custody (incident-response-plan.md §7).

## 10. Roles

Operations lead: log sources, retention, alerting. Engineering lead: application audit events.
Security owner: rules, reviews, chain verification.

## 11. Evidence produced

Audit log exports, weekly review notes, alert tickets, chain verification results, retention job
logs, central logging configuration once built.

## 12. Review cycle

Yearly.

## 13. Mapping

| Framework | Reference |
|---|---|
| ISO/IEC 27001:2022 | Annex A 8.15, 8.16, 8.17, 5.28, 8.2 |
| NCA ECC | Defense: event logs and monitoring management |
| Checklist | 21, 54, 69, 97-105 |
