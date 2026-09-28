'use client';

import { useState, type FormEvent } from 'react';
import type { Runbook } from '@/lib/types';
import { useShell } from './ctx';
import { Markdown } from './markdown';
import { Field } from './ui';

export interface RunbookDraft { title: string; body: string; tags: string[] }

/** Title, tags and a Markdown body with a live preview. */
export function RunbookEditor({ initial, busy, onSave, onCancel }: { initial?: Runbook; busy: boolean; onSave: (d: RunbookDraft) => void; onCancel: () => void }) {
  const { t } = useShell();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '));
  const [body, setBody] = useState(initial?.body ?? '');
  const [preview, setPreview] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave({ title: title.trim(), body, tags: tags.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean) });
  };
  return (
    <form onSubmit={submit} className="card space-y-4">
      <Field label={t('title')}>
        <input className="input" required minLength={3} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label={t('tags')} hint={t('tagsHint')}>
        <input className="input font-mono" dir="ltr" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="os:ubuntu, nginx, disk" />
      </Field>
      <div>
        <div className="mb-1 flex items-center gap-2 text-sm">
          <span className="font-medium">{t('body')}</span>
          <div className="ms-auto flex rounded-md border border-neutral-300 p-0.5 text-xs dark:border-neutral-700">
            <button type="button" className={`rounded px-2 py-0.5 ${!preview ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : ''}`} onClick={() => setPreview(false)}>{t('write')}</button>
            <button type="button" className={`rounded px-2 py-0.5 ${preview ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : ''}`} onClick={() => setPreview(true)}>{t('preview')}</button>
          </div>
        </div>
        {preview ? (
          <div className="min-h-64 rounded-md border border-neutral-200 p-3 dark:border-neutral-800"><Markdown source={body} /></div>
        ) : (
          <textarea className="input min-h-64 font-mono text-xs" dir="auto" required maxLength={100000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('markdownHint')} />
        )}
      </div>
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>{t('save')}</button>
        <button type="button" className="btn-ghost" onClick={onCancel}>{t('cancel')}</button>
      </div>
    </form>
  );
}
