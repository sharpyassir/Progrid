# Internal audit, management review and corrective action

| | |
|---|---|
| Document owner | [Security owner — to be named] |
| Approved by | [Management — to be named], [Date] |
| Version | Draft, 6 October 2026 |
| Review | Yearly |
| ISO/IEC 27001:2022 | Clauses 9.1, 9.2, 9.3, 10.1, 10.2; Annex A 5.35, 5.36 |
| NCA | ECC Governance domain (periodical cybersecurity review and audit) |
| Checklist | Controls 7, 153-160 |

## 1. Purpose

Check that the ISMS works as written, decide on improvements at management level, and fix
nonconformities so they do not recur.

## 2. Internal audit programme

1. Every ISO/IEC 27001 clause (4-10) and every applicable Annex A control in the Statement of
   Applicability is audited at least once in a three-year cycle; high-risk areas every year.
2. Auditors shall be competent and independent of the work they audit. Because the team is
   small, use an external auditor or a qualified person outside the audited role
   ([Internal auditor — to be named]); the Security owner does not audit their own work.
3. Year-one plan (before a certification audit):

   | Quarter | Audit | Scope |
   |---|---|---|
   | [Q1] | ISMS core | Clauses 4-10: scope, policy, risk method and register, SoA, objectives, document control |
   | [Q2] | Access and privileged access | Access control policy, JML records, access reviews, break-glass, ops grants |
   | [Q3] | Operations | Logging, vulnerability management, backups and restore tests, change management |
   | [Q4] | Suppliers, people, incidents | Supplier register and reviews, training, incident register and exercises |

4. Method: interviews, record sampling (at least 5 samples or 10% per control), system checks
   (configuration exports, screenshots), comparison with the control register.
5. Output: an audit report with findings graded as Major nonconformity, Minor nonconformity,
   Observation or Opportunity for improvement; each nonconformity enters the CAPA log (§5).

### 2.1 Audit report template

Audit id and date; auditor; scope and criteria; people interviewed; records sampled; findings
(id, requirement, evidence, grade); conclusion; distribution.

## 3. Metrics (clause 9.1)

The Security owner reports quarterly to Management:

| Metric | Source |
|---|---|
| Objectives O1-O10 (information-security-policy.md §4) | As listed there |
| Control register status counts by layer, and change since last quarter | control-register.csv |
| Risks by rating; risks above appetite; overdue treatments | risk-register.csv |
| Open vulnerabilities by severity and age vs SLA; exceptions | GitHub Security tab, exception log |
| Incidents by severity; mean time to detect and to contain | Incident register |
| Restore tests passed; measured RPO/RTO | Restore records |
| Access review completion; leavers removed within 24 h | Access review packs, JML tickets |
| Training completion | Training records |
| CAPA items open, overdue | CAPA log |

Trends are kept in `evidence/20-audit/metrics/YYYY-Qn.md`.

## 4. Management review (clause 9.3)

At least yearly and before any certification audit, chaired by Management.

**Inputs:** status of actions from previous reviews; changes in internal and external issues and
interested parties (isms-scope.md); metrics (§3); nonconformities and corrective actions; audit
results; results of risk assessment and treatment status; feedback from interested parties
(customer security questionnaires, complaints); opportunities for improvement.

**Outputs:** decisions on improvements, changes to the ISMS (scope, policy, objectives, appetite),
resource needs, risk acceptances.

**Minutes template:** date; attendees; inputs reviewed (with links); decisions; actions (owner,
due date); next review date. Filed in `evidence/01-governance/management-reviews/`.

## 5. Nonconformity and corrective action (CAPA)

Log: `evidence/20-audit/capa-log.csv` with these columns:

| Column | Content |
|---|---|
| ID | CAPA-YYYY-NNN |
| Date raised | |
| Source | Internal audit, external audit, incident, restore test, access review, customer, other |
| Type | Major NC, Minor NC, Observation, Improvement |
| Requirement | Clause or control (ISO / checklist id) |
| Description | What was found, with evidence |
| Correction | Immediate fix |
| Root cause | Why it happened |
| Corrective action | What prevents recurrence |
| Owner | Role / person |
| Due date | Major: 30 days; Minor: 90 days; others as agreed |
| Status | Open, In progress, Done, Verified |
| Effectiveness check | How and when verified, by whom |
| Closed date | |

## 6. Operating calendar (continuous readiness)

| When | Activity | Owner |
|---|---|---|
| Weekly | Change review; manual log review (until alerting); triage of security gate findings | Engineering lead, Operations lead |
| Monthly | Restore test; vulnerability report against SLA; audit chain verification; CAPA follow-up | Operations lead, Security owner |
| Quarterly | Access review incl. firewall review; risk register review; KPI report; settings and GitHub configuration review; evidence index check | Security owner |
| Twice a year | Tabletop exercise; break-glass test; full host rebuild exercise | Security owner, Operations lead |
| Yearly | Policy review; supplier reviews; training refresh; penetration test; internal audit cycle; management review; SoA re-approval | Security owner, Management |
| On trigger | Risk reassessment (risk-methodology.md §6); threat model update | Security owner |

Readiness is maintained by running this calendar, not by preparing before an audit. A
certification audit should not be booked until at least one full cycle of the quarterly and
monthly activities, one internal audit and one management review have produced evidence.

## 7. Roles

Management: management review, resources. Security owner: programme, metrics, CAPA log.
Internal auditor: independent audits. Control owners: corrective actions.

## 8. Evidence produced

Audit programme and reports, metrics reports, management review minutes, CAPA log with
effectiveness checks, the calendar with completion marks.

## 9. Review cycle

Yearly.

## 10. Mapping

| Framework | Reference |
|---|---|
| ISO/IEC 27001:2022 | Clauses 9.1, 9.2, 9.3, 10.1, 10.2; Annex A 5.35, 5.36 |
| NCA ECC | Governance: periodical cybersecurity review and audit |
| Checklist | 7, 153-160 |
