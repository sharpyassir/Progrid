'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { t, tf } from '@/lib/i18n';
import { AdminShell } from '@/components/admin-shell';
import { useShell } from '@/components/shell';
import { ErrorBox, Field, Loading, OkBox } from '@/components/managed';
import { Markdown } from '@/components/markdown';
import { errText, fmtDateTime, type Runbook } from '@/lib/managed';

/** Runbook editor with a live Markdown preview. `new` creates one. */
export default function AdminRunbookEditor() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { locale } = useShell();
  const isNew = id === 'new';
  const [rb, setRb] = useState<Runbook | null>(null);
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [tags, setTags] = useState('');
  const [body, setBody] = useState('');
  const [view, setView] = useState<'split' | 'edit' | 'preview'>(isNew ? 'split' : 'preview');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isNew) { setBody(t(locale, 'admMcRunbookTemplate')); return; }
    api<Runbook>(`/admin/managed/runbooks/${encodeURIComponent(id)}`).then((r) => { setRb(r); setTitle(r.title); setSlug(r.slug); setTags(r.tags.join(', ')); setBody(r.body ?? ''); }).catch((e) => setError(errText(e)));
    // The template uses the language at the time the page opens.
  }, [id, isNew]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setOk(null);
    const payload = { title: title.trim(), body, tags: tags.split(',').map((x) => x.trim()).filter(Boolean), ...(slug.trim() ? { slug: slug.trim() } : {}) };
    try {
      const saved = await api<Runbook>(isNew ? '/admin/managed/runbooks' : `/admin/managed/runbooks/${rb!.id}`, { method: isNew ? 'POST' : 'PATCH', body: JSON.stringify(payload) });
      if (isNew || saved.slug !== id) router.replace(`/admin/managed/runbooks/${saved.slug}`);
      setRb(saved); setOk(t(locale, 'admMcRunbookSaved'));
    } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  }
  async function remove() {
    if (!rb || !confirm(tf(locale, 'admMcDeleteRunbookConfirm')(rb.title))) return;
    setBusy(true);
    try { await api(`/admin/managed/runbooks/${rb.id}`, { method: 'DELETE' }); router.push('/admin/managed/runbooks'); } catch (err) { setError(errText(err)); setBusy(false); }
  }

  const pageTitle = isNew ? t(locale, 'admMcNewRunbook') : rb?.title ?? t(locale, 'admMcRunbooksTitle');
  if (!isNew && !rb) return <AdminShell title={pageTitle}>{error ? <ErrorBox error={error} /> : <Loading />}</AdminShell>;
  const tab = (v: typeof view) => `rounded px-2 py-1 ${view === v ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'text-neutral-600 dark:text-neutral-300'}`;

  return (
    <AdminShell title={pageTitle} actions={<Link href="/admin/managed/runbooks" className="btn-ghost">{t(locale, 'back')}</Link>}>
      <ErrorBox error={error} />
      <OkBox msg={ok} />
      <form onSubmit={save} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t(locale, 'admMcRunbookTitle')}><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} maxLength={160} /></Field>
          <Field label={t(locale, 'admSlug')} hint={isNew ? t(locale, 'admMcSlugHint') : undefined}><input className="input font-mono" dir="ltr" value={slug} onChange={(e) => setSlug(e.target.value)} pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} /></Field>
          <Field label={t(locale, 'tags')} hint={t(locale, 'admMcTagsHint')}><input className="input" dir="ltr" value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
        </div>
        <div className="flex flex-wrap items-center gap-1 text-sm">
          <button type="button" className={tab('edit')} onClick={() => setView('edit')}>{t(locale, 'admMcWrite')}</button>
          <button type="button" className={tab('split')} onClick={() => setView('split')}>{t(locale, 'admMcSideBySide')}</button>
          <button type="button" className={tab('preview')} onClick={() => setView('preview')}>{t(locale, 'admMcPreview')}</button>
          {rb && <span className="ms-auto text-xs text-neutral-500">{rb.updatedBy ? tf(locale, 'admMcUpdatedBy')(rb.updatedBy.name, fmtDateTime(rb.updatedAt, locale)) : fmtDateTime(rb.updatedAt, locale)}</span>}
        </div>
        <div className={`grid gap-3 ${view === 'split' ? 'lg:grid-cols-2' : ''}`}>
          {view !== 'preview' && <textarea className="input min-h-[28rem] font-mono text-xs leading-relaxed" dir="auto" value={body} onChange={(e) => setBody(e.target.value)} required maxLength={200_000} aria-label={t(locale, 'admMcWrite')} />}
          {view !== 'edit' && <div className="card min-h-[28rem] overflow-x-auto" dir="auto">{body.trim() ? <Markdown source={body} /> : <p className="text-sm text-neutral-500">{t(locale, 'admMcNothingToPreview')}</p>}</div>}
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" disabled={busy}>{t(locale, 'save')}</button>
          {rb && <button type="button" className="btn-danger ms-auto" disabled={busy} onClick={remove}>{t(locale, 'delete')}</button>}
        </div>
      </form>
    </AdminShell>
  );
}
