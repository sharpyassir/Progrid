# Risk methodology

| | |
|---|---|
| Document owner | [Security owner — to be named] |
| Approved by | [Management — to be named], [Date] |
| Version | Draft, 6 October 2026 |
| Review | Yearly |
| ISO/IEC 27001:2022 | Clauses 6.1.1, 6.1.2, 6.1.3, 8.2, 8.3 |
| NCA | ECC Governance domain (cybersecurity risk management) |
| Checklist | Controls 3, 159 |

## 1. Purpose

A repeatable way to find, score, treat and accept information security risks, so that results are
comparable from one assessment to the next.

## 2. Scope

All assets and processes in the ISMS scope, including suppliers and the legal entities' regulatory
obligations.

## 3. Method

Asset-and-scenario based. For each scenario record: the asset, the threat, the vulnerability it
exploits, the existing controls, the likelihood and impact **with existing controls**
(inherent score in this register means "today", before planned treatment), the treatment, the
planned controls (checklist control numbers), the owner, the target date and the expected
residual score after treatment.

### 3.1 Likelihood (1-5)

| Score | Label | Guide |
|---|---|---|
| 1 | Rare | Not expected in the next 3 years; needs a skilled, targeted attacker and several failures |
| 2 | Unlikely | Could happen once in 3 years; known technique but strong existing controls |
| 3 | Possible | Could happen within a year; exposed to the internet or to many people |
| 4 | Likely | Expected within a year; seen at comparable providers or already partly happened |
| 5 | Almost certain | Happens continuously (scans, credential stuffing, abuse sign-ups) and a weakness is present |

### 3.2 Impact (1-5)

Take the highest row that applies.

| Score | Label | Customers and data | Availability | Legal and contractual | Financial (per event) |
|---|---|---|---|---|---|
| 1 | Negligible | No customer data affected | < 15 min degraded | None | < USD 1,000 |
| 2 | Minor | Internal data of one customer exposed internally | < 4 h control plane outage, VMs unaffected | Minor breach of a policy | < USD 10,000 |
| 3 | Moderate | Personal data of a few customers exposed | < 24 h control plane outage or one node down | DPA breach notice to customers | < USD 50,000 |
| 4 | Major | Data of many customers exposed or one customer's content destroyed | > 24 h outage or loss of data since last backup | Notifiable breach to a regulator; SLA credits for many | < USD 250,000 |
| 5 | Severe | Cross-tenant compromise or loss of the platform database | Platform cannot be restored | Regulatory sanction, loss of payment or hosting provider | ≥ USD 250,000 or business-ending |

### 3.3 Score and rating

Score = likelihood × impact.

| Score | Rating | Required response |
|---|---|---|
| 15-25 | Critical | Not acceptable. Treat at once; Management informed within one week; treatment plan with dates |
| 10-14 | High | Treat within the current quarter, or Management accepts in writing with a review date |
| 5-9 | Medium | Treat when practical; risk owner may accept with a review date |
| 1-4 | Low | Accept and monitor |

## 4. Treatment options

- **Reduce**: add or improve controls (most entries).
- **Avoid**: stop the activity (for example, do not sell a product until a control exists).
- **Transfer**: insurance or contract (customer responsibility under the DPA, supplier terms).
  Transfer never removes Progrid's accountability for customer notification.
- **Accept**: only within the appetite below, recorded with a name, date and review date.

## 5. Risk appetite and acceptance

- Residual risk 1-9 may be accepted by the risk owner.
- Residual risk 10-14 needs written acceptance by Management with a review date of at most six
  months.
- Residual risk 15 or more is outside the appetite and cannot be accepted, except for a
  documented temporary period of at most 90 days while treatment is in progress.
- Risks that could lead to cross-tenant data exposure or loss of the platform database have a
  low appetite: their treatment takes priority over feature work.

Acceptances are recorded in the risk register (status "Accepted") and in
`evidence/01-governance/risk-acceptances/`.

## 6. When to reassess

The register is reviewed quarterly. A risk assessment is also required, before the change goes
live, when any of these happens (checklist control 159):

1. A new product or a major feature is launched (for example a new managed service, GPU servers,
   inference gateway, Saudi region).
2. The architecture changes (new host, new network path, hosting phase change, `sdn_vnet` switch).
3. A critical supplier is added, replaced or changes its terms or location.
4. A Sev 1 or Sev 2 incident occurs, or a pen test finds a High or Critical issue.
5. A new legal or regulatory requirement applies (for example NCA applicability, PDPL
   regulations, a new country).
6. A new category of personnel gets access (for example contractors in a new country).

The change management procedure ([change-management.md](change-management.md)) asks for this
check on every high-risk change.

## 7. Roles

| Role | Duty |
|---|---|
| Security owner | Runs the assessment, keeps the register, reports to Management |
| Risk owner (per row) | Owns the treatment plan and its dates |
| Management | Approves the method and the appetite; accepts High residual risks |

## 8. Evidence produced

The risk register ([risk-register.csv](risk-register.csv)) with its git history, quarterly
review notes, signed acceptances, treatment plan status in the control register.

## 9. Review cycle

Method: yearly. Register: quarterly and on triggers in §6.

## 10. Mapping

| Framework | Reference |
|---|---|
| ISO/IEC 27001:2022 | Clauses 6.1, 8.2, 8.3; Annex A 5.8 |
| NCA ECC | Governance domain: cybersecurity risk management |
| Checklist | 3, 159 |
