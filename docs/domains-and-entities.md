# Domains and the billing entity

Progrid is one global brand on one platform: one database, one account system, one set of apps,
two domains and **one contracting company: Progrid Arabia**, a Saudi company. It sells and
invoices everything, to every customer, on both domains. Progrid Technologies LLC (the US
company that billed customers outside Saudi Arabia until 2026-10) no longer contracts; its
invoices stay in the system for the history.

| | progrid.co | progrid.sa |
|---|---|---|
| Role | Primary, global | Local storefront for Saudi Arabia |
| Hosts | progrid.co, www, console, api, ops, gateway | the same hosts on progrid.sa |
| Contracting company | Progrid Arabia | Progrid Arabia |
| Decides billing | No | No |

The domain decides nothing about billing. The **billing country** of the team does:

| Billing country | Currency | VAT | Note on the invoice |
|---|---|---|---|
| Saudi Arabia (SA) | SAR | 15% (standard rate) | |
| Any other country | USD | 0% | "Zero-rated export of services"; VAT and totals also shown in SAR with the exchange rate used |

> **To be confirmed by the tax advisor:** the 0% treatment of customers outside Saudi Arabia as a
> zero-rated export of services (whether every service and every customer qualifies, for example
> customers that have a place of residence in Saudi Arabia, and what evidence of the customer's
> location must be kept). The code applies the rule by billing country only
> (`vatFor` in `apps/api/src/common/entities/entities.ts`); change it there if the advisor says so.

Common to everything:

| | |
|---|---|
| E-invoicing | ZATCA (Fatoora) through the e-invoicing provider, every new invoice (`eInvoiceType: zatca`) |
| Card gateway | Moyasar (mada, Visa, Mastercard, Apple Pay), SAR and USD |
| Invoice series | `PRGD-SA-YYYY-NNNNN`, credit notes `CN-SA-YYYY-NNNNN` (every new document) |
| Mail sender | `Progrid <no-reply@progrid.sa>` (`ENTITY_ARABIA_MAIL_FROM`) |
| Support inbox | support@progrid.sa and support@progrid.co (`SUPPORT_INBOX`) |
| Legal pages | the same Progrid Arabia documents on both domains (Saudi law) |

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

**API.** Customer facing links follow Progrid Arabia (`apps/api/src/common/entities/entities.ts`):

- Mail: Progrid Arabia's sender, reply address, logo and console links (`console.progrid.sa`).
  Links built on the primary console are rewritten to it. Accounts work on both consoles.
- Browser redirects (payment return, OAuth return, verification and reset links) go back to the
  console the person used, when it is one of ours, else to Progrid Arabia's console. Sessions live in
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

## Billing

**Company.** Every team is Progrid Arabia's (`billingEntity: progrid_arabia`). The field stays on
teams, invoices, credit notes and API responses for compatibility. `progrid_llc` stays in the
database enum only for the history; nothing assigns it any more (`BILLING_ENTITIES` lists Progrid
Arabia alone, and the PRGD-US / CN-US sequences are not in the list of sequences new documents may
use, `billing/sequences.ts`).

**Signup** asks for the billing country. The console prefills it from `GET /v1/geo`: SA on the
progrid.sa domain, otherwise the country of the caller's address from the DB-IP database, otherwise
US. That is only a guess of the address; the person picks the country, and the country sets the
currency (SA: SAR, else USD). The signup page shows what it means ("SAR · 15% VAT" or "USD · 0%
VAT, zero-rated export of services"). Social sign up does the same. A signup without a country
(CLI, older clients) gets the suggested one.

**Changing the billing country.** Customers change it on the Team page; finance staff in the back
office (team page, "Billing country and currency", or
`POST /admin/v1/teams/:id/billing-country { country, currency?, reason }`).

- A change that keeps the currency (DE to US, or within Saudi Arabia) applies at once.
- A change into or out of Saudi Arabia changes the currency, so it is **scheduled for the first day
  of the next month**: the team keeps its country, currency and VAT for the current month, usage
  from that day is rated in the new currency, and the monthly invoice run folds the change into the
  team. The pending change is in `pendingCountry`, `pendingCurrency` and `billingChangeAt` (the
  columns of the old company change, `pendingBillingEntity` is gone), shown on the billing page and
  in `GET /v1/billing/balance` (`pendingChange`). Changing back before the date cancels it; staff
  can cancel with `POST /admin/v1/teams/:id/billing-country/cancel`.
- Staff may pass `currency` to keep a team on a currency that differs from its country's, for
  example while it still holds credit in that currency.
- Credit left in the old currency is not converted and is not spent on invoices in the new one
  (`GET /v1/billing/balance` counts only credit in the team's currency); refund or reissue it by hand.
  The staff endpoint answers with `creditLeftInOldCurrencyMinor`.
- Audit log: `team.billing_currency_scheduled` (customer), `admin.team_billing_country_set`,
  `admin.team_billing_currency_scheduled`, `admin.team_billing_change_cancelled`,
  `team.billing_currency_changed` (applied).

**Invoices** (`billing/invoices.service.ts`, `billing/invoice-pdf.ts`): Progrid Arabia's legal
name, address, CR and VAT number, "TAX INVOICE", the `PRGD-SA` series and the ZATCA hand off on
every new invoice. VAT follows the billing country in force for the period: 15% for SA
(`vatCategory: standard`), 0% otherwise (`vatCategory: zero_rated_export`, `taxNote: "Zero-rated
export of services"`, printed under the totals and in the footer). Every new invoice stores the
exchange rate it used, `fxRateSar` (SAR per one unit of the invoice currency, 1 for SAR, else the
USD to SAR rate from `FxService` at the time of issue), and `subtotalSarMinor`, `taxSarMinor` (the
VAT amount in SAR, which ZATCA requires on an invoice in another currency) and `totalSarMinor`.
A USD invoice prints "In SAR at 1 USD = 3.7500 SAR (rate of <issue date>)" with the SAR subtotal,
VAT and total due. Invoices issued before this change have these fields empty.

**Credit notes** follow the same rules: `CN-SA` series, issued by Progrid Arabia, the VAT part of
the amount in proportion to the invoice (`taxMinor`), the invoice's VAT category and note, and the
SAR amount and VAT at the invoice's rate.

**Prices.** The price book is in SAR. USD prices are the SAR prices converted at the stored USD to
SAR rate (`FX_USD_SAR`, 3.75, the peg) at the hour of usage, rounded to the cent per hour. The
website on progrid.co shows USD, progrid.sa shows SAR with VAT.

**Payments** all go to Progrid Arabia through `PAYMENT_PROVIDER` (Moyasar in production), in the
currency of the team (top up) or the invoice (pay). The Moyasar adapter sends the currency with each
hosted invoice, so USD is charged in USD; **the Moyasar merchant account must be enabled for USD**
(confirm with Moyasar before switching it on; until then customers outside Saudi Arabia can pay by
bank transfer, recorded by finance). Stripe is not used: the US Stripe account belonged to Progrid
Technologies LLC. The generic Stripe adapter stays behind `PAYMENT_PROVIDER=stripe` for a future
Stripe account of Progrid Arabia; its webhook and callback routes only matter then. Refunds go back
through the provider that took the payment: an old Stripe payment of the LLC can only be refunded
with the LLC's `STRIPE_*` keys, or by hand.

**Back office:** the teams and invoices lists still filter by company (`progrid_llc` finds the
history), the finance page shows Progrid Arabia per currency and month, and Progrid Technologies LLC
only for months in which it still has invoices, open amounts or payments
(`GET /admin/v1/finance/entities?month=YYYY-MM`).

## History: Progrid Technologies LLC

From 2026-10-04 to the single entity migration, teams created on progrid.co were billed by
Progrid Technologies LLC in USD, in the `PRGD-US-YYYY-NNNNN` series (credit notes `CN-US-...`),
paid through Stripe. What stays:

- Every invoice and credit note it issued keeps `billingEntity: progrid_llc` and its number, and can
  be listed and downloaded as before. The PDF is rendered again from the stored figures with the name
  "Progrid Technologies LLC" and "United States"; its EIN and address are no longer configured, so
  **the PDF sent at the time is the record**.
- An LLC invoice cannot get a credit note any more (the request is refused); void an unpaid one, and
  settle a paid one by hand.
- An LLC invoice that is still open is paid through Progrid Arabia's gateway (Moyasar) in USD. The
  accountant settles that money between the two companies (see below).
- Affiliate payouts paid by the LLC against a US tax form stay on record with their withholding
  (docs/affiliates-tax.md).
- Older invoices from before billing entities keep their numbers (`PRGD-2026-000123`).

### Migration `20261012100000_single_entity`

1. Adds `prgd_teams.pendingCurrency`, the VAT and SAR columns on invoices and credit notes, and
   makes `progrid_arabia` the default company.
2. Clears every pending change of company (`pendingCountry`, `billingChangeAt`, and drops
   `pendingBillingEntity`). Scheduled moves between the companies no longer mean anything; if one
   also carried a new country, staff set the country again. List them **before** deploying:
   `SELECT id, country, "pendingCountry", "pendingBillingEntity", "billingChangeAt" FROM prgd_teams WHERE "pendingBillingEntity" IS NOT NULL;`
3. Currency from the country: a team whose currency is not its country's (SA: SAR, else USD) is
   scheduled to switch on the first day of next month (`pendingCurrency`, `billingChangeAt`), so the
   current month is invoiced in one currency. **A team that still holds money in its current
   currency keeps it** and gets no scheduled change: unexpired credit with something left
   (`prgd_credits.remainingMinor > 0`, the only balance there is), or an unpaid invoice (draft, open
   or uncollectible with something due). Find them afterwards and move them by hand once the credit
   is used or refunded:
   `SELECT id, country, currency FROM prgd_teams WHERE currency <> (CASE WHEN country = 'SA' THEN 'SAR' ELSE 'USD' END)::prgd_currency AND "pendingCurrency" IS NULL;`
4. Moves every team on `progrid_llc` to `progrid_arabia`.

The data part of the migration is tested in `apps/api/test/integration/entities.it.ts` (run inside a
transaction that is rolled back).

**Rollout order for the change:** run the monthly invoice run for the last LLC month first if it is
due (a period not yet invoiced when the migration runs is invoiced by Progrid Arabia in PRGD-SA,
with the VAT rules above), deploy, run the queries above, settle open PRGD-US invoices with the
accountant, and remove the `ENTITY_LLC_*`, `PAYMENT_PROVIDER_LLC` and `STRIPE_*` settings (and the
Stripe webhook endpoint in the Stripe dashboard).

## Configuration

| Setting | Purpose |
|---|---|
| `DOMAIN`, `DOMAIN_SA` | Caddy sites and certificates (compose, Ansible `domain`, `domain_sa`) |
| `PRGD_DOMAIN`, `PRGD_DOMAIN_SA` | Website storefronts (compose passes them from `DOMAIN`, `DOMAIN_SA`) |
| `WWW_URL` | Primary website |
| `PRIMARY_DOMAIN` | progrid.co: the primary domain (CORS, links of requests made through it). Replaces `ENTITY_LLC_DOMAIN` |
| `ENTITY_ARABIA_DOMAIN` | progrid.sa: Progrid Arabia's domain; customer mail and links use `console.X`, `api.X` |
| `ENTITY_ARABIA_LEGAL_NAME`, `_ADDRESS`, `_CR`, `_VAT_NUMBER`, `_BANK_DETAILS` | Printed on invoices; empty prints a placeholder |
| `ENTITY_ARABIA_VAT_RATE` | VAT for a Saudi billing country (0.15); other countries are 0% |
| `ENTITY_ARABIA_SUPPORT_EMAIL`, `_MAIL_FROM`, `_TERMS_URL` | Mail and invoice footer |
| `PAYMENT_PROVIDER` | `moyasar` in production (SAR and USD), `fake` in development; `stripe` is possible but not used |
| `FX_USD_SAR`, `FX_PROVIDER_URL` | USD to SAR rate: prices, rating and the SAR figures on USD invoices |
| `PRGD_OPS_URL_SA`, `PRGD_OPS_RP_ID_SA` | The ops console on progrid.sa |
| `CORS_EXTRA_ORIGINS` | More origins allowed with credentials |
| `GEOIP_DB_PATH` | DB-IP Lite database (api and www) |

Removed: every `ENTITY_LLC_*` setting and `PAYMENT_PROVIDER_LLC`. Left in a settings file they are
ignored. `MAIL_FROM` and `SUPPORT_INBOX` are the progrid.co addresses (staff and system mail),
`OAUTH_REDIRECT_BASE` is empty in production so the callback follows the domain, the gateway allows
both ops origins, `COMPANY_NAME` is the brand ("Progrid"). `COMPANY_ADDRESS` and `COMPANY_TAX_ID`
remain as fallbacks for Progrid Arabia's address and VAT number.

## What the owner, the accountant and the tax advisor must confirm

Nothing below is invented in the code: unset values print a bracketed placeholder or nothing.

- **Tax advisor:** the zero-rated export treatment (0% VAT) for every customer whose billing
  country is not Saudi Arabia, the evidence of location to keep, and the wording of the invoice note.
  Also whether Saudi withholding tax applies to affiliate commission paid to partners outside Saudi
  Arabia (docs/affiliates-tax.md).
- **Accountant:** open PRGD-US invoices at the cutover (collected by Progrid Arabia, or voided and
  reissued), LLC credit and refunds of old Stripe payments, and the exchange rate source for the
  SAR figures (`FX_PROVIDER_URL`, or the rate set by hand in the back office).
- **Moyasar:** that the merchant account of Progrid Arabia accepts and settles USD.
- **Progrid Arabia details:** CR number, VAT registration number, registered address, bank details
  (optional) and the e-invoicing provider for ZATCA.
- **Mail:** progrid.co in Resend (receiving for support@progrid.co) next to progrid.sa.
- **OAuth:** the progrid.co redirect URIs in the Google and Microsoft apps (below).

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

## Rollout order (domains)

1. **DNS first.** Create the progrid.co records above and wait until every host resolves
   (`dig +short` for each). Caddy cannot get certificates for hosts that do not resolve.
2. **Provider settings.** Add the OAuth redirect URIs. No Stripe endpoint: payments go through
   Moyasar for both currencies.
3. **Configuration.** Set `domain: progrid.co` and `domain_sa: progrid.sa` and Progrid Arabia's
   details in `group_vars`, run the playbook. It renders `prgd.env` and copies the new Caddyfile.
4. **Deploy.** Push to main (or run the deploy workflow). Migrations run before the new version
   starts (see the single entity migration above).
5. **Verify certificates and routing.** For each of the twelve hosts: `curl -sI https://HOST` shows
   a valid certificate. Then check: both domains name Progrid Arabia in the footer; progrid.co shows
   US dollars (0% VAT outside Saudi Arabia), progrid.sa riyals with VAT;
   `curl -sI -H 'X-Real-IP: <a Saudi address>' https://progrid.co/` is not possible from outside
   (Caddy overwrites it), so test the redirect from a Saudi connection or a VPN; `?site=global`
   stays on progrid.co; `curl https://api.progrid.co/v1/geo` answers.
6. **Back office.** Run the queries of the migration section and move teams by hand where needed.
   Staff register passkeys on ops.progrid.co.
