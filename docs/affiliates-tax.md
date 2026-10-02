# Affiliate payouts: US tax and accounting

How Progrid Technologies LLC (USD payouts) stays within IRS rules for affiliate commissions, and how
the program is booked. Riyal payouts by Progrid Arabia follow Saudi rules and are not covered here.

> This implements the IRS forms and instructions as published (Form W-9 Rev. March 2024,
> W-8BEN and W-8BEN-E Rev. October 2021, Form 1099-NEC instructions). It is not tax advice: have a
> US CPA confirm the setup, the payer EIN and the LLC's own filings before the first filing season,
> and recheck form revisions and the 1099 threshold every year.

## Who signs what

| Affiliate | Form | Where |
|---|---|---|
| US citizen, US resident, or US company or partnership | **Form W-9** (name, federal tax classification, SSN, ITIN or EIN, US address) | Portal, Payouts, Tax information |
| Individual outside the US | **Form W-8BEN** (name, citizenship, permanent address, foreign TIN, date of birth) | same |
| Company outside the US | **Form W-8BEN-E** (entity name, country of incorporation, chapter 3 and FATCA status, foreign TIN) | same |

- Forms are signed electronically: the IRS certification text is shown in English exactly as on the
  form (`apps/api/src/modules/affiliates/tax-rules.ts`), the signer types their name (it must match
  line 1) and confirms under penalties of perjury. Stored with each form: the text agreed to, the
  form revision, the signature, time and address (`prgd_affiliate_tax_forms`).
- The TIN is checked (SSN, ITIN and EIN format rules), sealed with the secrets key, and only the last
  four digits are ever shown, in the portal and in the back office. Full TINs leave the system only
  in the 1099 file, and that export is written to the audit log.
- A W-9 signer who crossed out certification 2 (notified of backup withholding) is put under backup
  withholding.
- W-8 signers also certify that **all services for Progrid are performed outside the United States**.
  That makes the commission foreign source income: no US withholding and no Form 1042-S. An
  affiliate working from inside the US must contact support (the form cannot be signed without it).
- A W-8 expires at the end of the third calendar year after signing; the portal asks for a new one.
- A new form supersedes the old one. Finance can mark a form invalid (name and TIN do not match,
  IRS notice): USD payouts stop and the affiliate gets an email asking for a new form.

## Payouts

- **USD payouts need an active form.** Requesting one without a form, or with an expired or invalid
  one, is refused (`tax_form_required`, `tax_form_expired`). The form is checked again when finance
  marks the payout paid.
- **Backup withholding (24%)** applies to a W-9 payee who certified it, or after an IRS **B notice
  (CP2100)**: finance turns it on in the back office (Affiliates, the affiliate, US tax forms, "B
  notice: start withholding") and off when it is resolved. The payout shows gross, withholding and
  the net to send; finance sends the net. The withheld amount must be **deposited with the IRS**
  (EFTPS) and reported on **Form 945** (annual, due January 31) and in box 4 of the payee's 1099-NEC.
- SAR payouts by Progrid Arabia are not gated by US forms.

## Year end: Form 1099-NEC

Back office, Affiliates, **Tax & accounting**, pick the year:

- One row per US payee (W-9) paid in USD in that calendar year (the year the money was sent):
  box 1 nonemployee compensation (gross payouts), box 4 federal income tax withheld.
- **File** when the total reaches the threshold (Settings, US tax; **$2,000** for payments made from
  2026, it was $600 before) or anything was withheld. **Exempt**: payees on a W-9 as C or S
  corporations (or LLCs taxed as one), which are generally not reported for services.
- **Download 1099 file**: CSV with payer and recipient name, TIN, address, box 1 and box 4, for the
  IRS IRIS portal or an e-filing service (Track1099, Tax1099 and similar also mail or email the
  recipient copies and handle state filing). Due to the IRS and the recipients by **January 31**.
- Payer details (name, EIN, address, phone) are in Settings, US tax. The EIN is empty until the IRS
  assigns it; the report warns until it is set.
- Foreign payees on a W-8 are listed separately with their totals and form validity, for the
  records: no 1099 and no 1042-S while services are performed outside the US.
- Payouts made through PayPal or a card network would be reported by them on Form 1099-K instead;
  the program pays by bank transfer, so Progrid files the 1099-NEC.

## Accounting

Commissions are a **sales and marketing expense** (IRC 162; for US GAAP, expensed as earned: they
accrue month by month on paid usage invoices, not as a cost to obtain a contract under ASC 340-40).
The customer promo discount is a **reduction of revenue**, already netted on the invoices.

Every money event is written to the affiliate ledger (`prgd_affiliate_ledger`): commission earned,
commission reversed (refund, credit note, chargeback, self referral; also after payout, which the
next payout recovers), and payouts with their withholding. Back office, Tax & accounting, **Monthly
journal** (per month and currency, CSV for the books):

| Event | Debit | Credit |
|---|---|---|
| Commission earned | Affiliate commissions (S&M expense) | Affiliate commissions payable |
| Commission reversed | Affiliate commissions payable | Affiliate commissions (S&M expense) |
| Payout sent | Affiliate commissions payable (gross) | Cash (net); Backup withholding payable (withheld) |

The journal shows the payable balance at the start and end of the month; reconcile it with the
general ledger monthly. A negative payable means commission was reversed after it was paid and is
owed back by affiliates (recovered from their next payouts).

Accrual books record the expense when earned; an LLC filing on the cash method deducts it when
paid. The LLC's own return (for a single member LLC owned by a non US person: pro forma Form 1120
with Form 5472) is outside this system; ask the CPA.

## Records

Kept in the database for each payout: the tax form in force, the gross, the withholding, the bank
transfer reference and who marked it paid; for each commission, the invoice and rate it came from.
Keep the exported 1099 files and filing confirmations for at least four years.

## Not automated

- **TIN matching** against IRS records (IRS e-Services TIN Matching, after registering as a payer)
  before filing.
- **State** information returns where a state requires them (usually handled by the e-filing service).
- **Depositing** backup withholding and filing Form 945 (EFTPS, by finance).
