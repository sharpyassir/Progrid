'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { AgentDetail, capi, post, Template } from '@/lib/connect';
import { ErrorBox, useC, useLoad } from './ui';

const ICON: Record<string, string> = { 'customer-support': '☎', sales: '◎', 'data-analyst': '▤', monitoring: '◉', research: '⌕', developer: '⌘', invoice: '▧' };

/** The template gallery. "Use template" creates an agent from it and opens it for editing. */
export function TemplateGrid() {
  const { c, cd, cf } = useC();
  const router = useRouter();
  const { data, error } = useLoad(() => capi<{ data: Template[] }>('/templates').then((r) => r.data), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  async function use(t: Template) {
    setBusy(t.slug); setErr(null);
    try {
      const a = await post<AgentDetail>('/agents', { name: cd('tpl_', t.slug) === t.slug ? t.name : cd('tpl_', t.slug), templateSlug: t.slug });
      router.push(`/connect/agents/${a.id}?tab=instructions`);
    } catch (e) { setErr(e); setBusy(null); }
  }
  return (
    <div className="space-y-3">
      <ErrorBox error={error ?? err} />
      {!data && !error && <p className="text-sm text-neutral-500">{c('loading')}</p>}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data?.map((t) => {
          const name = cd('tpl_', t.slug) === t.slug ? t.name : cd('tpl_', t.slug);
          const desc = cd('tplD_', t.slug) === t.slug ? t.description : cd('tplD_', t.slug);
          return (
            <li key={t.slug} className="card flex flex-col">
              <div className="flex items-center gap-2">
                <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">{ICON[t.slug] ?? '✦'}</span>
                <h3 className="font-medium">{name}</h3>
              </div>
              <p className="mt-2 flex-1 text-sm text-neutral-500">{desc}</p>
              {t.tools.length > 0 && (
                <p className="mt-2 text-xs text-neutral-500">{cf('toolsN')(t.tools.length)}: <code dir="ltr" className="font-mono">{t.tools.map((x) => x.name).join(', ')}</code></p>
              )}
              <button type="button" className="btn-primary mt-3 self-start" disabled={!!busy} onClick={() => use(t)} aria-label={`${c('useTemplate')}: ${name}`}>
                {busy === t.slug ? c('creating') : c('useTemplate')}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
