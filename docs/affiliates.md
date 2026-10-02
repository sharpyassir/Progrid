# Affiliate program

Content creators earn a share of what the customers they refer pay. This page covers how
referrals are tracked and how the program is configured. Built in phases; this page grows with
them.

## Who counts as referred (phase a)

**Only customers who sign up with the partner's code earn commission.** The code is entered on
the signup form (email or Google/Microsoft), or on the **Billing** page
(`POST /v1/billing/promo-code`) until the team's first paid invoice. Using it gives the customer
the code discount (`promoDiscountPercent` off invoices before tax, for `promoDiscountMonths`; 10%
for 3 months by default). An unknown code stops the email signup with `invalid_promo_code` before
anything is created. Only **approved** partners' codes are accepted.

**Referral links help, but do not refer on their own.** Any page of the website or the console
opened with `?ref=CODE` stores the code in the first party cookie `prgd_ref` on the parent domain
(`progrid.co` or `progrid.sa`), as `CODE.<unix seconds of the click>`; another partner's link
replaces it (last click wins). The console signup form prefills the code from it while the click
is younger than `cookieDays` (60 by default), so the customer signs up with the code unless they
remove it. `console.<domain>/login?promo=CODE` prefills a code directly.

The website also sends `POST /v1/affiliates/clicks` from the browser, for the partner's click
statistics. A click is counted once per visitor address per partner per day; only a keyed hash of
the address is stored, plus the landing path, the referring site (origin only) and the country.

**Referral is permanent.** Using the code creates one `prgd_referrals` row for the team: partner,
code, signup address, discount, and `commissionUntil` (date of use plus `commissionMonths`, 12 by
default). It never moves to another partner, and a team can use one code only.

## Fraud controls

- **Self referral** is recorded as a blocked referral (it earns nothing and gives no discount), and
  the partner is flagged: the customer is the partner's own user, or uses the same mailbox (case,
  `+tags` and Gmail dots ignored). Card fingerprints are stored on payments
  (`prgd_payments.cardFingerprint`: Stripe's card fingerprint; for Moyasar a keyed hash of the
  masked number, brand and holder) to also catch the partner's own card when commission is earned
  (phase d). Customers on the same network as the partner are not blocked.
- **Many signups from one address**: `flagSignupsPerIpPerDay` (3) referred signups from one address
  within a day flag the partner for staff review; the signups still count.
- **Free credit earns nothing**: every invoice records which credit settled how much
  (`prgd_credit_applications`), so commission counts paid money and prepaid credit only, never
  promo, goodwill or refund credit (phase d).
- Rate limits per address: clicks 30 a minute, code checks 30 a minute, billing promo codes 10 per
  10 minutes, signup 5 per 10 minutes.

## Public pages (phase b)

- `/affiliates` (and `/ar/affiliates`, `/tr/affiliates`) on both domains: hero with **Apply now**,
  how it works, the commission table, who it is for, questions, and a link to the terms. Rates,
  windows, the discount and the minimum payout come from `GET /v1/affiliates/program` (the
  settings below, cached for five minutes); the page falls back to the defaults if the API is
  unreachable. The minimum payout is shown in the storefront currency (USD on progrid.co, SAR on
  progrid.sa). When `applicationsOpen` is off the buttons say applications are paused.
- `/affiliates/terms`: a draft summary of the rules (`apps/www/content/pages/shared/{en,ar}/affiliate-terms.md`),
  to be replaced by the final agreement. Turkish falls back to English with a notice.
- `/affiliates/portal` redirects to `console.<domain>/affiliates/portal` (phase c).
- Footer: **Affiliate Program / برنامج الشركاء** under Company, on every marketing and legal page.

## Configuration

Settings live in one row (`prgd_affiliate_settings`); anything not stored uses the defaults in
`apps/api/src/modules/affiliates/settings.ts`. Finance staff edit them in the back office (phase e).

| Setting | Default | Meaning |
|---|---|---|
| `rates.web_hosting` | 30 | % of net paid amount: App Platform and Marketplace apps |
| `rates.connect` | 30 | Progrid Connect executions and tool calls |
| `rates.servers` | 15 | Servers, volumes, snapshots, backups, IPs, bandwidth, load balancers, object storage, databases, Kubernetes |
| `rates.managed_cloud` | 15 | Managed cloud plans and overage |
| `rates.ai_usage` | 0 | AI model tokens in Connect |
| `rates.support` | 0 | Support plans |
| `cookieDays` | 60 | How long a link click prefills the code on the signup form |
| `holdDays` | 60 | Commission stays pending this long after the invoice is paid |
| `commissionMonths` | 12 | Months after the code is used that invoices earn commission |
| `minPayoutMinor` | SAR 20000, USD 5000 | Smallest payout, per currency (200 SAR, 50 USD) |
| `promoDiscountPercent` / `promoDiscountMonths` | 10 / 3 | Customer discount for a promo code |
| `flagSignupsPerIpPerDay` | 3 | Signups from one address in a day before a flag |
| `flagRefundRatePercent` | 30 | Reversed share of commission before a flag |
| `applicationsOpen` | true | New applications accepted |
| `termsVersion` | 2026-10 | Version of /affiliates/terms applicants accept |

Product categories come from the resource type of each invoice line
(`apps/api/src/modules/affiliates/categories.ts`).
