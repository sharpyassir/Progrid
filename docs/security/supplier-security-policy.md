# Supplier security policy

| | |
|---|---|
| Document owner | [Security owner — to be named], with [Privacy lead — to be named] |
| Approved by | [Management — to be named], [Date] |
| Version | Draft, 6 October 2026 |
| Review | Yearly |
| ISO/IEC 27001:2022 | Annex A 5.19, 5.20, 5.21, 5.22, 5.23 |
| NCA | ECC Third-party and cloud computing cybersecurity domain |
| Checklist | Controls 123-130, 139-142 |

The register of suppliers is [supplier-register.csv](supplier-register.csv). The public list of
subprocessors is `apps/www/content/pages/{co/en,sa/en,sa/ar}/subprocessors.md`.

## 1. Purpose

Make sure suppliers that host, process or can affect Progrid and customer information protect it
to the level Progrid promises its customers.

## 2. Scope

All suppliers of services, software and infrastructure in the ISMS scope: hosting providers,
SaaS, payment providers, AI model providers, open-source components and registries, contractors
(also covered by people-security.md).

## 3. Classification

| Criticality | Criteria | Examples |
|---|---|---|
| Critical | Hosts or can read customer content or the control plane database; or its failure stops the platform or payments | DigitalOcean, Hetzner, GitHub, Stripe, Moyasar, domain registrar |
| High | Processes personal data or customer content in a limited way, or holds credentials | Resend, Postmark (if enabled), Anthropic, Infisical (if enabled), Let's Encrypt, image and package registries, e-invoicing provider |
| Medium | Limited personal data, easy to replace | Twilio, Google and Microsoft sign in |
| Low | No personal data, easily replaced | DB-IP database, FX rate feed |

## 4. Before onboarding

1. Business owner records purpose, data, location and criticality in the register.
2. For Critical and High suppliers, the Security owner reviews before any data flows:
   - independent assurance: ISO/IEC 27001 certificate (with scope and validity), SOC 2 Type II or
     SOC 3 report, PCI DSS attestation for payment providers, CSA STAR where available; filed under
     `evidence/16-suppliers/<supplier>/`. A certificate is accepted only after checking the
     issuer, scope (the service and location we use) and expiry. **None is assumed to be held until
     it is verified and filed.**
   - their security documentation or questionnaire answers (access control, encryption, incident
     notice, subprocessors, data location, deletion at exit);
   - data location and transfer mechanism (SCCs, adequacy, PDPL transfer basis for Progrid Arabia
     data [legal review needed]).
3. Privacy lead: DPA signed or accepted and filed; the supplier added to the subprocessor pages
   with at least 30 days' notice to customers when it processes customer personal data.
4. Account set-up: MFA on, personal admin accounts, least privilege API keys stored in the vault.

## 5. Contract requirements

Contracts or accepted terms with Critical and High suppliers shall cover: confidentiality;
security measures; use of data only for providing the service; subprocessor flow-down; breach
notification to Progrid without undue delay (target 24-72 hours); assistance with data subject
requests and audits (or provision of audit reports); data location; return and deletion at
exit; liability. Where standard terms cannot be negotiated, gaps are recorded as risks.

## 6. Monitoring and review

1. Critical suppliers: yearly review of certificates/reports, incidents, changes to terms,
   subprocessors and locations; recorded in the register ("Last review", "Next review").
2. High suppliers: yearly light review (certificate validity, terms changes).
3. Material changes (new location, new subprocessor, breach, acquisition) trigger a review and a
   risk reassessment (risk-methodology.md §6).
4. Suppliers' status pages and security notices are followed by the Operations lead.

## 7. Change of subprocessors

When a supplier that processes customer personal data is added or replaced: update the register,
update all three subprocessor pages in the same pull request, email account owners at least 30
days before processing starts (DPA section 6), handle objections per the DPA.

## 8. Exit and portability plans

| Supplier | Exit plan | Tested |
|---|---|---|
| DigitalOcean | Rebuild the control plane on another provider with Ansible and the off-site backups (business-continuity-and-dr.md §7.1); DNS cut-over | [Date] |
| Hetzner | Proxmox nodes are standard; customer VMs exportable (vzdump); move to another dedicated provider or own hardware (docs/hardware-plan.md) | Not yet |
| GitHub | Mirror repository; images buildable locally; alternative registry | Not yet |
| Resend | Postmark adapter exists | Not yet |
| Stripe / Moyasar | Payment provider interface; bank transfer fallback | Not yet |
| Anthropic | Model provider interface (`connect/models`); fake provider for degraded mode | Not yet |
| Infisical / Vault | `SecretStore` interface supports Vault, Infisical and local | Not yet |

## 9. Roles

Security owner: assessments and reviews. Privacy lead: DPAs and subprocessor notices.
Management: approves Critical suppliers and exit decisions. Business owners: keep register
entries current.

## 10. Evidence produced

Supplier register with review dates, filed certificates and reports, DPAs, assessment notes,
subprocessor change notices, exit plan tests.

## 11. Review cycle

Yearly.

## 12. Mapping

| Framework | Reference |
|---|---|
| ISO/IEC 27001:2022 | Annex A 5.19, 5.20, 5.21, 5.22, 5.23 |
| NCA ECC | Third-party and cloud computing cybersecurity |
| NCA CCC | Third-party and cloud: cloud service provider obligations |
| Checklist | 123-130, 139-142 |
