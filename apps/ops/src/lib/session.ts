/**
 * The ops session lives in memory and in sessionStorage, never in localStorage: closing the
 * browser signs the engineer out. GET streams and PDF downloads use the HttpOnly
 * prgd_ops_session cookie the API sets at sign in instead of this token.
 */
export interface StoredSession {
  token: string;
  expiresAt: string;
  user: { id: string; name: string; locale?: string };
  engineer: { kind: 'EXTERNAL' | 'INTERNAL'; country: string; timezone: string };
}

const KEY = 'prgd.ops.session';
let memory: StoredSession | null = null;

export function getSession(): StoredSession | null {
  if (!memory && typeof window !== 'undefined') {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) memory = JSON.parse(raw) as StoredSession;
    } catch {
      memory = null;
    }
  }
  if (memory && new Date(memory.expiresAt).getTime() <= Date.now()) {
    clearSession();
    return null;
  }
  return memory;
}

export function setSession(s: StoredSession) {
  memory = s;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage blocked: the session stays in memory for this tab */
  }
}

export function clearSession() {
  memory = null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export const getToken = () => getSession()?.token ?? null;
