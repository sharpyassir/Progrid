'use client';

import { useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useState } from 'react';
import { capi, Connection, CONNECTION_KINDS, ConnectionKind, DB_KINDS, del, fmtDate, patch, post, pretty } from '@/lib/connect';
import { Drawer, Empty, ErrorBox, Field, JsonInput, KeyValueEditor, Notice, PageHeader, SecretInput, Status, Toggle, useAction, useC, useLoad } from '@/components/connect/ui';

export default function ConnectionsPage() {
  return <Suspense fallback={null}><Connections /></Suspense>;
}

function Connections() {
  const { c, cd, locale } = useC();
  const params = useSearchParams();
  const { data, error, reload } = useLoad(() => capi<{ data: Connection[] }>('/connections').then((r) => r.data), []);
  const [editing, setEditing] = useState<Connection | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, { ok: boolean; message?: string } | 'busy'>>({});
  const act = useAction();
  useEffect(() => { if (params.get('new')) setEditing('new'); }, [params]);

  async function test(x: Connection) {
    setTests((t) => ({ ...t, [x.id]: 'busy' }));
    try {
      const r = await post<{ ok?: boolean; error?: { message: string } | null }>(`/connections/${x.id}/test`);
      const fresh = await capi<Connection>(`/connections/${x.id}`).catch(() => null);
      const ok = r?.ok ?? fresh?.status === 'ok';
      setTests((t) => ({ ...t, [x.id]: { ok, message: r?.error?.message ?? fresh?.lastError ?? undefined } }));
      reload();
    } catch (e) {
      setTests((t) => ({ ...t, [x.id]: { ok: false, message: e instanceof Error ? e.message : undefined } }));
    }
  }
  const remove = (x: Connection) => confirm(c('deleteConnConfirm')) && act.run(async () => { await del(`/connections/${x.id}`); await reload(); });

  return (
    <div>
      <PageHeader title={c('nConnections')} subtitle={c('connectionsNote')} actions={<button type="button" className="btn-primary" onClick={() => setEditing('new')}>+ {c('newConnection')}</button>} />
      <div className="space-y-3">
        <ErrorBox error={error ?? act.error} />
        {notice && <Notice>{notice}</Notice>}
        {data && data.length === 0 && <Empty title={c('noConnections')} action={<button type="button" className="btn-primary" onClick={() => setEditing('new')}>+ {c('newConnection')}</button>} />}
        <ul className="grid gap-3 lg:grid-cols-2">
          {data?.map((x) => {
            const tr = tests[x.id];
            const target = String(x.config.baseUrl ?? x.config.url ?? (x.config.host ? `${x.config.host}${x.config.port ? `:${x.config.port}` : ''}${x.config.database ? `/${x.config.database}` : ''}` : x.config.database ?? ''));
            return (
              <li key={x.id} className="card flex min-w-0 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{x.name}</span>
                  <span className="badge bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{cd('conn_', x.kind)}</span>
                  <Status status={x.status} />
                  {DB_KINDS.includes(x.kind) && x.access.readOnly && <span className="badge bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">{c('readOnly')}</span>}
                </div>
                {target && <code dir="ltr" className="truncate font-mono text-xs text-neutral-500">{target}</code>}
                {x.secretFields.length > 0 && (
                  <div className="flex flex-wrap gap-x-3 text-xs text-neutral-500">
                    {x.secretFields.map((f) => <span key={f}><span>{cd('', f)}</span>: <code dir="ltr" className="font-mono">{x.secretHints[f] ?? '••••'}</code></span>)}
                  </div>
                )}
                <p className="text-xs text-neutral-500">{c('lastTested')}: {x.lastTestedAt ? fmtDate(x.lastTestedAt, locale) : c('never')}</p>
                {x.status === 'error' && x.lastError && <p className="text-xs text-red-700 dark:text-red-400">{x.lastError}</p>}
                {tr && tr !== 'busy' && <p role="status" className={`text-sm ${tr.ok ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>{tr.ok ? c('testOk') : `${c('testFailed')} ${tr.message ?? ''}`}</p>}
                <div className="mt-auto flex flex-wrap gap-1 pt-1">
                  <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={tr === 'busy'} onClick={() => test(x)}>{tr === 'busy' ? c('testing') : c('testConnection')}</button>
                  <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setEditing(x)}>{c('edit')}</button>
                  <button type="button" className="btn-danger px-2 py-1 text-xs" onClick={() => remove(x)}>{c('delete')}</button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
      <Drawer open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? c('newConnection') : c('editConnection')}>
        {editing && <ConnectionForm key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? null : editing}
          onDone={async () => { setEditing(null); setNotice(c('connectionSaved')); await reload(); }} onCancel={() => setEditing(null)} />}
      </Drawer>
    </div>
  );
}

/** Secret fields per kind. Values are sent once and never come back. */
function secretFieldsFor(kind: ConnectionKind, authType: string): string[] {
  if (kind === 'rest_api') return authType === 'bearer' ? ['token'] : authType === 'basic' ? ['username', 'password'] : authType === 'header' || authType === 'query' ? ['value'] : [];
  if (kind === 'postgres' || kind === 'mysql' || kind === 'mongodb' || kind === 'smtp') return ['password'];
  if (kind === 'webhook_out') return ['signingSecret'];
  return [];
}
const DEFAULTS: Record<ConnectionKind, Record<string, unknown>> = {
  rest_api: { baseUrl: '', auth: { type: 'bearer' }, defaultHeaders: {} }, postgres: { host: '', port: 5432, database: '', user: '', ssl: true },
  mysql: { host: '', port: 3306, database: '', user: '', ssl: true }, mongodb: { uri: '', database: '' }, smtp: { host: '', port: 587, user: '', from: '', secure: true },
  webhook_out: { url: '' }, custom: {},
};
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

function ConnectionForm({ initial, onDone, onCancel }: { initial: Connection | null; onDone: () => void; onCancel: () => void }) {
  const { c, cd } = useC();
  const [kind, setKind] = useState<ConnectionKind>(initial?.kind ?? 'rest_api');
  const [name, setName] = useState(initial?.name ?? '');
  const [config, setConfig] = useState<Record<string, unknown>>(initial?.config ?? DEFAULTS.rest_api);
  const [customText, setCustomText] = useState(pretty(initial?.kind === 'custom' ? initial.config : {}));
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [customSecrets, setCustomSecrets] = useState<Record<string, string>>({});
  const [readOnly, setReadOnly] = useState(initial?.access.readOnly ?? true);
  const [allowed, setAllowed] = useState((initial?.access.allowedTables ?? initial?.access.allowedCollections ?? []).join(', '));
  const [hosts, setHosts] = useState((initial?.access.allowedHosts ?? []).join(', '));
  const { busy, error, run } = useAction();
  const auth = String((config.auth as { type?: string } | undefined)?.type ?? 'none');
  const isDb = DB_KINDS.includes(kind);
  const set = (k: string, v: unknown) => setConfig((x) => ({ ...x, [k]: v }));

  function pickKind(k: ConnectionKind) { setKind(k); setConfig(DEFAULTS[k]); setSecrets({}); setReadOnly(DB_KINDS.includes(k)); }

  async function submit(e: FormEvent) {
    e.preventDefault();
    let cfg = config;
    if (kind === 'custom') { try { cfg = customText.trim() ? JSON.parse(customText) : {}; } catch { return; } }
    const allSecrets = Object.fromEntries(Object.entries(kind === 'custom' ? customSecrets : secrets).filter(([, v]) => v));
    const access = {
      readOnly: isDb ? readOnly : false,
      ...(kind === 'mongodb' ? { allowedCollections: list(allowed) } : isDb ? { allowedTables: list(allowed) } : {}),
      ...(kind === 'rest_api' || kind === 'custom' ? { allowedHosts: list(hosts) } : {}),
    };
    const body = { name, config: cfg, access, ...(Object.keys(allSecrets).length ? { secrets: allSecrets } : {}) };
    const r = await run(() => (initial ? patch(`/connections/${initial.id}`, body) : post('/connections', { ...body, kind })));
    if (r !== undefined) onDone();
  }

  const text = (k: string, label: string, opts: { type?: string; ph?: string; ltr?: boolean } = {}) => (
    <Field label={label}>{(id) => <input id={id} type={opts.type ?? 'text'} dir={opts.ltr === false ? undefined : 'ltr'} className="input" placeholder={opts.ph} value={String(config[k] ?? '')}
      onChange={(e) => set(k, opts.type === 'number' ? Number(e.target.value) : e.target.value)} />}</Field>
  );
  const bool = (k: string, label: string) => <Toggle checked={!!config[k]} onChange={(v) => set(k, v)} label={label} />;

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label={c('name')}>{(id) => <input id={id} required className="input" placeholder="CRM API" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label={c('kindLabel')}>
        {(id) => <select id={id} className="input" value={kind} disabled={!!initial} onChange={(e) => pickKind(e.target.value as ConnectionKind)}>{CONNECTION_KINDS.map((k) => <option key={k} value={k}>{cd('conn_', k)}</option>)}</select>}
      </Field>

      {kind === 'rest_api' && (
        <>
          {text('baseUrl', c('baseUrl'), { type: 'url', ph: 'https://api.example.com' })}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={c('auth')}>
              {(id) => <select id={id} className="input" value={auth} onChange={(e) => { set('auth', { type: e.target.value }); setSecrets({}); }}>{['none', 'bearer', 'basic', 'header', 'query'].map((a) => <option key={a} value={a}>{cd('auth_', a)}</option>)}</select>}
            </Field>
            {auth === 'header' && <Field label={c('headerName')}>{(id) => <input id={id} dir="ltr" className="input font-mono" placeholder="X-Api-Key" value={String((config.auth as { headerName?: string }).headerName ?? '')} onChange={(e) => set('auth', { type: auth, headerName: e.target.value })} />}</Field>}
            {auth === 'query' && <Field label={c('queryName')}>{(id) => <input id={id} dir="ltr" className="input font-mono" placeholder="api_key" value={String((config.auth as { queryName?: string }).queryName ?? '')} onChange={(e) => set('auth', { type: auth, queryName: e.target.value })} />}</Field>}
          </div>
          <KeyValueEditor label={c('defaultHeaders')} value={(config.defaultHeaders as Record<string, string>) ?? {}} onChange={(v) => set('defaultHeaders', v)} keyPh="Accept" valuePh="application/json" />
        </>
      )}
      {(kind === 'postgres' || kind === 'mysql') && (
        <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
          {text('host', c('host'), { ph: 'db.example.com' })}{text('port', c('port'), { type: 'number' })}
          {text('database', c('database'))}<div className="hidden sm:block" />
          {text('user', c('user'))}<div className="hidden sm:block" />
          {bool('ssl', c('useTls'))}
        </div>
      )}
      {kind === 'mongodb' && <>{text('uri', c('uri'), { ph: 'mongodb+srv://user@cluster.example.net' })}{text('database', c('database'))}</>}
      {kind === 'smtp' && (
        <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
          {text('host', c('host'), { ph: 'smtp.example.com' })}{text('port', c('port'), { type: 'number' })}
          {text('user', c('user'))}<div className="hidden sm:block" />
          {text('from', c('fromAddress'), { ph: 'Acme <bot@example.com>' })}<div className="hidden sm:block" />
          {bool('secure', c('useTls'))}
        </div>
      )}
      {kind === 'webhook_out' && text('url', c('url'), { type: 'url', ph: 'https://hooks.example.com/in' })}
      {kind === 'custom' && <JsonInput label={c('configJson')} value={customText} onChange={setCustomText} rows={6} />}

      {kind !== 'custom' && secretFieldsFor(kind, auth).map((f) => (
        <SecretInput key={f} label={cd('', f)} hint={initial?.secretHints[f]} value={secrets[f] ?? ''} required={!initial} onChange={(v) => setSecrets((s) => ({ ...s, [f]: v }))} />
      ))}
      {kind === 'custom' && (
        <div>
          <KeyValueEditor label={c('secretValues')} value={{}} onChange={setCustomSecrets} keyPh="api_key" valuePh="••••" />
          {initial && initial.secretFields.length > 0 && <p className="mt-1 text-xs text-neutral-500">{initial.secretFields.map((f) => `${f} ${initial.secretHints[f] ?? ''}`).join(' · ')}</p>}
          <p className="mt-1 text-xs text-neutral-500">{c('secretWriteOnlyNote')}</p>
        </div>
      )}

      {(isDb || kind === 'rest_api' || kind === 'custom') && <fieldset className="space-y-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
        <legend className="px-1 text-sm font-medium">{c('access')}</legend>
        {isDb && <Toggle checked={readOnly} onChange={setReadOnly} label={c('readOnly')} hint={c('readOnlyHint')} />}
        {isDb && <Field label={kind === 'mongodb' ? c('allowedCollections') : c('allowedTables')} hint={c('commaSep')}>{(id, h) => <input id={id} aria-describedby={h} dir="ltr" className="input font-mono text-xs" placeholder={kind === 'mongodb' ? 'orders, customers' : 'public.orders, public.customers'} value={allowed} onChange={(e) => setAllowed(e.target.value)} />}</Field>}
        {(kind === 'rest_api' || kind === 'custom') && <Field label={c('allowedHosts')} hint={c('commaSep')}>{(id, h) => <input id={id} aria-describedby={h} dir="ltr" className="input font-mono text-xs" placeholder="api.example.com" value={hosts} onChange={(e) => setHosts(e.target.value)} />}</Field>}
      </fieldset>}

      <ErrorBox error={error} />
      <div className="flex gap-2">
        <button className="btn-primary" disabled={busy}>{busy ? c('saving') : c('save')}</button>
        <button type="button" className="btn-ghost" onClick={onCancel}>{c('cancel')}</button>
      </div>
    </form>
  );
}
