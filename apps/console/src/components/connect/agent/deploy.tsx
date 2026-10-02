'use client';

import { FormEvent, useState } from 'react';
import { WWW_URL } from '@/lib/api';
import { AgentKey, AgentVersion, del, fmtDate, patch, post, Webhook, WebhookSecrets } from '@/lib/connect';
import { CopyField, ErrorBox, Field, IssuesNotice, Notice, SecretOnce, Status, useAction, useC } from '../ui';
import type { AgentTabProps } from './types';

export function DeployTab({ agent, reload, setTab }: AgentTabProps) {
  const { c, cf } = useC();
  const [note, setNote] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  async function saveVersion(e: FormEvent) {
    e.preventDefault(); setNotice(null);
    const v = await run(() => post<AgentVersion>(`/agents/${agent.id}/versions`, { note }));
    if (v) { setNote(''); await reload(); setNotice(cf('versionSaved')(v.version)); }
  }
  // The latest saved version is already live: deploying again would change nothing, so offer
  // "Deploy latest", which saves the draft as a new version and deploys it.
  const live = agent.status === 'deployed' && !!agent.deployedVersion && agent.deployedVersion === agent.currentVersion;
  const resume = agent.status === 'paused' && !!agent.deployedVersion && agent.deployedVersion === agent.currentVersion;
  async function deploy() {
    setNotice(null);
    const r = await run(() => post(`/agents/${agent.id}/deploy`, agent.currentVersion && !live ? { version: agent.currentVersion } : {}));
    if (r !== undefined) { await reload(); setNotice(c('deployedOk')); }
  }
  async function pause() {
    setNotice(null);
    const r = await run(() => post(`/agents/${agent.id}/pause`));
    if (r !== undefined) { await reload(); setNotice(c('pausedOk')); }
  }

  const statusNote = agent.status === 'deployed' && agent.deployedVersion ? cf('deployedNote')(agent.deployedVersion) : agent.status === 'paused' ? c('pausedNote') : c('draftDeployNote');
  return (
    <div className="space-y-5">
      <section className="card space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Status status={agent.status} />
          <p className="min-w-0 flex-1 text-sm text-neutral-600 dark:text-neutral-300">{statusNote}</p>
        </div>
        <form onSubmit={saveVersion} className="flex flex-wrap items-end gap-2">
          <Field label={c('versionNote')} className="min-w-48 flex-1">{(id) => <input id={id} className="input" placeholder={c('versionNotePh')} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <button className="btn-ghost" disabled={busy}>{c('saveVersion')}</button>
        </form>
        <div className="flex flex-wrap gap-2">
          {live && <span className="badge self-center bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">{cf('versionN')(agent.deployedVersion!)} · {c('liveBadge')}</span>}
          <button type="button" className={live ? 'btn-ghost' : 'btn-primary'} disabled={busy} onClick={deploy} title={live ? c('deployLatestHint') : undefined}>
            {live ? c('deployLatest') : resume ? c('resume') : agent.currentVersion ? cf('deployVersion')(agent.currentVersion) : c('deploy')}
          </button>
          {live && <span className="self-center text-xs text-neutral-500">{c('deployLatestHint')}</span>}
          {agent.status === 'deployed' && <button type="button" className="btn-ghost" disabled={busy} onClick={pause}>{c('pause')}</button>}
        </div>
        <IssuesNotice issues={agent.issues ?? []} />
        {notice && <Notice>{notice}</Notice>}
        <ErrorBox error={error} />
      </section>

      <section className="card">
        <dl className="divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
          <div className="grid gap-1 py-2 sm:grid-cols-[10rem_1fr] sm:items-center"><dt className="text-neutral-500">{c('status')}</dt><dd><Status status={agent.status} /></dd></div>
          <div className="grid gap-1 py-2 sm:grid-cols-[10rem_1fr] sm:items-center"><dt className="text-neutral-500">{c('agentId')}</dt><dd className="min-w-0"><CopyField value={agent.id} label={c('agentId')} /></dd></div>
          <div className="grid gap-1 py-2 sm:grid-cols-[10rem_1fr] sm:items-center"><dt className="text-neutral-500">{c('endpoint')}</dt><dd className="min-w-0"><CopyField value={agent.runEndpoint} label={c('endpoint')} /></dd></div>
        </dl>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <button type="button" className="font-medium text-blue-700 hover:underline dark:text-blue-400" onClick={() => setTab('api')}>{c('seeApiTab')}</button>
          <a href={`${WWW_URL}/docs/connect`} target="_blank" rel="noreferrer" className="font-medium text-blue-700 hover:underline dark:text-blue-400">{c('readDocs')} ↗</a>
        </div>
      </section>

      <KeysSection agentId={agent.id} keys={agent.keys} reload={reload} />
      <WebhooksSection agentId={agent.id} hooks={agent.webhooks} reload={reload} />
    </div>
  );
}

export function KeysSection({ agentId, keys, reload, agentName }: { agentId: string; keys: AgentKey[]; reload: () => Promise<unknown>; agentName?: string }) {
  const { c, locale } = useC();
  const [name, setName] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  async function create(e: FormEvent) {
    e.preventDefault();
    const r = await run(() => post<{ key: AgentKey; secret: string }>(`/agents/${agentId}/keys`, { name }));
    if (r) { setSecret(r.secret); setName(''); await reload(); }
  }
  const revoke = (k: AgentKey) => confirm(c('revokeConfirm')) && run(async () => { await del(`/agents/${agentId}/keys/${k.id}`); await reload(); });
  return (
    <section className="card">
      <h2 className="mb-3 font-semibold">{c('apiKeys')}{agentName ? <span className="font-normal text-neutral-500"> · {agentName}</span> : null}</h2>
      {secret && <div className="mb-3"><SecretOnce secret={secret} onDone={() => setSecret(null)} /></div>}
      {keys.length === 0 ? <p className="mb-3 text-sm text-neutral-500">{c('noKeys')}</p> : (
        <ul className="mb-3 divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
          {keys.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
              <span className="font-medium">{k.name}</span>
              <code dir="ltr" className="font-mono text-xs text-neutral-500">{k.prefix}…</code>
              <span className="text-xs text-neutral-500">{c('lastUsed')}: {k.lastUsedAt ? fmtDate(k.lastUsedAt, locale) : c('never')}</span>
              <button type="button" className="btn-danger ms-auto px-2 py-1 text-xs" onClick={() => revoke(k)}>{c('revoke')}</button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={create} className="flex flex-wrap items-end gap-2">
        <Field label={c('keyName')} className="min-w-48 flex-1">{(id) => <input id={id} required className="input" placeholder={c('keyNamePh')} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <button className="btn-primary" disabled={busy}>{c('createKey')}</button>
      </form>
      <ErrorBox error={error} className="mt-3" />
    </section>
  );
}

export function WebhooksSection({ agentId, hooks, reload, agentName }: { agentId: string; hooks: Webhook[]; reload: () => Promise<unknown>; agentName?: string }) {
  const { c, cf } = useC();
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [signing, setSigning] = useState(false);
  const [fresh, setFresh] = useState<WebhookSecrets | null>(null);
  const { busy, error, run } = useAction();
  async function create(e: FormEvent) {
    e.preventDefault();
    const r = await run(() => post<WebhookSecrets>(`/agents/${agentId}/webhooks`, { name, path: path || undefined, signing }));
    if (r) { setFresh(r); setName(''); setPath(''); setSigning(false); await reload(); }
  }
  const rotate = (h: Webhook) => confirm(c('rotateConfirm')) && run(async () => { setFresh(await post<WebhookSecrets>(`/agents/${agentId}/webhooks/${h.id}/rotate`)); await reload(); });
  const toggle = (h: Webhook) => run(async () => { await patch(`/agents/${agentId}/webhooks/${h.id}`, { enabled: !h.enabled }); await reload(); });
  const remove = (h: Webhook) => confirm(c('deleteWebhookConfirm')) && run(async () => { await del(`/agents/${agentId}/webhooks/${h.id}`); await reload(); });
  const signed = hooks.find((h) => h.signing)?.signing;
  return (
    <section className="card">
      <h2 className="font-semibold">{c('webhookUrls')}{agentName ? <span className="font-normal text-neutral-500"> · {agentName}</span> : null}</h2>
      <p className="mb-3 text-sm text-neutral-500">{c('urlIsSecret')}</p>
      {fresh && <div className="mb-3"><HookSecretsOnce hook={fresh} onDone={() => setFresh(null)} /></div>}
      {hooks.length === 0 ? <p className="mb-3 text-sm text-neutral-500">{c('noWebhooks')}</p> : (
        <ul className="mb-3 space-y-3">
          {hooks.map((h) => <WebhookRow key={h.id} h={h} onRotate={() => rotate(h)} onToggle={() => toggle(h)} onDelete={() => remove(h)} />)}
        </ul>
      )}
      <form onSubmit={create} className="flex flex-wrap items-end gap-2">
        <Field label={c('name')} className="min-w-40 flex-1">{(id) => <input id={id} required className="input" placeholder="Website form" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label={<>{c('webhookPath')} <span className="font-normal text-neutral-500">({c('optional')})</span></>} className="min-w-40 flex-1">{(id) => <input id={id} dir="ltr" className="input font-mono text-xs" placeholder="new-lead" value={path} onChange={(e) => setPath(e.target.value.replace(/[^a-z0-9-]/g, ''))} />}</Field>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={signing} onChange={(e) => setSigning(e.target.checked)} /> {c('requireSignature')}</label>
        <button className="btn-primary" disabled={busy}>{c('addWebhook')}</button>
      </form>
      <ErrorBox error={error} className="mt-3" />
      {signed && <p className="mt-3 text-xs text-neutral-500">{c('signing')}: {cf('signingNote')(signed.header, signed.algo)} <code dir="ltr" className="font-mono">{'t=<unix seconds>,v1=<hex of HMAC("<t>.<body>")>'}</code></p>}
    </section>
  );
}

/** The full webhook URL (and signing secret) exist only in the create and rotate responses. */
export function HookSecretsOnce({ hook, onDone }: { hook: WebhookSecrets; onDone: () => void }) {
  const { c } = useC();
  return (
    <div role="status" className="space-y-2 rounded-md border border-blue-300 bg-blue-50 p-3 text-sm dark:border-blue-800 dark:bg-blue-950/30">
      <p className="font-medium">{c('hookShownOnce')}</p>
      <div><div className="mb-1 text-xs text-neutral-600 dark:text-neutral-300">{c('url')}</div><CopyField value={hook.url} label={c('url')} /></div>
      {hook.signingSecret && <div><div className="mb-1 text-xs text-neutral-600 dark:text-neutral-300">{c('signingSecret')}</div><CopyField value={hook.signingSecret} label={c('signingSecret')} /></div>}
      <button type="button" className="btn-ghost text-xs" onClick={onDone}>{c('close')}</button>
    </div>
  );
}

export function WebhookRow({ h, onRotate, onToggle, onDelete, agentLabel }: { h: Webhook; onRotate: () => void; onToggle: () => void; onDelete?: () => void; agentLabel?: React.ReactNode }) {
  const { c, locale } = useC();
  return (
    <li className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{h.name}</span>
        {agentLabel}
        <span className={`badge ${h.enabled ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800'}`}>{h.enabled ? c('enabled') : c('disabled')}</span>
        {h.signing && <span className="badge bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">{c('signed')}</span>}
        <span className="text-xs text-neutral-500">{c('lastCalled')}: {h.lastCalledAt ? fmtDate(h.lastCalledAt, locale) : c('never')}</span>
      </div>
      <code dir="ltr" className="block truncate rounded bg-neutral-50 px-2 py-1.5 font-mono text-xs text-neutral-600 dark:bg-neutral-900 dark:text-neutral-300" title={h.url}>{h.url}</code>
      <p className="mt-1 text-xs text-neutral-500">{c('tokenHidden')} <code dir="ltr" className="font-mono">{h.secretHint}</code></p>
      <div className="mt-2 flex flex-wrap gap-1">
        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={onToggle}>{h.enabled ? c('disable') : c('enable')}</button>
        <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={onRotate}>{c('rotate')}</button>
        {onDelete && <button type="button" className="btn-danger px-2 py-1 text-xs" onClick={onDelete}>{c('delete')}</button>}
      </div>
    </li>
  );
}
