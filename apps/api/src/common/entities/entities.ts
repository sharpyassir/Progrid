import type { BillingEntity, Currency } from '@prisma/client';
import { loadConfig, type AppConfig } from '../../config/config';
import { currentRequest } from './request-context';

/**
 * The two contracting companies and the two public domains (docs/domains-and-entities.md).
 *
 * One platform, one database and one account system serve both progrid.co (primary, global) and
 * progrid.sa. Which company contracts with a team follows the team's billing country, never the
 * visitor's IP address: Saudi Arabia is Progrid Arabia (SAR, VAT, ZATCA, Moyasar), every other
 * country is Progrid Technologies LLC (USD, Stripe).
 *
 * Legal details come from configuration. Unset values print a visible placeholder; nothing here
 * invents a registration or tax number.
 */

export type BillingEntityId = BillingEntity;
export const BILLING_ENTITIES: BillingEntityId[] = ['progrid_llc', 'progrid_arabia'];

/** The billing country that belongs to Progrid Arabia. */
export const ARABIA_COUNTRY = 'SA';

export function entityForCountry(country: string | null | undefined): BillingEntityId {
  return (country ?? '').toUpperCase() === ARABIA_COUNTRY ? 'progrid_arabia' : 'progrid_llc';
}

export function currencyForEntity(entity: BillingEntityId): Currency {
  return entity === 'progrid_arabia' ? 'SAR' : 'USD';
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
  currency: Currency;
  /** Tax added to invoices: 0.15 VAT for Arabia, configurable (default 0) for the LLC. */
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
  /** Electronic invoicing hand off: ZATCA (Fatoora) for Arabia, none for the LLC. */
  eInvoicing: 'zatca' | null;
}

const trim = (u: string) => u.replace(/\/+$/, '');

/** Public URLs of a domain: <domain>, console.<domain>, api.<domain>, ops.<domain>. Falls back to the configured URLs when no domain is set. */
export function urlsFor(domain: string | undefined, c: AppConfig = loadConfig()) {
  if (!domain) return { wwwUrl: trim(c.WWW_URL), consoleUrl: trim(c.CONSOLE_URL), apiUrl: trim(c.PUBLIC_API_URL) };
  return { wwwUrl: `https://${domain}`, consoleUrl: `https://console.${domain}`, apiUrl: `https://api.${domain}` };
}

export function entityProfile(id: BillingEntityId, c: AppConfig = loadConfig()): EntityProfile {
  if (id === 'progrid_arabia') {
    const domain = c.ENTITY_ARABIA_DOMAIN;
    const urls = urlsFor(domain, c);
    const vat = c.ENTITY_ARABIA_VAT_NUMBER ?? c.COMPANY_TAX_ID;
    return {
      id,
      legalName: c.ENTITY_ARABIA_LEGAL_NAME,
      country: 'SA',
      countryName: 'Saudi Arabia',
      address: c.ENTITY_ARABIA_ADDRESS ?? c.COMPANY_ADDRESS ?? '[Registered address to be provided], Saudi Arabia',
      registrations: c.ENTITY_ARABIA_CR ? [{ label: 'CR', value: c.ENTITY_ARABIA_CR }] : [],
      taxId: vat,
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
    };
  }
  const domain = c.ENTITY_LLC_DOMAIN;
  const urls = urlsFor(domain, c);
  return {
    id,
    legalName: c.ENTITY_LLC_LEGAL_NAME,
    country: 'US',
    countryName: 'United States',
    address: c.ENTITY_LLC_ADDRESS ?? '[Registered address to be provided], United States',
    registrations: c.ENTITY_LLC_EIN ? [{ label: 'EIN', value: c.ENTITY_LLC_EIN }] : [],
    taxId: undefined,
    currency: 'USD',
    taxRate: c.ENTITY_LLC_TAX_RATE,
    taxLabel: c.ENTITY_LLC_TAX_LABEL,
    bankDetails: c.ENTITY_LLC_BANK_DETAILS,
    supportEmail: c.ENTITY_LLC_SUPPORT_EMAIL,
    mailFrom: c.ENTITY_LLC_MAIL_FROM,
    domain,
    ...urls,
    termsUrl: c.ENTITY_LLC_TERMS_URL ?? `${urls.wwwUrl}/legal/terms`,
    invoicePrefix: 'PRGD-US',
    creditNotePrefix: 'CN-US',
    invoiceSequence: 'prgd_invoice_number_us_seq',
    creditNoteSequence: 'prgd_credit_note_number_us_seq',
    paymentProvider: c.PAYMENT_PROVIDER_LLC,
    eInvoicing: null,
  };
}

/** What the console and the API show a customer about their contracting company. */
export function publicEntity(id: BillingEntityId) {
  const e = entityProfile(id);
  return { id: e.id, legalName: e.legalName, country: e.country, currency: e.currency, taxRate: e.taxRate, taxLabel: e.taxLabel, supportEmail: e.supportEmail, termsUrl: e.termsUrl, domain: e.domain ?? null, consoleUrl: e.consoleUrl };
}

/** Invoice number per company and year, e.g. PRGD-SA-2026-00042. */
export function entityInvoiceNumber(id: BillingEntityId, year: number, seq: number | bigint) {
  return `${entityProfile(id).invoicePrefix}-${year}-${String(seq).padStart(5, '0')}`;
}

export function entityCreditNoteNumber(id: BillingEntityId, year: number, seq: number | bigint) {
  return `${entityProfile(id).creditNotePrefix}-${year}-${String(seq).padStart(5, '0')}`;
}

// ---- domains ----

/** The configured public domains, primary (LLC) first. Empty in development. */
export function publicDomains(c: AppConfig = loadConfig()): string[] {
  return [c.ENTITY_LLC_DOMAIN, c.ENTITY_ARABIA_DOMAIN].filter((d): d is string => !!d);
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
 * one of ours (sessions live in that origin's storage), else the entity's console.
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
