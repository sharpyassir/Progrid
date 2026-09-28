import { intlLocale } from './time';
import type { Locale } from './i18n';

export function money(minor: number, currency: string, locale: Locale) {
  try {
    return new Intl.NumberFormat(intlLocale(locale), { style: 'currency', currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}
