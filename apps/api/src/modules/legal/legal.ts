/**
 * The legal documents every user accepts (clickwrap) before using the console or the API.
 * Bump LEGAL_VERSION when one of them changes materially: every user is then asked to accept
 * again (AuthGuard answers 428 legal_acceptance_required until they do). The documents live in
 * apps/www/content/pages/<co|sa>/<lang>/<slug>.md and are served at /legal/<slug>.
 */
export const LEGAL_VERSION = '2026-10-03';
export const LEGAL_DOCUMENTS = ['terms', 'acceptable-use', 'privacy'] as const;
/** Documents linked from the acceptance screens that the agreement incorporates. */
export const LEGAL_RELATED = ['dpa', 'refunds', 'sla', 'cookies', 'subprocessors', 'export-sanctions'] as const;

export type LegalMethod = 'signup' | 'oauth_signup' | 'invite' | 'reaccept';

/** Requests a user who has not accepted the current version may still make. */
export function allowedBeforeAcceptance(method: string, path: string): boolean {
  if (path === '/v1/legal' || path === '/v1/legal/accept') return true;
  if (method === 'GET' && path === '/v1/account') return true;
  if (path.startsWith('/v1/auth/')) return true; // sign out, sessions, two factor setup
  return false;
}
