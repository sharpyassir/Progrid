'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, del, patch } from '@/lib/api';
import type { Runbook } from '@/lib/types';
import { useLoad } from '@/lib/use-load';
import { useShell } from '@/components/ctx';
import { Markdown } from '@/components/markdown';
import { RunbookEditor } from '@/components/runbook-editor';
import { ErrorNote, Loading, PageTitle, Time, useAction } from '@/components/ui';

export default function RunbookPage() {
  const { slug } = useParams<{ slug: string }>();
  const { t, me } = useShell();
  const router = useRouter();
  const rb = useLoad(() => api<Runbook>(`/ops/v1/runbooks/${encodeURIComponent(slug)}`), [slug]);
  const [editing, setEditing] = useState(false);
  const { busy, run } = useAction();

  if (rb.error && !rb.data) return <ErrorNote error={rb.error} />;
  if (!rb.data) return <Loading />;
  const r = rb.data;
  // External engineers never delete runbooks; the API refuses it too.
  const canDelete = me?.engineer.kind === 'INTERNAL';

  if (editing) {
    return (
      <div className="max-w-4xl">
        <PageTitle title={t('editRunbook')} />
        <RunbookEditor
          initial={r}
          busy={busy === 'save'}
          onCancel={() => setEditing(false)}
          onSave={(d) => run('save', () => patch<Runbook>(`/ops/v1/runbooks/${r.id}`, d), t('runbookSaved')).then((n) => {
            if (n) {
              rb.setData(n);
              setEditing(false);
              if (n.slug !== slug) router.replace(`/runbooks/${n.slug}`);
            }
          })}
        />
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <Link href="/runbooks" className="text-sm text-neutral-500 hover:underline"><span className="inline-block rtl:rotate-180">←</span> {t('navRunbooks')}</Link>
      <PageTitle title={r.title} sub={<>{t('updated')} <Time value={r.updatedAt} />{r.updatedBy ? ` · ${r.updatedBy.name}` : ''}</>}>
        <button className="btn-ghost" onClick={() => setEditing(true)}>{t('edit')}</button>
        {canDelete && (
          <button className="btn-ghost text-red-600" disabled={busy === 'del'} onClick={() => confirm(t('deleteRunbookConfirm')) && run('del', () => del(`/ops/v1/runbooks/${r.id}`), t('runbookDeleted')).then((x) => x && router.push('/runbooks'))}>{t('delete')}</button>
        )}
      </PageTitle>
      <div className="mb-4 flex flex-wrap gap-1">{r.tags.map((x) => <span key={x} className="badge bg-neutral-100 font-mono text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300" dir="ltr">{x}</span>)}</div>
      <article className="card" dir="auto"><Markdown source={r.body ?? ''} /></article>
    </div>
  );
}
