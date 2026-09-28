/**
 * Who a social sign in belongs to. Pure functions so the security critical rules can be tested
 * without a database; OAuthService loads the rows and acts on the decision.
 */

export type ProviderId = 'google' | 'microsoft';
export const PROVIDERS: readonly ProviderId[] = ['google', 'microsoft'];

/** Microsoft's fixed directory for personal accounts (outlook.com, hotmail.com, live.com). */
export const MS_PERSONAL_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

/** What the verified id token says about the person. */
export interface ProviderAccount {
  provider: ProviderId;
  subject: string;
  /** Lower case; null when the token carries no usable address. */
  email: string | null;
  /** The provider vouches that this person controls `email` (see `emailTrusted`). */
  emailVerified: boolean;
  name: string;
  tenantId: string | null;
}

/**
 * Whether the provider vouches for the email address, which is what allows linking to an
 * existing account with that address.
 *   Google: `email_verified` is true.
 *   Microsoft: an `email` claim is present and either the account is a personal Microsoft
 *   account (Microsoft verifies those addresses) or the token carries `xms_edov` true, which
 *   Entra adds when the directory has verified the domain of the address. A work or school
 *   directory can otherwise put any address in `email`, so it proves nothing.
 */
export function emailTrusted(provider: ProviderId, claims: Record<string, unknown>): boolean {
  const email = typeof claims.email === 'string' ? claims.email.trim() : '';
  if (!email) return false;
  if (provider === 'google') return claims.email_verified === true || claims.email_verified === 'true';
  if (claims.tid === MS_PERSONAL_TENANT) return true;
  return claims.xms_edov === true || claims.xms_edov === 'true' || claims.xms_edov === 1;
}

export type Intent = 'login' | 'signup' | 'link';

export interface LinkInput {
  intent: Intent;
  account: Pick<ProviderAccount, 'email' | 'emailVerified'>;
  /** The user this provider account is already linked to, if any. */
  linkedUserId: string | null;
  /** The user whose email equals the account's email, if any. */
  emailUserId: string | null;
  /** For intent `link`: the signed in user who started it. */
  currentUserId?: string | null;
}

export type LinkDecision =
  /** (a) Already linked: sign that user in. */
  | { action: 'sign_in'; userId: string }
  /** (b) Same verified email: link the identity to that user, then sign in. */
  | { action: 'link_and_sign_in'; userId: string }
  /** (c) Nobody has this address: create an account (or join the invited team). */
  | { action: 'create' }
  /** Linking from Security: attach the identity to the signed in user. */
  | { action: 'link'; userId: string }
  | { action: 'already_linked'; userId: string }
  | { action: 'refuse'; code: RefuseCode };

export type RefuseCode =
  /** The provider account belongs to another user. */
  | 'identity_in_use'
  /** A user with this address exists but the provider does not vouch for the address. */
  | 'link_from_security'
  /** The token has no email address to create an account with. */
  | 'email_missing'
  | 'link_session_invalid';

export function decideLink(i: LinkInput): LinkDecision {
  if (i.intent === 'link') {
    if (!i.currentUserId) return { action: 'refuse', code: 'link_session_invalid' };
    if (i.linkedUserId === i.currentUserId) return { action: 'already_linked', userId: i.currentUserId };
    if (i.linkedUserId) return { action: 'refuse', code: 'identity_in_use' };
    // The person is signed in and just proved control of the provider account: no email match needed.
    return { action: 'link', userId: i.currentUserId };
  }
  if (i.linkedUserId) return { action: 'sign_in', userId: i.linkedUserId };
  if (i.emailUserId) {
    if (i.account.email && i.account.emailVerified) return { action: 'link_and_sign_in', userId: i.emailUserId };
    return { action: 'refuse', code: 'link_from_security' };
  }
  if (!i.account.email) return { action: 'refuse', code: 'email_missing' };
  return { action: 'create' };
}

/**
 * Checks the id token's `iss`. Google publishes one fixed issuer (tokens may also carry it
 * without the scheme). Microsoft's multi tenant endpoints (common, organizations, consumers)
 * publish a template with `{tenantid}`, which is filled in with the token's `tid`; a single
 * tenant endpoint publishes the exact issuer. `tenant` is the configured MICROSOFT_TENANT and
 * narrows which directories may sign in.
 */
export function issuerValid(provider: ProviderId, discoveredIssuer: string, claims: Record<string, unknown>, tenant = 'common'): boolean {
  const iss = claims.iss;
  if (typeof iss !== 'string') return false;
  if (provider === 'google') return iss === discoveredIssuer || `https://${iss}` === discoveredIssuer;

  const tid = claims.tid;
  if (typeof tid !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tid)) return false;
  const expected = discoveredIssuer.includes('{tenantid}') ? discoveredIssuer.replace('{tenantid}', tid) : discoveredIssuer;
  if (iss !== expected) return false;
  const t = tenant.toLowerCase();
  if (t === 'consumers') return tid === MS_PERSONAL_TENANT;
  if (t === 'organizations') return tid !== MS_PERSONAL_TENANT;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return tid.toLowerCase() === t;
  return true; // common, or a domain name whose discovery document already pinned the issuer
}

/** A console path to land on after sign in. Only same origin paths, never another host. */
export function safeReturnPath(p: unknown, fallback = '/servers'): string {
  if (typeof p !== 'string' || !p.startsWith('/') || p.startsWith('//') || p.length > 300) return fallback;
  if (/[\\\s\u0000-\u001f]/.test(p) || /^\/+[a-z][a-z0-9+.-]*:/i.test(p)) return fallback;
  return p;
}
