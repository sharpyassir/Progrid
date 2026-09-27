'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

const TABS = [
  ['/admin', 'Overview'], ['/admin/teams', 'Teams'], ['/admin/servers', 'Servers'], ['/admin/hosts', 'Hosts'],
  ['/admin/abuse', 'Abuse'], ['/admin/support', 'Support'], ['/admin/invoices', 'Invoices'], ['/admin/finance', 'Finance'], ['/admin/audit', 'Audit'],
] as const;

/** Back office frame: staff only (the API also enforces the admin scope on every call). */
export function AdminShell({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    api<{ isStaff: boolean }>('/v1/account').then((m) => { if (m.isStaff) setOk(true); else router.replace('/servers'); }).catch(() => router.replace('/login'));
  }, [router]);
  if (!ok) return <p className="text-sm text-neutral-500">Checking access…</p>;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className="badge bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Back office</span>
        <nav className="flex flex-wrap gap-1 text-sm">
          {TABS.map(([href, label]) => {
            const active = href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);
            return <Link key={href} href={href} className={`rounded px-2.5 py-1 ${active ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'}`}>{label}</Link>;
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
