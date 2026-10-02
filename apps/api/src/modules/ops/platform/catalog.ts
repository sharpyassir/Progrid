/**
 * Recurring maintenance of Progrid's own platform (docs/platform-maintenance.md): the part-time
 * engineer's task list, as data. Titles and steps are i18n keys in apps/ops (plt_<key>_t / _s).
 *
 *  - auto:     the system runs the check and closes the task when it passes. A warning or
 *              failure stays open for the engineer, who closes it with a note.
 *  - assisted: the system gathers what it can; the engineer does the work and closes it with
 *              evidence (command output, a timing).
 *  - manual:   the engineer does it and closes it with a note and evidence.
 */
export type Cadence = 'weekly' | 'monthly' | 'quarterly';
export type Mode = 'auto' | 'assisted' | 'manual';
export type CheckKey = 'monitoring' | 'backups' | 'abuse' | 'access' | 'capacity' | 'security' | 'runbooks' | 'patching';

export interface PlatformTask {
  key: string;
  cadence: Cadence;
  mode: Mode;
  /** Automatic check that runs for it, if any. */
  check?: CheckKey;
  /** Expected engineer time, in minutes. */
  estimateMinutes: number;
  /** Evidence is required to close it (restore test, drill). */
  evidenceRequired?: boolean;
}

export const PLATFORM_TASKS: PlatformTask[] = [
  { key: 'weekly.patching', cadence: 'weekly', mode: 'assisted', check: 'patching', estimateMinutes: 30, evidenceRequired: true },
  { key: 'weekly.monitoring', cadence: 'weekly', mode: 'auto', check: 'monitoring', estimateMinutes: 15 },
  { key: 'weekly.backups', cadence: 'weekly', mode: 'auto', check: 'backups', estimateMinutes: 10 },
  { key: 'weekly.abuse', cadence: 'weekly', mode: 'auto', check: 'abuse', estimateMinutes: 15 },
  { key: 'monthly.restore_test', cadence: 'monthly', mode: 'manual', estimateMinutes: 60, evidenceRequired: true },
  { key: 'monthly.access_review', cadence: 'monthly', mode: 'auto', check: 'access', estimateMinutes: 30 },
  { key: 'monthly.capacity', cadence: 'monthly', mode: 'auto', check: 'capacity', estimateMinutes: 15 },
  { key: 'monthly.code_review', cadence: 'monthly', mode: 'manual', estimateMinutes: 60 },
  { key: 'quarterly.security_audit', cadence: 'quarterly', mode: 'assisted', check: 'security', estimateMinutes: 120, evidenceRequired: true },
  { key: 'quarterly.dr_drill', cadence: 'quarterly', mode: 'manual', estimateMinutes: 120, evidenceRequired: true },
  { key: 'quarterly.runbook', cadence: 'quarterly', mode: 'assisted', check: 'runbooks', estimateMinutes: 45 },
];

export const taskByKey = (key: string) => PLATFORM_TASKS.find((t) => t.key === key);

/** The period a moment falls in (UTC): ISO week, calendar month or quarter. */
export function periodOf(cadence: Cadence, at: Date): { key: string; start: Date; end: Date } {
  const y = at.getUTCFullYear();
  const m = at.getUTCMonth();
  if (cadence === 'monthly') {
    return { key: `${y}-${String(m + 1).padStart(2, '0')}`, start: new Date(Date.UTC(y, m, 1)), end: new Date(Date.UTC(y, m + 1, 1)) };
  }
  if (cadence === 'quarterly') {
    const q = Math.floor(m / 3);
    return { key: `${y}-Q${q + 1}`, start: new Date(Date.UTC(y, q * 3, 1)), end: new Date(Date.UTC(y, q * 3 + 3, 1)) };
  }
  // ISO 8601 week: Monday to Sunday; week 1 holds the year's first Thursday.
  const day = new Date(Date.UTC(y, m, at.getUTCDate()));
  const dow = (day.getUTCDay() + 6) % 7; // Monday 0
  const start = new Date(day.getTime() - dow * 86_400_000);
  const thursday = new Date(start.getTime() + 3 * 86_400_000);
  const isoYear = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const week1 = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86_400_000);
  const week = Math.round((start.getTime() - week1.getTime()) / (7 * 86_400_000)) + 1;
  return { key: `${isoYear}-W${String(week).padStart(2, '0')}`, start, end: new Date(start.getTime() + 7 * 86_400_000) };
}
