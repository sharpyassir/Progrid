'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { t, tf } from '@/lib/i18n';
import { AdminShell } from '@/components/admin-shell';
import { useShell } from '@/components/shell';
import { Empty, ErrorBox, Loading } from '@/components/managed';
import { errText, fmtRelative, type Runbook } from '@/lib/managed';

/** Runbooks: the internal knowledge base, searchable by title and tag. */
export default function AdminRunbooks() {
  const { locale } = useShell();
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [rows, setRows] = useState<Runbook[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      const p = new URLSearchParams();
      if (q.trim()) p.set('q', q.trim());
      if (tag) p.set('tag', tag);
      api<{ data: Runbook[] }>(`/admin/managed/runbooks?${p}`).then((r) => { setRows(r.data); setError(null); }).catch((e) => setError(errText(e)));
    }, 250);
    return () => clearTimeout(id);
  }, [q, tag]);

  const tags = [...new Set((rows ?? []).flatMap((r) => r.tags))].sort();

  return (
    <AdminShell title={t(locale, 'admMcRunbooksTitle')} actions={<Link href="/admin/managed/runbooks/new" className="btn-primary">{t(locale, 'admMcNewRunbook')}</Link>}>
      <div className="flex flex-wrap items-center gap-2">
        <input className="input sm:!w-80" type="search" placeholder={t(locale, 'admMcSearchRunbooks')} value={q} onChange={(e) => setQ(e.target.value)} />
        {tag && <button className="btn-ghost" onClick={() => setTag('')}>{tf(locale, 'admMcTagFilter')(tag)} ×</button>}
      </div>
      {!tag && tags.length > 0 && <div className="flex flex-wrap gap-1">{tags.map((x) => <button key={x} onClick={() => setTag(x)} className="badge bg-neutral-100 text-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300">{x}</button>)}</div>}
      <ErrorBox error={error} />
      {!rows ? (error ? null : <Loading />) : rows.length === 0 ? <Empty>{q || tag ? t(locale, 'admMcNoRunbooksMatch') : t(locale, 'admMcNoRunbooks')}</Empty> : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <Link key={r.id} href={`/admin/managed/runbooks/${r.slug}`} className="card block space-y-1 hover:border-blue-400">
              <div className="font-medium">{r.title}</div>
              <div className="font-mono text-xs text-neutral-500" dir="ltr">{r.slug}</div>
              {r.excerpt && <p className="line-clamp-3 text-sm text-neutral-600 dark:text-neutral-300">{r.excerpt}</p>}
              <div className="flex flex-wrap items-center gap-1 pt-1">
                {r.tags.map((x) => <span key={x} className="badge bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{x}</span>)}
                <span className="ms-auto text-xs text-neutral-500">{r.updatedBy ? tf(locale, 'admMcUpdatedBy')(r.updatedBy.name, fmtRelative(r.updatedAt, locale)) : fmtRelative(r.updatedAt, locale)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </AdminShell>
  );
}
