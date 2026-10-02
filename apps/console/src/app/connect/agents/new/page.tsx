'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useMemo, useState } from 'react';
import { AgentDetail, capi, Connection, Draft, Effort, post, Tool, ToolDraft } from '@/lib/connect';
import { InstructionsEditor, ModelEffort } from '@/components/connect/agent-fields';
import { Drawer, ErrorBox, Field, Notice, PageHeader, useAction, useC, useLoad } from '@/components/connect/ui';
import { autoLayout, emptyGraph, WorkflowEditor } from '@/components/connect/workflow-editor';
import { blankTool, KindPicker, ToolForm } from '@/components/connect/tool-form';
import { VariablesEditor } from '@/components/connect/variables';
import { TemplateGrid } from '@/components/connect/templates';

type Path = 'blank' | 'ai' | 'template';

export default function NewAgentPage() {
  return <Suspense fallback={null}><NewAgent /></Suspense>;
}

function NewAgent() {
  const { c } = useC();
  const params = useSearchParams();
  const router = useRouter();
  const initial = (['blank', 'ai', 'template'] as Path[]).find((p) => p === params.get('path')) ?? 'blank';
  const [path, setPath] = useState<Path>(initial);
  const choose = (p: Path) => { setPath(p); router.replace(`/connect/agents/new?path=${p}`, { scroll: false }); };
  const paths: { id: Path; title: string; desc: string; icon: string }[] = [
    { id: 'blank', title: c('pathBlank'), desc: c('pathBlankD'), icon: '✎' },
    { id: 'ai', title: c('pathAi'), desc: c('pathAiD'), icon: '✦' },
    { id: 'template', title: c('pathTemplate'), desc: c('pathTemplateD'), icon: '▦' },
  ];
  return (
    <div>
      <PageHeader title={c('newAgentTitle')} back={{ href: '/connect/agents', label: c('agentsTitle') }} />
      <div role="radiogroup" aria-label={c('newAgentTitle')} className="mb-6 grid gap-3 sm:grid-cols-3">
        {paths.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={path === p.id} onClick={() => choose(p.id)}
            className={`card flex items-start gap-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${path === p.id ? 'border-blue-600 ring-1 ring-blue-600 dark:border-blue-500' : 'hover:border-neutral-400'}`}>
            <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${path === p.id ? 'bg-blue-600 text-white' : 'bg-neutral-100 dark:bg-neutral-800'}`}>{p.icon}</span>
            <span><span className="block font-medium">{p.title}</span><span className="block text-sm text-neutral-500">{p.desc}</span></span>
          </button>
        ))}
      </div>
      {path === 'blank' && <BlankForm />}
      {path === 'ai' && <BuildWithAi />}
      {path === 'template' && <TemplateGrid />}
    </div>
  );
}

function BlankForm() {
  const { c } = useC();
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState<Effort>('medium');
  const { busy, error, run } = useAction();
  async function submit(e: FormEvent) {
    e.preventDefault();
    const a = await run(async () => {
      const created = await post<AgentDetail>('/agents', { name, description: description || undefined, instructions: instructions || undefined, model: model || undefined });
      if (effort !== 'medium') await capi(`/agents/${created.id}`, { method: 'PATCH', body: JSON.stringify({ effort }) });
      return created;
    });
    if (a) router.push(`/connect/agents/${a.id}?tab=tools`);
  }
  return (
    <form onSubmit={submit} className="card space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={c('agentName')}>{(id) => <input id={id} required className="input" placeholder={c('agentNamePh')} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label={<>{c('description')} <span className="font-normal text-neutral-500">({c('optional')})</span></>}>{(id) => <input id={id} className="input" placeholder={c('descriptionPh')} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
      </div>
      <Field label={c('instructions')} hint={c('instructionsHint')}>
        {(id, h) => <InstructionsEditor id={id} describedBy={h} value={instructions} onChange={setInstructions} />}
      </Field>
      <ModelEffort model={model} effort={effort} onModel={setModel} onEffort={setEffort} />
      <ErrorBox error={error} />
      <button className="btn-primary" disabled={busy || !name.trim()}>{busy ? c('creating') : c('createAgent')}</button>
    </form>
  );
}

function BuildWithAi() {
  const { c } = useC();
  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const { busy, error, run } = useAction();
  async function generate(e: FormEvent) {
    e.preventDefault();
    const r = await run(() => post<{ draft: Draft }>('/agents/generate', { prompt }));
    if (r) setDraft({ ...r.draft, workflow: r.draft.workflow ? autoLayout(r.draft.workflow) : null });
  }
  if (draft) return <DraftReview draft={draft} onChange={setDraft} onReset={() => setDraft(null)} />;
  return (
    <form onSubmit={generate} className="card space-y-3">
      <Field label={c('aiPrompt')} hint={c('aiPromptHint')}>
        {(id, h) => <textarea id={id} aria-describedby={h} dir="auto" rows={6} required className="input" placeholder={c('aiPromptPh')} value={prompt} onChange={(e) => setPrompt(e.target.value)} />}
      </Field>
      <ErrorBox error={error} />
      <div className="flex items-center gap-3">
        <button className="btn-primary" disabled={busy || prompt.trim().length < 10}>{busy ? c('generating') : `✦ ${c('generate')}`}</button>
        {busy && <span role="status" className="text-sm text-neutral-500">{c('generating')}</span>}
      </div>
    </form>
  );
}

/** The generated draft, every part editable before anything is saved. */
function DraftReview({ draft, onChange, onReset }: { draft: Draft; onChange: (d: Draft) => void; onReset: () => void }) {
  const { c, cd } = useC();
  const router = useRouter();
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const [newKind, setNewKind] = useState<ToolDraft | null>(null);
  const [layoutKey, setLayoutKey] = useState(0);
  const connections = useLoad(() => capi<{ data: Connection[] }>('/connections').then((r) => r.data), []).data ?? [];
  const setAgent = (p: Partial<Draft['agent']>) => onChange({ ...draft, agent: { ...draft.agent, ...p } });
  // Draft tools have no ids yet; the canvas refers to them by name.
  const pseudoTools = useMemo(() => draft.tools.map((t) => ({ ...t, id: t.name, agentId: '', enabled: t.enabled ?? true, requiresApproval: !!t.requiresApproval })) as Tool[], [draft.tools]);
  const graph = draft.workflow;

  async function create() {
    const a = await run(() => post<AgentDetail>('/agents/from-draft', { draft }));
    if (a) router.push(`/connect/agents/${a.id}?tab=test`);
  }
  const saveTool = async (t: ToolDraft) => {
    const tools = editing === 'new' ? [...draft.tools, t] : draft.tools.map((x, i) => (i === editing ? t : x));
    onChange({ ...draft, tools }); setEditing(null); setNewKind(null);
  };

  return (
    <div className="space-y-5">
      <Notice tone="blue"><span className="font-medium">{c('draftTitle')}.</span> {c('draftNote')}</Notice>
      <section className="card space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={c('agentName')}>{(id) => <input id={id} className="input" value={draft.agent.name} onChange={(e) => setAgent({ name: e.target.value })} />}</Field>
          <Field label={c('description')}>{(id) => <input id={id} className="input" value={draft.agent.description ?? ''} onChange={(e) => setAgent({ description: e.target.value })} />}</Field>
        </div>
        <Field label={c('instructions')}>{(id) => <textarea id={id} dir="auto" rows={8} className="input font-mono text-sm" value={draft.agent.instructions} onChange={(e) => setAgent({ instructions: e.target.value })} />}</Field>
        <ModelEffort model={draft.agent.model ?? ''} effort={draft.agent.effort ?? 'medium'} onModel={(m) => setAgent({ model: m })} onEffort={(e) => setAgent({ effort: e })} />
      </section>

      <section className="card">
        <div className="mb-3 flex items-center gap-2"><h2 className="flex-1 font-semibold">{c('tools')}</h2><button type="button" className="btn-ghost text-xs" onClick={() => setEditing('new')}>+ {c('addTool')}</button></div>
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {draft.tools.map((t, i) => (
            <li key={i} className="flex flex-wrap items-center gap-3 py-2">
              <code dir="ltr" className="font-mono text-sm">{t.name}</code>
              <span className="badge bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{cd('kind_', t.kind)}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-neutral-500">{t.description}</span>
              <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setEditing(i)}>{c('edit')}</button>
              <button type="button" className="btn-danger px-2 py-1 text-xs" onClick={() => onChange({ ...draft, tools: draft.tools.filter((_, j) => j !== i) })}>{c('remove')}</button>
            </li>
          ))}
        </ul>
      </section>

      {draft.connectionsNeeded.length > 0 && (
        <section className="card">
          <h2 className="font-semibold">{c('connectionsNeeded')}</h2>
          <p className="mb-2 text-sm text-neutral-500">{c('connectionsNeededNote')}</p>
          <ul className="space-y-2">
            {draft.connectionsNeeded.map((n, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 rounded-md bg-neutral-50 p-2 text-sm dark:bg-neutral-900">
                <span className="font-medium">{n.name}</span>
                <span className="badge bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">{cd('conn_', String(n.kind))}</span>
                {n.reason && <span className="text-neutral-500">{n.reason}</span>}
                {n.usedBy?.length ? <span className="text-xs text-neutral-500">{c('usedBy')}: <code dir="ltr" className="font-mono">{n.usedBy.join(', ')}</code></span> : null}
                <Link href="/connect/connections?new=1" target="_blank" className="ms-auto text-xs font-medium text-blue-700 hover:underline dark:text-blue-400">{c('addConnection')} ↗</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card">
        <h2 className="mb-3 font-semibold">{c('variables')}</h2>
        <VariablesEditor value={draft.variables} onChange={(v) => onChange({ ...draft, variables: v })} />
      </section>

      <section className="card">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="flex-1 font-semibold">{c('workflow')}</h2>
          {graph && <button type="button" className="btn-ghost text-xs" onClick={() => { onChange({ ...draft, workflow: autoLayout(graph) }); setLayoutKey((k) => k + 1); }}>{c('autoLayout')}</button>}
          {graph && <button type="button" className="btn-danger text-xs" onClick={() => onChange({ ...draft, workflow: null })}>{c('remove')}</button>}
        </div>
        {graph
          ? <WorkflowEditor initial={graph} tools={pseudoTools} layoutKey={layoutKey} height="h-[460px]" onChange={(g) => onChange({ ...draft, workflow: g })} />
          : <div className="text-sm text-neutral-500">{c('noWorkflow')} <button type="button" className="ms-1 font-medium text-blue-700 hover:underline dark:text-blue-400" onClick={() => { onChange({ ...draft, workflow: emptyGraph() }); setLayoutKey((k) => k + 1); }}>{c('createWorkflow')}</button></div>}
      </section>

      <ErrorBox error={error} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary px-4 py-2" disabled={busy || !draft.agent.name.trim()} onClick={create}>{busy ? c('creating') : c('createAgent')}</button>
        <button type="button" className="btn-ghost" onClick={onReset}>{c('startOver')}</button>
      </div>

      <Drawer open={editing !== null} onClose={() => { setEditing(null); setNewKind(null); }} title={editing === 'new' ? c('newTool') : c('editTool')}>
        {editing === 'new' && !newKind && <KindPicker onPick={(k) => setNewKind(blankTool(k))} />}
        {editing === 'new' && newKind && <ToolForm initial={newKind} connections={connections} onSave={saveTool} onCancel={() => { setEditing(null); setNewKind(null); }} />}
        {typeof editing === 'number' && draft.tools[editing] && <ToolForm initial={draft.tools[editing]} connections={connections} onSave={saveTool} onCancel={() => setEditing(null)} />}
      </Drawer>
    </div>
  );
}
