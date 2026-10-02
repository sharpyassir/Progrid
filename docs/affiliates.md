# Affiliate program

Content creators earn a share of what the customers they refer pay. This page covers how
referrals are tracked and how the program is configured. Built in phases; this page grows with
them.

## Tracking (phase a)

**Referral link.** Any page of the website or the console opened with `?ref=CODE` stores the code in
the first party cookie `prgd_ref` on the parent domain (`progrid.co` or `progrid.sa`), so
`console.<domain>` sees it. The value is `CODE.<unix seconds of the click>`. A click on another
partner's link replaces it: **last click wins**. The browser keeps the cookie for a year; the API
only counts a click younger than `cookieDays` (60 by default), so changing the setting applies to
existing cookies too.

The website also sends `POST /v1/affiliates/clicks` from the browser. A click is counted once per
visitor address per partner per day; only a keyed hash of the address is stored, plus the landing
path, the referring site (origin only) and the country.

**Promo code.** The partner's code is also a promo code. Typed on the signup form (email or
Google/Microsoft), it wins over the cookie and gives the customer the signup discount
(`promoDiscountPercent` off invoices before tax, for `promoDiscountMonths`; 10% for 3 months by
default). An unknown code stops the email signup with `invalid_promo_code` before anything is
created. A link `console.<domain>/login?promo=CODE` prefills it.

A customer who signed up without a code can add one on the **Billing** page
(`POST /v1/billing/promo-code`) until the team's first paid invoice, if the team is not already
referred by another partner. A team referred through a partner's link can add that same
partner's code to get the discount.

**Attribution is permanent.** At signup the team gets one `prgd_referrals` row: partner, source
(`link` or `promo_code`), signup address, discount, and `commissionUntil` (signup plus
`commissionMonths`, 12 by default). It never moves to another partner.

Only **approved** partners' codes count; codes of pending, rejected or suspended partners are ignored.

## Fraud controls

- **Self referral** is recorded as a blocked referral (it earns nothing and gives no discount), and
  the partner is flagged. It is self referral when the customer is the partner's own user, uses the
  same mailbox (case, `+tags` and Gmail dots ignored), or signs up from an address the partner used
  (signup, application, or console sessions in the last 180 days). Card fingerprints are stored on
  payments (`prgd_payments.cardFingerprint`: Stripe's card fingerprint; for Moyasar a keyed hash of
  the masked number, brand and holder) for the same check when commission is earned (phase d).
- **Many signups from one address**: `flagSignupsPerIpPerDay` (3) referred signups from one address
  within a day flag the partner for review.
- **Free credit earns nothing**: every invoice records which credit settled how much
  (`prgd_credit_applications`), so commission counts paid money and prepaid credit only, never
  promo, goodwill or refund credit (phase d).
- Rate limits per address: clicks 30 a minute, code checks 30 a minute, billing promo codes 10 per
  10 minutes, signup 5 per 10 minutes.

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
| `cookieDays` | 60 | How long a link click counts |
| `holdDays` | 60 | Commission stays pending this long after the invoice is paid |
| `commissionMonths` | 12 | Months after signup that invoices earn commission |
| `minPayoutMinor` | SAR 20000, USD 5000 | Smallest payout, per currency (200 SAR, 50 USD) |
| `promoDiscountPercent` / `promoDiscountMonths` | 10 / 3 | Customer discount for a promo code |
| `flagSignupsPerIpPerDay` | 3 | Signups from one address in a day before a flag |
| `flagRefundRatePercent` | 30 | Reversed share of commission before a flag |
| `applicationsOpen` | true | New applications accepted |
| `termsVersion` | 2026-10 | Version of /affiliates/terms applicants accept |

Product categories come from the resource type of each invoice line
(`apps/api/src/modules/affiliates/categories.ts`).
