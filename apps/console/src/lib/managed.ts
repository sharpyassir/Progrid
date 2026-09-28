/**
 * Managed cloud: types that mirror the /v1/managed and /admin/managed responses, and the
 * formatting helpers the customer and back office pages share.
 */
import { API_URL, ApiError, getToken } from './api';
import { Locale, t, tf } from './i18n';

export type Coverage = 'BUSINESS_HOURS' | 'TWENTY_FOUR_SEVEN';
export type ContractStatus = 'DRAFT' | 'ONBOARDING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED';
export type Priority = 'P1' | 'P2' | 'P3' | 'P4';
export type Targets = Record<Priority, number>;
export type AssetKind = 'PLATFORM_SERVER' | 'EXTERNAL_SERVER' | 'SITE';
export type AssetStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type Health = 'UNKNOWN' | 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
export type Owner = 'PROGRID' | 'CUSTOMER' | 'SHARED';
export type Severity = 'CRITICAL' | 'WARNING' | 'INFO';
export type AlertStatus = 'FIRING' | 'ACKNOWLEDGED' | 'RESOLVED';
export type TicketStatus = 'open' | 'answered' | 'closed';

export const PRIORITIES: Priority[] = ['P1', 'P2', 'P3', 'P4'];
export const CONTRACT_STATUSES: ContractStatus[] = ['DRAFT', 'ONBOARDING', 'ACTIVE', 'SUSPENDED', 'CANCELLED'];
export const ASSET_KINDS: AssetKind[] = ['PLATFORM_SERVER', 'EXTERNAL_SERVER', 'SITE'];
export const OWNERS: Owner[] = ['PROGRID', 'SHARED', 'CUSTOMER'];

export interface Plan {
  id: string; code: string; name: string; description: string | null; priceMinor: number | null; currency: string; custom: boolean;
  maxAssets: number | null; coverage: Coverage; includedEngineerMinutes: number; hourlyRateMinor: number;
  responseTargets: Targets; resolveTargets: Targets; active: boolean; sortOrder: number;
}

export interface Sla {
  coverage: Coverage; calendar: 'SA' | 'TR'; timeZone: string;
  businessHours: { workdays: number[]; start: string; end: string } | null;
  responseTargets: Targets; resolveTargets: Targets;
}

export interface OnboardingItem { id: string; key: string; title: string; done: boolean; doneById: string | null; doneAt: string | null; note: string | null; sortOrder: number; check?: { ready: boolean; hint: string } | null }
export interface Responsibility { id: string; area: string; owner: Owner; notes: string | null; sortOrder: number }
export interface Usage { periodStart: string; billableMinutes: number; nonBillableMinutes: number; includedMinutes: number; overageMinutes: number }

export interface Contract {
  id: string; teamId: string; status: ContractStatus; plan: Plan; calendar: 'SA' | 'TR'; currency: string;
  monthlyFeeMinor: number | null; hourlyRateMinor: number; includedEngineerMinutes: number; maxAssets: number | null;
  liabilityCapMinor: number | null; signedByName: string | null; signedAt: string | null; termMonths: number; termEndsAt: string | null; renewedAt: string | null;
  notes: string | null; onboardingStartedAt: string | null; activatedAt: string | null; suspendedAt: string | null; cancelledAt: string | null; cancelReason: string | null;
  createdAt: string; updatedAt: string; sla: Sla; assetCount?: number;
  // detail
  onboarding?: { done: number; total: number; items: OnboardingItem[] };
  responsibilities?: Responsibility[];
  assets?: Record<string, number>;
  usage?: Usage;
  // staff
  priceOverrideMinor?: number | null; includedMinutesOverride?: number | null; maxAssetsOverride?: number | null;
  signedById?: string | null; requestedById?: string | null; onCallOverride?: boolean; suspensions?: { from: string; to: string }[] | null;
  team?: { id: string; name: string; slug: string; country?: string; currency?: string; status?: string };
}

export interface Asset {
  id: string; contractId: string; kind: AssetKind; serverId: string | null; name: string; address: string | null; provider: string | null; os: string | null;
  status: AssetStatus; monitoringEnabled: boolean; backupEnabled: boolean; health: Health; lastHeartbeatAt: string | null; approvedAt: string | null;
  rejectedReason: string | null; notes: string | null; createdAt: string; openAlerts?: number;
  managementAddress?: string | null; hasHeartbeatToken?: boolean; heartbeatReport?: unknown;
}

export interface Message { id: string; fromSupport: boolean; author: string; body: string; createdAt: string; internal?: boolean; authorId?: string | null }
export interface StaffRef { id: string; name: string; email: string }

export interface Ticket {
  id: string; number: number; subject: string; status: TicketStatus; priority: Priority; contractId: string; assetId: string | null; assigneeId: string | null; source: string | null;
  responseDueAt: string | null; resolveDueAt: string | null; firstRespondedAt: string | null; closedAt: string | null; warnedAt: string | null; breachedAt: string | null;
  responseBreached: boolean; resolveBreached: boolean; createdAt: string; updatedAt: string; messageCount: number;
  messages?: Message[];
  // staff
  team?: { id: string; name: string; slug: string } | null; assignee?: StaffRef | null; asset?: { id: string; name: string; kind?: string } | null;
  plan?: { code: string; name: string } | null;
  alerts?: { id: string; name: string; severity: Severity; status: AlertStatus }[];
  workLogs?: { id: string; minutes: number; billable: boolean; userId: string; workedAt: string }[];
}

export interface Alert {
  id: string; assetId: string | null; asset?: { id: string; name: string }; contractId: string | null; fingerprint: string; name: string; summary: string | null;
  severity: Severity; status: AlertStatus; source: string; labels: Record<string, string> | null; startsAt: string; endsAt: string | null; ticketId: string | null;
  acknowledgedById: string | null; acknowledgedAt: string | null; resolvedAt: string | null; createdAt: string;
}

export interface Shift { id: string; userId: string; user?: StaffRef; role: 'PRIMARY' | 'SECONDARY'; startsAt: string; endsAt: string; note: string | null }
export interface StaffMember extends StaffRef { phone: string | null; pagingChannel: 'SMS' | 'WHATSAPP' | 'PUSH' | 'EMAIL' | null; staffRoles: string[] }

/** Team and plan names staff responses carry next to a contract id. */
export interface ContractRef { teamId?: string; teamName?: string; planName?: string; planCode?: string }

export interface MaintenanceTask extends ContractRef {
  id: string; contractId: string; assetId: string | null; asset?: { id: string; name: string }; kind: 'PATCHING' | 'BACKUP_TEST' | 'CUSTOM'; name: string; cron: string; timezone: string;
  playbook: string | null; vars: Record<string, unknown> | null; enabled: boolean; lastRunAt: string | null; nextRunAt: string | null;
}
export interface MaintenanceRun {
  id: string; taskId: string; task?: { id: string; name: string; kind: string; contractId: string } & ContractRef; status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'; trigger: string; runner: string | null;
  startedAt: string | null; finishedAt: string | null; error: string | null; ticketId: string | null; createdAt: string; log?: string | null;
}

export interface WorkLog { id: string; contractId: string; ticketId: string | null; userId: string; user?: { id: string; name: string }; minutes: number; billable: boolean; note: string | null; workedAt: string; billedPeriod: string | null; billedInvoiceId: string | null }

/** Counted (approved or paid) minutes per contract or per engineer for the filtered worklogs. */
export interface WorkLogTotals {
  billableMinutes: number; nonBillableMinutes: number;
  byContract: { contractId: string; teamId: string | null; teamName: string | null; planName: string | null; includedMinutes: number | null; overageMinutes: number; billableMinutes: number; nonBillableMinutes: number; entries: number }[];
  byUser: { userId: string; name: string | null; billableMinutes: number; nonBillableMinutes: number; entries: number }[];
}

/** GET /v1/managed/summary: what every team member may see about the managed cloud contract. */
export interface ManagedSummary {
  hasContract: boolean;
  contract: { id: string; status: ContractStatus; planName: string; planCode: string; coverage: Coverage; calendar: 'SA' | 'TR'; sla: Sla; onboarding: { done: number; total: number } | null; createdAt: string; activatedAt: string | null } | null;
  openTickets: number;
  previous: { planName: string; cancelledAt: string | null } | null;
}

/** GET /admin/managed/teams: a team for the create contract picker (no billing data). */
export interface TeamHit { id: string; name: string; slug: string; country: string; ownerName: string | null }

/** Full staff: empty roles. Engineers and support leads only read plans. */
export const isFullStaffRoles = (roles: string[]) => roles.length === 0;

export interface Runbook { id: string; slug: string; title: string; tags: string[]; body?: string; excerpt?: string; updatedBy?: { id: string; name: string }; updatedAt: string }

export interface ReportData {
  period: string; periodStart: string; periodEnd: string; team: { id: string; name: string }; plan: { code: string; name: string; coverage: string }; calendar: string;
  assets: { id: string; name: string; kind: string; observedMinutes: number; downtimeMinutes: number; uptimePercent: number | null }[];
  uptimePercent: number | null;
  incidents: { alerts: { total: number; critical: number; warning: number; info: number }; majorTickets: { id: string; number: number; subject: string; priority: string; openedAt: string; closedAt: string | null; source: string | null }[] };
  sla: { tickets: number; responseMet: number; responseBreached: number; resolveMet: number; resolveBreached: number };
  patches: { runs: number; succeeded: number; failed: number };
  backupTests: { runs: number; succeeded: number; failed: number };
  hours: { billableMinutes: number; nonBillableMinutes: number; includedMinutes: number; overageMinutes: number };
}
export interface Report extends ContractRef { id: string; contractId: string; period: string; status: 'DRAFT' | 'SENT'; data: ReportData | null; recommendations: string | null; hasPdf: boolean; generatedAt: string | null; sentAt: string | null; pdfUrl?: string }

export interface Page<T> { data: T[]; meta?: { next_cursor: string | null; count: number } }

/** Account details the managed pages need: role on the team and staff areas. */
export interface Account { user: { id: string; name: string; email: string }; team: { id: string; name: string; currency: string; country?: string }; role: string; isStaff: boolean; staffRoles: string[] }

// ---- formatting ----

/** Error text for a failed call, in the page's error box. */
export const errText = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e));

/**
 * An SLA target in words: "1 hour", "30 minutes", "2 business days". Business hours plans count
 * working time, so a day there is one 8 hour working day.
 */
export function fmtTarget(minutes: number, coverage: Coverage, locale: Locale) {
  const business = coverage === 'BUSINESS_HOURS';
  const day = business ? 480 : 1440;
  const dur = tf(locale, 'mcDuration');
  if (minutes >= day && minutes % day === 0) return dur(minutes / day, 'day', business);
  if (minutes >= 60 && minutes % 60 === 0) return dur(minutes / 60, 'hour', business);
  if (minutes >= 60) return dur(Math.round((minutes / 60) * 10) / 10, 'hour', business);
  return dur(minutes, 'minute', business);
}

/** Minutes as hours with one decimal, e.g. 90 to "1.5". */
export const hours = (minutes: number) => String(Math.round((minutes / 60) * 10) / 10);

/** Compact span such as "2d 4h", "3h 15m" or "12m". */
export function fmtSpan(ms: number, locale: Locale) {
  const m = Math.max(0, Math.round(Math.abs(ms) / 60_000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  const [sd, sh, sm] = [t(locale, 'mcShortDay'), t(locale, 'mcShortHour'), t(locale, 'mcShortMinute')];
  if (d) return `${d}${sd} ${h}${sh}`;
  if (h) return `${h}${sh} ${mm}${sm}`;
  return `${mm}${sm}`;
}

export const fmtDateTime = (d: string | null | undefined, locale: Locale) =>
  d ? new Date(d).toLocaleString(locale === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : locale, { dateStyle: 'medium', timeStyle: 'short' }) : '';
export const fmtDay = (d: string | null | undefined, locale: Locale) =>
  d ? new Date(d).toLocaleDateString(locale === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : locale, { dateStyle: 'medium' }) : '';
/** "September 2026" for "2026-09". */
export const fmtPeriod = (period: string, locale: Locale) =>
  new Date(`${period}-01T00:00:00Z`).toLocaleDateString(locale === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Relative wording for a future or past time: "in 3h 5m" or "2d 1h ago". */
export function fmtRelative(d: string | null | undefined, locale: Locale, now = Date.now()) {
  if (!d) return '';
  const ms = new Date(d).getTime() - now;
  return ms >= 0 ? tf(locale, 'mcIn')(fmtSpan(ms, locale)) : tf(locale, 'mcAgo')(fmtSpan(ms, locale));
}

/** Share of an SLA target already used, 0 to 1 and beyond. */
export function slaUsed(createdAt: string, dueAt: string, now = Date.now()) {
  const start = new Date(createdAt).getTime(), due = new Date(dueAt).getTime();
  return due <= start ? 1 : (now - start) / (due - start);
}

/** "2026-09" for the month containing `d`. */
export const periodOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Fetches a PDF with the session token and saves it under `filename`. */
export async function downloadPdf(path: string, filename: string) {
  const res = await fetch(`${API_URL}${path}`, { headers: { authorization: `Bearer ${getToken()}` } });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.error?.code ?? 'error', body?.error?.message ?? res.statusText);
  }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Staff areas that see the managed back office; empty roles mean full staff. */
export const isLeadRoles = (roles: string[]) => roles.length === 0 || roles.includes('support_lead');
