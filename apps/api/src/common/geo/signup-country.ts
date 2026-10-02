import { entityProfile, requestDomain } from '../entities/entities';
import { currentRequest } from '../entities/request-context';
import { countryOfIp } from './geoip';

/**
 * Country to suggest (or to use when a signup sends none): SA on the progrid.sa domain, else the
 * country of the caller's address from the local IP database, else US. Only a default: the
 * person picks their billing country on the signup form, and that choice decides the company.
 */
export function suggestedCountry(ip?: string, domain?: string): { country: string; source: 'domain' | 'ip' | 'default' } {
  const arabiaDomain = entityProfile('progrid_arabia').domain;
  if (arabiaDomain && domain === arabiaDomain) return { country: 'SA', source: 'domain' };
  const geo = countryOfIp(ip);
  if (geo) return { country: geo, source: 'ip' };
  return { country: 'US', source: 'default' };
}

/** suggestedCountry for the current request. */
export function defaultSignupCountry(): string {
  const ctx = currentRequest();
  return suggestedCountry(ctx?.ip, requestDomain() ?? domainOfOrigin(ctx?.origin)).country;
}

function domainOfOrigin(origin?: string): string | undefined {
  if (!origin) return undefined;
  try {
    const host = new URL(origin).hostname;
    const d = entityProfile('progrid_arabia').domain;
    return d && (host === d || host.endsWith(`.${d}`)) ? d : undefined;
  } catch {
    return undefined;
  }
}
