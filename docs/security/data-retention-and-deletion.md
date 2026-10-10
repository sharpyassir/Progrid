# Data retention and deletion

| | |
|---|---|
| Document owner | [Privacy lead — to be named] |
| Approved by | [Management — to be named], [Date] |
| Version | Draft, 6 October 2026 |
| Review | Yearly, and whenever a privacy policy retention table changes |
| ISO/IEC 27001:2022 | Annex A 5.33, 5.34, 8.10 |
| NCA | DCC (data retention and secure disposal); ECC Defense domain (data and information protection) |
| Checklist | Controls 61, 62, 103, 135 |

## 1. Purpose

Keep personal and customer data only as long as needed, delete it when the period ends, and be
able to show that the published retention periods are what the systems really do.

## 2. Scope

All data in the asset register, for Progrid Arabia (and the records Progrid Technologies LLC left in the platform). The retention periods below are the ones
published in the privacy policies (`apps/www/content/pages/co/en/privacy.md` §9 and
`apps/www/content/pages/sa/{en,ar}/privacy.md` §7) and the DPAs (section 9 co, section 10 sa).

## 3. Policy statements

1. Each data category shall have a retention period, a legal or business reason, and a deletion
   method; the table in §4 is the schedule.
2. Retention shall be enforced by an automatic job wherever practical. Where it is not yet
   automatic, the category is marked "pending" with an owner and a target date, and a manual
   deletion is run each quarter until the job exists.
3. A legal hold (pending claim, investigation, preservation request from an authority) suspends
   deletion for the data concerned; holds are recorded by the Privacy lead with a review date.
4. Deletion from active systems shall be followed by expiry from backups on the backup schedule
   (14 days for control plane dumps today); restored backups shall have deletions re-applied.
5. Anonymisation is acceptable instead of deletion when records must stay for accounting or
   integrity (invoices, audit rows), provided the person can no longer be identified from them.
6. Customer content is deleted when the customer deletes the resource and, at the latest, 30 days
   after the account is closed (DPA). On request Progrid confirms deletion in writing.
7. Physical media are sanitised under
   [physical-and-shared-responsibility.md](physical-and-shared-responsibility.md) §4.

## 4. Retention schedule

"Job" means enforced by code; "pending" means not yet enforced automatically.

| Data | Published period | Enforcement | How |
|---|---|---|---|
| Account data | Life of the account + 5 years after closure (accounting and tax) | **Partial**: self-service deletion anonymises identifying fields at once (`DELETE /v1/account`, `apps/api/src/modules/privacy`, feat/security-iso). Purge of closed-account records after 5 years: **pending** | Anonymisation of email, name, phone, second factors, sign-in methods, SSH keys, sessions and API tokens; user id kept for invoices and audit |
| Billing and affiliate payout records | 5 years after the end of the year they relate to, or longer where tax law requires | **Pending** (kept indefinitely today) | Planned yearly job after legal confirmation of the longest period per entity (ZATCA and US rules) [legal review needed] |
| Legal acceptance records (`prgd_legal_acceptances`) | Life of the account + 5 years | **Pending** | Planned with the closed-account purge |
| Verification and fraud records | Life of the account + 5 years; ban records as long as needed to enforce the ban [period to be confirmed on progrid.sa] | **Pending** | Planned with the closed-account purge; ban records reviewed yearly |
| Audit logs | 1 year | **Job** (feat/security-iso): rows older than `AUDIT_RETENTION_DAYS` (default 400 days, i.e. 1 year plus a margin for investigations) are exported to `AUDIT_ARCHIVE_BUCKET` and deleted from the database. Without a bucket rows are kept. | `apps/api/src/jobs/retention.service.ts`. Gap: the archive bucket has no expiry yet; set a lifecycle rule so archives are deleted after [period to confirm, e.g. 1 year after archiving] or change the published period |
| Server metrics | 30 days at full resolution | **Job**: raw samples deleted after 14 days, hourly roll-ups after 365 days (`apps/api/src/modules/monitoring/metrics.service.ts`) | Discrepancy to fix: the policy should say "14 days at full resolution, hourly averages for 1 year", or the code should match the policy [Privacy lead to decide] |
| Usage events (billing meter) | Not published separately | **Job**: TimescaleDB retention policy 90 days on raw usage events (rated usage records kept with billing) | Init migration |
| Support tickets | 3 years | **Pending** | Planned job: delete or anonymise tickets closed more than 3 years ago |
| Customer content (servers, volumes, buckets, databases, apps) | Deleted with the resource; at the latest 30 days after account closure; backups expire on schedule | **Partial**: deletion with the resource is immediate. Deletion of remaining resources 30 days after closure: **pending** (account deletion currently requires the team to have no running resources) | Planned job to delete resources of closed teams after 30 days |
| Webhook deliveries | Not published separately (part of usage/technical data) | **Job**: 90 days | retention.service.ts |
| Connect run steps and payloads | Not published separately | **Job**: steps deleted and inputs/outputs cleared 90 days after the run finished; the run row stays for billing | retention.service.ts |
| Console, staff and ops sessions | Not published separately | **Job**: 30 days after expiry or revocation | retention.service.ts |
| Engineer session recordings | Not published (internal evidence) | **Job**: `recordingRetentionMonths` (12), daily at 03:30 UTC | `apps/api/src/modules/ops` |
| Expired gateway tokens | — | **Job**: daily | ops module |
| Control plane backups | 14 days (`BACKUP_KEEP_DAYS`) | **Job**: backup container deletes dumps and WAL older than 14 days locally | `infra/prod/backup.sh`; off-site copies need a matching lifecycle rule when configured |
| Application logs (Docker JSON logs) | Not published | Rotated by size (20 MB x 5 per service) | Compose logging options; retention by time is pending central logging |
| Email delivery logs at Resend/Postmark | Supplier default | Supplier | Record supplier retention in the supplier register |

## 5. Deletion methods

| Medium | Method |
|---|---|
| Database rows | `DELETE` or anonymising `UPDATE` by a job or reviewed script; recorded in the audit log (`audit.purged` event for audit rows) |
| Object storage | Object deletion plus bucket lifecycle rules |
| VM disks and volumes | Proxmox/Ceph volume removal; thin-provisioned storage returns zeroed blocks to new volumes. Disks leaving Progrid's control: physical-and-shared-responsibility.md §4 |
| Backups | Expire by retention; encrypted with age, so destroying the identity key makes all copies unreadable (crypto-shredding as a last resort) |
| Files on laptops | Secure delete or full disk encryption plus normal delete |

## 6. Roles

Privacy lead: owns the schedule, legal holds and deletion confirmations. Engineering lead:
builds and runs the jobs. Operations lead: backups and media.

## 7. Evidence produced

Job logs (counts per run), `audit.purged` audit events, quarterly manual deletion records for
pending categories, legal hold register, written deletion confirmations sent to customers, the
reconciliation of this table against the privacy policies at each review.

## 8. Review cycle

Yearly, and whenever a privacy policy or DPA retention text changes (both must change together).

## 9. Mapping

| Framework | Reference |
|---|---|
| ISO/IEC 27001:2022 | Annex A 5.33, 5.34, 8.10 |
| NCA DCC | Data retention and secure disposal |
| PDPL / GDPR | Storage limitation, deletion on request |
| Checklist | 61, 62, 103, 135 |
