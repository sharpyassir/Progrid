# People security

| | |
|---|---|
| Document owner | [People owner — to be named] |
| Approved by | [Management — to be named], [Date] |
| Version | Draft, 6 October 2026 |
| Review | Yearly |
| ISO/IEC 27001:2022 | Annex A 6.1-6.8, 5.10, 5.11, 7.7, 8.1 |
| NCA | ECC Governance domain (cybersecurity in human resources; awareness and training) |
| Checklist | Controls 14, 143, 145-152 |

## 1. Purpose

Make sure the people who build and run Progrid are trustworthy, know their duties, have only the
access they need while they need it, and can report problems.

## 2. Screening

1. Before receiving access to production or customer data, every employee and contractor shall be
   screened in proportion to the role and as allowed by the law of the country where they live and
   work [legal review needed per country, including Saudi Arabia, Jordan, India, the US].
2. Minimum for all: identity verification, right to work or contracting status, references or
   verifiable work history.
3. Additional for privileged roles (root, staff `full_admin`, support lead, engineers on managed
   contracts): criminal record check where lawful, and for contracts with a residency policy
   (`SAUDI_ONLY`, `TURKIYE_ONLY`) confirmation of the country recorded on the engineer profile.
4. Results are kept confidential by the People owner, only the outcome is recorded in the access
   request.

## 3. Terms and confidentiality

1. Employment contracts and contractor agreements shall include: confidentiality during and after
   the engagement (customer data, credentials, security weaknesses), compliance with Progrid's
   policies, acceptable use, return of assets and data at the end, intellectual property, and
   cooperation in incident investigations.
2. Anyone else who receives Confidential or Restricted information (advisers, auditors, pen
   testers) signs an NDA first.
3. Signed copies are filed (Restricted) and listed in `evidence/19-people/agreements.csv` (name,
   role, document, version, date signed).

## 4. Onboarding and offboarding checklists

### 4.1 Onboarding (copy into the JML ticket)

- [ ] Contract/agreement and NDA signed; screening done (§2, §3)
- [ ] Policies read and acceptable use acknowledged (§6)
- [ ] Security awareness training completed (§5); privileged training if applicable
- [ ] Device meets the endpoint baseline (physical-and-shared-responsibility.md §5)
- [ ] Password manager set up; MFA set up (security key or passkey for provider accounts)
- [ ] GitHub: added to the repository/organisation with the least role; SSH or signing key
      registered; MFA required
- [ ] Platform: staff account with areas (`POST /admin/v1/staff/{userId}`) or engineer profile
      and contract assignments (`POST /admin/ops/engineers`, `/assignments`); IP allowlist set;
      passkey registered on ops.progrid.co
- [ ] Infrastructure (only if the role needs it): named sudo account on the management host and
      nodes; key added through Ansible; WireGuard peer if needed
- [ ] DigitalOcean team member / Hetzner Robot sub-account (only if needed), MFA on
- [ ] Vault / Infisical / Ansible vault access (only if needed)
- [ ] SaaS (Resend, Moyasar, Anthropic, Twilio, Google Cloud, Microsoft Entra, registrar)
      only if needed
- [ ] On-call contact (phone, channel) set (`PUT /admin/managed/staff/{userId}/contact`)
- [ ] Added to the security contact list and incident channel
- [ ] Access recorded in the JML ticket and approved

### 4.2 Offboarding (within 24 hours of the last day; immediately for dismissals)

- [ ] Platform: engineers `PATCH /admin/ops/engineers/{id}` status `OFFBOARDED` (ends sessions,
      revokes grants and certificates, kills terminal sessions, stops timers, removes shifts and
      assignments, opens rotate-credential tickets); staff: remove staff flag and areas, revoke
      sessions and tokens; remove from customer teams they were added to for support
- [ ] GitHub: remove from the organisation/repository; remove deploy keys and personal access
      tokens they created; review Actions secrets they knew
- [ ] DigitalOcean and Hetzner: remove team member / sub-account; revoke API tokens they created
- [ ] Hosts: remove their account and keys (Ansible), WireGuard peer
- [ ] Vault / Infisical / Ansible vault: remove access; **rotate** the vault password and any
      secret they could read (`prgd.env` values, deploy key, provider keys) per key-management.md
- [ ] SaaS accounts and the registrar: remove
- [ ] Break-glass: if they were a holder, rotate and reseal (access-control-policy.md §8)
- [ ] Company devices and data returned or wiped; confirm deletion of Progrid data on personal
      devices in writing
- [ ] Remind of continuing confidentiality
- [ ] Ticket closed with each item checked and dated; filed in `evidence/02-iam/jml/`

Movers: run the offboarding items for access no longer needed, then the onboarding items for the
new role.

## 5. Awareness and training

| Training | Who | When | Content |
|---|---|---|---|
| Security awareness | Everyone | At onboarding, then yearly | These policies in brief, phishing and social engineering, password manager and MFA, data classification, reporting incidents, acceptable use, privacy basics (GDPR, PDPL) |
| Secure administration | Privileged users (root, staff, support leads, engineers) | At onboarding, then yearly | Access grants and the gateway, break-glass, change management, handling customer data, evidence preservation, the incident plan |
| Secure development | Developers | At onboarding, then yearly | OWASP Top 10 and API Top 10 as they apply to the code base, the secure coding rules, security gates |
| Phishing exercise | Everyone | Yearly once the team has more than [5] people | Simulated phishing, followed by a short debrief |
| Incident tabletop | IC, leads | Twice a year | incident-response-plan.md §11 |

Records (name, course, date, result) in `evidence/19-people/training.csv`.

## 6. Acceptable use (staff and contractors)

1. Use company systems and customer data only for your work, under the access you were given.
2. Never access customer content except for a customer request, an incident or a legal duty, and
   record why (data-classification-and-handling.md §5).
3. Never share accounts, passwords, tokens or MFA devices. Never put credentials in code, chat,
   tickets or email.
4. Use only devices that meet the endpoint baseline; lock your screen when away; keep a clear desk
   for printed customer information (avoid printing).
5. Work from trusted networks; use the ops console and gateway for customer servers, never direct
   SSH from your machine.
6. Do not install unapproved software on production hosts; changes go through the change process.
7. Do not paste Confidential or Restricted data into unapproved AI tools or public services.
8. Report lost devices, suspected phishing, mistakes and weaknesses at once (§7). Reporting in
   good faith is never punished.

Every person acknowledges this section at onboarding and yearly.

## 7. Security contact and reporting

- Internal and external reports: **security@progrid.co** (`SECURITY.md`,
  `/.well-known/security.txt`). The mailbox is monitored by the Security owner and a deputy;
  acknowledgement within 2 business days for external reports, at once for internal urgent ones.
- Urgent: call the security on-call (incident-response-plan.md §5).
- Customers' end users and data subjects: support@progrid.co and support@progrid.sa.

## 8. Disciplinary process

Breaches of policy are handled fairly and in proportion: the People owner investigates with the
Security owner; outcomes range from retraining to termination of employment or contract and
legal action. For contractors the agreement's termination clauses apply. Access may be suspended
during the investigation.

## 9. Roles

People owner: screening, contracts, training records, JML triggers. Security owner: content of
training, access removal checks. Managers: approve access for their people.

## 10. Evidence produced

Agreements list, screening outcomes, training records, JML tickets with checklists, acceptable
use acknowledgements, disciplinary records (Restricted).

## 11. Review cycle

Yearly.

## 12. Mapping

| Framework | Reference |
|---|---|
| ISO/IEC 27001:2022 | Annex A 5.10, 5.11, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 7.7, 8.1 |
| NCA ECC | Governance: cybersecurity in human resources; cybersecurity awareness and training |
| Checklist | 14, 143, 145-152 |
