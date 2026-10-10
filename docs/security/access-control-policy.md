# Access control policy

| | |
|---|---|
| Document owner | [Security owner — to be named] |
| Approved by | [Management — to be named], [Date] |
| Version | Draft, 6 October 2026 |
| Review | Yearly |
| ISO/IEC 27001:2022 | Annex A 5.15, 5.16, 5.17, 5.18, 8.2, 8.3, 8.5, 8.18 |
| NCA | ECC Defense domain (identity and access management); CCC Defense |
| Checklist | Controls 9-23, 30, 137, 151 |

## 1. Purpose

Make sure every person and system has only the access it needs, that access is strongly
authenticated, recorded, reviewed and removed on time.

## 2. Scope

| Access type | Systems |
|---|---|
| Customer access | Console, public API (`/v1`), CLI, Terraform, MCP, API tokens, Connect agents |
| Staff access | Back office (`/admin`), staff areas and roles |
| Engineer access | Ops console (`/ops/v1`), terminal gateway, access grants to managed assets |
| Infrastructure access | SSH and root on the management host and Proxmox nodes, Proxmox web UI/API, databases, Temporal UI |
| Provider and SaaS access | DigitalOcean, Hetzner Robot/console, GitHub, registrar, Resend/Postmark, Moyasar, Anthropic, Twilio, Google Cloud, Microsoft Entra, Infisical, Vault |
| Machine access | CI deploy key, NATS token, Proxmox agent token, platform agent secrets, webhook secrets |

## 3. Policy statements: identities and authentication

1. Every person shall have a personal account in every system. Shared accounts and shared
   passwords for people are not allowed. Where a provider allows only one owner login, it is a
   break-glass account (§8).
2. Multi-factor authentication shall be enabled on every administrative account: back office
   (enforced by `REQUIRE_TOTP_FOR_STAFF`), ops console (TOTP or WebAuthn, enforced), all provider
   and SaaS admin accounts in §2. Phishing-resistant factors (security keys or passkeys) shall be
   used for DigitalOcean, Hetzner, GitHub and the domain registrar by [Date].
3. Customer team owners shall use two-factor sign in in production
   (`REQUIRE_TOTP_FOR_OWNERS=true`); other customer members are encouraged to, and enterprise
   customers can require it for their team when that setting exists.
4. Passwords are stored only as argon2id hashes; API tokens, gateway tokens and heartbeat tokens
   only as hashes; TOTP seeds sealed. Staff shall use a password manager and unique passwords.
5. SSH to servers shall use keys or certificates only; password authentication and direct root
   login with a password are disabled (`infra-hardening.md`).

## 4. Policy statements: privileged access

1. Privileged accounts are: staff with any area, `full_admin` staff, support leads, root and sudo
   on hosts, Proxmox administrators, owners and admins of provider accounts, holders of the CI
   deploy key and the Ansible vault password.
2. Staff work shall use a **dedicated staff identity** (separate email, not a member of any
   customer team) by [Date]; until then staff accounts are restricted by
   `STAFF_IP_ALLOWLIST`, a 30-minute idle timeout and audit of every back-office read.
3. Admin-scope API tokens shall belong only to staff with TOTP and expire within 24 hours.
4. Back office access shall come only from approved networks (`STAFF_IP_ALLOWLIST`,
   `ADMIN_ALLOW_CIDRS` at Caddy) once set in production.
5. Infrastructure SSH shall be reachable only from `ssh_allow_from` addresses or the WireGuard
   network. Each administrator shall have a named sudo account; root keys are break-glass only.
6. Engineer access to customer managed assets shall go only through access grants (reason,
   ticket, approval, expiry), short-lived SSH certificates and the recorded gateway
   (`docs/devops-console.md`). Engineers never connect from their own machines to customer
   servers.
7. Privileged utilities (`psql` on production, `pvesh`, `docker exec` into production containers,
   `ansible-playbook` against production) shall be used only for a ticket or change, and the
   ticket shall be referenced in the shell history or change record.
8. All privileged actions are logged: the API audit log records every state-changing call and
   every back-office read; ops actions write `ops.*` events; hosts run auditd
   ([logging-and-monitoring-policy.md](logging-and-monitoring-policy.md)).

## 5. Policy statements: authorization

1. Access is granted on least privilege and need to know, through roles: team roles and token
   scopes for customers, staff areas (`engineer`, `support_lead`, `finance`, `full_admin`) for
   staff, engineer profiles and contract assignments for engineers.
2. An empty staff role list shall not mean full access; full access needs the explicit
   `full_admin` role.
3. Tokens cannot have scopes their creator lacks; agent tokens cannot create tokens or decide
   approvals.
4. Contractors shall never see billing data, customer contact details, raw secrets or other
   customers' assets (masking mappers and AssignmentGuard).
5. Every new API route shall declare its required scope or staff area; code review checks it
   ([secure-development-lifecycle.md](secure-development-lifecycle.md)).

## 6. Joiner, mover, leaver (JML)

| Step | Joiner | Mover (role change) | Leaver |
|---|---|---|---|
| Trigger | Signed contract and NDA (people-security.md §3) | Role change approved by the manager | Notice, end of contract, or immediate removal |
| Request | People owner opens a JML ticket listing systems and roles | Manager lists access to add and remove | People owner or manager opens a leaver ticket |
| Approval | Security owner (privileged), support lead (engineers) | Security owner | — |
| Provision / change | Ops and engineering leads, from the checklist in people-security.md §4 | Remove old access first, then add | Within 24 hours of the last working day (at once for a dismissal): run the offboarding checklist |
| Platform specifics | Staff: `POST /admin/v1/staff/{userId}` with areas; engineers: `POST /admin/ops/engineers` and assignments | Change staff areas or assignments | Engineers: `PATCH /admin/ops/engineers/{id}` `OFFBOARDED` (ends sessions, revokes grants and certificates, opens rotate-credential tickets). Staff: remove staff flag; sessions and tokens are revoked (feat/security-iso) |
| Shared secrets | — | Rotate any shared secret the person knew and no longer needs | Rotate every secret the person could read (prgd.env values, vault password, deploy key) |
| Record | JML ticket with approvals, filed in `evidence/02-iam/jml/` | Same | Same, with the checklist signed off |

## 7. Quarterly access review

Run in the first two weeks of each quarter by the Security owner (the owner's own accounts by
[independent reviewer — to be named]).

1. Export the lists:
   - staff users and their areas (`GET /admin/v1/staff` or a database query on `isStaff`);
   - engineer profiles, status, IP allowlists and contract assignments (`GET /admin/ops/engineers`);
   - active API tokens with admin scope, and tokens older than 180 days;
   - members of the GitHub organisation/repository with their permissions, GitHub Actions
     secrets and deploy keys;
   - users of DigitalOcean, Hetzner Robot, registrar, Resend/Postmark, Moyasar, Anthropic,
     Twilio, Google Cloud, Microsoft Entra, Infisical/Vault;
   - Unix accounts and `authorized_keys` on the management host and each Proxmox node;
   - firewall rules: `ufw status numbered`, Proxmox datacenter and node firewall, Caddy allowlists.
2. For each entry confirm: the person is current, the access matches the role, MFA is on, the
   last use is recent. Mark keep / change / remove.
3. Remove or change within 5 working days; record the ticket.
4. Review a sample of privileged actions from the audit log (back-office reads, staff changes,
   billing entity changes, break-glass use) and of session recordings.
5. File the export, the decisions and the evidence of removal in
   `evidence/02-iam/access-reviews/YYYY-Qn/`, signed by the reviewer.

The firewall part of this review satisfies checklist control 30.

## 8. Break-glass procedure

Break-glass accounts give access when normal paths fail (the owner unavailable, MFA lost,
WireGuard down).

| Account | Stored as |
|---|---|
| Provider owner logins (DigitalOcean, Hetzner, GitHub, registrar) with recovery codes | Sealed in [password manager vault / physical safe — to be decided], two holders: [Holder 1], [Holder 2] |
| Root SSH key for the management host and nodes (not used day to day) | Same, plus offline copy |
| Ansible vault password and age backup identity | Same, separate entry |
| Hetzner rescue system and DigitalOcean recovery console | Through the provider owner logins |

Rules:

1. Use only when the normal path is unavailable and an incident or urgent change is open.
   Announce use in the incident channel with the reason.
2. Every use is logged: who, when, why, what was done.
3. After use: rotate the used credential, reseal it, and review the actions within 2 working days.
4. **Test twice a year**: open the sealed credential under the four-eyes principle, verify it
   works (sign in, SSH to a host), reseal, and record the result in
   `evidence/03-privileged-access/break-glass-tests/`.
5. The emergency access grant of the ops module (auto-approved P1/P2 for the on-call engineer)
   is not break-glass; it is the normal emergency path and is reviewed in the access review.

## 9. Session and credential lifetimes

| Credential | Lifetime |
|---|---|
| Console session | 24 hours, ends after 120 minutes idle |
| Staff session (back office) | 24 hours, ends after 30 minutes idle |
| Ops session | 12 hours, ends after 30 minutes idle |
| API token | Optional expiry of 1-365 days chosen by the creator; without one the token lasts until revoked (gap: make expiry mandatory, and list tokens older than 180 days in the access review); admin-scope tokens at most 24 hours |
| Gateway one-time token | 60 seconds, single use |
| Engineer SSH certificate | Until the grant expires (at most 240 minutes plus one extension) |
| Password reset link | 1 hour |
| Provider API tokens and long-lived secrets | Reviewed quarterly; rotated yearly or on suspicion (key-management.md) |

## 10. Roles

Security owner (policy, reviews, break-glass custody); Engineering and Operations leads
(provisioning and removal); Support lead (engineer grants); People owner (JML triggers); every
person (protect credentials, report loss at once).

## 11. Evidence produced

JML tickets, quarterly access review packs, break-glass test records and use logs, MFA status
screenshots or exports per provider, audit log extracts, GitHub branch protection and member
exports.

## 12. Review cycle

Policy yearly; reviews quarterly; break-glass tests twice a year.

## 13. Mapping

| Framework | Reference |
|---|---|
| ISO/IEC 27001:2022 | Annex A 5.15, 5.16, 5.17, 5.18, 6.5, 8.2, 8.3, 8.5, 8.18, 8.20 |
| NCA ECC | Defense: identity and access management; network security management |
| NCA CCC | Defense: cloud identity and privileged access |
| Checklist | 9-16, 17-23, 30, 137, 151 |
