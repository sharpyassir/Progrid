import { Injectable } from '@nestjs/common';
import type { AffiliateTaxForm, Currency } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ApiError } from '../../common/errors/api-error';
import { open, seal } from '../../common/crypto/secretbox';
import type { Actor } from '../../common/auth/actor';
import { EventsService } from '../events/events.service';
import { AffiliateSettingsService } from './settings';
import { AffiliateMailer } from './mailer';
import type { TaxFormDto } from './tax.dto';
import { backupWithholding, CERTIFICATIONS, digits, exemptFrom1099Nec, FORM_REVISIONS, formatTin, validEin, validItin, validSsn, W8BENE_CH3, W9_CLASSIFICATIONS, w8ExpiresAt } from './tax-rules';

export type TaxState = 'missing' | 'active' | 'expired' | 'invalid';

/**
 * US tax compliance for USD affiliate payouts by Progrid Technologies LLC (docs/affiliates-tax.md):
 * electronic W-9 / W-8BEN / W-8BEN-E, the payout gate, backup withholding, the year end 1099-NEC
 * report, and the monthly accounting journal from the affiliate ledger.
 */
@Injectable()
export class TaxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
    private readonly settings: AffiliateSettingsService,
    private readonly mailer: AffiliateMailer,
  ) {}

  /** The form that counts for payouts now, and the state the portal shows. */
  async current(affiliateId: string, now = new Date()): Promise<{ state: TaxState; form: AffiliateTaxForm | null }> {
    const forms = await this.prisma.affiliateTaxForm.findMany({ where: { affiliateId }, orderBy: { signedAt: 'desc' }, take: 5 });
    const active = forms.find((f) => f.status === 'active');
    if (active) return { state: active.expiresAt && active.expiresAt < now ? 'expired' : 'active', form: active };
    if (forms[0]?.status === 'invalid') return { state: 'invalid', form: forms[0] };
    return { state: 'missing', form: null };
  }

  async presentCurrent(affiliateId: string) {
    const c = await this.current(affiliateId);
    return { state: c.state, form: c.form ? present(c.form) : null };
  }

  /** Signs a new form electronically; the previous active form is superseded. */
  async submit(actor: Actor, affiliateId: string, dto: TaxFormDto, ip?: string | null) {
    if (dto.certify !== true) throw ApiError.invalid('Confirm the certification to sign the form.');
    const now = new Date();
    const f = this.validate(dto);
    const certificationText = dto.formType === 'W9'
      ? CERTIFICATIONS.W9(!!dto.subjectToBackupWithholding)
      : `${(dto.formType === 'W8BEN' ? CERTIFICATIONS.W8BEN : CERTIFICATIONS.W8BENE)()}\n\n${CERTIFICATIONS.servicesOutsideUs}`;
    const form = await this.prisma.$transaction(async (tx) => {
      await tx.affiliateTaxForm.updateMany({ where: { affiliateId, status: 'active' }, data: { status: 'superseded' } });
      return tx.affiliateTaxForm.create({
        data: {
          affiliateId,
          formType: dto.formType,
          revision: FORM_REVISIONS[dto.formType],
          legalName: dto.legalName.trim(),
          businessName: dto.businessName?.trim() || null,
          taxClassification: dto.taxClassification ?? (dto.formType === 'W8BEN' ? 'individual' : null),
          exemptPayeeCode: dto.formType === 'W9' ? dto.exemptPayeeCode || null : null,
          fatcaCode: dto.formType === 'W9' ? dto.fatcaCode || null : null,
          fatcaStatus: dto.formType === 'W8BENE' ? dto.fatcaStatus ?? null : null,
          tinType: f.tinType,
          tin: f.tin ? seal(f.tin) : null,
          tinLast4: f.tin ? f.tin.slice(-4) : null,
          citizenshipCountry: dto.formType === 'W9' ? null : dto.citizenshipCountry ?? null,
          dateOfBirth: dto.formType === 'W8BEN' ? dto.dateOfBirth ?? null : null,
          addressLine1: dto.addressLine1.trim(),
          addressLine2: dto.addressLine2?.trim() || null,
          city: dto.city.trim(),
          region: dto.region?.trim() || null,
          postalCode: dto.postalCode?.trim() || null,
          country: dto.country,
          mailingAddress: dto.mailingAddress?.trim() || null,
          backupWithholding: dto.formType === 'W9' && !!dto.subjectToBackupWithholding,
          backupWithholdingReason: dto.formType === 'W9' && dto.subjectToBackupWithholding ? 'certification 2 crossed out by the payee' : null,
          servicesOutsideUs: dto.formType !== 'W9' && !!dto.servicesOutsideUs,
          signatureName: dto.signatureName.trim(),
          signedAt: now,
          signedIp: ip ?? null,
          certificationText,
          expiresAt: dto.formType === 'W9' ? null : w8ExpiresAt(now),
        },
      });
    });
    await this.events.emit('affiliate.tax_form_signed', { affiliateId, taxFormId: form.id, formType: form.formType }, { actor, resource: `affiliate:${affiliateId}` });
    return present(form);
  }

  /** Field rules of each form, beyond the DTO types. Returns the normalized TIN. */
  private validate(dto: TaxFormDto): { tinType: string; tin: string | null } {
    const bad = (m: string) => { throw ApiError.invalid(m); };
    if (dto.signatureName.trim().toLowerCase() !== dto.legalName.trim().toLowerCase() && dto.formType !== 'W8BENE') bad('Sign with the same name as on line 1.');
    if (dto.formType === 'W9') {
      if (dto.country !== 'US') bad('A W-9 needs a US address. Persons outside the US use Form W-8BEN or W-8BEN-E.');
      if (!dto.region || !/^[A-Z]{2}$/.test(dto.region.trim().toUpperCase())) bad('Enter the two letter state.');
      if (!dto.postalCode || !/^\d{5}(-\d{4})?$/.test(dto.postalCode.trim())) bad('Enter a ZIP code.');
      if (!(W9_CLASSIFICATIONS as readonly string[]).includes(dto.taxClassification ?? '')) bad('Choose the federal tax classification.');
      const tin = digits(dto.tin ?? '');
      if (dto.tinType === 'ssn' && !validSsn(tin)) bad('This is not a valid Social Security number.');
      if (dto.tinType === 'itin' && !validItin(tin)) bad('This is not a valid ITIN.');
      if (dto.tinType === 'ein' && !validEin(tin)) bad('This is not a valid Employer Identification Number.');
      if (dto.tinType === 'foreign') bad('A W-9 needs an SSN, ITIN or EIN.');
      // Individuals (and single member LLCs owned by one) may use an SSN or ITIN; corporations, partnerships and trusts use their EIN.
      if (dto.tinType !== 'ein' && ['c_corporation', 's_corporation', 'partnership', 'trust_estate'].includes(dto.taxClassification ?? '')) bad('Corporations, partnerships and trusts sign with their EIN.');
      return { tinType: dto.tinType, tin };
    }
    if (dto.country === 'US') bad('A W-8 is for persons outside the US. US persons use Form W-9.');
    if (!dto.citizenshipCountry) bad(dto.formType === 'W8BEN' ? 'Enter your country of citizenship.' : 'Enter the country of incorporation or organization.');
    if (dto.formType === 'W8BEN' && dto.citizenshipCountry === 'US') bad('US citizens use Form W-9.');
    if (dto.formType === 'W8BEN' && !dto.dateOfBirth) bad('Enter your date of birth.');
    if (dto.formType === 'W8BENE') {
      if (!(W8BENE_CH3 as readonly string[]).includes(dto.taxClassification ?? '')) bad('Choose the entity type (chapter 3 status).');
      if (!dto.fatcaStatus) bad('Choose the FATCA status (chapter 4).');
    }
    if (!dto.servicesOutsideUs) bad('Confirm that the services are performed outside the United States. If any are performed in the US, contact support before requesting a payout.');
    if (dto.tinType !== 'foreign') bad('Enter the foreign tax identifying number of your country of residence.');
    const tin = (dto.tin ?? '').trim();
    if (!tin && !dto.foreignTinNotRequired) bad('Enter your foreign tax identifying number, or confirm that your country does not issue one.');
    return { tinType: 'foreign', tin: tin || null };
  }

  /**
   * USD payouts are made by a US company: an active, unexpired W-9 or W-8 must be on file.
   * Returns the form and the backup withholding that applies to a payout of `grossMinor`.
   */
  async forUsdPayout(affiliateId: string, grossMinor: number) {
    const c = await this.current(affiliateId);
    if (c.state === 'missing' || c.state === 'invalid') throw new ApiError(409, 'tax_form_required', 'Add your tax information (Form W-9 or W-8) before requesting a payout in US dollars.');
    if (c.state === 'expired') throw new ApiError(409, 'tax_form_expired', 'Your Form W-8 has expired. Sign a new one before requesting a payout in US dollars.');
    const form = c.form!;
    return { form, withheldMinor: form.formType === 'W9' && form.backupWithholding ? backupWithholding(grossMinor) : 0 };
  }

  // ---- back office ----

  async forms(affiliateId: string) {
    const rows = await this.prisma.affiliateTaxForm.findMany({ where: { affiliateId }, orderBy: { signedAt: 'desc' } });
    return rows.map(present);
  }

  /** B notice (CP2100) from the IRS, or its end: turns 24% backup withholding on or off for this W-9. */
  async setBackupWithholding(actor: Actor, formId: string, on: boolean, reason: string) {
    const f = await this.prisma.affiliateTaxForm.findUnique({ where: { id: formId } });
    if (!f || f.formType !== 'W9' || f.status !== 'active') throw ApiError.invalidState('Backup withholding applies to an active W-9');
    const u = await this.prisma.affiliateTaxForm.update({ where: { id: formId }, data: { backupWithholding: on, backupWithholdingReason: reason, reviewedById: actor.userId } });
    await this.events.emit('affiliate.backup_withholding', { affiliateId: f.affiliateId, taxFormId: formId, on, reason }, { actor, resource: `affiliate:${f.affiliateId}` });
    return present(u);
  }

  /** The form is wrong (name and number do not match, IRS notice): the affiliate is asked for a new one. */
  async invalidate(actor: Actor, formId: string, reason: string) {
    const f = await this.prisma.affiliateTaxForm.findUnique({ where: { id: formId }, include: { affiliate: true } });
    if (!f || f.status !== 'active') throw ApiError.invalidState('Only an active form can be marked invalid');
    const u = await this.prisma.affiliateTaxForm.update({ where: { id: formId }, data: { status: 'invalid', statusReason: reason, reviewedById: actor.userId } });
    await this.events.emit('affiliate.tax_form_invalid', { affiliateId: f.affiliateId, taxFormId: formId, reason }, { actor, resource: `affiliate:${f.affiliateId}` });
    await this.mailer.send({ ...f.affiliate, statusReason: reason }, 'tax_form_needed');
    return present(u);
  }

  /**
   * Year end Form 1099-NEC data: USD payouts paid in the calendar year (cash basis, the year the
   * money was sent) to US persons on a W-9, grouped by payee. Box 1 is the gross paid; box 4 the
   * federal income tax withheld (backup withholding). A form is required at or above the
   * threshold, and whenever anything was withheld.
   */
  async report1099(year: number) {
    const s = await this.settings.get();
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year + 1, 0, 1));
    const payouts = await this.prisma.affiliatePayout.findMany({
      where: { status: 'paid', currency: 'USD', paidAt: { gte: start, lt: end } },
      include: { taxForm: true, affiliate: { select: { id: true, code: true, email: true } } },
      orderBy: { paidAt: 'asc' },
    });
    const by = new Map<string, typeof payouts>();
    for (const p of payouts) by.set(p.affiliateId, [...(by.get(p.affiliateId) ?? []), p]);
    const recipients = [];
    const foreign = [];
    for (const [affiliateId, list] of by) {
      // The payee's details as certified on the latest form used for a payout in the year, else the current one.
      const form = [...list].reverse().find((p) => p.taxForm)?.taxForm ?? (await this.current(affiliateId)).form;
      const gross = list.reduce((t, p) => t + p.amountMinor, 0);
      const withheld = list.reduce((t, p) => t + p.withheldMinor, 0);
      const base = { affiliateId, code: list[0].affiliate.code, email: list[0].affiliate.email, payouts: list.length, grossMinor: gross, withheldMinor: withheld };
      if (form && form.formType !== 'W9') {
        foreign.push({ ...base, formType: form.formType, name: form.legalName, country: form.country, formSignedAt: form.signedAt, formExpiresAt: form.expiresAt, servicesOutsideUs: form.servicesOutsideUs });
        continue;
      }
      const exempt = form ? exemptFrom1099Nec(form) : false;
      const issues: string[] = [];
      if (!form) issues.push('no tax form on file');
      else if (!form.tin) issues.push('no TIN');
      recipients.push({
        ...base,
        required: !exempt && (gross >= s.form1099ThresholdMinor || withheld > 0),
        exempt,
        formType: form?.formType ?? null,
        name: form?.legalName ?? '',
        businessName: form?.businessName ?? '',
        tinType: form?.tinType ?? '',
        tin: form?.tin ? formatTin(form.tinType, open(form.tin)) : '',
        address: form ? [form.addressLine1, form.addressLine2].filter(Boolean).join(', ') : '',
        city: form?.city ?? '', state: form?.region ?? '', zip: form?.postalCode ?? '',
        issues,
      });
    }
    const payerIssues = [...(s.taxPayerEin ? [] : ['payer EIN not set']), ...(s.taxPayerAddress ? [] : ['payer address not set'])];
    return {
      year,
      thresholdMinor: s.form1099ThresholdMinor,
      payer: { name: s.taxPayerName, ein: s.taxPayerEin, address: s.taxPayerAddress, phone: s.taxPayerPhone, issues: payerIssues },
      dueDate: `${year + 1}-01-31`,
      recipients,
      foreign,
      backupWithholdingMinor: payouts.reduce((t, p) => t + p.withheldMinor, 0),
    };
  }

  /** The 1099-NEC records that must be filed, as CSV for an e-filing service or the IRS IRIS portal. */
  async csv1099(year: number, actor: Actor) {
    const r = await this.report1099(year);
    await this.events.emit('affiliate.1099_exported', { year, recipients: r.recipients.filter((x) => x.required).length }, { actor, resource: `affiliate_tax:${year}` });
    const money = (m: number) => (m / 100).toFixed(2);
    const rows = r.recipients.filter((x) => x.required).map((x) => [
      r.year, r.payer.name, r.payer.ein, r.payer.address, x.name, x.businessName, x.tinType.toUpperCase(), x.tin, x.address, x.city, x.state, x.zip, 'US', money(x.grossMinor), money(x.withheldMinor), x.code, x.email, x.issues.join('; '),
    ]);
    return { header: ['tax_year', 'payer_name', 'payer_tin', 'payer_address', 'recipient_name', 'recipient_business_name', 'recipient_tin_type', 'recipient_tin', 'recipient_address', 'recipient_city', 'recipient_state', 'recipient_zip', 'recipient_country', 'box1_nonemployee_compensation', 'box4_federal_income_tax_withheld', 'affiliate_code', 'email', 'issues'], rows };
  }

  /**
   * Monthly journal for the books, per currency, from the affiliate ledger: commission earned
   * (expense accrued), reversed, and payouts (cash and backup withholding), with the payable
   * balance at the start and end of the month.
   */
  async accounting(month: string, currency: Currency) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw ApiError.invalid('month must look like 2026-10');
    const [y, m] = month.split('-').map(Number);
    const start = new Date(Date.UTC(y, m - 1, 1));
    const end = new Date(Date.UTC(y, m, 1));
    const sum = async (where: object) => {
      const g = await this.prisma.affiliateLedgerEntry.groupBy({ by: ['kind'], where: { currency, ...where }, _sum: { amountMinor: true, withheldMinor: true } });
      const k = (kind: string) => g.find((x) => x.kind === kind)?._sum;
      return { earned: k('earned')?.amountMinor ?? 0, reversed: k('reversed')?.amountMinor ?? 0, paid: k('paid')?.amountMinor ?? 0, withheld: k('paid')?.withheldMinor ?? 0 };
    };
    const before = await sum({ at: { lt: start } });
    const during = await sum({ at: { gte: start, lt: end } });
    const opening = before.earned - before.reversed - before.paid;
    const closing = opening + during.earned - during.reversed - during.paid;
    const date = new Date(end.getTime() - 1).toISOString().slice(0, 10);
    const lines: { date: string; account: string; debitMinor: number; creditMinor: number; memo: string }[] = [];
    const add = (account: string, debitMinor: number, creditMinor: number, memo: string) => { if (debitMinor || creditMinor) lines.push({ date, account, debitMinor, creditMinor, memo }); };
    add('Affiliate commissions (Sales & marketing expense)', during.earned, 0, 'Commission earned on paid customer invoices');
    add('Affiliate commissions payable', 0, during.earned, 'Commission earned on paid customer invoices');
    add('Affiliate commissions payable', during.reversed, 0, 'Commission reversed (refunds, credit notes, chargebacks)');
    add('Affiliate commissions (Sales & marketing expense)', 0, during.reversed, 'Commission reversed (refunds, credit notes, chargebacks)');
    add('Affiliate commissions payable', during.paid, 0, 'Affiliate payouts (gross)');
    add(currency === 'USD' ? 'Cash (Progrid Technologies LLC bank)' : 'Cash (Progrid Arabia bank)', 0, during.paid - during.withheld, 'Affiliate payouts sent');
    add('Backup withholding payable (IRS, Form 945)', 0, during.withheld, 'Backup withholding kept from payouts');
    return {
      month, currency,
      company: currency === 'USD' ? 'Progrid Technologies LLC' : 'Progrid Arabia',
      totals: { earnedMinor: during.earned, reversedMinor: during.reversed, paidGrossMinor: during.paid, withheldMinor: during.withheld, cashMinor: during.paid - during.withheld },
      payable: { openingMinor: opening, closingMinor: closing },
      lines,
    };
  }
}

/** A tax form as the portal and the back office see it: the TIN masked to its last four digits. */
export function present(f: AffiliateTaxForm) {
  const { tin, certificationText, ...rest } = f;
  return { ...rest, tinMasked: f.tinLast4 ? `•••••${f.tinLast4}` : null };
}
