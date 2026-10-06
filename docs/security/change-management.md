# Change management

| | |
|---|---|
| Document owner | [Engineering lead — to be named] |
| Approved by | [Management — to be named], [Date] |
| Version | Draft, 6 October 2026 |
| Review | Yearly |
| ISO/IEC 27001:2022 | Annex A 8.32, 8.9, 8.19, 5.8 |
| NCA | ECC Governance domain (cybersecurity in IT projects, change management) |
| Checklist | Controls 30, 79, 85, 88, 159 |

## 1. Purpose

Make production changes deliberately, with the right review for their risk, and keep a record.

## 2. Scope

Changes to production: application code and images, database migrations, compose and Caddy
configuration, Ansible roles and variables, `prgd.env` settings, host packages, firewall rules,
Proxmox and network configuration, DNS, supplier configuration (payment, mail, OAuth apps), and
the CI/CD pipeline.

## 3. Change types

| Type | Examples | Approval | Record |
|---|---|---|---|
| **Standard** (pre-approved, low risk) | Application code merged through the normal pull request with passing gates; Dependabot patch updates; automatic OS security updates | The pull request review | Pull request and deploy run |
| **Normal** | New features; configuration and Ansible changes; Proxmox node changes; new supplier configuration | Pull request review by the code owner | Pull request; deploy or playbook run log |
| **High-risk** | Anything touching authentication, authorisation, crypto or keys, tenant isolation or networking between tenants, backups, the deploy pipeline (`.github/`, `deploy.sh`), destructive or long-running migrations, firewall rules on the management host, switching `PRIVATE_NETWORK_MODE`, adding a supplier that processes personal data, removing a security control | Code owner review **plus** a second approval from the Security owner (or Management if the Security owner made the change); the `production` environment's required reviewers on the deploy | Pull request with a short risk note (what can go wrong, rollback, customer impact), threat model or risk register update where a trigger applies |
| **Emergency** | Fix for an active incident or a Critical vulnerability | Incident commander | Logged in the incident record; normal review within 2 working days after |

## 4. Procedure

1. Open a pull request with what and why. For Normal and High-risk changes add: rollback plan,
   customer impact, test evidence.
2. CI and security gates must pass (secure-development-lifecycle.md §6).
3. Get the approvals required by the type.
4. Merge; the deploy workflow builds, scans, attests and rolls the management host. Ansible
   changes are applied with `ansible-playbook` by the Operations lead and the run output is kept.
5. Verify after the change (health checks, smoke test); roll back with
   `sudo /opt/prgd/deploy.sh <previous sha>` if needed. Migrations are forward only: a rollback
   across a migration needs a restore or a follow-up migration, so destructive migrations are
   High-risk.
6. Customer-visible changes with downtime are announced in advance on the status page and by
   email (maintenance window [to define]).

## 5. Weekly change review

Every week the Engineering lead (and, while there is only one developer, an independent reviewer
when available) reviews the list of merged pull requests and deploys:

- Every change to the CODEOWNERS sensitive paths was reviewed; self-merged ones are re-read now
  and the review recorded in `evidence/11-devsecops/change-reviews/YYYY-Www.md`.
- Every production deploy came from the workflow (no manual `deploy.sh` runs without a ticket).
- Emergency changes from the week have their after-the-fact review.

## 6. Periodic configuration reviews

| Review | Frequency | Content |
|---|---|---|
| Firewall and exposed services (checklist 30) | Quarterly, in the access review | `ufw status numbered` on the management host, Proxmox datacenter and node firewall rules, Caddy allowlists, published Docker ports (`docker ps --format '{{.Ports}}'`), external port scan of public IPs; remove anything not needed |
| Settings file | Quarterly | `prgd.env` keys against `infra/prod/prgd.env.example`; no development defaults; `PAYMENT_PROVIDER` and `PAYMENT_PROVIDER_LLC` real; `REQUIRE_TOTP_*` on |
| GitHub settings | Quarterly | Branch protection, Actions permissions, secrets, deploy keys, collaborators |

## 7. Separation of environments

Development, CI and production are separate (secure-development-lifecycle.md §9). A staging
environment is planned before external customers; until then High-risk changes are tested on a
demo or throwaway host when practical.

## 8. Roles

Engineering lead: owns the process and the weekly review. Operations lead: infrastructure changes.
Security owner: second approval for High-risk changes. Incident commander: emergency changes.

## 9. Evidence produced

Pull requests with approvals, deploy runs with image digests, Ansible run logs, weekly change
reviews, emergency change reviews, quarterly configuration reviews.

## 10. Review cycle

Yearly.

## 11. Mapping

| Framework | Reference |
|---|---|
| ISO/IEC 27001:2022 | Annex A 5.8, 8.9, 8.19, 8.31, 8.32 |
| NCA ECC | Governance: cybersecurity in IT projects; Defense: secure configuration |
| Checklist | 30, 79, 85, 88, 159 |
