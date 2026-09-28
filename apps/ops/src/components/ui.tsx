'use client';

import Link from 'next/link';
import { useCallback, useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import type { Key } from '@/lib/i18n';
import { fmtDate, fmtDateTime, fmtDuration, fmtTime, useNow, zoneLabel } from '@/lib/time';
import { useShell, type ShellCtx } from './ctx';

/** A time in the engineer's zone; hovering shows the contract's local time. */
export function Time({ value, contractId, mode = 'datetime' }: { value: string | null | undefined; contractId?: string | null; mode?: 'datetime' | 'date' | 'time' }) {
  const { tz, contractTz, locale, t } = useShell();
  if (!value) return <span className="text-neutral-400">-</span>;
  const f = mode === 'date' ? fmtDate : mode === 'time' ? fmtTime : fmtDateTime;
  const ctz = contractTz(contractId);
  const title = ctz
    ? `${t('contractLocal')}: ${fmtDateTime(value, ctz, locale, { year: 'numeric' })} (${zoneLabel(ctz, locale)})`
    : `${fmtDateTime(value, 'UTC', locale, { year: 'numeric' })} UTC`;
  return (
    <time dateTime={value} title={title} className="cursor-help whitespace-nowrap underline decoration-dotted decoration-neutral-300 underline-offset-2 dark:decoration-neutral-600">
      {f(value, tz, locale)}
    </time>
  );
}

export function useUnits() {
  const { t } = useShell();
  return { d: t('unitD'), h: t('unitH'), m: t('unitM'), s: t('unitS') };
}

/** Time left until `to`; red and marked late once it has passed. */
export function Countdown({ to, warnSeconds = 900, seconds = true, calm = 'text-neutral-700 dark:text-neutral-200' }: { to: string | null | undefined; warnSeconds?: number; seconds?: boolean; calm?: string }) {
  const now = useNow(1000);
  const units = useUnits();
  const { t } = useShell();
  if (!to) return <span className="text-neutral-400">-</span>;
  const left = Math.round((new Date(to).getTime() - now) / 1000);
  const cls = left < 0 ? 'text-red-600 dark:text-red-400 font-semibold' : left < warnSeconds ? 'text-amber-600 dark:text-amber-400 font-medium' : calm;
  return (
    <span className={`tabular-nums ${cls}`}>
      {left < 0 ? t('lateBy', { d: fmtDuration(-left, units, seconds) }) : fmtDuration(left, units, seconds)}
    </span>
  );
}

/** Time since `from`, ticking. */
export function Elapsed({ from }: { from: string }) {
  const now = useNow(1000);
  const units = useUnits();
  return <span className="tabular-nums">{fmtDuration((now - new Date(from).getTime()) / 1000, units)}</span>;
}

const tone: Record<string, string> = {
  green: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  amber: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  gray: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
  violet: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300',
};

const statusTone: Record<string, keyof typeof tone> = {
  ACTIVE: 'green', APPROVED: 'green', SUCCEEDED: 'green', HEALTHY: 'green', PAID: 'green', CLOSED: 'gray', closed: 'gray', ISSUED: 'blue',
  REQUESTED: 'amber', SUBMITTED: 'blue', QUEUED: 'gray', RUNNING: 'blue', DRAFT: 'gray', open: 'amber', answered: 'blue', resolved_pending_pm: 'violet',
  DENIED: 'red', REVOKED: 'red', FAILED: 'red', REJECTED: 'red', UNHEALTHY: 'red', EXPIRED: 'gray', DEGRADED: 'amber', UNKNOWN: 'gray',
  FIRING: 'red', ACKNOWLEDGED: 'amber', RESOLVED: 'green', CRITICAL: 'red', WARNING: 'amber', INFO: 'blue',
  PROGRID: 'blue', CUSTOMER: 'amber', SHARED: 'violet', P1: 'red', P2: 'amber', P3: 'blue', P4: 'gray', PRIMARY: 'blue', SECONDARY: 'gray',
};

export function Badge({ children, color = 'gray', title }: { children: ReactNode; color?: keyof typeof tone; title?: string }) {
  return <span title={title} className={`badge ${tone[color]}`}>{children}</span>;
}

/** Status badge with the translated label (`st_<status>`). */
export function StatusBadge({ status }: { status: string | null | undefined }) {
  const { t } = useShell();
  if (!status) return null;
  return <Badge color={statusTone[status] ?? 'gray'}>{t(`st_${status}` as Key)}</Badge>;
}

export function PriorityBadge({ priority }: { priority: string | null | undefined }) {
  if (!priority) return null;
  return <span className={`badge font-mono ${tone[statusTone[priority] ?? 'gray']}`}>{priority}</span>;
}

export function errText(e: unknown, t: ShellCtx['t']): string {
  if (e instanceof ApiError) {
    if (e.code === 'network') return t('errNetwork');
    const known = `err_${e.code}` as Key;
    const s = t(known);
    return s !== known ? s : e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

export function ErrorNote({ error }: { error: unknown }) {
  const { t } = useShell();
  if (!error) return null;
  return <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{errText(error, t)}</p>;
}

export function Loading() {
  const { t } = useShell();
  return <p className="text-sm text-neutral-500">{t('loading')}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-2 text-sm text-neutral-500">{children}</p>;
}

export function PageTitle({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-neutral-500">{sub}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500 rtl:normal-case rtl:tracking-normal">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function TicketLink({ ticket }: { ticket: { id: string; number: number } | null | undefined }) {
  if (!ticket) return null;
  return <Link href={`/tickets/${ticket.id}`} className="font-mono text-blue-600 hover:underline dark:text-blue-400" dir="ltr">#{ticket.number}</Link>;
}

/** Runs an action with a busy flag; errors become a toast, success an optional toast. */
export function useAction() {
  const { toast, t } = useShell();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async <T,>(id: string, fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
      setBusy(id);
      try {
        const r = await fn();
        if (ok) toast(ok, 'success');
        return r;
      } catch (e) {
        toast(errText(e, t), 'error');
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [toast, t],
  );
  return { busy, run };
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}

export function Uptime({ s }: { s: number }) {
  const units = useUnits();
  return <span>{fmtDuration(s, units, false)}</span>;
}
