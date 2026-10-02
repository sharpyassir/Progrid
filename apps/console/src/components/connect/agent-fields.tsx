'use client';

/** Fields shared by the create flows and the Instructions tab: model, effort and the instructions editor with examples. */
import { useEffect } from 'react';
import { capi, Effort, ModelList, unitPrice } from '@/lib/connect';
import { Field, useC, useLoad } from './ui';

export function useModelList() {
  return useLoad(() => capi<ModelList>('/models'), []).data;
}

export function useModels() {
  return useModelList()?.data ?? [];
}

/** The chosen model's token prices plus the execution and tool call prices, from GET /models. */
export function ModelPricing({ list, model }: { list: ModelList | null | undefined; model: string }) {
  const { c, cf, locale } = useC();
  const m = list?.data.find((x) => x.id === model);
  const pricing = list?.pricing;
  if (!m?.prices || !pricing?.configured) return null;
  const p = m.prices;
  const fmt = (minor: number) => unitPrice(minor, p.currency, locale);
  const rows: [string, string][] = [[c('priceInput'), fmt(p.inputPerMTokMinor)], [c('priceOutput'), fmt(p.outputPerMTokMinor)], [c('priceCacheRead'), fmt(p.cacheReadPerMTokMinor)], [c('priceCacheWrite'), fmt(p.cacheWritePerMTokMinor)]];
  return (
    <section aria-labelledby="model-pricing" className="rounded-md border border-neutral-200 p-3 text-sm dark:border-neutral-800">
      <h3 id="model-pricing" className="font-medium">{c('pricingTitle')}</h3>
      <p className="mt-0.5 text-xs text-neutral-500">{cf('pricingFor')(m.label)}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        {rows.map(([k, v]) => <div key={k} className="min-w-0"><dt className="truncate text-xs text-neutral-500">{k}</dt><dd className="tabular-nums">{v}</dd></div>)}
      </dl>
      <p className="mt-2 text-xs text-neutral-500">{c('priceExecution')} {unitPrice(pricing.executionMinor, pricing.currency, locale)} · {c('priceToolCall')} {unitPrice(pricing.toolCallMinor, pricing.currency, locale)}</p>
      <p className="mt-1 text-xs text-neutral-500">{c('pricingVat')}</p>
    </section>
  );
}

export function ModelEffort({ model, effort, onModel, onEffort }: { model: string; effort: Effort; onModel: (m: string) => void; onEffort: (e: Effort) => void }) {
  const { c, cd } = useC();
  const list = useModelList();
  const models = list?.data ?? [];
  useEffect(() => { if (!model && models.length) onModel(models.find((m) => m.default)?.id ?? models[0].id); }, [models]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={c('model')}>
          {(id) => <select id={id} className="input" value={model} onChange={(e) => onModel(e.target.value)}>{models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>}
        </Field>
        <Field label={c('effort')} hint={c('effortHint')}>
          {(id, h) => <select id={id} aria-describedby={h} className="input" value={effort} onChange={(e) => onEffort(e.target.value as Effort)}>{(['low', 'medium', 'high'] as Effort[]).map((x) => <option key={x} value={x}>{cd('effort_', x)}</option>)}</select>}
        </Field>
      </div>
    <ModelPricing list={list} model={model} />
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

