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

## Credit and invoices

New accounts start with credit. Usage is drawn from credit first. On the first of each month an invoice is issued for the previous month, with an ZATCA e-invoice for Saudi companies, and the team owners get an email. The console shows month to date spend, every invoice with a PDF, and every card payment.

## Paying

**Add credit** under **Billing**: pick an amount, pay by card on the hosted page, and come back with the credit on your balance. Riyal teams pay through Moyasar, dollar teams through Moyasar. Card details never touch our servers.

**Pay an invoice** the same way with the **Pay** button next to any open invoice, or from the terminal:

```sh
pgcloud billing                 # balance and month to date
pgcloud billing invoices
pgcloud billing topup 25        # prints the payment page to open
pgcloud billing pay INVOICE_ID
```

An invoice that is not paid within 14 days pauses new server creation until it is settled; running servers keep running. Paying, or adding credit, lifts the pause at once.

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
