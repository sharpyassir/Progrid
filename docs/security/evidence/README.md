# Evidence repository

Evidence shows that each control is not only written but operated. This folder is the index.
Records without personal data or secrets may be committed here as Markdown or CSV; anything
Confidential with personal data, or Restricted, stays in the system that produced it or in the
restricted evidence store ([location — to be decided, e.g. an encrypted bucket or a restricted
drive]), and the folder holds a pointer file (`POINTER.md`: what, where, who can access,
retention).

Retention: at least three years (a certification cycle), longer where the retention schedule
says so. Naming: `YYYY-MM-DD-short-title.ext`, or `YYYY-Qn` / `YYYY-MM` folders for recurring
records.

## Structure

One folder per checklist layer. Create a folder when its first record arrives.

| Folder | Layer | Typical records |
|---|---|---|
| `01-governance/` | 1 Governance & ISMS | Approved policies (PDF export with approval), role appointments, risk acceptances, management review minutes, SoA approvals |
| `02-iam/` | 2 Identity & Access Management | JML tickets (`jml/`), quarterly access reviews (`access-reviews/YYYY-Qn/`), MFA status exports per provider |
| `03-privileged-access/` | 3 Privileged Access & Management Plane | Break-glass tests and use logs, privileged action samples, bastion/gateway configuration |
| `04-network/` | 4 Network Security | ufw and Proxmox firewall exports, quarterly firewall reviews, network diagrams |
| `05-edge/` | 5 Edge, WAF & DDoS | Caddy configuration snapshots, rate limit settings, WAF/DDoS decisions, emergency filtering records |
| `06-appsec/` | 6 Application & API Security | Threat model reviews, security test results |
| `07-workload-isolation/` | 7 AI App Builder / Workload Isolation | App host hardening checks, tenant isolation test runs |
| `08-data-protection/` | 8 Data Protection & Cryptography | Key inventory snapshots, rotation records, TLS scan reports |
| `09-secrets/` | 9 Secrets & Credential Security | Secret scanning results, rotation logs, vault access reviews |
| `10-infrastructure/` | 10 Secure Infrastructure & Containers | Baseline/CIS check results, image scan summaries |
| `11-devsecops/` | 11 DevSecOps & Supply Chain | Branch protection export, weekly change reviews (`change-reviews/`), deploy records, SBOM/attestation references |
| `12-vulnerability/` | 12 Vulnerability & Patch Management | Monthly vulnerability reports, exception log (`exceptions.csv`), patch records |
| `13-logging/` | 13 Logging, Monitoring & SIEM | Audit log exports, chain verification results, weekly log reviews, alert tickets |
| `14-incident-response/` | 14 Incident Response | `incident-register.csv`, incident records, postmortems, `exercises/`, `contacts.md` (pointer, Restricted) |
| `15-backup-dr/` | 15 Backup, DR & Business Continuity | `restore-tests/YYYY-MM.md`, `exercises/`, backup status history |
| `16-suppliers/` | 16 Third-Party & Supplier Security | Per supplier: certificates, reports, DPAs, assessments, review notes |
| `17-privacy/` | 17 Privacy, Data Lifecycle & Tenant Isolation | Data subject request log (pointer), deletion confirmations, retention job reports, legal holds |
| `18-physical/` | 18 Physical & Data Center Security | Provider evidence per provider, `sanitisation-log.csv`, device inventory (pointer) |
| `19-people/` | 19 People Security & Awareness | `agreements.csv`, `training.csv`, acceptable use acknowledgements (pointers) |
| `20-audit/` | 20 Audit, Assurance & Continuous Improvement | Audit programme and reports, `capa-log.csv`, `metrics/`, `pentests/` |

## Evidence to start collecting now

The 16 items from the checklist's "Evidence to Start Collecting Now", where each lives, and the
first action.

| # | Evidence | Where it lives | First action |
|---|---|---|---|
| 1 | Architecture and data-flow diagrams | `docs/architecture.md`, [threat-model.md](../threat-model.md) §1-2; snapshots in `06-appsec/` | Approve the diagrams; re-export after each architecture change |
| 2 | Asset inventory and asset owners | [asset-register.csv](../asset-register.csv) | Name owners; reconcile with DigitalOcean, Hetzner and GitHub |
| 3 | Risk register and risk-treatment decisions | [risk-register.csv](../risk-register.csv); acceptances in `01-governance/risk-acceptances/` | Owners accept treatment plans; Management signs temporary acceptance of R-04 |
| 4 | Access reviews and privileged-access records | `02-iam/access-reviews/`, `03-privileged-access/` | Run the first quarterly review (access-control-policy.md §7) |
| 5 | Firewall/WAF/security-group configurations | `04-network/`, `05-edge/` | Export ufw, Proxmox firewall and Caddyfile after the branch deploys |
| 6 | Vulnerability reports and remediation evidence | GitHub Security tab; monthly report in `12-vulnerability/` | Enable code scanning and Dependabot alerts; first monthly report |
| 7 | Penetration-test reports and retest results | `20-audit/pentests/` | Define scope and request quotes (vulnerability-and-patch-management.md §6) |
| 8 | Backup and restore test records | `15-backup-dr/restore-tests/` | Configure off-site storage; first restore test |
| 9 | Incident tickets and exercise records | `14-incident-response/` | Create the incident register; schedule the first tabletop |
| 10 | Security awareness/training records | `19-people/training.csv` | Run onboarding training for everyone with access |
| 11 | Supplier security assessments and contracts | `16-suppliers/<supplier>/`; [supplier-register.csv](../supplier-register.csv) | File DPAs and certificates for DigitalOcean, Hetzner, GitHub, Moyasar (and the LLC's Stripe DPA for the history) |
| 12 | Change approvals and deployment records | GitHub pull requests and Actions runs; `11-devsecops/change-reviews/` | Enable branch protection; start weekly change reviews |
| 13 | SIEM/security-monitoring records | Audit log; `13-logging/` | Weekly manual review until central logging exists |
| 14 | Key-management and secrets-management evidence | [key-management.md](../key-management.md) inventory; `08-data-protection/`, `09-secrets/` | Record key owners and last rotation dates |
| 15 | Internal audit and management-review records | `20-audit/`, `01-governance/management-reviews/` | Appoint an internal auditor; plan the year-one programme |
| 16 | Statement of Applicability and control evidence mapping | [statement-of-applicability.csv](../statement-of-applicability.csv), [control-register.csv](../control-register.csv) | Management approves the SoA; keep evidence links current |
