/**
 * Thin client for the pgcloud API. The console is just one API client — it uses the
 * same endpoints the CLI, Terraform and agents use. Session token lives in localStorage.
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
/** The marketing site, for legal and help links. */
export const WWW_URL = process.env.NEXT_PUBLIC_WWW_URL ?? 'https://progrid.sa';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, unknown>) {
    super(message);
  }
}

export function getToken() {
  try {
    return typeof window !== 'undefined' ? localStorage.getItem('pgcloud.session') : null;
  } catch {
    return null;
  }
}

export function setToken(t: string | null) {
  try {
    if (t) localStorage.setItem('pgcloud.session', t);
    else localStorage.removeItem('pgcloud.session');
  } catch {
    /* private mode */
  }
}

export async function api<T>(path: string, init: RequestInit & { idempotent?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.headers as Record<string, string>) };
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (init.idempotent) headers['idempotency-key'] = crypto.randomUUID();
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const e = body?.error ?? { code: 'error', message: res.statusText };
    throw new ApiError(res.status, e.code, e.message, e.details);
  }
  return body as T;
}

// ---- types (subset of packages/openapi) ----

export interface Size { id: string; name?: string; vcpu: number; memoryMb: number; diskGb: number; transferTb: number }
export const VAT_RATE = 0.15;
/** Amount with Saudi VAT added, for checkout style totals. */
export function withVat(minor: number) { return Math.round(minor * (1 + VAT_RATE)); }
export interface Image { id: string; kind: 'distribution' | 'marketplace'; name: string; distribution?: string; version?: string }
export interface Server {
  id: string; name: string; status: string; statusMessage: string | null;
  region: { id: string; name: string }; size: Size; image: Image;
  networks: { v4: { ipAddress: string; floating?: boolean; reverseDns?: string | null }[]; private: { ipAddress: string }[] };
  firewalls: string[]; backupsEnabled: boolean; managed: boolean; managedHealth: 'ok' | 'warn' | 'stale' | 'pending' | null; projectId: string;
  tags: string[]; createdAt: string;
}
export interface ServerAction { id: string; type: string; status: string; params: Record<string, unknown> | null; error: string | null; startedAt: string; finishedAt: string | null }
export interface Volume { id: string; name: string; sizeGb: number; status: string; statusMessage: string | null; serverId: string | null; device: string | null; regionId: string; createdAt: string; server: { id: string; name: string } | null }
export interface Snapshot { id: string; name: string; kind?: 'manual' | 'backup'; status: string; sizeGb: number; serverId: string | null; createdAt: string }
export interface Firewall { id: string; name: string; rules: { id: string; direction: string; protocol: string; ports: string | null; sources: string[]; destinations: string[] }[]; servers: { serverId: string }[] }
export interface App { id: string; slug: string; name: string; category: string; summary: string; version: string; minSizeId: string; variables: AppVariable[]; priceMonthlyMinor: number }
export interface AppVariable { name: string; label: string; type: string; required?: boolean; default?: string; generate?: string }
export interface Price { resourceType: string; sku: string; monthlyMinor: number; hourlyMinor: number }
export interface Balance { currency: 'USD' | 'SAR'; creditMinor: number; monthToDateMinor: number; status: string }

export function money(minor: number, currency: string, locale = 'en') {
  return new Intl.NumberFormat(locale === 'tr' ? 'tr-TR' : locale === 'ar' ? 'ar-EG' : 'en-US', { style: 'currency', currency }).format(minor / 100);
}
