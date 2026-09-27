---
title: Billing and pricing
description: Hourly billing, monthly caps, dollars or riyals, and what happens when credit runs out.
section: Guides
order: 11
---

## How you are charged

Every resource is metered by the hour it exists and capped at its monthly price. A server that lives a whole month costs its monthly price and never more. One that lives three hours costs three hours. Stopping a server does not stop billing, because its disk and address are still yours. Delete it, or take a snapshot and delete it, to stop the meter.

The monthly price divided by 672 gives the hourly rate. There is no minimum term.

## Dollars or riyals

Prices are set in Saudi riyals and exclude VAT; every checkout shows the total with 15 percent VAT before you pay. If your team's currency is US dollars, prices and invoices are converted at the pegged rate of 3.75 riyals per dollar.

## Your first top up

Before a new team can create anything billable, it adds credit once: open **Billing**, pick any amount and pay by card. Until then, creating a server, database, cluster, app, load balancer, volume or bucket is refused with `payment_required`, and the console points you to the billing page. After that first top up, usage is billed monthly (postpaid). Teams we have verified by phone or ID skip this step.

## Credit and invoices

Usage is drawn from credit first. On the first of each month an invoice is issued for the previous month, with an ZATCA e-invoice for Saudi companies, and the team owners and the billing email get an email. Invoices are numbered in one sequence (for example `PG-2026-000123`) and are due 14 days after they are issued. The console shows month to date spend, every invoice with a PDF, and every card payment.

The name, VAT number, billing address and country printed on your invoices come from the **Team** page. Saudi businesses should enter their 15 digit VAT number there before the invoice is issued.

## Paying

**Add credit** under **Billing**: pick an amount, pay by card on the hosted page, and come back with the credit on your balance. Riyal teams pay through Moyasar, dollar teams through Moyasar. Card details never touch our servers.

**Pay an invoice** the same way with the **Pay** button next to any open invoice, or from the terminal:

```sh
pgcloud billing                 # balance and month to date
pgcloud billing invoices
pgcloud billing topup 25        # prints the payment page to open
pgcloud billing pay INVOICE_ID
```

If you already opened a payment page for an invoice in the last 30 minutes, **Pay** takes you back to that same page instead of starting a second payment.

## Overdue invoices and suspension

When an invoice is still unpaid after its due date, we email the team owners, billing members and the billing email:

| Days past due | What happens |
|---|---|
| 3 | First reminder |
| 7 | Second reminder |
| 14 | Final notice, and the account is suspended |

A suspended account keeps its data, but every running server is powered off and the API and console only work for billing: you can see your invoices, add credit and pay. Tokens and sessions get `account_suspended` for anything else, and nothing new can be created. Powered off servers still exist, so they are still billed like any stopped server.

Paying the overdue invoice lifts the suspension at once, and the servers we powered off start again on their own. Suspensions for other reasons, such as abuse, are lifted by support.

## Refunds and credit notes

Card payments can be refunded to the same card, in full or in part; the money reaches your account in the time your bank takes. Refunding a credit top up takes the same amount out of your unused credit.

When an invoice was wrong, we issue a credit note against it, numbered in its own sequence (for example `CN-2026-000045`). On an unpaid invoice the credit note lowers what is due; on a paid invoice it becomes credit on your balance for the next invoices. An invoice fully covered by credit notes is marked credited.

You can also pay an invoice by bank transfer: put the invoice number in the transfer reference and tell support, and we mark the invoice paid when the money arrives. Ask support for refunds, credit notes and bank details.

## Spending caps

Each project can have a monthly limit, and each agent token can have its own cap. A create or resize that would go past the cap is refused with `spend_limit_reached` before anything is charged. Caps reset on the first of the month.

## What costs what

| Resource | Billed |
|---|---|
| Server | per hour, capped at the monthly price of its size |
| Public IPv4 | per hour with the server; reserved IPs also while unattached |
| Snapshot | per GB per month |
| Backups | 20 percent of the server price, when enabled |
| One click app | the server price plus the app's price, if any |
| Bandwidth | outbound transfer up to the size's monthly allowance is included; beyond it, per GB in the calendar month |

The live price list is at `GET /v1/pricing` and in `pgcloud sizes`.
