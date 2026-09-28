'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Locale, t, tf } from '@/lib/i18n';
import { useShell } from '@/components/shell';
import { Account, fmtDateTime, fmtSpan, slaUsed, type AlertStatus, type AssetStatus, type ContractStatus, type Health, type Owner, type Priority, type Severity, type TicketStatus } from '@/lib/managed';

/** Lookup for keys built at runtime, such as `mcStatus_ACTIVE`. Falls back to the raw value. */
export function tk(locale: Locale, key: string, fallback?: string) {
  const v = t(locale, key as Parameters<typeof t>[1]);
  return v ?? fallback ?? key;
}

const RED = 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
const AMBER = 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200';
const GREEN = 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
const BLUE = 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200';
const GREY = 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300';

const PRIORITY_TONE: Record<Priority, string> = { P1: RED, P2: AMBER, P3: BLUE, P4: GREY };
const CONTRACT_TONE: Record<ContractStatus, string> = { DRAFT: GREY, ONBOARDING: BLUE, ACTIVE: GREEN, SUSPENDED: RED, CANCELLED: GREY };
const ASSET_TONE: Record<AssetStatus, string> = { PENDING: AMBER, APPROVED: GREEN, REJECTED: RED };
const HEALTH_TONE: Record<Health, string> = { UNKNOWN: GREY, HEALTHY: GREEN, DEGRADED: AMBER, UNHEALTHY: RED };
const SEVERITY_TONE: Record<Severity, string> = { CRITICAL: RED, WARNING: AMBER, INFO: BLUE };
const ALERT_TONE: Record<AlertStatus, string> = { FIRING: RED, ACKNOWLEDGED: AMBER, RESOLVED: GREEN };
const TICKET_TONE: Record<TicketStatus, string> = { open: AMBER, answered: BLUE, closed: GREY };
const OWNER_TONE: Record<Owner, string> = { PROGRID: BLUE, CUSTOMER: GREY, SHARED: AMBER };

function Badge({ tone, children, title }: { tone: string; children: React.ReactNode; title?: string }) {
  return <span className={`badge whitespace-nowrap ${tone}`} title={title}>{children}</span>;
}

export function PriorityBadge({ p }: { p: Priority }) {
  const { locale } = useShell();
  return <Badge tone={PRIORITY_TONE[p] ?? GREY} title={tk(locale, `mcPrioHint_${p}`)}>{p}</Badge>;
}
export function ContractStatusBadge({ s }: { s: ContractStatus }) {
  const { locale } = useShell();
  return <Badge tone={CONTRACT_TONE[s] ?? GREY}>{tk(locale, `mcStatus_${s}`, s)}</Badge>;
}
export function AssetStatusBadge({ s }: { s: AssetStatus }) {
  const { locale } = useShell();
  return <Badge tone={ASSET_TONE[s] ?? GREY}>{tk(locale, `mcAssetStatus_${s}`, s)}</Badge>;
}
export function HealthBadge({ h }: { h: Health }) {
  const { locale } = useShell();
  return <Badge tone={HEALTH_TONE[h] ?? GREY}>{tk(locale, `mcHealth_${h}`, h)}</Badge>;
}
export function SeverityBadge({ s }: { s: Severity }) {
  const { locale } = useShell();
  return <Badge tone={SEVERITY_TONE[s] ?? GREY}>{tk(locale, `mcSeverity_${s}`, s)}</Badge>;
}
export function AlertStatusBadge({ s }: { s: AlertStatus }) {
  const { locale } = useShell();
  return <Badge tone={ALERT_TONE[s] ?? GREY}>{tk(locale, `mcAlertStatus_${s}`, s)}</Badge>;
}
export function TicketStatusBadge({ s }: { s: TicketStatus }) {
  const { locale } = useShell();
  return <Badge tone={TICKET_TONE[s] ?? GREY}>{tk(locale, `mcTicketStatus_${s}`, s)}</Badge>;
}
export function OwnerBadge({ o }: { o: Owner }) {
  const { locale } = useShell();
  return <Badge tone={OWNER_TONE[o] ?? GREY}>{tk(locale, `mcOwner_${o}`, o)}</Badge>;
}
export function ToneBadge({ tone, children }: { tone: 'red' | 'amber' | 'green' | 'blue' | 'grey'; children: React.ReactNode }) {
  return <Badge tone={{ red: RED, amber: AMBER, green: GREEN, blue: BLUE, grey: GREY }[tone]}>{children}</Badge>;
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <p role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{error}</p>;
}
export function OkBox({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <p role="status" className="rounded border border-green-200 bg-green-50 p-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300">{msg}</p>;
}
export function Loading() {
  const { locale } = useShell();
  return <p className="text-sm text-neutral-500">{t(locale, 'loading')}</p>;
}
export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="card text-center text-sm text-neutral-500">{children}</div>;
}

/** Re-renders every `ms` so countdowns stay current. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** The signed in account (role on the team, staff areas). */
export function useAccount() {
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<Account>('/v1/account').then(setAccount).catch((e) => setError(String(e?.message ?? e))); }, []);
  return { account, error };
}

/**
 * Time left on an SLA target. Green below 75 percent of the target, amber from 75 percent,
 * red once it is due. A met target shows when it was met.
 */
export function SlaCountdown({ label, createdAt, dueAt, metAt, breached, now }: { label?: string; createdAt: string; dueAt: string | null; metAt?: string | null; breached?: boolean; now: number }) {
  const { locale } = useShell();
  if (!dueAt) return <span className="text-xs text-neutral-500">{label ? `${label}: ` : ''}{t(locale, 'mcNoTarget')}</span>;
  if (metAt) {
    const late = new Date(metAt).getTime() > new Date(dueAt).getTime() || breached;
    return <span className={`text-xs ${late ? 'text-red-700 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`} title={fmtDateTime(dueAt, locale)}>{label ? `${label}: ` : ''}{late ? t(locale, 'mcMetLate') : t(locale, 'mcMet')}</span>;
  }
  const used = slaUsed(createdAt, dueAt, now);
  const left = new Date(dueAt).getTime() - now;
  const tone = used >= 1 || breached ? 'text-red-700 font-medium dark:text-red-400' : used >= 0.75 ? 'text-amber-700 font-medium dark:text-amber-400' : 'text-green-700 dark:text-green-400';
  return (
    <span className={`text-xs ${tone}`} title={fmtDateTime(dueAt, locale)}>
      {label ? `${label}: ` : ''}{left >= 0 ? tf(locale, 'mcLeft')(fmtSpan(left, locale)) : tf(locale, 'mcOverdueBy')(fmtSpan(left, locale))}
    </span>
  );
}

/** Sub navigation of the customer managed cloud pages. Owners see the contract and reports. */
export function ManagedNav({ owner }: { owner: boolean }) {
  const { locale } = useShell();
  const pathname = usePathname();
  const links: [string, string][] = [
    ['/managed', t(locale, 'mcOverview')], ['/managed/tickets', t(locale, 'tickets')], ['/managed/assets', t(locale, 'mcAssets')],
    ...(owner ? ([['/managed/reports', t(locale, 'mcReports')], ['/managed/contract', t(locale, 'mcContract')]] as [string, string][]) : []),
  ];
  return (
    <nav className="flex flex-wrap gap-1 text-sm" aria-label={t(locale, 'mcTitle')}>
      {links.map(([href, label]) => {
        const active = href === '/managed' ? pathname === '/managed' : pathname.startsWith(href);
        return <Link key={href} href={href} className={`rounded px-2.5 py-1 ${active ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'}`}>{label}</Link>;
      })}
    </nav>
  );
}

/** Page frame for the customer managed cloud pages: title, sub navigation and actions. */
export function ManagedFrame({ title, owner, actions, children }: { title: string; owner: boolean; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        <div className="ms-auto flex gap-2">{actions}</div>
      </div>
      <ManagedNav owner={owner} />
      {children}
    </div>
  );
}

/** Simple on and off switch used for toggles in tables. */
export function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition disabled:opacity-50 ${on ? 'bg-blue-600' : 'bg-neutral-300 dark:bg-neutral-700'}`}>
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${on ? 'translate-x-4 rtl:-translate-x-4' : 'translate-x-0.5 rtl:-translate-x-0.5'}`} />
    </button>
  );
}

/** Table wrapper with the card look used across the console. */
export function Table({ head, children, empty, cols }: { head: React.ReactNode[]; children: React.ReactNode; empty?: React.ReactNode; cols?: number }) {
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="text-xs text-neutral-500"><tr>{head.map((h, i) => <th key={i} className="px-4 py-2 text-start font-medium">{h}</th>)}</tr></thead>
        <tbody>
          {empty && <tr><td colSpan={cols ?? head.length} className="px-4 py-3 text-neutral-500">{empty}</td></tr>}
          {children}
        </tbody>
      </table>
    </div>
  );
}
export const Row = ({ children, className = '', onClick }: { children: React.ReactNode; className?: string; onClick?: () => void }) => (
  <tr className={`border-t border-neutral-100 align-top dark:border-neutral-800 ${onClick ? 'cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900' : ''} ${className}`} onClick={onClick}>{children}</tr>
);
export const Cell = ({ children, className = '', dir, colSpan }: { children?: React.ReactNode; className?: string; dir?: 'ltr' | 'rtl'; colSpan?: number }) => <td dir={dir} colSpan={colSpan} className={`px-4 py-2 ${className}`}>{children}</td>;

/** Label and control stacked, as in the console forms. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="text-neutral-500">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}
