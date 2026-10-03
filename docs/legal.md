# Legal documents and acceptance

The agreement every customer accepts, and how the platform records it.

## Documents

Served at `/legal/<slug>` on each storefront, with an index at `/legal`. Each company has its own
set: `apps/www/content/pages/co/en/` for Progrid Technologies LLC (progrid.co, English) and
`apps/www/content/pages/sa/{en,ar}/` for Progrid Arabia (progrid.sa, English and Arabic; the
Arabic version prevails). SLA, cookies and the affiliate terms are shared (`pages/shared/`).

| Slug | Document | Accepted at signup |
|---|---|---|
| terms | Terms of service, including section "Illegal activity, fraud and abuse" (immediate suspension, termination, lifetime ban, retention of amounts, legal action) | yes |
| acceptable-use | Acceptable use policy | yes |
| privacy | Privacy policy (GDPR, UK, US states, PDPL and others) | yes |
| dpa | Data processing addendum | incorporated by the terms |
| subprocessors | Subprocessor list | referenced |
| refunds, sla, cookies | Refunds, service levels, cookies | incorporated by the terms |
| copyright | Copyright and IP complaints (DMCA on progrid.co, Saudi Copyright Law on progrid.sa) | |
| law-enforcement | Requests from authorities | |
| export-sanctions | Export controls and sanctions | incorporated by the terms |

All documents are drafts for legal review. Placeholders in square brackets (state of
organization, governing law, registered address, EIN, commercial registration, VAT number, DMCA
agent registration, EU and UK representative) must be completed by counsel before launch.

## Acceptance (clickwrap)

- **Signup** (`POST /v1/auth/signup`) requires `acceptTerms: true`, ticked in the console.
- **Google and Microsoft** sign up: the console sends `legal=<version>` to the start URL once the
  box is ticked; the social buttons on the signup form stay disabled until then.
- **Invitations**: `POST /v1/invitations/accept-signup` requires `acceptTerms: true`.
- Every acceptance is a row in `prgd_legal_acceptances`: user, version, documents, company,
  method (signup, oauth_signup, invite, reaccept), IP address, user agent and time. The user row
  keeps the latest version (`legalVersion`, `legalAcceptedAt`). Rows are kept for the life of the
  account plus 5 years (privacy policy).
- **Enforcement**: a user whose `legalVersion` is not the current `LEGAL_VERSION`
  (`apps/api/src/modules/legal/legal.ts`) gets `428 legal_acceptance_required` on every request,
  from the console and through API tokens, except `GET /v1/account`, `/v1/auth/*` and `/v1/legal`.
  The console then shows the documents with an "I agree" button (`POST /v1/legal/accept`, console
  sessions only). The ops console (engineers) is not affected.

## Changing a document

1. Edit the Markdown in every language of both companies and update `updated:` in the front matter.
2. Material change: tell customers by email and in the console at least 30 days before it takes
   effect (immediately when the law or security requires it), as the terms promise.
3. On the effective date, bump `LEGAL_VERSION` (a date, `YYYY-MM-DD`) and deploy. Every user is
   asked to accept again before their next request; API tokens stop working until the owner
   accepts, so warn API heavy customers in the notice.
4. Typo and formatting fixes do not need a new version.

At the first deploy of this feature every existing user is asked to accept, because none of them
has an acceptance on record.
