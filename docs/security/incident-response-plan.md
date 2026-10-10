# Incident response plan

| | |
|---|---|
| Document owner | [Security owner — to be named] |
| Approved by | [Management — to be named], [Date] |
| Version | Draft, 6 October 2026 |
| Review | Yearly, after every Sev 1 or Sev 2 incident, and after each tabletop |
| ISO/IEC 27001:2022 | Annex A 5.24, 5.25, 5.26, 5.27, 5.28, 5.5, 6.8 |
| NCA | ECC Defense domain (cybersecurity incident and threat management) |
| Checklist | Controls 37, 106-113 |

> **Legal review needed.** The regulator notification duties in §8 are a working summary for
> planning, not legal advice. Counsel must confirm them for each entity before this plan is
> approved.

## 1. Purpose

Detect, contain and recover from security incidents quickly, notify the right people on time,
and learn from each one.

## 2. Scope

Any event that may affect the confidentiality, integrity or availability of Progrid or customer
information: compromise of accounts or hosts, data exposure, cross-tenant access, malware, abuse
launched from the platform that harms third parties, DDoS, loss of backups, supplier breaches
affecting our data, lost devices, and insider misuse. Platform outages without a security cause
follow the same roles but the availability runbooks in
[business-continuity-and-dr.md](business-continuity-and-dr.md).

## 3. Severity matrix

| Severity | Definition (any one) | Examples | Response start | Updates |
|---|---|---|---|---|
| **Sev 1 — Critical** | Confirmed exposure or loss of customer data; cross-tenant access; compromise of the management host, a Proxmox node, keys or CI; platform-wide outage from an attack | Root on the management host; leaked `prgd.env`; tenant reads another tenant's disk | Immediately, 24/7 | Every 2 hours internally; customers as in §8 |
| **Sev 2 — High** | Likely exposure of personal data for some customers; compromise of a staff, engineer or provider admin account; exploited vulnerability without confirmed data access; sustained DDoS | Phished staff account; engineer acting outside a grant | Within 1 hour, 24/7 | Every 4 hours |
| **Sev 3 — Medium** | Contained event with limited impact; abuse from a customer VM; single customer account takeover | Credential-stuffed customer account; phishing site on App Platform | Within 1 business day | Daily |
| **Sev 4 — Low** | Suspicious activity without impact; policy breach without exposure | Port scans; lost laptop with full disk encryption | Within 3 business days | At closure |

When unsure, choose the higher severity; downgrade later with a note.

## 4. Roles and decision authority

| Role | Who | Authority |
|---|---|---|
| Incident commander (IC) | Security owner; deputy [to be named]; on-call engineer until the IC joins | Declares severity, runs the response, decides containment steps (including taking services offline, revoking all sessions and tokens, suspending accounts) |
| Technical lead | Engineering or Operations lead | Investigation and fixes |
| Privacy lead | [Privacy lead — to be named] with counsel | Decides whether personal data is affected and which notifications are due |
| Communications | Support lead | Customer messages, status page, support inbox |
| Management | [Management — to be named] | Informed of every Sev 1-2 within 1 hour; approves regulator notifications, public statements and payments to third parties |
| Scribe | Anyone assigned by the IC | Timeline in the incident record |
| Contracted engineers | As assigned | Only within assigned contracts and grants |

The IC may act without waiting for approval to contain a Sev 1-2 incident.

## 5. Contacts and reporting

- **Report an incident:** security@progrid.co (also published in `SECURITY.md` and
  `/.well-known/security.txt`). Staff and contractors also message the IC directly.
- **24/7 security on-call:** [phone number — to be set], reached through the on-call paging of the
  managed module (`PAGING_MODE=live`, Twilio). Primary: [name]; secondary: [name].
- **Escalation:** IC → Management → counsel.
- **Provider security contacts:** DigitalOcean [abuse/security contact — to record], Hetzner
  [abuse contact — to record], GitHub, Moyasar, Resend, Anthropic [to record].
- **Authorities:** see §8.

A contact list with current names and numbers is kept in
`evidence/14-incident-response/contacts.md` (Restricted) and tested at each tabletop.

## 6. Phases

1. **Detect and report.** Sources: alerts (logging-and-monitoring-policy.md §6), customer and
   researcher reports, provider abuse notices, staff observations. Anyone may declare a
   suspected incident.
2. **Triage (within the response start time).** IC confirms, assigns severity, opens an incident
   record (`INC-YYYY-NNN`) and a private channel, names roles.
3. **Contain.** Short term: revoke sessions and tokens (`prgd_sessions`, API tokens), disable
   accounts, revoke engineer grants (`POST /admin/ops/access/grants/{id}/revoke`, which also kills
   sessions), suspend abusive teams, block IPs in ufw/Caddy, stop affected services, isolate a VM
   (Proxmox firewall), take the droplet off the internet with the DigitalOcean cloud firewall.
   Preserve evidence (§7) **before** wiping or rebuilding where possible.
4. **Eradicate.** Remove the cause: patch, remove malicious code, rotate every credential the
   attacker could have read (key-management.md rotation procedure; reseal secrets), rebuild hosts
   from Ansible rather than cleaning them.
5. **Recover.** Restore from known-good backups if needed (business-continuity-and-dr.md §7),
   verify integrity (audit chain, image digests), monitor closely for 14 days.
6. **Notify** as in §8, in parallel with steps 3-5.
7. **Close and learn.** Postmortem (§9), register update (§10), CAPA items.

### Playbook: emergency traffic filtering (checklist 37)

1. Confirm the attack in Caddy logs (top client IPs, paths, user agents) and provider graphs.
2. Raise rate limits' strictness or block paths at Caddy (config change through git, or a hot
   change recorded afterwards).
3. Block source ranges with ufw on the management host, or with the DigitalOcean cloud firewall
   for volumetric traffic; for nodes, Hetzner's firewall in Robot.
4. Ask the provider for upstream filtering (DigitalOcean support, Hetzner DDoS team).
5. If an edge provider (CDN/WAF) has been contracted by then, switch DNS for the affected
   hostnames to it.
6. Post status updates; remove emergency rules within 7 days or convert them into reviewed
   configuration.

## 7. Evidence preservation

1. Before changing a compromised system: take a provider snapshot (droplet snapshot, Proxmox
   snapshot of a VM), copy relevant logs, export the audit log range, keep session recordings.
2. Compute a sha256 for each item; record who collected it, when, from where and how, and every
   later access (chain of custody form in §12).
3. Store evidence encrypted in the evidence store (Restricted), not in chat or email.
4. Keep evidence 3 years after closure, or longer under legal hold.
5. Clocks: all sources are UTC and NTP-synchronised; record any offset found.

## 8. Notification

### 8.1 Customers

- Under the DPAs (co section 8, sa section 8): notify affected customers of a security incident
  affecting their personal data **without undue delay and where feasible within 72 hours** of
  becoming aware, by email to the account owner and in the console where possible, with the
  content in DPA 8.2 (nature, categories and approximate numbers, likely consequences, measures,
  contact). Provide information in stages.
- For managed cloud customers: incident notice per the contract and SLA.
- Template: §12.1.

### 8.2 Regulators (legal review needed)

| Regime | When Progrid is | Duty (summary) | Who |
|---|---|---|---|
| GDPR / UK GDPR (EU and UK data subjects) | Controller (account data) | Notify the competent supervisory authority within 72 hours of awareness unless unlikely to result in a risk; notify data subjects when high risk. Lead authority to be determined (no EU establishment; EU representative [to be appointed]) | Privacy lead with counsel |
| GDPR | Processor (customer content) | Notify the customer (controller) without undue delay; the customer notifies its authority | Privacy lead |
| Saudi PDPL (Progrid Arabia as controller) | Controller | Notify SDAIA within 72 hours of becoming aware where the regulations require, and affected people without undue delay where the breach may harm them (sa privacy policy §9) | Privacy lead with counsel |
| Saudi PDPL | Processor | Notify the controller customer so it can notify SDAIA (sa DPA 8.1) | Privacy lead |
| NCA | Only if Progrid is in scope of NCA controls or a contract requires it (formal applicability assessment pending, nca-mapping.md) | Report cybersecurity incidents to NCA through its designated channel within the time the applicable controls or contract set | Security owner with counsel |
| US state breach laws | Controller for US residents' account data | Notify affected residents and, where thresholds are met, state attorneys general within the state deadlines | Privacy lead with counsel |
| Payment schemes / providers | Card data never touches Progrid; if payment accounts are compromised | Notify Moyasar at once | Finance lead |
| Law enforcement | Criminal activity | Optional, decided by Management with counsel | Management |

Every notification decision (including a decision **not** to notify) is recorded with the reason
in the incident record.

## 9. Root cause analysis and corrective action

1. Sev 1 and Sev 2 incidents need a written postmortem within 10 working days, using the same
   sections as managed P1 postmortems (timeline, impact, root cause, fix, prevention).
   Sev 3 needs a short root cause note.
2. Blameless: focus on causes and controls.
3. Each prevention item becomes a CAPA entry (internal-audit-and-management-review.md §5) with an
   owner and due date; the risk register is updated (risk-methodology.md §6, trigger 4).

## 10. Incident register

`evidence/14-incident-response/incident-register.csv` with columns: ID, date opened, date
detected, reported by, severity, category, summary, assets, personal data affected (Y/N),
customers affected, notifications made (who, when), status, date closed, postmortem link, CAPA
ids. Restricted.

## 11. Exercises

| Exercise | Frequency | Scenarios to rotate |
|---|---|---|
| Tabletop | Twice a year ([Date], [Date]) | Leaked `prgd.env`; App Platform container escape; compromised contractor account; ransomware on the management host with backup loss; DDoS on the API; supplier breach at the mail provider; PDPL notification drill |
| Technical drill | Yearly | Full credential rotation; restore from backup into a clean host (with business-continuity-and-dr.md §8) |

Records (scenario, attendees, gaps found, actions) go to `evidence/14-incident-response/exercises/`.

## 12. Templates

### 12.1 Customer notification (first notice)

> Subject: Security incident notice — Progrid Arabia
>
> We are writing to tell you about a security incident that affects [your account / data you
> store on Progrid]. On [date, time UTC] we became aware that [short description]. Based on what
> we know now, the data involved is [categories], for approximately [number] [records / people].
> The likely consequences are [consequences]. We have [measures taken] and will [next steps].
> We recommend that you [actions for the customer]. We will send further information as our
> investigation continues, at the latest on [date]. Contact: [name, email, phone].
> This notice is given under section 8 of our Data processing addendum.

### 12.2 Internal incident record

ID; severity; IC; timeline (UTC); detection source; systems and data affected; containment
actions; evidence collected (with hashes); notifications (who, when, by whom, decision reason);
recovery; root cause; CAPA ids; closure approval.

### 12.3 Chain of custody

Item; sha256; source system and path; collected by; date and time UTC; method; storage location;
each later access (who, when, why).

### 12.4 Regulator notification (draft for counsel)

Entity; contact person; date and time of awareness; nature of the breach; categories and
approximate number of data subjects and records; likely consequences; measures taken or proposed;
whether data subjects were informed; cross-border aspects.

## 13. Roles, evidence and review

Evidence: incident register, records, postmortems, notifications sent, exercise records.
Review: yearly and after every Sev 1-2 incident and exercise.

## 14. Mapping

| Framework | Reference |
|---|---|
| ISO/IEC 27001:2022 | Annex A 5.5, 5.24, 5.25, 5.26, 5.27, 5.28, 6.8 |
| NCA ECC | Defense: cybersecurity incident and threat management |
| Checklist | 37, 106-113 |
