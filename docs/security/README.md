# Progrid information security management system (ISMS)

This folder is Progrid's information security management system: the scope, policies,
procedures, registers and evidence index that together show how Progrid manages security risk.
It follows ISO/IEC 27001:2022 and the customer checklist "Cybersecurity Architecture & ISO/NCA
Readiness Checklist" (160 controls in 20 layers), and maps to the Saudi NCA control sets at domain
level.

> **Status: readiness, not certification.** Progrid is not certified to ISO/IEC 27001 and does
> not claim compliance with ISO/IEC 27001, the NCA Essential Cybersecurity Controls (ECC), the
> Cloud Cybersecurity Controls (CCC) or the Data Cybersecurity Controls (DCC). These documents
> define the programme and record the gaps. Certification needs the ISMS to operate for a period,
> evidence of that operation, an internal audit, a management review and an audit by an
> accredited certification body. NCA applicability needs a separate formal assessment.

## Documents

| Area | Document | Checklist layer |
|---|---|---|
| Scope | [isms-scope.md](isms-scope.md) | 1 |
| Top-level policy and objectives | [information-security-policy.md](information-security-policy.md) | 1 |
| Roles, RACI, segregation of duties | [roles-and-responsibilities.md](roles-and-responsibilities.md) | 1 |
| Risk method | [risk-methodology.md](risk-methodology.md) | 1, 20 |
| Risk register | [risk-register.csv](risk-register.csv) | 1 |
| Statement of Applicability (93 Annex A controls) | [statement-of-applicability.csv](statement-of-applicability.csv) | 1 |
| Asset register | [asset-register.csv](asset-register.csv) | 1, 12 |
| Control register (160 checklist controls) | [control-register.md](control-register.md), [control-register.csv](control-register.csv) | all |
| Access control (JML, access review, break-glass) | [access-control-policy.md](access-control-policy.md) | 2, 3 |
| Cryptography | [cryptography-policy.md](cryptography-policy.md), [key-management.md](key-management.md) | 8, 9 |
| Data classification and handling | [data-classification-and-handling.md](data-classification-and-handling.md) | 8, 17 |
| Retention and deletion | [data-retention-and-deletion.md](data-retention-and-deletion.md) | 8, 17 |
| Secure development | [secure-development-lifecycle.md](secure-development-lifecycle.md) | 6, 11 |
| Threat model and data flows | [threat-model.md](threat-model.md) | 6, 7, 17 |
| Infrastructure hardening | [infra-hardening.md](infra-hardening.md) | 3, 4, 10 |
| Vulnerability and patch management | [vulnerability-and-patch-management.md](vulnerability-and-patch-management.md) | 10, 12, 20 |
| Logging and monitoring | [logging-and-monitoring-policy.md](logging-and-monitoring-policy.md) | 13 |
| Incident response | [incident-response-plan.md](incident-response-plan.md) | 5, 14 |
| Business continuity and disaster recovery | [business-continuity-and-dr.md](business-continuity-and-dr.md) | 15 |
| Suppliers | [supplier-security-policy.md](supplier-security-policy.md), [supplier-register.csv](supplier-register.csv) | 16 |
| Physical security and shared responsibility | [physical-and-shared-responsibility.md](physical-and-shared-responsibility.md) | 18 |
| People security | [people-security.md](people-security.md) | 19 |
| Change management | [change-management.md](change-management.md) | 11 |
| Internal audit, management review, CAPA | [internal-audit-and-management-review.md](internal-audit-and-management-review.md) | 1, 20 |
| NCA mapping | [nca-mapping.md](nca-mapping.md) | all |
| Evidence index | [evidence/README.md](evidence/README.md) | 20 |

`infra-hardening.md` and `key-management.md` are maintained alongside the code changes that
implement them.

## How the ISMS works

1. **Owner.** The Security owner ([Security owner — to be named]) runs the ISMS: keeps these
   documents current, runs the risk process, collects evidence and reports to management.
   Management ([Management — to be named]) approves the policy, the scope, the risk acceptance and
   the resources. See [roles-and-responsibilities.md](roles-and-responsibilities.md).
2. **Risk drives controls.** Risks are recorded in the risk register with a score and a
   treatment. Treatments point to checklist controls. The Statement of Applicability says which
   ISO controls apply and why.
3. **Controls are operated and evidenced.** Each control in the control register has an owner,
   a status and an evidence location under `evidence/`. A control is only "done" when it is
   defined, implemented, operated and evidenced.
4. **Review cycle.**

   | Activity | Frequency |
   |---|---|
   | Access review (privileged and staff) | Quarterly |
   | Risk register review | Quarterly, and on any trigger in risk-methodology.md §6 |
   | Firewall and exposed-service review | Quarterly |
   | Restore test | Monthly |
   | Supplier review (critical suppliers) | Yearly |
   | Policy review (all documents in this folder) | Yearly, or after a major change or incident |
   | Tabletop incident exercise | Twice a year |
   | Internal audit | Yearly, covering every clause and applicable control over three years at most |
   | Management review | Yearly, and before a certification audit |

   The full calendar is in
   [internal-audit-and-management-review.md](internal-audit-and-management-review.md) §6.

## Document control

- **Source of truth.** The documents are Markdown and CSV files in this repository. The git
  history is the version history: every change has an author, a date and a reason (the commit
  message).
- **Change process.** Changes go through a pull request to `main` reviewed by the Security owner
  (enforced by `.github/CODEOWNERS` once branch protection requires code owner review). A policy
  change that alters obligations needs management approval, recorded in the pull request.
- **Approval record.** Each policy carries an "Approved by / date" line. Until approval the line
  reads `[Approver — to be named], [Date]` and the document is a draft.
- **Versioning.** A document's version is the date of its last approved change, shown in its
  header, plus the commit hash.
- **Distribution.** Staff and contractors read the documents in the repository or in an exported
  PDF filed under `evidence/01-governance/`. Customers receive extracts under NDA on request
  (DPA section 10).
- **Records and evidence.** Records (reviews, tickets, test results, approvals) are kept under
  `evidence/` or in the system that produced them, as listed in
  [evidence/README.md](evidence/README.md). Evidence is kept for at least three years, the length
  of a certification cycle, unless the retention schedule says longer.
- **Classification.** These documents are Internal. Registers that name hosts, keys or
  weaknesses (risk register, asset register, control register) are Confidential and are not
  shared outside Progrid without an NDA.

## Where evidence lives

| Evidence | Location |
|---|---|
| Policies, registers | this folder |
| Code and configuration controls | repository paths cited in the control register |
| CI security results | GitHub Actions runs and the Security tab (code scanning, Dependabot) |
| Audit trail of platform actions | `prgd_audit_logs` table (append-only), exports under `evidence/13-logging/` |
| Session recordings of engineers | recordings bucket (`PRGD_RECORDINGS_BUCKET`), 12 months |
| Reviews, tests, exercises, meeting minutes | `evidence/<layer>/` (see evidence/README.md) |

Evidence that contains personal data or secrets is not committed to the repository; the
evidence folder holds a pointer to where it is kept and who can access it.
