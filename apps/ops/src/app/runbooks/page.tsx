'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Runbook } from '@/lib/types';
import { useLoad } from '@/lib/use-load';
import { useShell } from '@/components/ctx';
import { Card, Empty, ErrorNote, Loading, PageTitle, Time } from '@/components/ui';

export default function RunbooksPage() {
  const { t } = useShell();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);
  const params = new URLSearchParams({ ...(query ? { q: query } : {}), ...(tag ? { tag } : {}) });
  const list = useLoad(() => api<{ data: Runbook[] }>(`/ops/v1/runbooks?${params}`), [params.toString()]);

  return (
    <div>
      <PageTitle title={t('navRunbooks')} sub={t('runbooksLead')}>
        <Link className="btn-primary" href="/runbooks/new">{t('newRunbook')}</Link>
      </PageTitle>
      <div className="mb-4 flex flex-wrap gap-2">
        <input className="input max-w-md" type="search" placeholder={t('searchRunbooks')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t('search')} />
        {tag && <button className="badge bg-blue-100 font-mono text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" onClick={() => setTag('')} dir="ltr">{tag} ×</button>}
      </div>
      <ErrorNote error={list.error} />
      {!list.data ? <Loading /> : !list.data.data.length ? <Card><Empty>{t('noRunbooks')}</Empty></Card> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {list.data.data.map((r) => (
            <li key={r.id} className="card">
              <Link href={`/runbooks/${r.slug}`} className="font-medium text-blue-600 hover:underline dark:text-blue-400">{r.title}</Link>
              {r.excerpt && <p dir="auto" className="mt-1 line-clamp-2 text-start text-sm text-neutral-600 dark:text-neutral-300">{r.excerpt}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-1">
                {r.tags.map((x) => <button key={x} className="badge bg-neutral-100 font-mono text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300" onClick={() => setTag(x)} dir="ltr">{x}</button>)}
                <span className="ms-auto text-xs text-neutral-500">{t('updated')} <Time value={r.updatedAt} mode="date" /></span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
