'use client';

import { FormEvent, useState } from 'react';
import { FINISHED, post, Run } from '@/lib/connect';
import { RunView } from '../runs';
import { ErrorBox, Field, JsonInput, Segmented, useAction, useC } from '../ui';
import type { AgentTabProps } from './types';

export function TestTab({ agent }: AgentTabProps) {
  const { c } = useC();
  const [mode, setMode] = useState<'message' | 'json'>('message');
  const [message, setMessage] = useState('');
  const [json, setJson] = useState('{\n  "email": "sara@company.com",\n  "company": "Company Ltd",\n  "message": "We need a CRM for 200 people."\n}');
  const [run, setRun] = useState<Run | null>(null);
  const { busy, error, run: act } = useAction();

  async function send(e: FormEvent) {
    e.preventDefault();
    let body: Record<string, unknown>;
    if (mode === 'message') body = { input: { message }, message, useDraft: true };
    else {
      try { body = { input: JSON.parse(json), useDraft: true }; } catch { return; }
    }
    setRun(null);
    const r = await act(() => post<Run>(`/agents/${agent.id}/test`, body));
    if (r) setRun(r);
  }
  const cancel = () => run && act(() => post(`/runs/${run.id}/cancel`));

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <form onSubmit={send} className="card space-y-3 self-start">
        <Segmented label={c('tTest')} value={mode} onChange={setMode} options={[{ id: 'message', label: c('testMessage') }, { id: 'json', label: c('testJson') }]} />
        {mode === 'message'
          ? <Field label={c('testMessage')}>{(id) => <textarea id={id} dir="auto" rows={6} required className="input" placeholder={c('testMessagePh')} value={message} onChange={(e) => setMessage(e.target.value)} />}</Field>
          : <JsonInput label={c('testJson')} value={json} onChange={setJson} rows={10} />}
        <p className="text-xs text-neutral-500">{c('testDraftNote')}</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={busy}>{busy ? c('runningTest') : `▶ ${c('runTestBtn')}`}</button>
          {run && !FINISHED.includes(run.status) && <button type="button" className="btn-ghost" onClick={cancel}>{c('cancelRun')}</button>}
        </div>
        <ErrorBox error={error} />
      </form>
      <section aria-live="polite" className="min-w-0">
        {busy && !run && <p role="status" className="card animate-pulse text-sm text-neutral-500">{c('runningTest')}</p>}
        {!busy && !run && <div className="card py-10 text-center text-sm text-neutral-500">{c('noTestYet')}</div>}
        {run && <div className="card"><RunView run={run} /></div>}
      </section>
    </div>
  );
}
