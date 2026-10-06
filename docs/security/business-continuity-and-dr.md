# Business continuity and disaster recovery

| | |
|---|---|
| Document owner | [Operations lead — to be named] |
| Approved by | [Management — to be named], [Date] |
| Version | Draft, 6 October 2026 |
| Review | Yearly, after each DR exercise, and when the hosting phase changes |
| ISO/IEC 27001:2022 | Annex A 5.29, 5.30, 8.13, 8.14 |
| NCA | ECC Resilience domain (cybersecurity in business continuity); ECC Defense domain (backup and recovery management) |
| Checklist | Controls 114-122 |

## 1. Purpose

Keep the platform and the business running through failures and disasters, and recover within
agreed times with limited data loss.

## 2. Scope

The control plane on the management host, the data plane on Hetzner, the delivery pipeline,
critical suppliers and key people. Customer data inside customer servers is the customer's to
back up unless they use a Progrid backup feature or a managed contract.

## 3. Recovery objectives

RPO = maximum data loss; RTO = maximum time to restore service. "Now" is what the current
setup can achieve at best (nightly dump, same host, never tested); "Target" is what the planned
controls deliver. Targets need Management approval.

| Service | Criticality | RPO now | RPO target | RTO now | RTO target | What gets the target |
|---|---|---|---|---|---|---|
| Control plane database (accounts, billing, resources, audit) | Critical | 24 h (nightly dump); WAL archive on the same host gives less only if the host survives | 15 min | Unknown (never tested); estimated 8 h on a new droplet | 4 h | Off-site encrypted copies, pgBackRest with WAL archiving to object storage, streaming replica in phase 1, tested runbook |
| API, console, website, ops console, gateway | Critical | n/a (stateless; images in ghcr.io) | n/a | ~2 h with a working runbook | 4 h (with the database) | Ansible rebuild runbook (§7.1) |
| Temporal workflows | High | Same as database | 15 min | Same as database | 4 h | Production Temporal deployment in phase 1 |
| NATS JetStream | Medium | In-flight jobs only; the worker retries | n/a | 1 h | 1 h | — |
| Redis | Low | Not backed up (locks, counters) | n/a | Minutes | Minutes | — |
| PowerDNS (customer zones) | High | Same as database; zones re-pushed by the API | 15 min | Same as database | 4 h (secondary nameserver in phase 1 keeps answering) | Second nameserver |
| Customer VMs on a Proxmox node | Critical (for customers) | Lost with the node today (local storage, same-node snapshots) | 24 h for customers who enable backups | Days (no off-host copy) | 8 h per node for backed-up VMs | Ceph replication across 3 nodes, Proxmox Backup Server or Storage Box, scheduled customer backups |
| Session recordings | Medium | Bucket durability | Bucket durability | — | — | — |
| Source code and CI | High | GitHub; local clones | Mirror daily | 1 day to move CI | 1 day | Mirror repository |
| Settings and secrets (`group_vars`, vault, `prgd.env`, age identity, step-ca) | Critical | Operator copies [to record] | Encrypted off-host copy, two holders | — | 1 h to retrieve | Break-glass storage (access-control-policy.md §8) |

Customer-facing SLA terms are in `apps/www/content/pages/shared/en/sla.md`; these objectives
must stay consistent with it.

## 4. Redundancy

Today: one management host (phase 0), one or few Proxmox nodes. Running customer VMs do not
depend on the control plane being up (design principle 2 of docs/architecture.md). Planned
(docs/hosting.md, phase 1): separate app, data and workflow VMs, a streaming Postgres replica on a
second node, Ceph replicated three times, two nameservers.

## 5. Backup policy

1. The control plane database (all databases on the Postgres server: app, Temporal, PowerDNS) is
   dumped nightly at 02:15 UTC with `pg_dumpall` and WAL is archived continuously
   (`infra/prod/backup.sh`, `docker-compose.yml`).
2. Backups shall be encrypted with age before they leave the host (feat/security-iso); the private
   identity is kept offline by two holders and never on the management host.
3. Backups shall be copied off the host daily to storage at a different provider or region
   (`BACKUP_S3_URL`, rclone). **Not yet configured in production.**
4. The off-site target shall be protected against deletion by the production host: object lock
   (compliance or governance mode) for the retention period, or credentials that can only write,
   with deletion done by a separate lifecycle rule. **Planned.**
5. Retention: 14 days locally; off-site 35 days daily plus 12 monthly copies [to confirm against
   data-retention-and-deletion.md].
6. Also back up: `/etc/prgd` (via the Ansible vault, not the rendered file), Caddy data (optional;
   certificates can be re-issued), step-ca database and keys (Restricted, offline), the gateway
   spool (recordings not yet uploaded).
7. Backup success is visible in `/var/backups/prgd/last-status`; a status other than `ok` for 24
   hours is an alert (logging-and-monitoring-policy.md A9).

## 6. Restore testing

1. **Monthly**: restore the latest off-site backup into a throwaway Postgres (a temporary droplet
   or a local container), run the checks below, record the result, destroy the copy.
2. Checks: decrypt with the offline identity; `psql` restore completes without errors; row counts
   of key tables (`prgd_users`, `prgd_teams`, `prgd_invoices`, `prgd_audit_logs`) are within 1% of
   production at dump time; audit hash chain verifies; the API starts against the restored
   database (`/healthz` 200).
3. Record: date, backup file and its age (actual RPO), duration of each step (actual RTO for the
   data layer), result, issues, person. File under `evidence/15-backup-dr/restore-tests/YYYY-MM.md`.
4. A failed test is a Sev 3 incident and a CAPA item.

## 7. DR runbooks

### 7.1 Loss of the management host

1. Declare an incident (incident-response-plan.md); post a status update.
2. Create a new droplet in Frankfurt (or another region if FRA1 is unavailable) from Ubuntu 24.04;
   attach the reserved IP if one is used, otherwise update DNS for both domains (records in
   docs/domains-and-entities.md, TTL 300).
3. Run `ansible-playbook -i inventory.ini site.yml --limit management --ask-vault-pass`
   (wireguard and management roles). The first-start step deploys the last known image tag.
4. Stop the API and worker: `cd /opt/prgd && docker compose --env-file /etc/prgd/prgd.env stop api worker`.
5. Fetch the latest off-site backup; decrypt it (`age -d -i <identity> all-YYYYMMDD-HHMM.sql.gz.age > dump.sql.gz`
   when encrypted).
6. Restore the whole server dump (it contains every database and drops them first):
   `gunzip -c dump.sql.gz | docker compose --env-file /etc/prgd/prgd.env exec -T postgres psql -U prgd -d postgres`.
7. Start everything: `docker compose --env-file /etc/prgd/prgd.env up -d`; run
   `/opt/prgd/deploy.sh <tag>` to apply any newer migrations.
8. Re-peer WireGuard: the new host has a new key; re-run the wireguard role on the nodes so they
   accept it. Host agents reconnect to NATS.
9. Verify: `/healthz`, console sign in, a test server create on a staff team, audit chain check,
   gateway session check, payments webhook reachability.
10. Post-incident: rotate secrets that were on the lost host if compromise is possible.

(The restore commands in docs/hosting.md must match this runbook; check both at each review.)

### 7.2 Database corruption or bad migration

Stop api and worker; restore into a second database name first and compare; with pgBackRest
(planned) restore to a point in time before the event; otherwise the last nightly dump. Re-apply
known later changes from the audit log where possible and tell affected customers.

### 7.3 Loss of a Proxmox node

1. Customers on the node are affected: status page and email.
2. Hetzner: request hardware repair or order a replacement; reinstall with
   docs/first-proxmox-node.md and the `pve_node` and `wireguard` roles.
3. With Ceph (planned): VMs restart on surviving nodes. Today (local storage): restore VMs that
   have off-host backups; others are lost — this must be clear in customer documentation until
   backups exist.
4. Return of the failed hardware: physical-and-shared-responsibility.md §4.

### 7.4 Loss of GitHub

Build images locally from a mirror clone, push to an alternative registry, set `REGISTRY` and
`IMAGE_TAG` in `prgd.env`, deploy with `deploy.sh`.

### 7.5 Loss of a SaaS supplier

| Supplier | Fallback |
|---|---|
| Resend | Switch `MAIL_PROVIDER=postmark` (code supports it) after signing the DPA and verifying the domains |
| Stripe / Moyasar | Accept bank transfer (invoice bank details); pause card top-ups |
| Anthropic | Connect agents fail gracefully; notify customers |
| Twilio | Paging falls back to email automatically |
| Google / Microsoft OAuth | Users sign in with password or reset it |

## 8. DR exercises

| Exercise | Frequency | Pass criteria |
|---|---|---|
| Restore test | Monthly (§6) | Within RPO/RTO targets |
| Full management host rebuild on a fresh droplet from backups (§7.1), in a separate project with test DNS | Twice a year | Platform usable within RTO 4 h |
| Node loss simulation (once there are 3 nodes) | Yearly | VMs back within target |
| Supplier failover (mail provider switch) | Yearly | Mail flows within 1 day |

Results go to `evidence/15-backup-dr/exercises/` and feed CAPA.

## 9. Business continuity: people, suppliers, infrastructure

| Dependency | Risk | Plan |
|---|---|---|
| Owner / key engineer | Single point of knowledge and access (R-04) | Name a deputy for each role; break-glass credentials with two holders; runbooks in `docs/`; at least two people able to run §7.1 by [Date] |
| On-call engineers | Two-person rule for 24/7 managed plans (docs/managed-cloud-operations.md) | Do not sell 24/7 plans until the rota has two people |
| DigitalOcean | Account suspension or region outage | Rebuild in another region or provider from backups (§7.1); off-site backups at a different provider |
| Hetzner | Account suspension, data centre outage | Respond to abuse notices within Hetzner's deadline; second location for new nodes |
| GitHub | Outage or account lock | Mirror (§7.4) |
| Payment providers | Account freeze | Bank transfer fallback; keep a 3-month cash buffer [Management] |
| Domain registrar | Domain lost or hijacked | Registrar lock, MFA, auto-renew, contacts current |
| Security during disruption | Controls bypassed in a hurry | Emergency changes still logged and reviewed (change-management.md); break-glass rules apply |

## 10. Roles

Operations lead: backups, restore tests, runbooks. Management: approves objectives and funds
redundancy. Security owner: checks that security controls hold during recovery.

## 11. Evidence produced

Backup status history, monthly restore records with measured RPO/RTO, exercise reports, approved
objectives, supplier contact list.

## 12. Review cycle

Yearly, after each exercise, and when moving to hosting phase 1.

## 13. Mapping

| Framework | Reference |
|---|---|
| ISO/IEC 27001:2022 | Annex A 5.29, 5.30, 8.13, 8.14 |
| NCA ECC | Resilience: cybersecurity in business continuity management; Defense: backup and recovery management |
| Checklist | 114-122 |
