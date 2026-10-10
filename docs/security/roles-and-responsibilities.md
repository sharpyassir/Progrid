# Roles and responsibilities

| | |
|---|---|
| Document owner | [Security owner — to be named] |
| Approved by | [Management — to be named], [Date] |
| Version | Draft, 6 October 2026 |
| Review | Yearly, and whenever a role holder changes |
| ISO/IEC 27001:2022 | Clause 5.3; Annex A 5.2, 5.3, 5.4 |
| NCA | ECC Governance domain (roles and responsibilities) |
| Checklist | Control 6 |

## 1. Purpose

Make clear who decides, who does the work and who checks it, so that no single person can both
make and approve a high-risk change unnoticed.

## 2. Scope

All ISMS activities, all staff and contractors.

## 3. Roles

One person may hold several roles while the team is small. The segregation rules in §5 say which
combinations are not allowed. Record each appointment (name, date, deputy) in
`evidence/01-governance/role-appointments.md`.

| Role | Holder | Responsibilities |
|---|---|---|
| Management | [Management — to be named] | Approves policy, scope, risk acceptance criteria and residual risks above the appetite; provides resources; chairs the management review |
| Security owner (ISMS owner, CISO function) | [Security owner — to be named] | Runs the ISMS; owns the risk register, SoA, control register and evidence; runs access reviews, internal audit programme and CAPA; is the incident commander by default; security contact (security@progrid.co) |
| Privacy lead (DPO function) | [Privacy lead — to be named] | Privacy policy and DPA of Progrid Arabia; retention and deletion; data subject requests; breach notification decisions with legal counsel; subprocessor list; PDPL and GDPR contact. Whether a formally designated DPO is required (GDPR art. 37, PDPL) needs legal review |
| Engineering lead | [Engineering lead — to be named] | Secure development lifecycle, code review, CI security gates, application security fixes, threat model updates, secrets in code and pipelines |
| Operations lead | [Operations lead — to be named] | Hosts, networks, hardening, patching, backups and restore tests, monitoring, firewall reviews, supplier accounts at DigitalOcean and Hetzner, DR runbooks |
| Support lead (`support_lead` staff area) | [Support lead — to be named] | Approves engineer access grants and timesheets, watches and kills terminal sessions, closes postmortems, first triage of customer security reports |
| Finance lead (`finance` staff role) | [Finance lead — to be named] | Payment provider accounts, refunds and fraud decisions, billing country and currency changes, invoice records retention (including the PRGD-US history of Progrid Technologies LLC) |
| People owner | [People owner — to be named] | Screening, contracts and NDAs, onboarding and offboarding checklists, training records, disciplinary process |
| Internal engineer | Staff with the `engineer` area | Operates managed contracts; follows access, logging and incident procedures |
| External engineer (contractor) | Users with an `EXTERNAL` engineer profile | Works only on assigned contracts through the ops console and gateway; never staff; no billing data, no export, no self-approval (`docs/devops-console.md`) |
| All personnel | Everyone | Follow the policies, protect credentials, report incidents and weaknesses at once |
| Legal counsel (external) | [Counsel — to be named] | Regulatory notifications, contracts, legal review items marked in these documents |

## 4. RACI

R = responsible (does the work), A = accountable (one per row, signs off), C = consulted,
I = informed.

| Activity | Mgmt | Security owner | Privacy lead | Eng lead | Ops lead | Support lead | People owner | Contractors |
|---|---|---|---|---|---|---|---|---|
| ISMS scope, policy, objectives | A | R | C | C | C | I | I | I |
| Risk assessment and treatment | A (acceptance) | R | C | C | C | I | | |
| Statement of Applicability | A | R | C | C | C | | | |
| Asset register | I | A | C | R | R | | | |
| Access provisioning (staff, infra) | I | A | | R | R | C | C | |
| Engineer access grants (managed assets) | | C | | | I | A/R | | R (request) |
| Quarterly access review | I | A/R | | C | C | C | | |
| Break-glass use | I | A | | C | R | | | |
| Secure development and code review | | C | | A/R | C | | | C |
| Production deploy and change approval | I | C | | A | R | | | |
| Vulnerability remediation | I | A | | R (code) | R (hosts) | | | |
| Logging and monitoring | | A | C | R | R | | | |
| Incident response | I (Sev 1-2) | A (incident commander) | R (privacy impact, notices) | R | R | R (customer comms) | | C |
| Regulator and customer breach notification | A | C | R | C | C | C | | |
| Backup and restore tests | I | C | | | A/R | | | |
| Supplier assessment and register | A (critical) | R | R (DPA) | C | C | | | |
| Retention and deletion | | C | A/R | R (jobs) | C | | | |
| Screening, NDAs, training | I | C | C | | | | A/R | R (complete) |
| Onboarding/offboarding | | C | | R | R | R (engineers) | A | |
| Internal audit | I | A (programme) | | C | C | | | |
| Management review | A/R | R (inputs) | C | C | C | | | |
| Corrective actions (CAPA) | I | A | R | R | R | R | R | |

## 5. Segregation of duties

Rules:

1. Nobody shall approve their own access request, access grant, timesheet or exception. The ops
   module enforces this for grants and timesheets (approvals are "never your own").
2. Nobody shall merge their own pull request to `main` without a second reviewer once a second
   person with write access exists. Until then, every self-merged change to the paths in
   `.github/CODEOWNERS` shall be reviewed after the fact in the weekly change review
   ([change-management.md](change-management.md)) and the review recorded.
3. The person who performs a quarterly access review of an account shall not be the holder of that
   account; the owner's own accounts are reviewed by [Management or a delegate — to be named].
4. Contractors shall never hold staff roles, approve grants, see billing data or administer
   hosting provider accounts.
5. Finance actions (refunds, credit, billing country and currency changes) shall be done by the finance role and
   are written to the audit log; staff without the finance role cannot do them.
6. Audit log integrity: no single production role can alter audit rows; the append-only trigger
   and hash chain detect changes (`apps/api/src/modules/events/audit-chain.ts`).
7. The internal auditor shall not audit their own work.

Known conflicts while the team is small (accepted until [Date], see risk register R-04, R-05
and R-40): the owner holds Management, Security owner, Engineering lead and Operations lead roles and
holds root on all hosts. Compensating controls: audit log with hash chain, session recordings for
customer assets, quarterly review of the owner's privileged actions by
[independent reviewer — to be named], break-glass sealed credentials.

## 6. Evidence produced

Role appointment records, signed RACI acknowledgement, segregation-of-duties exceptions with
compensating controls, evidence of after-the-fact reviews.

## 7. Review cycle

Yearly, and whenever a role holder changes.

## 8. Mapping

| Framework | Reference |
|---|---|
| ISO/IEC 27001:2022 | Clause 5.3; Annex A 5.2, 5.3, 5.4, 6.4 |
| NCA ECC | Governance domain: roles and responsibilities, cybersecurity management |
| Checklist | 6 |
