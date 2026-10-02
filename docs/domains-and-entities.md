# Domains and billing entities

Progrid is one global brand on one platform: one database, one account system, one set of apps.
Two domains and two companies sit on top of it.

| | progrid.co | progrid.sa |
|---|---|---|
| Role | Primary, global | Local storefront for Saudi Arabia |
| Hosts | progrid.co, www, console, api, ops, gateway | the same hosts on progrid.sa |
| Contracting company | Progrid Technologies LLC (United States) | Progrid Arabia (Saudi Arabia) |
| Who it bills | Every billing country except Saudi Arabia | Billing country Saudi Arabia |
| Currency | USD | SAR |
| Tax on invoices | None by default (`ENTITY_LLC_TAX_RATE`, 0) | VAT 15% |
| E-invoicing | None | ZATCA (Fatoora) through the e-invoicing provider |
| Card gateway | Stripe | Moyasar (mada, Visa, Mastercard, Apple Pay) |
| Invoice series | `PRGD-US-YYYY-NNNNN`, credit notes `CN-US-...` | `PRGD-SA-YYYY-NNNNN`, credit notes `CN-SA-...` |
| Mail sender | `Progrid <no-reply@progrid.co>` | `Progrid <no-reply@progrid.sa>` |
| Support inbox | support@progrid.co | support@progrid.sa |
| Legal pages | progrid.co/legal/* (LLC, governing law to be confirmed) | progrid.sa/legal/* (Saudi law) |

Accounts work on both domains. A customer can sign in on console.progrid.co or console.progrid.sa
with the same email; only the website redirects by country.

## Architecture

**Caddy** (`infra/prod/Caddyfile`) imports one snippet per domain (`import sites {$DOMAIN}` and
`import sites {$DOMAIN_SA}`), so every site exists on both and Caddy gets a certificate for each
host. `www.X` redirects to the apex of the same domain. Caddy sets `X-Real-IP` and
`X-Forwarded-For` to the address it saw for the website and the API; the apps trust them because
only Caddy reaches them.

**Addresses at runtime.** No app hardcodes one domain:

- The website reads the Host and shows the storefront of that domain (`apps/www/src/lib/site.ts`).
  Pages render per request; console and API links point at `console.X` and `api.X`.
- The console derives `api.X` and the website from `console.X` in the browser
  (`apps/console/src/lib/urls.ts`).
- The ops console derives `api.X` and `wss://gateway.X` from `ops.X`, and its Content Security
  Policy allows the API and gateway of the domain it is served on (`apps/ops/src/lib/security-headers.ts`).
- The build time `NEXT_PUBLIC_*` values are only the fallback for other hosts (local runs, previews).
  They default to progrid.co.

**API.** Customer facing links follow the customer's company (`apps/api/src/common/entities/entities.ts`):

- Mail: the sender, reply address, logo and console links of the team's company. Links built on
  the primary console are rewritten to the company's console.
- Browser redirects (payment return, OAuth return, verification and reset links) go back to the
  console the person used, when it is one of ours, else to the company's console. Sessions live in
  the browser storage of one origin, so this keeps people signed in.
- API responses (Connect run endpoints and webhook URLs, deploy hooks, managed install commands,
  terminal gateway URLs) use the API host the request came through.
- CORS: our own origins on both domains (website, console, ops) may call the API with credentials.
  Other origins get CORS without credentials, so customer apps can still call the API with a token.
- OAuth: the callback goes to `api.X` of the domain the sign in started on. Register both redirect
  URIs with Google and Microsoft (below).
- Ops WebAuthn: the relying party follows the browser origin. Passkeys are bound to one relying
  party, so a passkey registered on ops.progrid.co does not work on ops.progrid.sa. Staff use
  **ops.progrid.co** as their ops console and register passkeys there. TOTP works on both.
- The terminal gateway accepts both ops origins (`PRGD_GATEWAY_ALLOWED_ORIGINS`).

## Website redirect for Saudi Arabia

`apps/www/src/middleware.ts` runs on the Node.js runtime and calls the pure decision function in
`apps/www/src/lib/geo-redirect.ts` (unit tested in `geo-redirect.test.ts`). In order:

1. Only page views (GET or HEAD), not assets, `/_next`, `/api` or files.
2. Only on progrid.co and www.progrid.co. progrid.sa never redirects anywhere.
3. `?site=global` sets the cookie `prgd_site=global` for a year and stays. The cookie keeps the
   visitor on progrid.co from then on. The footer of progrid.sa links to the global site with this
   parameter ("Global site · الموقع العالمي"); progrid.co links to the Saudi site ("Saudi Arabia
   site · الموقع السعودي").
4. Crawlers, link preview bots, monitors and headless renderers are never redirected, so both sites
   index cleanly. Every page carries `hreflang` alternates: progrid.co as `en`, `ar`, `tr` and
   `x-default`, progrid.sa as `en-SA`, `ar-SA`, `tr-SA`.
5. The country of `X-Real-IP` from the local database. Saudi Arabia: `302` to the same path and
   query on progrid.sa, with `Cache-Control: private, no-store`. Any other country, an unknown
   address or no database: no redirect.

The console, the API and the ops console are never redirected.

### Country database

DB-IP "IP to Country Lite" (https://db-ip.com), CC BY 4.0, no license key. The site footer carries
the required attribution ("IP geolocation by DB-IP"). It is read with `mmdb-lib`; both the
official file (`country.iso_code`) and the ip-location-db build (`country_code`) work.

- **Where:** `infra/geoip/fetch-dbip.sh` downloads `dbip-country-lite-YYYY-MM.mmdb.gz` (this month,
  else last month) when the www image is built (`/app/geoip`, `GEOIP_DB_PATH`) and when the api
  image is built (`/opt/prgd/geoip`, for the signup prefill). A failed download does not fail the
  build; the site then simply does not redirect.
- **Monthly refresh:** the deploy workflow passes `GEOIP_MONTH=YYYY-MM` as a build argument, so the
  layer is rebuilt the first deploy of each month. Without a deploy in a month, run the workflow
  by hand (workflow_dispatch), or mount a fresh file at `GEOIP_DB_PATH`. The reader notices a
  changed file without a restart.

## Billing entities

**Rule.** The company follows the team's **billing country**, never the visitor's IP address:
`SA` is Progrid Arabia, every other country Progrid Technologies LLC. The currency follows the
company (SAR or USD). TRY does not exist in the schema (only USD and SAR), so there is nothing to
keep or hide.

**Signup** asks for the billing country. The console prefills it from `GET /v1/geo`: SA on the
progrid.sa domain, otherwise the country of the caller's address from the same DB-IP database,
otherwise US. The person can pick any country and the company follows what they pick. Social
sign up passes the picked country to the API. A signup without a country (CLI, older clients)
gets the same default.

**Stored** on the team (`billingEntity`), on every invoice and on every credit note. Migration
`20261004100000_billing_entities` sets existing teams by country (SA: Progrid Arabia, others: the
LLC) and marks every existing invoice and credit note as Progrid Arabia, the only company that
existed when they were issued. Old invoices keep their numbers (`PRGD-2026-000123`). A team whose
stored currency does not match its new company keeps its currency; find them with
`SELECT id, country, currency, "billingEntity" FROM prgd_teams WHERE ("billingEntity" = 'progrid_llc') <> (currency = 'USD');`
and move them with the back office change below.

**Changing company** is staff only (finance role): back office, team page, "Billing country and
company", or `POST /admin/v1/teams/:id/billing-country { country, reason }`. A country within the
same company changes at once. A change of company is scheduled for the first day of the next
month: the current month is rated and invoiced by the old company, usage from that day is rated in
the new currency, and the monthly invoice run folds the change into the team. Every step is in the
audit log (`admin.team_billing_entity_scheduled`, `team.billing_entity_changed`). Credit left in the
old currency is not converted; refund it or reissue it by hand. Customers cannot change their
billing country across companies (`409 billing_country_locked`).

**Invoices and PDFs** carry the company's legal name, address, registration numbers and tax
number, its series, currency and tax line, "TAX INVOICE" and the ZATCA note for Progrid Arabia,
payment instructions (card on the company's console, bank details when set) and its terms. The
e-invoicing hand off (`eInvoiceType: zatca`) is set only for Progrid Arabia.

**Payments** go to the company of the invoice (or of the team for a top up): Moyasar with
`MOYASAR_*` for Progrid Arabia, Stripe Checkout with `STRIPE_*` for the LLC. Stripe webhook:
`https://api.progrid.co/v1/billing/payments/stripe/webhook`, events `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
`checkout.session.expired`.

**Prices.** The price book is in SAR. USD prices are the SAR prices converted at the stored
USD to SAR rate (`FX_USD_SAR`, 3.75, the peg) at the hour of usage, rounded to the cent per hour.
This covers every SKU, including the Connect token prices. The website on progrid.co shows USD,
progrid.sa shows SAR with VAT.

**Back office:** teams and invoices filter by company, the finance page shows invoiced, collected
and open amounts per company and month (`GET /admin/v1/finance/entities?month=YYYY-MM`).

## Configuration

New settings (all in `.env.example`, `infra/prod/prgd.env.example`, the Ansible template and
`group_vars/all.yml.example`):

| Setting | Purpose |
|---|---|
| `DOMAIN`, `DOMAIN_SA` | Caddy sites and certificates (compose, Ansible `domain`, `domain_sa`) |
| `PRGD_DOMAIN`, `PRGD_DOMAIN_SA` | Website storefronts (compose passes them from `DOMAIN`, `DOMAIN_SA`) |
| `WWW_URL` | Primary website |
| `ENTITY_LLC_DOMAIN`, `ENTITY_ARABIA_DOMAIN` | Domain of each company; customer links use `console.X`, `api.X` |
| `ENTITY_*_LEGAL_NAME`, `_ADDRESS`, `_EIN` / `_CR`, `_VAT_NUMBER`, `_BANK_DETAILS` | Printed on invoices; empty prints a placeholder |
| `ENTITY_LLC_TAX_RATE`, `ENTITY_LLC_TAX_LABEL`, `ENTITY_ARABIA_VAT_RATE` | Tax line per company |
| `ENTITY_*_SUPPORT_EMAIL`, `ENTITY_*_MAIL_FROM`, `ENTITY_*_TERMS_URL` | Mail and invoice footer per company |
| `PAYMENT_PROVIDER_LLC`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_BASE_URL` | Stripe for the LLC |
| `PRGD_OPS_URL_SA`, `PRGD_OPS_RP_ID_SA` | The ops console on progrid.sa |
| `CORS_EXTRA_ORIGINS` | More origins allowed with credentials |
| `GEOIP_DB_PATH` | DB-IP Lite database (api and www) |

Changed defaults: `MAIL_FROM` and `SUPPORT_INBOX` are the progrid.co addresses (staff and system
mail), `OAUTH_REDIRECT_BASE` is empty in production so the callback follows the domain, the gateway
allows both ops origins, `COMPANY_NAME` is the brand ("Progrid"). `COMPANY_ADDRESS` and
`COMPANY_TAX_ID` remain as fallbacks for Progrid Arabia's address and VAT number.

## What the owner must provide

Nothing below is invented in the code: unset values print a bracketed placeholder or nothing.

- **Progrid Technologies LLC:** exact legal name, state of organization, registered address, EIN,
  bank details for transfers (optional), a Stripe account (live secret key and the webhook signing
  secret), and counsel's choice of governing law and venue for the terms (marked
  "[to be confirmed]" on progrid.co/legal/terms, acceptable use and privacy). Whether any US sales
  tax applies; until then `ENTITY_LLC_TAX_RATE=0` and the invoices print no tax line and make no
  tax claim.
- **Progrid Arabia:** commercial registration (CR) number, VAT registration number, registered
  address, bank details (optional), the Moyasar account (already used), and the e-invoicing
  provider for ZATCA.
- **Mail:** add progrid.co to Resend (sending and receiving) next to progrid.sa.
- **OAuth:** add the progrid.co redirect URIs to the Google and Microsoft apps (below).

## DNS records for progrid.co

All pointing at the management host's public address (`PUBLIC_IP`), TTL 300 during the move:

| Name | Type | Value |
|---|---|---|
| `progrid.co` (`@`) | A | `PUBLIC_IP` |
| `www.progrid.co` | A (or CNAME to `progrid.co`) | `PUBLIC_IP` |
| `console.progrid.co` | A (or CNAME to `progrid.co`) | `PUBLIC_IP` |
| `api.progrid.co` | A (or CNAME to `progrid.co`) | `PUBLIC_IP` |
| `ops.progrid.co` | A (or CNAME to `progrid.co`) | `PUBLIC_IP` |
| `gateway.progrid.co` | A (or CNAME to `progrid.co`) | `PUBLIC_IP` |
| `progrid.co` | AAAA | only if the host has IPv6 and Caddy listens on it |
| `progrid.co` | CAA | `0 issue "letsencrypt.org"` (optional, recommended) |
| `get.progrid.co` | CNAME | wherever the CLI installer is hosted, if it moves from progrid.sa |

Mail, later, once Resend shows them: the DKIM TXT record `resend._domainkey.progrid.co`, the SPF
TXT and MX records of the `send` subdomain for bounces, a DMARC TXT record at `_dmarc.progrid.co`
(start with `v=DMARC1; p=none; rua=mailto:...`), and for receiving support mail the MX record at
the root that Resend displays. Keep the existing progrid.sa records.

## OAuth redirect URIs to add

- Google: `https://api.progrid.co/v1/auth/oauth/google/callback` next to the progrid.sa one;
  add `progrid.co` to the authorized domains.
- Microsoft: `https://api.progrid.co/v1/auth/oauth/microsoft/callback` next to the progrid.sa one.

## Rollout order

1. **DNS first.** Create the progrid.co records above and wait until every host resolves
   (`dig +short` for each). Caddy cannot get certificates for hosts that do not resolve.
2. **Provider settings.** Add the OAuth redirect URIs and the Stripe webhook endpoint (it can wait
   until Stripe is live; until then keep `PAYMENT_PROVIDER_LLC=fake` only on a demo box, never in
   production, or leave LLC card payments unavailable).
3. **Configuration.** Set `domain: progrid.co` and `domain_sa: progrid.sa` and the entity details
   in `group_vars`, put the Stripe secrets in the vault, run the playbook. It renders `prgd.env`
   and copies the new Caddyfile.
4. **Deploy.** Push to main (or run the deploy workflow). The migration adds the billing entity
   columns and sequences.
5. **Verify certificates and routing.** For each of the twelve hosts: `curl -sI https://HOST` shows
   a valid certificate. Then check: progrid.co shows US dollars and the LLC footer; progrid.sa shows
   riyals with VAT; `curl -sI -H 'X-Real-IP: <a Saudi address>' https://progrid.co/` is not
   possible from outside (Caddy overwrites it), so test the redirect from a Saudi connection or a
   VPN; `?site=global` stays on progrid.co; `curl https://api.progrid.co/v1/geo` answers.
6. **Back office.** Run the mismatch query above and move any team whose currency does not match
   its company. Staff register passkeys on ops.progrid.co.
