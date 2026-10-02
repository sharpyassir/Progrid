'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ENTITY_NAME, type BillingEntityId } from '@/lib/countries';
import { AdminShell, fmtDate } from '@/components/admin-shell';
import { StatusBadge } from '@/components/status-badge';

interface Team { id: string; name: string; slug: string; country: string; currency: string; billingEntity: string; status: string; kycLevel: number; createdAt: string; _count: { projects: number; abuseFlags: number } }

export default function AdminTeams() {
  const [rows, setRows] = useState<Team[]>([]);
  const [q, setQ] = useState('');
  const [entity, setEntity] = useState('');
  const load = useCallback((query = '') => {
    const p = new URLSearchParams();
    if (query) p.set('q', query);
    if (entity) p.set('entity', entity);
    return api<{ data: Team[] }>(`/admin/v1/teams${p.size ? `?${p}` : ''}`).then((r) => setRows(r.data));
  }, [entity]);
  useEffect(() => { load(); }, [load]);
  return (
    <AdminShell title="Teams" actions={<form className="flex gap-2" onSubmit={(e: FormEvent) => { e.preventDefault(); load(q); }}><select className="input w-auto py-1" value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Billing company"><option value="">All companies</option><option value="progrid_llc">Progrid Technologies LLC</option><option value="progrid_arabia">Progrid Arabia</option></select><input className="input w-64" placeholder="Search name, slug or email" value={q} onChange={(e) => setQ(e.target.value)} /></form>}>
      <section className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-neutral-500"><tr><th className="px-4 py-2 text-start">Team</th><th className="px-4 py-2 text-start">Status</th><th className="px-4 py-2 text-start">Country</th><th className="px-4 py-2 text-start">Billed by</th><th className="px-4 py-2 text-start">KYC</th><th className="px-4 py-2 text-start">Projects</th><th className="px-4 py-2 text-start">Flags</th><th className="px-4 py-2 text-start">Created</th></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-t border-neutral-100 dark:border-neutral-800">
                <td className="px-4 py-2"><Link href={`/admin/teams/${t.id}`} className="font-medium hover:underline">{t.name}</Link> <span className="text-xs text-neutral-500">{t.slug}</span></td>
                <td className="px-4 py-2"><StatusBadge status={t.status} /></td>
                <td className="px-4 py-2 text-neutral-500">{t.country} · {t.currency}</td>
                <td className="px-4 py-2 text-neutral-500">{ENTITY_NAME[t.billingEntity as BillingEntityId] ?? t.billingEntity}</td>
                <td className="px-4 py-2">{t.kycLevel}</td><td className="px-4 py-2">{t._count.projects}</td>
                <td className="px-4 py-2">{t._count.abuseFlags > 0 ? <span className="badge bg-red-100 text-red-800">{t._count.abuseFlags}</span> : '—'}</td>
                <td className="px-4 py-2 text-xs text-neutral-500">{fmtDate(t.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </AdminShell>
  );
}
