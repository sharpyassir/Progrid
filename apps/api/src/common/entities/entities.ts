import type { BillingEntity, Currency } from '@prisma/client';
import { loadConfig, type AppConfig } from '../../config/config';
import { currentRequest } from './request-context';

/**
 * The contracting company and the two public domains (docs/domains-and-entities.md).
 *
 * Progrid Arabia, a Saudi company, sells and invoices everything. progrid.co (primary, global) and
 * progrid.sa both belong to it and serve every customer; the domain decides nothing about billing.
 * The billing country decides the currency and the VAT:
 *
 * - Saudi Arabia: SAR, 15% VAT.
 * - Every other country: USD, 0% VAT as a zero-rated export of services. TO BE CONFIRMED BY THE
 *   TAX ADVISOR (whether every service and customer qualifies, and what evidence is kept).
 *
 * progrid_llc (Progrid Technologies LLC) is kept only to read and print what it issued before
 * (PRGD-US invoices, CN-US credit notes); nothing assigns it any more.
 *
 * Legal details come from configuration. Unset values print a visible placeholder; nothing here
 * invents a registration or tax number.
 */

export type BillingEntityId = BillingEntity;
/** The company every team, invoice and credit note gets from now on. */
export const BILLING_ENTITY: BillingEntityId = 'progrid_arabia';
/** Companies that can be assigned. */
export const BILLING_ENTITIES: BillingEntityId[] = [BILLING_ENTITY];
/** Companies that only exist in the history (old invoices and credit notes). */
export const LEGACY_ENTITIES: BillingEntityId[] = ['progrid_llc'];

/** The billing country of Progrid Arabia's home market: SAR and VAT. */
export const ARABIA_COUNTRY = 'SA';

/** Note printed on invoices to customers outside Saudi Arabia. */
export const ZERO_RATED_NOTE = 'Zero-rated export of services';

export type VatCategory = 'standard' | 'zero_rated_export';

const isSaudi = (country: string | null | undefined) => (country ?? '').toUpperCase() === ARABIA_COUNTRY;

/** The currency of a billing country: SAR in Saudi Arabia, USD everywhere else. */
export function currencyForCountry(country: string | null | undefined): Currency {
  return isSaudi(country) ? 'SAR' : 'USD';
}

/**
 * VAT of a billing country. Saudi Arabia: the standard rate (15%). Elsewhere: 0%, a zero-rated
 * export of services, with the note on the invoice (to be confirmed by the tax advisor).
 */
export function vatFor(country: string | null | undefined, c: AppConfig = loadConfig()): { rate: number; category: VatCategory; note: string | null } {
  return isSaudi(country)
    ? { rate: c.ENTITY_ARABIA_VAT_RATE, category: 'standard', note: null }
    : { rate: 0, category: 'zero_rated_export', note: ZERO_RATED_NOTE };
}

export interface EntityProfile {
  id: BillingEntityId;
  legalName: string;
  /** Country of incorporation, ISO 3166-1. */
  country: 'SA' | 'US';
  countryName: string;
  /** Registered address, or a placeholder in brackets until the owner provides it. */
  address: string;
  /** Registration numbers printed on invoices, only those that are set. */
  registrations: { label: string; value: string }[];
  /** Seller tax id printed on invoices (VAT number for Arabia), when set. */
  taxId?: string;
  /** Home currency of the company (its books). Customers pay in SAR or USD by billing country. */
  currency: Currency;
  /** Standard VAT rate (Saudi billing country). Other countries pay 0% (vatFor). */
  taxRate: number;
  taxLabel: string;
  bankDetails?: string;
  supportEmail: string;
  mailFrom: string;
  domain?: string;
  wwwUrl: string;
  consoleUrl: string;
  apiUrl: string;
  termsUrl: string;
  /** Invoice and credit note number prefixes, and the sequences behind them. */
  invoicePrefix: 'PRGD-SA' | 'PRGD-US';
  creditNotePrefix: 'CN-SA' | 'CN-US';
  invoiceSequence: 'prgd_invoice_number_sa_seq' | 'prgd_invoice_number_us_seq';
  creditNoteSequence: 'prgd_credit_note_number_sa_seq' | 'prgd_credit_note_number_us_seq';
  /** Card payment adapter. */
  paymentProvider: 'moyasar' | 'stripe' | 'fake';
  /** Electronic invoicing hand off: ZATCA (Fatoora) for Arabia, none on LLC history. */
  eInvoicing: 'zatca' | null;
  /** Only in the history: issues nothing new. */
  legacy: boolean;
}

const trim = (u: string) => u.replace(/\/+$/, '');

/** Public URLs of a domain: <domain>, console.<domain>, api.<domain>, ops.<domain>. Falls back to the configured URLs when no domain is set. */
export function urlsFor(domain: string | undefined, c: AppConfig = loadConfig()) {
  if (!domain) return { wwwUrl: trim(c.WWW_URL), consoleUrl: trim(c.CONSOLE_URL), apiUrl: trim(c.PUBLIC_API_URL) };
  return { wwwUrl: `https://${domain}`, consoleUrl: `https://console.${domain}`, apiUrl: `https://api.${domain}` };
}

export function entityProfile(id: BillingEntityId, c: AppConfig = loadConfig()): EntityProfile {
  const domain = c.ENTITY_ARABIA_DOMAIN;
  const urls = urlsFor(domain, c);
  const arabia: EntityProfile = {
    id: 'progrid_arabia',
    legalName: c.ENTITY_ARABIA_LEGAL_NAME,
    country: 'SA',
    countryName: 'Saudi Arabia',
    address: c.ENTITY_ARABIA_ADDRESS ?? c.COMPANY_ADDRESS ?? '[Registered address to be provided], Saudi Arabia',
    registrations: c.ENTITY_ARABIA_CR ? [{ label: 'CR', value: c.ENTITY_ARABIA_CR }] : [],
    taxId: c.ENTITY_ARABIA_VAT_NUMBER ?? c.COMPANY_TAX_ID,
    currency: 'SAR',
    taxRate: c.ENTITY_ARABIA_VAT_RATE,
    taxLabel: 'VAT',
    bankDetails: c.ENTITY_ARABIA_BANK_DETAILS,
    supportEmail: c.ENTITY_ARABIA_SUPPORT_EMAIL,
    mailFrom: c.ENTITY_ARABIA_MAIL_FROM,
    domain,
    ...urls,
    termsUrl: c.ENTITY_ARABIA_TERMS_URL ?? `${urls.wwwUrl}/legal/terms`,
    invoicePrefix: 'PRGD-SA',
    creditNotePrefix: 'CN-SA',
    invoiceSequence: 'prgd_invoice_number_sa_seq',
    creditNoteSequence: 'prgd_credit_note_number_sa_seq',
    paymentProvider: c.PAYMENT_PROVIDER,
    eInvoicing: 'zatca',
    legacy: false,
  };
  if (id === 'progrid_arabia') return arabia;
  // Progrid Technologies LLC, history only: enough to show and reprint what it issued. Its
  // registration details are no longer configured; the PDF sent at the time is the record.
  // Customer links, mail and any payment still due go through Progrid Arabia.
  return {
    ...arabia,
    id,
    legalName: 'Progrid Technologies LLC',
    country: 'US',
    countryName: 'United States',
    address: 'United States',
    registrations: [],
    taxId: undefined,
    currency: 'USD',
    taxRate: 0,
    taxLabel: 'Tax',
    bankDetails: undefined,
    invoicePrefix: 'PRGD-US',
    creditNotePrefix: 'CN-US',
    invoiceSequence: 'prgd_invoice_number_us_seq',
    creditNoteSequence: 'prgd_credit_note_number_us_seq',
    eInvoicing: null,
    legacy: true,
  };
}

/**
 * What the console and the API show a customer about their contracting company. With the team's
 * billing country and currency, the currency and VAT are the team's own (USD at 0% outside Saudi
 * Arabia); without, the company's defaults (SAR, 15%).
 */
export function publicEntity(id: BillingEntityId, team?: { country: string; currency?: Currency | null }) {
  const e = entityProfile(id);
  const vat = team ? vatFor(team.country) : { rate: e.taxRate, category: 'standard' as VatCategory, note: null };
  return {
    id: e.id,
    legalName: e.legalName,
    country: e.country,
    currency: team ? (team.currency ?? currencyForCountry(team.country)) : e.currency,
    taxRate: vat.rate,
    taxLabel: e.taxLabel,
    vatCategory: vat.category,
    taxNote: vat.note,
    supportEmail: e.supportEmail,
    termsUrl: e.termsUrl,
    domain: e.domain ?? null,
    consoleUrl: e.consoleUrl,
  };
}

/** Invoice number per company and year, e.g. PRGD-SA-2026-00042 (PRGD-US only in the history). */
export function entityInvoiceNumber(id: BillingEntityId, year: number, seq: number | bigint) {
  return `${entityProfile(id).invoicePrefix}-${year}-${String(seq).padStart(5, '0')}`;
}

export function entityCreditNoteNumber(id: BillingEntityId, year: number, seq: number | bigint) {
  return `${entityProfile(id).creditNotePrefix}-${year}-${String(seq).padStart(5, '0')}`;
}

// ---- domains ----

/** The configured public domains, primary (progrid.co) first. Empty in development. Both are Progrid Arabia's. */
export function publicDomains(c: AppConfig = loadConfig()): string[] {
  return [...new Set([c.PRIMARY_DOMAIN, c.ENTITY_ARABIA_DOMAIN].filter((d): d is string => !!d))];
}

/** The configured domain a host name belongs to (api.progrid.sa → progrid.sa), if any. */
export function domainOfHost(host: string | undefined, c: AppConfig = loadConfig()): string | undefined {
  if (!host) return undefined;
  const h = host.toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  return publicDomains(c).find((d) => h === d || h.endsWith(`.${d}`));
}

/** The domain of the current request's Host, when it is one of ours. */
export function requestDomain(): string | undefined {
  return domainOfHost(currentRequest()?.host);
}

/** Public API base for links in API responses: the domain the request came through, else the fallback. */
export function requestApiBase(fallback?: string): string {
  const d = requestDomain();
  if (d) return `https://api.${d}`;
  return trim(fallback ?? loadConfig().PUBLIC_API_URL);
}

/**
 * The console a browser redirect should return to: the console the request came from when it is
 * one of ours (sessions live in that origin's storage), else Progrid Arabia's console.
 */
export function returnConsoleUrl(entity?: BillingEntityId): string {
  const origin = currentRequest()?.origin;
  if (origin) {
    for (const d of publicDomains()) if (origin === `https://console.${d}`) return origin;
    if (origin === trim(loadConfig().CONSOLE_URL)) return origin;
  }
  return entity ? entityProfile(entity).consoleUrl : trim(loadConfig().CONSOLE_URL);
}

/**
 * Browser origins allowed to call the API with credentials: the configured console, website and
 * ops URLs, every page of both domains, and CORS_EXTRA_ORIGINS.
 */
export function allowedOrigins(c: AppConfig = loadConfig()): Set<string> {
  const out = new Set<string>();
  const add = (u?: string) => { if (u) try { out.add(new URL(u).origin); } catch { /* not a URL */ } };
  add(c.CONSOLE_URL); add(c.WWW_URL); add(c.PRGD_OPS_URL); add(c.PRGD_OPS_URL_SA);
  for (const d of publicDomains(c)) for (const sub of ['', 'www.', 'console.', 'ops.']) out.add(`https://${sub}${d}`);
  for (const o of c.CORS_EXTRA_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)) add(o);
  return out;
}

// ---- ops console (WebAuthn) ----

/**
 * The ops console origin and WebAuthn relying party id for this request. A browser on
 * ops.progrid.sa gets the .sa relying party; everything else the primary one. Passkeys are bound
 * to their relying party, so staff register them on the primary console, ops.progrid.co.
 */
export function opsRelyingParty(origin: string | undefined, c: AppConfig = loadConfig()): { origin: string; rpId: string } {
  const primary = { origin: trim(c.PRGD_OPS_URL), rpId: c.PRGD_OPS_RP_ID };
  if (origin && c.PRGD_OPS_URL_SA && trim(origin) === new URL(c.PRGD_OPS_URL_SA).origin) {
    return { origin: new URL(c.PRGD_OPS_URL_SA).origin, rpId: c.PRGD_OPS_RP_ID_SA ?? new URL(c.PRGD_OPS_URL_SA).hostname };
  }
  return primary;
}
