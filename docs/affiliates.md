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
  (see Commission engine). Customers on the same network as the partner are not blocked.
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

## Portal (phase c)

`console.<domain>/affiliates/portal` (also under **Account** in the console menu). It works on the
signed in person, not the team, and only with a console session: API tokens get 403.

- **Apply.** Signed out visitors create their Progrid account and apply in one form; customers
  apply with their account. Fields: name, country, channel links, audience size, content language,
  how they will promote Progrid, an optional preferred code, and acceptance of the terms (version
  stored). Bot protection without a third party: a hidden field bots fill, at least 3 seconds on
  the form, and 5 applications per address per hour. A rejected applicant can apply again after 30
  days.
- **Status.** Pending, approved, rejected (with the reason) or suspended. Only approved affiliates
  see the dashboard. Emails go out in Arabic or English (the user's console language) from the
  company of the affiliate's country: application received, approved (with the code), rejected,
  suspended, reinstated, payout requested and payout sent. Approve, reject, suspend and paid are
  sent by the back office actions (phase e).
- **Dashboard** with a date range (7, 30, 90 days or custom): code, referral links on both
  domains, a signup link with the code, clicks, signups with the code, paying customers, and
  commission pending, approved, paid out and reversed per currency; balances (pending, ready to
  pay out, payout requested, paid out) against the minimum payout.
- **Referrals**: each referred customer as `Customer 3F2A9C` (no names, emails or team details),
  signup date, status (signed up, paying, not eligible), services with commission, the date
  commission ends, and commission so far.
- **Payouts**: bank details (holder, bank, country, IBAN or account number, SWIFT, note), sealed in
  the database and shown back with the last four digits only; a payout request per currency once
  the ready balance reaches the minimum (one open request per currency; it takes all ready
  commission); payout history.
- **Assets**: logos, banners (728×90, 300×250, 1200×630 in English and Arabic, in
  `apps/console/public/affiliates/`), copy snippets with the affiliate's code filled in, and the
  disclosure reminder.

API (console session): `GET /v1/affiliates/me`, `POST /v1/affiliates/apply`,
`GET /v1/affiliates/me/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD`, `GET /v1/affiliates/me/referrals`,
`GET|PUT /v1/affiliates/me/payout-details`, `GET|POST /v1/affiliates/me/payouts`.

## Commission engine (phase d)

**Customer discount.** When an invoice is issued for a referred team whose discount is still
running (`discountUntil` after the start of the period), `promoDiscountPercent` of the usage comes
off before tax: `prgd_invoices.discountMinor`, with `subtotalMinor` the taxable amount after it.
The PDF shows Usage, the promo code discount, then the subtotal.

**Earning.** When an invoice of a referred team is paid (card, bank transfer, manual, or settled
from prepaid credit at issue), `CommissionService.earn` writes one `prgd_affiliate_commissions`
row per product category, in the invoice currency, status `pending`, `holdUntil` = paid time plus
`holdDays`. A job every 15 minutes catches paid invoices the payment hook missed
(`prgd_invoices.affiliateCheckedAt` marks an invoice as done, with or without commission).

For each category: base = the category's usage, minus its share of the discount, times the share
of the invoice paid with money; commission = base × rate (basis points, fixed when earned).
Money is card, bank transfer and prepaid credit. Promo, goodwill and refund credit, credit notes
against what was due, refunds, and tax are never part of the base. Rows below 1 minor unit and
categories at 0% are not written.

Nothing is earned when the team is not referred or the referral is blocked, for invoices whose
period starts on or after `commissionUntil`, or while the affiliate is not approved (suspended
affiliates forfeit invoices paid during the suspension).

**Approval.** A daily job (03:20 UTC) turns `pending` rows whose hold is over into `approved` for
approved affiliates, if the invoice is still paid. Approved rows are what payouts draw from.

**Reversals.**

- Card refund (back office): the refunded share of the invoice (refund ÷ subtotal plus tax) is
  taken off each commission on it.
- Credit note: the same, by the note's amount.
- Chargeback: Stripe's `charge.dispute.created` webhook (add it to the Stripe webhook endpoint),
  or finance marking a payment as disputed (Moyasar sends no dispute events; back office, phase
  e), sets `prgd_payments.disputedAt`, reverses all commission on the invoice and flags the
  affiliate.
- Commission not yet paid out is reduced in place and becomes `reversed` when nothing is left.
  Commission already paid out, or in a payout request, gets a negative `approved` clawback row
  (`<category>:clawback:<n>`) that the next payout deducts.
- After a reversal, an affiliate whose reversed share of earned commission reaches
  `flagRefundRatePercent` (with at least 3 commissions) is flagged `high_refund_rate`.

**Self referral by card.** Before earning, the customer's card fingerprints are compared with
payments of every team the affiliate belongs to. A match blocks the referral
(`self_referral:same_card`), ends the discount, reverses commission already earned on that
customer and flags the affiliate.

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
