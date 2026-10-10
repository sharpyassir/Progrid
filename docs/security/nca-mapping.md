# NCA mapping

| | |
|---|---|
| Document owner | [Security owner — to be named] |
| Approved by | [Management — to be named], [Date] |
| Version | Draft, 6 October 2026 |
| Review | When the NCA applicability assessment is done, and yearly |
| Checklist | All layers |

## 1. Purpose and status

This page maps the 20 layers of the customer checklist to the Saudi National Cybersecurity
Authority (NCA) control sets **at domain level**, to prepare a gap assessment.

> **Applicability is not determined.** Whether the NCA Essential Cybersecurity Controls (ECC),
> Cloud Cybersecurity Controls (CCC) or Data Cybersecurity Controls (DCC) apply to Progrid Arabia
> (the only contracting entity, serving every customer on progrid.co and progrid.sa) depends on the organisation's role and sector, its customers (for
> example government entities and critical national infrastructure operators, and the cloud
> service providers that serve them), any registration or licensing with the Communications,
> Space and Technology Commission (CST) as a cloud service provider, and contractual
> requirements. A **formal applicability assessment** with counsel is required. Nothing here
> claims compliance with any NCA control set.

Control identifiers are intentionally not quoted. Subdomain names below are topics used for
orientation; the exact numbering and wording must be taken from the official current editions
(ECC-2:2024, CCC and DCC as published by NCA) during the formal assessment.

## 2. NCA structure used

| Control set | Domains (by name) | Relevance to Progrid |
|---|---|---|
| ECC (Essential Cybersecurity Controls) | Cybersecurity Governance; Cybersecurity Defense; Cybersecurity Resilience; Third-Party and Cloud Computing Cybersecurity | Baseline for organisations in scope of NCA |
| CCC (Cloud Cybersecurity Controls) | Builds on ECC with additional controls for cloud service providers (CSP) and cloud service tenants, across the same domain structure | Progrid is a CSP; relevant if it serves in-scope entities or a contract requires it |
| DCC (Data Cybersecurity Controls) | Builds on ECC for data protection across the data lifecycle (classification, protection, sharing, retention and disposal), by data classification level | Relevant where Progrid processes classified data of in-scope entities |
| Related Saudi law | PDPL (SDAIA) for personal data; NDMO data management standards for government data | Applies to Progrid Arabia's processing of personal data regardless of NCA scope [legal review needed] |

## 3. Layer to domain mapping

| # | Checklist layer | ECC domain (topic) | CCC theme | DCC theme | Main Progrid documents |
|---|---|---|---|---|---|
| 1 | Governance & ISMS | Governance: strategy, management, policies and procedures, roles, risk management, compliance, periodic review | Governance for CSP | Data governance | isms-scope.md, information-security-policy.md, roles-and-responsibilities.md, risk-methodology.md |
| 2 | Identity & Access Management | Defense: identity and access management | Tenant and CSP privileged access, MFA | Access to classified data | access-control-policy.md |
| 3 | Privileged Access & Management Plane | Defense: identity and access management; information system and processing facilities protection | CSP management plane protection | — | access-control-policy.md, infra-hardening.md |
| 4 | Network Security | Defense: networks security management | Network segregation between tenants and management | — | infra-hardening.md, threat-model.md |
| 5 | Edge, WAF & DDoS | Defense: networks security management; web application security | Protection of cloud services exposed to the internet | — | threat-model.md, incident-response-plan.md |
| 6 | Application & API Security | Defense: web application security; Governance: cybersecurity in IT projects | Secure development of cloud services | — | secure-development-lifecycle.md, threat-model.md |
| 7 | AI App Builder / Workload Isolation | Defense: information system protection | Tenant isolation, virtualisation and container security | — | threat-model.md (TB4, TB6) |
| 8 | Data Protection & Cryptography | Defense: data and information protection; cryptography | Encryption and key management for tenant data | Encryption, data protection by classification | cryptography-policy.md, key-management.md, data-classification-and-handling.md |
| 9 | Secrets & Credential Security | Defense: identity and access management; cryptography | Credential and key protection | — | key-management.md, access-control-policy.md |
| 10 | Secure Infrastructure & Containers | Defense: information system and processing facilities protection (hardening, malware protection, patching) | Hardening of virtualisation and container platforms | — | infra-hardening.md, vulnerability-and-patch-management.md |
| 11 | DevSecOps & Supply Chain | Governance: cybersecurity in IT projects; Third-party cybersecurity | Supply chain of the CSP | — | secure-development-lifecycle.md, change-management.md |
| 12 | Vulnerability & Patch Management | Defense: vulnerabilities management; penetration testing | CSP vulnerability management and testing | — | vulnerability-and-patch-management.md |
| 13 | Logging, Monitoring & SIEM | Defense: event logs and monitoring management | Logging for CSP and tenant events, log access by tenants | Monitoring of data access | logging-and-monitoring-policy.md |
| 14 | Incident Response | Defense: cybersecurity incident and threat management | Incident notification to tenants and authorities | Data breach handling | incident-response-plan.md |
| 15 | Backup, DR & Business Continuity | Resilience: cybersecurity in business continuity; Defense: backup and recovery management | CSP continuity and backup | Backup of classified data | business-continuity-and-dr.md |
| 16 | Third-Party & Supplier Security | Third-Party and Cloud Computing: third-party cybersecurity | CSP's own suppliers and subcontractors | Data sharing with third parties | supplier-security-policy.md, supplier-register.csv |
| 17 | Privacy, Data Lifecycle & Tenant Isolation | Defense: data and information protection | Data location, tenant data isolation, data deletion at exit | Data lifecycle, retention, secure disposal | data-retention-and-deletion.md, data-classification-and-handling.md |
| 18 | Physical & Data Center Security | Defense: physical security; Third-Party and Cloud Computing: cloud computing and hosting | Data centre location and physical controls of the CSP | Secure disposal of media | physical-and-shared-responsibility.md |
| 19 | People Security & Awareness | Governance: cybersecurity in human resources; awareness and training | CSP personnel screening, especially for privileged roles | Personnel handling classified data | people-security.md |
| 20 | Audit, Assurance & Continuous Improvement | Governance: periodical cybersecurity review and audit; compliance with standards and regulations | Independent assessment of CSP | — | internal-audit-and-management-review.md, control-register.md |

The NCA column of [control-register.csv](control-register.csv) uses the same domain names per
control.

## 4. Known Saudi-specific gaps to examine in the formal assessment

1. **Data location.** All hosting is in Germany today, including region `sa1`. NCA cloud and data
   controls and government contracts commonly expect data of in-scope entities to stay in the
   Kingdom; PDPL has its own transfer rules. Saudi hosting is a prerequisite for serving such
   customers.
2. **Personnel.** Some controls concern nationality or location of personnel with privileged
   access for in-scope customers. The ops module supports a `SAUDI_ONLY` residency policy per
   managed contract; platform-level administration has no such restriction today.
3. **Incident reporting to NCA** and timelines, if in scope (incident-response-plan.md §8.2).
4. **CST cloud registration** requirements for cloud service providers [legal review needed].
5. **Penetration testing and assessments** by parties acceptable to the regulator.

## 5. Next steps

1. Counsel and the Security owner perform the applicability assessment for each entity and record
   the result here.
2. If in scope, take the official control lists, add control-level rows to a copy of the control
   register, and assess each control against the evidence already mapped to the layers above.
3. Feed gaps into the risk register and the roadmap.
