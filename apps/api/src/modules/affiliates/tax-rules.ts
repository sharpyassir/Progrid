/**
 * US tax rules for affiliate payouts by Progrid Technologies LLC (docs/affiliates-tax.md).
 * Pure and unit tested (tax-rules.test.ts). This follows the IRS forms and instructions as
 * published; a US tax professional should confirm the setup before the first filing season.
 */

/** Backup withholding rate (IRC 3406), applied when a payee is under backup withholding. */
export const BACKUP_WITHHOLDING_RATE = 0.24;

export const FORM_REVISIONS = {
  W9: 'Form W-9 (Rev. March 2024)',
  W8BEN: 'Form W-8BEN (Rev. October 2021)',
  W8BENE: 'Form W-8BEN-E (Rev. October 2021)',
} as const;

/** W-9 line 3a federal tax classification. */
export const W9_CLASSIFICATIONS = ['individual', 'c_corporation', 's_corporation', 'partnership', 'trust_estate', 'llc_c', 'llc_s', 'llc_p', 'other'] as const;
export type W9Classification = (typeof W9_CLASSIFICATIONS)[number];

/** W-8BEN-E Part I line 4 chapter 3 status (the common ones for an affiliate). */
export const W8BENE_CH3 = ['corporation', 'partnership', 'disregarded_entity', 'simple_trust', 'grantor_trust', 'complex_trust', 'estate', 'other'] as const;
/** W-8BEN-E Part I line 5 chapter 4 status (an operating business is almost always an active NFFE). */
export const W8BENE_CH4 = ['active_nffe', 'passive_nffe', 'excepted_nffe', 'other'] as const;

/** Digits only. */
export const digits = (s: string) => s.replace(/\D/g, '');

/** SSN: 9 digits, area not 000, 666 or 9xx; group not 00; serial not 0000. */
export function validSsn(raw: string): boolean {
  const d = digits(raw);
  if (!/^\d{9}$/.test(d)) return false;
  const area = d.slice(0, 3), group = d.slice(3, 5), serial = d.slice(5);
  return area !== '000' && area !== '666' && area[0] !== '9' && group !== '00' && serial !== '0000';
}

/** ITIN: 9 digits starting with 9, digits 4 and 5 in 50-65, 70-88, 90-92 or 94-99. */
export function validItin(raw: string): boolean {
  const d = digits(raw);
  if (!/^9\d{8}$/.test(d)) return false;
  const g = Number(d.slice(3, 5));
  return (g >= 50 && g <= 65) || (g >= 70 && g <= 88) || (g >= 90 && g <= 92) || (g >= 94 && g <= 99);
}

/** EIN prefixes the IRS assigns (campus and internet prefixes). */
const EIN_PREFIXES = new Set([
  '01', '02', '03', '04', '05', '06', '10', '11', '12', '13', '14', '15', '16', '20', '21', '22', '23', '24', '25', '26', '27',
  '30', '31', '32', '33', '34', '35', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47', '48', '50', '51',
  '52', '53', '54', '55', '56', '57', '58', '59', '60', '61', '62', '63', '64', '65', '66', '67', '68', '71', '72', '73', '74',
  '75', '76', '77', '80', '81', '82', '83', '84', '85', '86', '87', '88', '90', '91', '92', '93', '94', '95', '98', '99',
]);

export function validEin(raw: string): boolean {
  const d = digits(raw);
  return /^\d{9}$/.test(d) && EIN_PREFIXES.has(d.slice(0, 2));
}

/** As printed on a 1099: 123-45-6789 or 12-3456789. */
export function formatTin(tinType: string, tin: string): string {
  const d = digits(tin);
  if (tinType === 'ein') return `${d.slice(0, 2)}-${d.slice(2)}`;
  if (tinType === 'ssn' || tinType === 'itin') return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
  return tin;
}

/**
 * A W-8BEN or W-8BEN-E without a change in circumstances stays valid until the last day of the
 * third calendar year after the year it was signed (Treas. Reg. 1.1441-1(e)(4)(ii)).
 */
export function w8ExpiresAt(signedAt: Date): Date {
  return new Date(Date.UTC(signedAt.getUTCFullYear() + 3, 11, 31, 23, 59, 59, 999));
}

export function backupWithholding(grossMinor: number): number {
  return grossMinor > 0 ? Math.round(grossMinor * BACKUP_WITHHOLDING_RATE) : 0;
}

/**
 * Payments for services to a corporation are generally not reported on Form 1099-NEC (attorneys
 * aside, which does not apply to affiliates). LLCs taxed as corporations count as corporations.
 */
export function exemptFrom1099Nec(form: { formType: string; taxClassification: string | null; exemptPayeeCode: string | null }): boolean {
  if (form.formType !== 'W9') return true; // foreign persons: no 1099; W-8 is kept on file instead
  if (['c_corporation', 's_corporation', 'llc_c', 'llc_s'].includes(form.taxClassification ?? '')) return true;
  return !!form.exemptPayeeCode && form.exemptPayeeCode !== '';
}

/** The certifications shown to the signer, as on the IRS form. Stored with each signed form. */
export const CERTIFICATIONS = {
  W9: (backup: boolean) => [
    'Under penalties of perjury, I certify that:',
    '1. The number shown on this form is my correct taxpayer identification number (or I am waiting for a number to be issued to me); and',
    backup
      ? '2. [Crossed out: I have been notified by the IRS that I am currently subject to backup withholding.]'
      : '2. I am not subject to backup withholding because (a) I am exempt from backup withholding, or (b) I have not been notified by the Internal Revenue Service (IRS) that I am subject to backup withholding as a result of a failure to report all interest or dividends, or (c) the IRS has notified me that I am no longer subject to backup withholding; and',
    '3. I am a U.S. citizen or other U.S. person (defined in the instructions); and',
    '4. The FATCA code(s) entered on this form (if any) indicating that I am exempt from FATCA reporting is correct.',
    'The Internal Revenue Service does not require your consent to any provision of this document other than the certifications required to avoid backup withholding.',
  ].join('\n'),
  W8BEN: () => [
    'Under penalties of perjury, I declare that I have examined the information on this form and to the best of my knowledge and belief it is true, correct, and complete. I further certify under penalties of perjury that:',
    '- I am the individual that is the beneficial owner (or am authorized to sign for the individual that is the beneficial owner) of all the income or proceeds to which this form relates or am using this form to document myself for chapter 4 purposes;',
    '- The person named on line 1 of this form is not a U.S. person;',
    '- This form relates to (a) income not effectively connected with the conduct of a trade or business in the United States, (b) income effectively connected with the conduct of a trade or business in the United States but is not subject to tax under an applicable income tax treaty, (c) the partner\'s share of a partnership\'s effectively connected taxable income, or (d) the partner\'s amount realized from the transfer of a partnership interest subject to withholding under section 1446(f);',
    '- The person named on line 1 of this form is a resident of the treaty country listed on line 9 of the form (if any) within the meaning of the income tax treaty between the United States and that country; and',
    '- For broker transactions or barter exchanges, the beneficial owner is an exempt foreign person as defined in the instructions.',
    'Furthermore, I authorize this form to be provided to any withholding agent that has control, receipt, or custody of the income of which I am the beneficial owner or any withholding agent that can disburse or make payments of the income of which I am the beneficial owner.',
    'I agree that I will submit a new form within 30 days if any certification made on this form becomes incorrect.',
  ].join('\n'),
  W8BENE: () => [
    'Under penalties of perjury, I declare that I have examined the information on this form and to the best of my knowledge and belief it is true, correct, and complete. I further certify under penalties of perjury that:',
    '- The entity identified on line 1 of this form is the beneficial owner of all the income or proceeds to which this form relates, is using this form to certify its status for chapter 4 purposes, or is submitting this form for purposes of section 6050W or 6050Y;',
    '- The entity identified on line 1 of this form is not a U.S. person;',
    '- This form relates to (a) income not effectively connected with the conduct of a trade or business in the United States, (b) income effectively connected with the conduct of a trade or business in the United States but is not subject to tax under an income tax treaty, (c) the partner\'s share of a partnership\'s effectively connected taxable income, or (d) the partner\'s amount realized from the transfer of a partnership interest subject to withholding under section 1446(f); and',
    '- For broker transactions or barter exchanges, the beneficial owner is an exempt foreign person as defined in the instructions.',
    'Furthermore, I authorize this form to be provided to any withholding agent that has control, receipt, or custody of the income of which the entity on line 1 is the beneficial owner or any withholding agent that can disburse or make payments of the income of which the entity on line 1 is the beneficial owner.',
    'I agree that I will submit a new form within 30 days if any certification on this form becomes incorrect.',
    'I certify that I have the capacity to sign for the entity identified on line 1 of this form.',
  ].join('\n'),
  /** Our own attestation for foreign payees: commission for services performed abroad is foreign source income. */
  servicesOutsideUs: 'I certify that all services I (or the entity) perform for Progrid, including creating and publishing content, are performed outside the United States. I will tell Progrid within 30 days if this changes.',
};
