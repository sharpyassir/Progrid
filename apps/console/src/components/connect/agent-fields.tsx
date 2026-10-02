'use client';

/** Fields shared by the create flows and the Instructions tab: model, effort and the instructions editor with examples. */
import { useEffect } from 'react';
import { capi, Effort, Model } from '@/lib/connect';
import { Field, useC, useLoad } from './ui';

export function useModels() {
  return useLoad(() => capi<{ data: Model[] }>('/models').then((r) => r.data), []).data ?? [];
}

export function ModelEffort({ model, effort, onModel, onEffort }: { model: string; effort: Effort; onModel: (m: string) => void; onEffort: (e: Effort) => void }) {
  const { c, cd } = useC();
  const models = useModels();
  useEffect(() => { if (!model && models.length) onModel(models.find((m) => m.default)?.id ?? models[0].id); }, [models]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={c('model')}>
        {(id) => <select id={id} className="input" value={model} onChange={(e) => onModel(e.target.value)}>{models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>}
      </Field>
      <Field label={c('effort')} hint={c('effortHint')}>
        {(id, h) => <select id={id} aria-describedby={h} className="input" value={effort} onChange={(e) => onEffort(e.target.value as Effort)}>{(['low', 'medium', 'high'] as Effort[]).map((x) => <option key={x} value={x}>{cd('effort_', x)}</option>)}</select>}
      </Field>
    </div>
  );
}

export function InstructionsEditor({ value, onChange, id, describedBy }: { value: string; onChange: (v: string) => void; id?: string; describedBy?: string }) {
  const { c } = useC();
  const examples: ['ex1Title' | 'ex2Title' | 'ex3Title', 'ex1' | 'ex2' | 'ex3'][] = [['ex1Title', 'ex1'], ['ex2Title', 'ex2'], ['ex3Title', 'ex3']];
  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_16rem]">
      <textarea id={id} aria-describedby={describedBy} dir="auto" rows={14} className="input min-h-72 font-mono text-sm leading-relaxed" value={value} onChange={(e) => onChange(e.target.value)} />
      <aside>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 rtl:normal-case">{c('examples')}</h3>
        <ul className="space-y-2">
          {examples.map(([title, body]) => (
            <li key={title} className="rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
              <div className="text-sm font-medium">{c(title)}</div>
              <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs text-neutral-500">{c(body)}</p>
              <button type="button" className="mt-1 text-xs font-medium text-blue-700 hover:underline dark:text-blue-400" onClick={() => onChange(c(body))}>{c('useExample')}</button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

