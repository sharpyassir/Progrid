'use client';

import { useState } from 'react';
import { Graph, put } from '@/lib/connect';
import { autoLayout, emptyGraph, validateWorkflow, WorkflowEditor } from '../workflow-editor';
import { ErrorBox, Notice, useAction, useC } from '../ui';
import type { AgentTabProps } from './types';

export function WorkflowTab({ agent, reload }: AgentTabProps) {
  const { c, locale } = useC();
  const savedGraph = agent.workflow?.graph ?? null;
  const [graph, setGraph] = useState<Graph | null>(savedGraph);
  const [layoutKey, setLayoutKey] = useState(0);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const { busy, error, run } = useAction();
  // Postgres jsonb reorders keys and the editor drops empty labels, so compare a canonical form.
  const dirty = canonical(graph) !== canonical(savedGraph);

  function check() {
    const p = graph ? validateWorkflow(graph, locale) : [];
    setProblems(p);
    return p.length === 0;
  }
  async function save() {
    setSaved(false);
    if (!graph || !check()) return;
    const r = await run(() => put(`/agents/${agent.id}/workflow`, { graph }));
    if (r !== undefined) { await reload(); setSaved(true); }
  }
  /** An empty graph removes the workflow; the agent then answers each call directly. */
  async function removeWorkflow() {
    if (!savedGraph) { setGraph(null); return; }
    if (!confirm(c('removeWorkflowConfirm'))) return;
    const r = await run(() => put(`/agents/${agent.id}/workflow`, { graph: { nodes: [], edges: [] } }));
    if (r !== undefined) { setGraph(null); await reload(); }
  }

  if (!graph) {
    return (
      <div className="card space-y-3">
        <p className="text-sm text-neutral-600 dark:text-neutral-300">{c('noWorkflow')}</p>
        <button type="button" className="btn-primary" onClick={() => { setGraph(emptyGraph()); setLayoutKey((k) => k + 1); }}>{c('createWorkflow')}</button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? c('saving') : c('saveWorkflow')}</button>
        <button type="button" className="btn-ghost" onClick={check}>{c('check')}</button>
        <button type="button" className="btn-ghost" onClick={() => { setGraph(autoLayout(graph)); setLayoutKey((k) => k + 1); }}>{c('autoLayout')}</button>
        <button type="button" className="btn-danger ms-auto" disabled={busy} onClick={removeWorkflow}>{c('removeWorkflow')}</button>
        {dirty && <span className="text-sm text-amber-700 dark:text-amber-400">{c('unsaved')}</span>}
      </div>
      {problems && (problems.length === 0
        ? <Notice>{c('valid')}</Notice>
        : <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300"><ul className="list-disc space-y-0.5 ps-5">{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>)}
      {saved && !dirty && <Notice>{c('workflowSaved')}</Notice>}
      <ErrorBox error={error} />
      <WorkflowEditor initial={graph} tools={agent.tools} layoutKey={layoutKey} onChange={(g) => { setGraph(g); setProblems(null); }} />
    </div>
  );
}

/** Stable JSON: sorted keys, null and undefined fields dropped, edges in id order. */
function canonical(g: Graph | null): string {
  if (!g) return 'null';
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().filter((k) => (v as Record<string, unknown>)[k] != null).map((k) => [k, norm((v as Record<string, unknown>)[k])]));
    return v;
  };
  return JSON.stringify(norm({ nodes: [...g.nodes].sort((a, b) => a.id.localeCompare(b.id)), edges: [...g.edges].sort((a, b) => a.id.localeCompare(b.id)) }));
}
