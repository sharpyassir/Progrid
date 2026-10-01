'use client';

import { useState } from 'react';
import { capi, Connection, del, fmtMs, patch, post, pretty, Tool, ToolDraft } from '@/lib/connect';
import { blankTool, KindPicker, ToolForm } from '../tool-form';
import { Drawer, Empty, ErrorBox, Json, JsonInput, Notice, useAction, useC, useLoad } from '../ui';
import type { AgentTabProps } from './types';

/** Example arguments from the input schema, so a test can run with one click. */
function sampleInput(schema: Record<string, unknown>) {
  const props = (schema?.properties ?? {}) as Record<string, { type?: string }>;
  return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v.type === 'number' || v.type === 'integer' ? 1 : v.type === 'boolean' ? true : 'example']));
}

export function ToolsTab({ agent, reload }: AgentTabProps) {
  const { c, cd } = useC();
  const connections = useLoad(() => capi<{ data: Connection[] }>('/connections').then((r) => r.data), []).data ?? [];
  const [editing, setEditing] = useState<Tool | 'new' | null>(null);
  const [draft, setDraft] = useState<ToolDraft | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { error, run } = useAction();

  const close = () => { setEditing(null); setDraft(null); };
  async function save(t: ToolDraft) {
    setSaved(false);
    if (editing === 'new') await post(`/agents/${agent.id}/tools`, t);
    else if (editing) await patch(`/agents/${agent.id}/tools/${editing.id}`, t);
    await reload(); close(); setSaved(true);
  }
  const toggle = (t: Tool) => run(async () => { await patch(`/agents/${agent.id}/tools/${t.id}`, { enabled: !t.enabled }); await reload(); });
  const remove = (t: Tool) => confirm(c('deleteToolConfirm')) && run(async () => { await del(`/agents/${agent.id}/tools/${t.id}`); await reload(); });
  const connName = (id: string | null) => connections.find((x) => x.id === id)?.name;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="flex-1 font-semibold">{c('tools')}</h2>
        <button type="button" className="btn-primary" onClick={() => setEditing('new')}>+ {c('addTool')}</button>
      </div>
      <ErrorBox error={error} />
      {saved && <Notice>{c('toolSaved')}</Notice>}
      {agent.tools.length === 0 && <Empty title={c('noTools')} action={<button type="button" className="btn-primary" onClick={() => setEditing('new')}>+ {c('addTool')}</button>} />}
      <ul className="space-y-3">
        {agent.tools.map((t) => (
          <li key={t.id} className="card">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <code dir="ltr" className="font-mono text-sm font-medium">{t.name}</code>
              <span className="badge bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{cd('kind_', t.kind)}</span>
              {t.kind === 'http_request' && <code dir="ltr" className="font-mono text-xs text-neutral-500">{String(t.config.method ?? 'GET')} {String(t.config.path ?? '')}</code>}
              {t.kind === 'progrid' && <span className="text-xs text-neutral-500">{cd('act_', String(t.config.action))}</span>}
              {connName(t.connectionId) && <span className="text-xs text-neutral-500">· {connName(t.connectionId)}</span>}
              {t.requiresApproval && <span className="badge bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">{c('requiresApproval')}</span>}
              {!t.enabled && <span className="badge bg-neutral-200 text-neutral-600 dark:bg-neutral-800">{c('disabled')}</span>}
              <div className="ms-auto flex flex-wrap gap-1">
                <button type="button" className="btn-ghost px-2 py-1 text-xs" aria-expanded={testing === t.id} onClick={() => setTesting(testing === t.id ? null : t.id)}>{c('test')}</button>
                <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setEditing(t)}>{c('edit')}</button>
                <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => toggle(t)}>{t.enabled ? c('disable') : c('enable')}</button>
                <button type="button" className="btn-danger px-2 py-1 text-xs" onClick={() => remove(t)}>{c('delete')}</button>
              </div>
            </div>
            {t.description && <p className="mt-1 text-sm text-neutral-500">{t.description}</p>}
            {testing === t.id && <ToolTester agentId={agent.id} tool={t} />}
          </li>
        ))}
      </ul>
      <Drawer open={editing !== null} onClose={close} title={editing === 'new' ? c('newTool') : c('editTool')}>
        {editing === 'new' && !draft && <KindPicker onPick={(k) => setDraft(blankTool(k))} />}
        {editing === 'new' && draft && <ToolForm initial={draft} connections={connections} onSave={save} onCancel={close} />}
        {editing && editing !== 'new' && <ToolForm initial={editing} connections={connections} onSave={save} onCancel={close} />}
      </Drawer>
    </div>
  );
}

function ToolTester({ agentId, tool }: { agentId: string; tool: Tool }) {
  const { c } = useC();
  const [input, setInput] = useState(() => pretty(sampleInput(tool.inputSchema)));
  const [result, setResult] = useState<{ ok: boolean; output: unknown; durationMs: number; error: { code?: string; message: string } | null } | null>(null);
  const { busy, error, run } = useAction();
  async function go() {
    let parsed: unknown;
    try { parsed = input.trim() ? JSON.parse(input) : {}; } catch { return; }
    const r = await run(() => post<typeof result>(`/agents/${agentId}/tools/${tool.id}/test`, { input: parsed }));
    if (r) setResult(r);
  }
  return (
    <div className="mt-3 grid gap-3 border-t border-neutral-100 pt-3 lg:grid-cols-2 dark:border-neutral-800">
      <div className="space-y-2">
        <JsonInput label={c('testInput')} value={input} onChange={setInput} rows={5} />
        <button type="button" className="btn-primary" disabled={busy} onClick={go}>{busy ? c('testing') : c('runTest')}</button>
        <ErrorBox error={error} />
      </div>
      <div className="min-w-0" aria-live="polite">
        {result && (
          <div className="space-y-2">
            <div className="flex items-center gap-3 text-sm">
              <span className={`badge ${result.ok ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'}`}>{result.ok ? c('st_succeeded') : c('st_failed')}</span>
              <span className="text-neutral-500">{c('duration')}: <span className="tabular-nums">{fmtMs(result.durationMs)}</span></span>
            </div>
            {result.error && <p className="rounded bg-red-50 p-2 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-300">{c('error')}: <span dir="ltr" className="font-mono text-xs">{result.error.code ? `${result.error.code} ` : ''}</span>{result.error.message}</p>}
            {result.output !== null && result.output !== undefined && <><div className="text-xs font-medium text-neutral-500">{c('output')}</div><Json value={result.output} maxH="max-h-64" /></>}
          </div>
        )}
      </div>
    </div>
  );
}
