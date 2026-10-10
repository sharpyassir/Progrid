# Affiliate payouts: tax and accounting

How affiliate commissions are paid and booked. **Progrid Arabia** (Saudi Arabia) runs the program
and pays every payout, in SAR or in USD, by bank transfer (docs/domains-and-entities.md).

> Not tax advice. The points marked **to be confirmed** need the tax advisor's answer before
> payouts to partners outside Saudi Arabia are made at scale. Nothing in the code invents a rate.

## Payouts

- An approved affiliate with payout details requests a payout of the payable balance in one
  currency once it reaches the minimum (Settings: 200 SAR, 50 USD). Finance pays it by bank transfer
  and marks it paid with the reference (Back office, Affiliates, Payouts).
- No tax form is required and **nothing is withheld**: `withheldMinor` is 0 on every new payout.
- **Saudi withholding tax on payments to non-resident partners: to be confirmed with the tax
  advisor.** Commission paid by a Saudi company to a partner outside Saudi Arabia may be subject to
  withholding tax under Saudi rules, depending on how the payment is classified and on any tax
  treaty with the partner's country of residence. The rate, the classification, whether treaty
  relief applies and what forms or certificates to collect must come from the tax advisor. Until
  then the system withholds nothing and finance should hold payouts to non-resident partners that
  the advisor says are in scope. When the advisor answers, the payout record already has the
  fields (`withheldMinor`, net to send) to implement it.
- Payouts to partners in Saudi Arabia: whether VAT applies to commission invoiced by a VAT
  registered partner is also for the advisor to confirm.

## What happened to the US tax setup

Until 2026-10 USD payouts were made by Progrid Technologies LLC, a US company, which required an
IRS Form W-9 or W-8 in the portal, applied 24% backup withholding after an IRS B notice and produced
the year end Form 1099-NEC file. With the LLC no longer contracting, all of that is removed from the
portal, the back office and the API (`/v1/affiliates/me/tax-form`, `/admin/v1/affiliates/tax/1099`,
`export/1099`, `tax-forms/:id/backup-withholding`, `tax-forms/:id/invalidate`, the US tax settings).

Kept for the records:

- Signed forms stay in `prgd_affiliate_tax_forms` (TINs sealed), linked from the payouts they were
  used for (`prgd_affiliate_payouts.taxFormId`).
- Payouts the LLC paid keep their withholding (`withheldMinor`) and show "Progrid Technologies LLC"
  as the paying company. Any Form 1099-NEC or Form 945 still due for payments the LLC made is the
  LLC's own filing, handled with its accountant outside this system.

## Accounting

Commissions are a **sales and marketing expense**, accrued month by month on paid usage invoices.
The customer promo discount is a **reduction of revenue**, already netted on the invoices.

Every money event is written to the affiliate ledger (`prgd_affiliate_ledger`): commission earned,
commission reversed (refund, credit note, chargeback, self referral; also after payout, which the
next payout recovers), and payouts. Back office, Affiliates, **Accounting**, **Monthly journal**
(per month and currency, CSV for the books), in the name of Progrid Arabia:

| Event | Debit | Credit |
|---|---|---|
| Commission earned | Affiliate commissions (S&M expense) | Affiliate commissions payable |
| Commission reversed | Affiliate commissions payable | Affiliate commissions (S&M expense) |
| Payout sent | Affiliate commissions payable (gross) | Cash (Progrid Arabia bank, SAR or USD) |

Withholding appears only on payouts of the US era (`Withholding payable (US era, Progrid
Technologies LLC)`). The journal shows the payable balance at the start and end of the month;
reconcile it with the general ledger monthly. A negative payable means commission was reversed
after it was paid and is owed back by affiliates (recovered from their next payouts). USD payouts
are booked in USD; their SAR value for Progrid Arabia's books is for the accountant (the platform's
USD to SAR rate is in the back office, Finance).

## Records

Kept for each payout: the gross, any withholding, the bank transfer reference and who marked it
paid; for each commission, the invoice and rate it came from.
