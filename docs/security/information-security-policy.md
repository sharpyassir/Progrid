# Information security policy

| | |
|---|---|
| Document owner | [Security owner — to be named] |
| Approved by | [Management — to be named], [Date] |
| Version | Draft, 6 October 2026 |
| Applies to | Progrid Technologies LLC, Progrid Arabia, all staff, contractors and anyone with access to Progrid systems |
| Review | Yearly, and after a major incident or change |
| ISO/IEC 27001:2022 | Clauses 5.1, 5.2, 6.2; Annex A 5.1, 5.4 |
| NCA | ECC Governance domain (policies and procedures) |
| Checklist | Controls 1, 2, 158 |

## 1. Purpose

Progrid runs infrastructure that customers trust with their code, data and businesses. This
policy sets management's direction for protecting that information and the information Progrid
holds about its customers, staff and suppliers.

## 2. Scope

Everything in the ISMS scope ([isms-scope.md](isms-scope.md)): the platform, the people who build
and operate it, and the suppliers it relies on.

## 3. Policy statements

1. Progrid shall protect the confidentiality, integrity and availability of customer and company
   information in proportion to the risk, as assessed under
   [risk-methodology.md](risk-methodology.md).
2. Progrid shall keep each customer's data and workloads isolated from other customers and from
   the management plane. Isolation is the platform's first design principle.
3. Progrid shall meet its legal, regulatory and contractual obligations, including the privacy
   policies, DPAs and SLA of both entities, and shall not claim certifications or compliance it
   has not obtained.
4. Every person with access shall have a personal, uniquely identified account, use
   multi-factor authentication for any administrative access, and hold only the access their role
   needs ([access-control-policy.md](access-control-policy.md)).
5. Information shall be classified and handled according to
   [data-classification-and-handling.md](data-classification-and-handling.md), and kept only as
   long as [data-retention-and-deletion.md](data-retention-and-deletion.md) allows.
6. Cryptography shall follow [cryptography-policy.md](cryptography-policy.md); secrets shall never
   be committed to source code or baked into images.
7. Software changes shall follow the secure development lifecycle and change management
   procedures, including code review and automated security checks before production.
8. Vulnerabilities shall be fixed within the SLAs of
   [vulnerability-and-patch-management.md](vulnerability-and-patch-management.md); exceptions need
   an owner, a reason and an expiry date.
9. Security-relevant events shall be logged, protected against tampering and reviewed
   ([logging-and-monitoring-policy.md](logging-and-monitoring-policy.md)).
10. Incidents shall be reported at once to the security contact and handled under
    [incident-response-plan.md](incident-response-plan.md), including customer notice within 72
    hours where the DPA requires it.
11. Critical data shall be backed up, encrypted and restore-tested on the schedule in
    [business-continuity-and-dr.md](business-continuity-and-dr.md).
12. Suppliers that handle Progrid or customer data shall be assessed, contracted and reviewed under
    [supplier-security-policy.md](supplier-security-policy.md).
13. Staff and contractors shall be screened where lawful, bound by confidentiality, trained at
    onboarding and yearly, and offboarded promptly ([people-security.md](people-security.md)).
14. The ISMS shall be audited internally, reviewed by management at least yearly and improved
    through corrective actions
    ([internal-audit-and-management-review.md](internal-audit-and-management-review.md)).
15. Breaches of this policy may lead to disciplinary action or termination of contract
    ([people-security.md](people-security.md) §8).

## 4. Objectives and measures

Objectives are reviewed at each management review. Targets apply from the date the policy is
approved. Each measure is reported quarterly by the Security owner.

| # | Objective | Measure (KPI) | Target | Source |
|---|---|---|---|---|
| O1 | Administrative access is strongly authenticated | % of staff, engineer and infrastructure provider admin accounts with MFA | 100% | Quarterly access review |
| O2 | Access is current | % of quarterly access reviews completed on time; leavers whose access was removed within 24 hours | 100%; 100% | Access review records, offboarding checklists |
| O3 | Known vulnerabilities are fixed in time | % of Critical/High findings fixed within SLA (7/30 days); open exceptions past expiry | ≥ 95%; 0 | GitHub Security tab, Trivy results, exception log |
| O4 | Data can be recovered | Monthly restore tests passed; measured control plane RPO and RTO | 12 of 12 per year; within targets of business-continuity-and-dr.md §3 | Restore test records |
| O5 | Incidents are handled and learned from | Customer notifications within 72 hours where required; postmortems completed within 10 working days of a Sev 1/2 incident | 100%; 100% | Incident register |
| O6 | Tenants stay isolated | Cross-tenant findings from tests, pen tests or reports | 0 open beyond SLA; tenant isolation test suite green on every release | CI results, pen test reports |
| O7 | People know their duties | Staff and contractors with current training and signed confidentiality terms | 100% | Training and HR records |
| O8 | Suppliers are under control | Critical suppliers with filed security evidence and DPA, reviewed in the last 12 months | 100% | Supplier register |
| O9 | The ISMS runs continuously | Calendar activities done on time (internal-audit-and-management-review.md §6); CAPA items closed by due date | ≥ 90%; ≥ 90% | CAPA log, evidence index |
| O10 | Changes are controlled | Production changes merged through a reviewed pull request with passing security checks | 100% after branch protection is enabled | GitHub audit log, deploy records |

## 5. Roles

Roles and responsibilities are defined in
[roles-and-responsibilities.md](roles-and-responsibilities.md). In short: Management owns this
policy and accepts residual risk; the Security owner runs the ISMS; every person follows it and
reports incidents.

## 6. Management commitment

Management commits to provide the people, time and budget needed to operate the ISMS, to review
its performance at least yearly, and to support continual improvement. Signed:
[Management — to be named], [Date].

## 7. Evidence produced

Signed approval of this policy, communication record to staff and contractors (filed under
`evidence/01-governance/`), quarterly KPI reports, management review minutes.

## 8. Review cycle

Yearly, after any Sev 1 incident, and when the scope changes.

## 9. Mapping

| Framework | Reference |
|---|---|
| ISO/IEC 27001:2022 | Clauses 5.1, 5.2, 6.2, 9.1; Annex A 5.1, 5.4, 5.36 |
| NCA ECC | Governance domain: cybersecurity strategy, management, policies and procedures |
| Checklist | 1, 2, 158 |
