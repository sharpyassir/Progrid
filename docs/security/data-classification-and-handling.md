# Data classification and handling

| | |
|---|---|
| Document owner | [Privacy lead — to be named] |
| Approved by | [Management — to be named], [Date] |
| Version | Draft, 6 October 2026 |
| Review | Yearly |
| ISO/IEC 27001:2022 | Annex A 5.12, 5.13, 5.14, 5.10, 8.11 |
| NCA | DCC (data classification and protection); ECC Defense domain (data and information protection) |
| Checklist | Controls 60, 132, 136, 137 |

## 1. Purpose

Give every kind of information a level, and say what each level allows.

## 2. Scope

All information Progrid creates, receives or processes, in any form, including customer content
processed under the DPA. Where a Saudi government customer requires its own classification
(for example under the National Data Management Office rules), the stricter rule applies to that
customer's data [legal review needed].

## 3. Levels

| Level | Definition | Examples |
|---|---|---|
| **Public** | Approved for anyone | Website, public docs, published legal pages, CLI and SDK code, status page |
| **Internal** | For staff and contractors; low harm if disclosed | Architecture docs, runbooks, most of `docs/`, non-sensitive tickets, this ISMS (except registers below) |
| **Confidential** | Harm to customers or Progrid if disclosed | Customer account data (names, emails, phone numbers, addresses), billing records, support tickets, audit logs, legal acceptance records, source code, risk/asset/control registers, supplier contracts, session metadata |
| **Restricted** | Serious harm; access only for a named need | Customer content (VM disks, volumes, buckets, databases, app data, Connect data), credentials and keys (`prgd.env`, Ansible vault, SECRETS_KEY, age identity, step-ca keys, deploy key), sealed customer secrets, verification documents (ID), session recordings, backups, vulnerability details before a fix |

When unsure, use the higher level. A collection takes the level of its most sensitive item.

## 4. Handling rules

| Rule | Public | Internal | Confidential | Restricted |
|---|---|---|---|---|
| Who may access | Anyone | Staff and contractors | Staff and contractors with a role need | Named people with a ticketed need; customer content only to fix a customer request or incident, or as the law requires |
| Storage | Anywhere | Company systems | Company systems listed in the asset register | Only the systems listed in the asset register for it; never on personal cloud drives, chat, email or laptops except encrypted and temporary |
| In transit | — | TLS | TLS | TLS or WireGuard, plus encryption of the file when sent outside the platform (age or a password-protected archive with the password sent separately) |
| At rest | — | — | Provider encryption where available | Sealed (secrets) or encrypted (backups); full disk encryption planned |
| Labelling | None | None needed | "Confidential" in the header or file name of documents and exports | "Restricted" in the header or file name; exports carry the label |
| Sharing outside Progrid | Free | With approval | Under NDA or contract, minimum needed | Only with the customer it belongs to, a subprocessor under contract, or an authority under the law-enforcement guidelines |
| AI tools | Allowed | Allowed in company-approved tools | Only in tools approved for Confidential data | Never paste into AI tools, except customer content the customer itself sends through Connect |
| Disposal | — | Delete | Delete; empty trash | Secure deletion (data-retention-and-deletion.md; physical-and-shared-responsibility.md §4) |

## 5. Specific handling

1. **Customer content** is processed only on the customer's instructions (DPA section 3). Staff
   and engineers shall not open, copy or read customer content except to answer a request from
   that customer, to fix an incident, or as the law requires; the reason is recorded in the
   ticket.
2. **Support access** goes through the back office (reads audited) or, for managed assets, through
   access grants and the recorded gateway. Screen sharing with customers is allowed; recording it
   needs the customer's consent.
3. **Contractor view**: the ops API masks email addresses and phone numbers and never returns
   billing data (`apps/api/src/modules/ops/serializers/ops-dto.ts`).
4. **Exports and downloads**: invoice PDFs, report PDFs and recordings are served only to
   authorised users; recordings through five-minute URLs. Bulk exports of Confidential data
   (database dumps, CSV exports of customers) need Security owner approval and are deleted after
   use.
5. **Test data**: production customer data shall not be copied into development, CI or demo
   environments. Use seed data and fake drivers.
6. **Logs** shall not contain passwords, tokens, secrets, card data or customer content; secrets
   are redacted in Connect steps and build logs.
7. **Card data** never reaches Progrid systems (Moyasar hosted payment pages).

## 6. Data flows

The data flow diagrams for sensitive information are in [threat-model.md](threat-model.md) §2.
They are reviewed with every new integration.

## 7. Roles

Privacy lead owns the scheme; information owners (asset register) classify their assets; every
person handles data by its level.

## 8. Evidence produced

Asset register with classification, approvals for bulk exports, training records, review notes.

## 9. Review cycle

Yearly.

## 10. Mapping

| Framework | Reference |
|---|---|
| ISO/IEC 27001:2022 | Annex A 5.10, 5.12, 5.13, 5.14, 8.11, 8.33 |
| NCA DCC | Data classification, data protection, data sharing |
| NCA ECC | Defense: data and information protection |
| Checklist | 60, 132, 136, 137 |
