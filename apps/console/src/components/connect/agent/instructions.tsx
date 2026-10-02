'use client';

import { useEffect, useState } from 'react';
import { AgentDetail, Effort, Limits, patch, put, Variable } from '@/lib/connect';
import { InstructionsEditor, ModelEffort } from '../agent-fields';
import { VariablesEditor } from '../variables';
import { ErrorBox, Field, Notice, useAction, useC } from '../ui';
import type { AgentTabProps } from './types';

type Form = { name: string; description: string; instructions: string; model: string; effort: Effort; variables: Omit<Variable, 'hasValue'>[]; limits: Limits };
const toForm = (a: AgentDetail): Form => ({ name: a.name, description: a.description, instructions: a.instructions, model: a.model, effort: a.effort, variables: a.variables.map(({ hasValue, value, ...v }) => v), limits: a.limits }); // eslint-disable-line @typescript-eslint/no-unused-vars

export function InstructionsTab({ agent, reload }: AgentTabProps) {
  const { c } = useC();
  const [f, setF] = useState<Form>(() => toForm(agent));
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  useEffect(() => setF(toForm(agent)), [agent]);
  const dirty = JSON.stringify(f) !== JSON.stringify(toForm(agent));
  const hasValue = Object.fromEntries(agent.variables.map((v) => [v.key, v.hasValue]));
  const values = Object.fromEntries(agent.variables.map((v) => [v.key, v.value]));

  async function save() {
    setSaved(false);
    const r = await run(() => patch(`/agents/${agent.id}`, { ...f, variables: f.variables.filter((v) => v.key) }));
    if (r !== undefined) { await reload(); setSaved(true); }
  }
  const setValue = async (key: string, value: string) => {
    if (dirty) await save();
    await run(() => put(`/agents/${agent.id}/variables/${encodeURIComponent(key)}`, { value }));
    await reload();
  };
  const lim = (k: keyof Limits, label: string) => (
    <Field label={label}>{(id) => <input id={id} type="number" min={1} className="input" value={f.limits[k]} onChange={(e) => setF({ ...f, limits: { ...f.limits, [k]: Number(e.target.value) } })} />}</Field>
  );

  return (
    <div className="space-y-5">
      <section className="card space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={c('name')}>{(id) => <input id={id} className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
          <Field label={c('description')}>{(id) => <input id={id} className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
        </div>
        <Field label={c('instructions')} hint={c('instructionsHint')}>
          {(id, h) => <InstructionsEditor id={id} describedBy={h} value={f.instructions} onChange={(v) => setF({ ...f, instructions: v })} />}
        </Field>
        <ModelEffort model={f.model} effort={f.effort} onModel={(m) => setF({ ...f, model: m })} onEffort={(e) => setF({ ...f, effort: e })} />
      </section>
      <section className="card">
        <h2 className="font-semibold">{c('variables')}</h2>
        <p className="mb-3 text-sm text-neutral-500">{c('secretWriteOnly')}</p>
        <VariablesEditor value={f.variables.map((v) => ({ ...v, hasValue: hasValue[v.key], value: values[v.key] }))} onChange={(v) => setF({ ...f, variables: v.map(({ hasValue: _h, value: _v, ...x }) => x) })} onSetValue={setValue} />
      </section>
      <section className="card">
        <h2 className="mb-3 font-semibold">{c('limits')}</h2>
        <div className="grid gap-3 sm:grid-cols-3">{lim('maxSteps', c('maxSteps'))}{lim('maxTokensPerRun', c('maxTokens'))}{lim('timeoutSeconds', c('timeout'))}</div>
      </section>
      <ErrorBox error={error} />
      {saved && !dirty && <Notice>{c('saved')}</Notice>}
      <div className="sticky bottom-0 -mx-4 flex items-center gap-3 border-t border-neutral-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/90">
        <button type="button" className="btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? c('saving') : c('save')}</button>
        {dirty && <span className="text-sm text-amber-700 dark:text-amber-400">{c('unsaved')}</span>}
      </div>
    </div>
  );
}
