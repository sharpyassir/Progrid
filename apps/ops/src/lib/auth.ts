import { setSession } from './session';
import type { SignInAnswer } from './types';

export function storeSignIn(a: SignInAnswer) {
  setSession({ token: a.session, expiresAt: a.expiresAt, user: a.user, engineer: a.engineer });
}

/** Only same app paths are allowed after sign in. */
export function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : '/';
}
