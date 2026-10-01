'use client';

/** Add or edit one tool. Fields change with the tool kind; advanced JSON stays one click away. */
import { FormEvent, useState } from 'react';
import { Connection, DB_KINDS, DESTRUCTIVE_ACTIONS, HTTP_METHODS, pretty, PROGRID_ACTIONS, SNAKE, toSnake, TOOL_KINDS, ToolDraft, ToolKind } from '@/lib/connect';
import { ErrorBox, Field, JsonInput, KeyValueEditor, Notice, Toggle, useC } from './ui';

const KIND_ICON: Record<ToolKind, string> = { http_request: '↔', database_query: '⛁', send_email: '✉', notify: '🔔', webhook_out: '⇢', progrid: '☁' };

export function KindPicker({ onPick }: { onPick: (k: ToolKind) => void }) {
  const { c, cd } = useC();
  return (
    <div>
      <p className="mb-3 text-sm font-medium">{c('chooseKind')}</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {TOOL_KINDS.map((k) => (
          <li key={k}>
            <button type="button" onClick={() => onPick(k)} className="card flex h-full w-full items-start gap-3 text-start hover:border-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
              <span aria-hidden className="text-xl">{KIND_ICON[k]}</span>
              <span><span className="block font-medium">{cd('kind_', k)}</span><span className="block text-xs text-neutral-500">{cd('kindD_', k)}</span></span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function blankTool(kind: ToolKind): ToolDraft {
  const config: Record<ToolKind, Record<string, unknown>> = {
    http_request: { method: 'GET', path: '/', query: {}, headers: {} }, database_query: { mode: 'sql', maxRows: 200 },
    send_email: { via: 'platform' }, notify: { channel: 'email', target: '' }, webhook_out: {}, progrid: { action: 'list_servers' },
  };
  return { name: '', description: '', kind, connectionId: null, config: config[kind], inputSchema: { type: 'object', properties: {} }, enabled: true, requiresApproval: false };
}

export function ToolForm({ initial, connections, onSave, onCancel, saveLabel }: { initial: ToolDraft; connections: Connection[]; onSave: (t: ToolDraft) => Promise<unknown>; onCancel: () => void; saveLabel?: string }) {
  const { c, cd } = useC();
  const [t, setT] = useState<ToolDraft>(initial);
  const [schemaText, setSchemaText] = useState(pretty(initial.inputSchema ?? {}));
  const [bodyText, setBodyText] = useState(typeof initial.config.bodyTemplate === 'string' ? initial.config.bodyTemplate : initial.config.bodyTemplate ? pretty(initial.config.bodyTemplate) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const cfg = t.config;
  const setCfg = (p: Record<string, unknown>) => setT((x) => ({ ...x, config: { ...x.config, ...p } }));
  const nameOk = SNAKE.test(t.name);

  const relevant = connections.filter((x) =>
    t.kind === 'http_request' ? x.kind === 'rest_api' || x.kind === 'custom'
      : t.kind === 'database_query' ? DB_KINDS.includes(x.kind)
        : t.kind === 'send_email' ? x.kind === 'smtp'
          : t.kind === 'webhook_out' ? x.kind === 'webhook_out' : false);
  const conn = connections.find((x) => x.id === t.connectionId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    let inputSchema: Record<string, unknown>;
    try { inputSchema = schemaText.trim() ? JSON.parse(schemaText) : {}; } catch { setError(new Error(c('errBadJson'))); return; }
    setBusy(true); setError(null);
    try { await onSave({ ...t, inputSchema, config: t.kind === 'http_request' ? { ...cfg, bodyTemplate: bodyText || undefined } : cfg }); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  const connectionSelect = (allowNone: boolean) => (
    <Field label={c('connection')}>
      {(id) => (
        <select id={id} className="input" value={t.connectionId ?? ''} onChange={(e) => setT({ ...t, connectionId: e.target.value || null })}>
          {allowNone && <option value="">{c('none')}</option>}
          {!allowNone && <option value="">—</option>}
          {relevant.map((x) => <option key={x.id} value={x.id}>{x.name} ({cd('conn_', x.kind)})</option>)}
        </select>
      )}
    </Field>
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-neutral-500"><span aria-hidden>{KIND_ICON[t.kind]}</span>{cd('kind_', t.kind)}</div>
      <Field label={c('toolName')} hint={c('toolNameHint')} error={t.name && !nameOk ? c('toolNameBad') : undefined}>
        {(id, h) => <input id={id} aria-describedby={h} dir="ltr" required className="input font-mono" value={t.name} placeholder="lookup_company" onChange={(e) => setT({ ...t, name: e.target.value })} onBlur={() => t.name && !nameOk && setT({ ...t, name: toSnake(t.name) })} />}
      </Field>
      <Field label={c('description')} hint={c('toolDescHint')}>
        {(id, h) => <textarea id={id} aria-describedby={h} rows={2} className="input" value={t.description} onChange={(e) => setT({ ...t, description: e.target.value })} />}
      </Field>

      {t.kind === 'http_request' && (
        <>
          {connectionSelect(true)}
          {!t.connectionId ? (
            <>
              <Field label={c('baseUrl')} hint={c('baseUrlHint')}>
                {(id, h) => <input id={id} aria-describedby={h} dir="ltr" type="url" className="input font-mono text-xs" placeholder="https://api.example.com" value={String(cfg.baseUrl ?? '')} onChange={(e) => setCfg({ baseUrl: e.target.value })} />}
              </Field>
              <Field label={c('auth')}>
                {(id) => (
                  <select id={id} className="input" value={String((cfg.auth as { type?: string } | undefined)?.type ?? 'none')} onChange={(e) => setCfg({ auth: { type: e.target.value } })}>
                    {['none', 'bearer', 'basic', 'header', 'query'].map((a) => <option key={a} value={a}>{cd('auth_', a)}</option>)}
                  </select>
                )}
              </Field>
            </>
          ) : <p className="text-xs text-neutral-500">{c('authFromConnection')} <code dir="ltr" className="font-mono">{String(conn?.config.baseUrl ?? '')}</code></p>}
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
            <Field label={c('method')}>
              {(id) => <select id={id} className="input font-mono" value={String(cfg.method ?? 'GET')} onChange={(e) => setCfg({ method: e.target.value })}>{HTTP_METHODS.map((m) => <option key={m}>{m}</option>)}</select>}
            </Field>
            <Field label={c('endpointPath')} hint={c('endpointPathHint')}>
              {(id, h) => <input id={id} aria-describedby={h} dir="ltr" className="input font-mono text-xs" placeholder="/companies/{domain}" value={String(cfg.path ?? '')} onChange={(e) => setCfg({ path: e.target.value })} />}
            </Field>
          </div>
          <KeyValueEditor label={c('queryParams')} value={(cfg.query as Record<string, string>) ?? {}} onChange={(v) => setCfg({ query: v })} keyPh="q" valuePh="{query}" />
          <KeyValueEditor label={c('headers')} value={(cfg.headers as Record<string, string>) ?? {}} onChange={(v) => setCfg({ headers: v })} keyPh="Accept" valuePh="application/json" />
          {['POST', 'PUT', 'PATCH'].includes(String(cfg.method)) && <JsonInput label={c('bodyTemplate')} hint={c('bodyHint')} value={bodyText} onChange={setBodyText} rows={5} />}
        </>
      )}

      {t.kind === 'database_query' && (
        <>
          {connectionSelect(false)}
          {!t.connectionId && <p className="text-xs text-neutral-500">{c('pickDbConnection')}</p>}
          {conn && (conn.access.readOnly ? <Notice tone="blue">{c('readOnlyNotice')}</Notice> : <Notice tone="amber">{c('writesAllowed')}</Notice>)}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={c('dbMode')}>
              {(id) => <select id={id} className="input" value={String(cfg.mode ?? 'sql')} onChange={(e) => setCfg({ mode: e.target.value })}>{['sql', 'mongo_find', 'mongo_aggregate'].map((m) => <option key={m} value={m}>{cd('mode_', m)}</option>)}</select>}
            </Field>
            <Field label={c('maxRows')}>
              {(id) => <input id={id} type="number" min={1} max={10000} className="input" value={Number(cfg.maxRows ?? 200)} onChange={(e) => setCfg({ maxRows: Number(e.target.value) })} />}
            </Field>
          </div>
        </>
      )}

      {t.kind === 'send_email' && (
        <>
          <Field label={c('sendWith')}>
            {(id) => <select id={id} className="input" value={String(cfg.via ?? 'platform')} onChange={(e) => setCfg({ via: e.target.value })}>{['platform', 'smtp'].map((v) => <option key={v} value={v}>{cd('via_', v)}</option>)}</select>}
          </Field>
          {cfg.via === 'smtp' && connectionSelect(false)}
          <Field label={c('emailTo')} hint={c('emailToHint')}>
            {(id, h) => <input id={id} aria-describedby={h} dir="ltr" className="input" placeholder="sales@example.com" value={String(cfg.to ?? '')} onChange={(e) => setCfg({ to: e.target.value || undefined })} />}
          </Field>
          <Field label={c('subjectTemplate')}>
            {(id) => <input id={id} className="input" value={String(cfg.subjectTemplate ?? '')} onChange={(e) => setCfg({ subjectTemplate: e.target.value || undefined })} />}
          </Field>
        </>
      )}

      {t.kind === 'notify' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={c('channel')}>
            {(id) => <select id={id} className="input" value={String(cfg.channel ?? 'email')} onChange={(e) => setCfg({ channel: e.target.value })}>{['email', 'webhook', 'progrid_console'].map((v) => <option key={v} value={v}>{cd('channel_', v)}</option>)}</select>}
          </Field>
          {cfg.channel !== 'progrid_console' && (
            <Field label={c('target')} hint={c('targetHint')}>
              {(id, h) => <input id={id} aria-describedby={h} dir="ltr" className="input" value={String(cfg.target ?? '')} onChange={(e) => setCfg({ target: e.target.value })} />}
            </Field>
          )}
        </div>
      )}

      {t.kind === 'webhook_out' && connectionSelect(false)}

      {t.kind === 'progrid' && (
        <>
          <Field label={c('progridAction')}>
            {(id) => (
              <select id={id} className="input" value={String(cfg.action ?? 'list_servers')} onChange={(e) => { setCfg({ action: e.target.value }); if (DESTRUCTIVE_ACTIONS.includes(e.target.value)) setT((x) => ({ ...x, requiresApproval: true, config: { ...x.config, action: e.target.value } })); }}>
                {PROGRID_ACTIONS.map((a) => <option key={a} value={a}>{cd('act_', a)}</option>)}
              </select>
            )}
          </Field>
          <p className="text-xs text-neutral-500">{c('destructiveNote')}</p>
        </>
      )}

      <Toggle checked={!!t.requiresApproval} onChange={(v) => setT({ ...t, requiresApproval: v })} label={c('requiresApproval')} hint={c('requiresApprovalHint')}
        disabled={t.kind === 'progrid' && DESTRUCTIVE_ACTIONS.includes(String(cfg.action))} />
      <Toggle checked={t.enabled !== false} onChange={(v) => setT({ ...t, enabled: v })} label={c('enabled')} />

      <details className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
        <summary className="cursor-pointer text-sm font-medium">{c('advanced')}</summary>
        <div className="mt-3"><JsonInput label={c('inputSchema')} hint={c('inputSchemaHint')} value={schemaText} onChange={setSchemaText} rows={8} /></div>
      </details>

      <ErrorBox error={error} />
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy || !nameOk}>{busy ? c('saving') : saveLabel ?? c('save')}</button>
        <button type="button" className="btn-ghost" onClick={onCancel}>{c('cancel')}</button>
      </div>
    </form>
  );
}
