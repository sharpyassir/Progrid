'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Fragment, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useShell } from '@/components/shell';

// Each tab belongs to one or more staff areas; staff with limited roles only see their areas (the API enforces the same split).
// Managed cloud tabs carry an i18n key; the older tabs keep their English labels.
type Tab = { href: string; label: string; areas: readonly string[]; key?: Parameters<typeof t>[1] };
const MANAGED = ['engineer', 'support_lead'] as const;
const TABS: Tab[] = [
  { href: '/admin', label: 'Overview', areas: ['any'] }, { href: '/admin/teams', label: 'Teams', areas: ['support'] }, { href: '/admin/servers', label: 'Servers', areas: ['ops'] },
  { href: '/admin/hosts', label: 'Hosts', areas: ['ops'] }, { href: '/admin/ip-blocks', label: 'IP blocks', areas: ['ops'] }, { href: '/admin/images', label: 'Images', areas: ['ops'] },
  { href: '/admin/abuse', label: 'Abuse', areas: ['support'] }, { href: '/admin/support', label: 'Support', areas: ['support'] },
  { href: '/admin/invoices', label: 'Invoices', areas: ['finance'] }, { href: '/admin/finance', label: 'Finance', areas: ['finance'] }, { href: '/admin/audit', label: 'Audit', areas: ['support'] },
  { href: '/admin/managed/contracts', label: 'Managed', key: 'admMcTabContracts', areas: MANAGED },
  { href: '/admin/managed/tickets', label: 'Tickets queue', key: 'admMcTabTickets', areas: MANAGED },
  { href: '/admin/managed/alerts', label: 'Alerts', key: 'admMcTabAlerts', areas: MANAGED },
  { href: '/admin/managed/oncall', label: 'On call', key: 'admMcTabOnCall', areas: MANAGED },
  { href: '/admin/managed/maintenance', label: 'Maintenance', key: 'admMcTabMaintenance', areas: MANAGED },
  { href: '/admin/managed/worklogs', label: 'Worklogs', key: 'admMcTabWorklogs', areas: MANAGED },
  { href: '/admin/managed/runbooks', label: 'Runbooks', key: 'admMcTabRunbooks', areas: MANAGED },
  { href: '/admin/managed/reports', label: 'Reports', key: 'admMcTabReports', areas: MANAGED },
  { href: '/admin/managed/plans', label: 'Plans', key: 'admMcTabPlans', areas: MANAGED },
];

/** Back office frame: staff only (the API also enforces the admin scope on every call). */
export function AdminShell({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { locale } = useShell();
  const [ok, setOk] = useState<boolean | null>(null);
  const [roles, setRoles] = useState<string[]>([]);
  useEffect(() => {
    api<{ isStaff: boolean; staffRoles?: string[] }>('/v1/account').then((m) => { if (m.isStaff) { setRoles(m.staffRoles ?? []); setOk(true); } else router.replace('/servers'); }).catch(() => router.replace('/login'));
  }, [router]);
  const tabs = TABS.filter((tab) => tab.areas.includes('any') || roles.length === 0 || tab.areas.some((a) => roles.includes(a)));
  if (!ok) return <p className="text-sm text-neutral-500">Checking access…</p>;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="badge bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{t(locale, 'backOffice')}</span>
        <nav className="flex flex-wrap gap-1 text-sm">
          {tabs.map(({ href, label, key }, i) => {
            const active = href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
            const first = key && !tabs[i - 1]?.key && i > 0;
            return <Fragment key={href}>{first && <span aria-hidden className="mx-1 h-4 self-center border-s border-neutral-300 dark:border-neutral-700" />}<Link href={href} className={`rounded px-2.5 py-1 ${active ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'}`}>{key ? t(locale, key) : label}</Link></Fragment>;
          })}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{title}</h1>
        <div className="ms-auto flex gap-2">{actions}</div>
      </div>
      {children}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: 'warn' | 'bad' }) {
  return (
    <div className={`card ${tone === 'bad' ? 'border-red-300' : tone === 'warn' ? 'border-amber-300' : ''}`}>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub && <div className="text-xs text-neutral-500">{sub}</div>}
    </div>
  );
}

export const fmtMoney = (minor: number, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 100);
export const fmtDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
