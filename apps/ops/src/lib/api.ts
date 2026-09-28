/**
 * Client for the engineer API (/ops/v1). Every call sends the ops session as a Bearer token;
 * `credentials: 'include'` lets the sign in answers set the HttpOnly cookie used by GET streams.
 * A 401 outside the sign in routes ends the session and returns to the sign in page.
 */
import { clearSession, getToken } from './session';
import { API_URL } from './security-headers';

export { API_URL };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, unknown>) {
    super(message);
  }
}

let unauthorized: (() => void) | null = null;
/** The shell registers what happens on a 401 (back to sign in). */
export function onUnauthorized(fn: (() => void) | null) {
  unauthorized = fn;
}

type Init = Omit<RequestInit, 'body'> & { json?: unknown };

export async function api<T>(path: string, init: Init = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', ...(init.headers as Record<string, string>) };
  if (init.json !== undefined) headers['content-type'] = 'application/json';
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : undefined, credentials: 'include', cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'network', 'network');
  }
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const e = body?.error ?? { code: 'error', message: res.statusText };
    if (res.status === 401 && !path.startsWith('/ops/v1/auth/')) {
      clearSession();
      unauthorized?.();
    }
    throw new ApiError(res.status, e.code ?? 'error', e.message ?? res.statusText, e.details);
  }
  return body as T;
}

export const post = <T>(path: string, json: unknown = {}) => api<T>(path, { method: 'POST', json });
export const patch = <T>(path: string, json: unknown) => api<T>(path, { method: 'PATCH', json });
export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });
