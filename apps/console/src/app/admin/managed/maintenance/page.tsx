'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { AdminShell } from '@/components/admin-shell';
import { useShell } from '@/components/shell';
import { Cell, ErrorBox, Field, Loading, OkBox, Row, Table, tk, Toggle, ToneBadge } from '@/components/managed';
import { errText, fmtDateTime, fmtRelative, fmtSpan, type Asset, type Contract, type MaintenanceRun, type MaintenanceTask, type Page } from '@/lib/managed';

const KINDS = ['PATCHING', 'BACKUP_TEST', 'CUSTOM'] as const;
const RUN_TONE = { QUEUED: 'grey', RUNNING: 'blue', SUCCEEDED: 'green', FAILED: 'red' } as const;

/** Maintenance schedules (cron) per contract or asset, run now, and the runs with their logs. */
export default function AdminMaintenance() {
  const { locale } = useShell();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [contractId, setContractId] = useState('');
  const [tasks, setTasks] = useState<MaintenanceTask[] | null>(null);
  const [runs, setRuns] = useState<MaintenanceRun[] | null>(null);
  const [editing, setEditing] = useState<MaintenanceTask | 'new' | null>(null);
  const [log, setLog] = useState<MaintenanceRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api<Page<Contract>>('/admin/managed/contracts?limit=200').then((r) => setContracts(r.data.filter((c) => c.status !== 'CANCELLED'))).catch((e) => setError(errText(e))); }, []);
  const load = useCallback(async () => {
    const q = contractId ? `?contractId=${contractId}` : '';
    const [tk2, rs] = await Promise.all([
      api<{ data: MaintenanceTask[] }>(`/admin/managed/maintenance/tasks${q}`),
      api<Page<MaintenanceRun>>(`/admin/managed/maintenance/runs?limit=50${contractId ? `&contractId=${contractId}` : ''}`),
    ]);
    setTasks(tk2.data); setRuns(rs.data);
  }, [contractId]);
  useEffect(() => { load().catch((e) => setError(errText(e))); }, [load]);

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true); setError(null); setOk(null);
    try { await fn(); if (done) setOk(done); await load(); return true; } catch (e) { setError(errText(e)); return false; } finally { setBusy(false); }
  }
  async function openLog(r: MaintenanceRun) {
    setError(null);
    try { setLog(await api<MaintenanceRun>(`/admin/managed/maintenance/runs/${r.id}`)); } catch (e) { setError(errText(e)); }
  }

  const teamOf = (id: string) => { const c = contracts.find((x) => x.id === id); return c ? `${c.team?.name ?? c.teamId}` : id.slice(0, 8); };

  return (
    <AdminShell title={t(locale, 'admMcMaintenanceTitle')} actions={<button className="btn-primary" onClick={() => setEditing('new')}>{t(locale, 'admMcNewTask')}</button>}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select className="input !w-auto py-1" value={contractId} onChange={(e) => setContractId(e.target.value)} aria-label={t(locale, 'admMcContract')}>
          <option value="">{t(locale, 'admMcAllContracts')}</option>
          {contracts.map((c) => <option key={c.id} value={c.id}>{c.team?.name ?? c.teamId} · {c.plan.name}</option>)}
        </select>
      </div>
      <ErrorBox error={error} />
      <OkBox msg={ok} />
      {editing && <TaskForm key={editing === 'new' ? 'new' : editing.id} task={editing === 'new' ? null : editing} contracts={contracts} defaultContract={contractId} busy={busy} onCancel={() => setEditing(null)}
        onSave={async (body, id) => { if (await run(() => api(id ? `/admin/managed/maintenance/tasks/${id}` : '/admin/managed/maintenance/tasks', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) }), t(locale, 'admMcTaskSaved'))) setEditing(null); }} />}

      <section className="space-y-2">
        <h2 className="font-medium">{t(locale, 'admMcTasks')}</h2>
        {!tasks ? <Loading /> : (
          <Table head={[t(locale, 'name'), t(locale, 'team'), t(locale, 'mcAsset'), t(locale, 'admMcSchedule'), t(locale, 'admMcNextRun'), t(locale, 'admMcLastRun'), t(locale, 'admMcEnabled'), '']} empty={tasks.length === 0 ? t(locale, 'admMcNoTasks') : undefined}>
            {tasks.map((x) => (
              <Row key={x.id}>
                <Cell><span className="font-medium">{x.name}</span><div className="text-xs text-neutral-500">{tk(locale, `admMcKind_${x.kind}`, x.kind)}{x.playbook ? ` · ${x.playbook}` : ''}</div></Cell>
                <Cell><Link href={`/admin/managed/contracts/${x.contractId}`} className="hover:underline">{teamOf(x.contractId)}</Link></Cell>
                <Cell className="text-neutral-500">{x.asset?.name ?? t(locale, 'admMcAllAssets')}</Cell>
                <Cell><code className="font-mono text-xs" dir="ltr">{x.cron}</code><div className="text-xs text-neutral-500">{x.timezone}</div></Cell>
                <Cell className="text-xs">{x.enabled && x.nextRunAt ? <><div>{fmtDateTime(x.nextRunAt, locale)}</div><div className="text-neutral-500">{fmtRelative(x.nextRunAt, locale)}</div></> : <span className="text-neutral-500">{t(locale, 'admMcPaused')}</span>}</Cell>
                <Cell className="text-xs text-neutral-500">{x.lastRunAt ? fmtRelative(x.lastRunAt, locale) : '—'}</Cell>
                <Cell><Toggle on={x.enabled} label={t(locale, 'admMcEnabled')} disabled={busy} onChange={(v) => run(() => api(`/admin/managed/maintenance/tasks/${x.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: v }) }))} /></Cell>
                <Cell className="whitespace-nowrap text-end">
                  <button className="btn-ghost me-1" disabled={busy} onClick={() => { if (confirm(t(locale, 'admMcRunNowConfirm'))) run(() => api(`/admin/managed/maintenance/tasks/${x.id}/run`, { method: 'POST' }), t(locale, 'admMcRunQueued')); }}>{t(locale, 'admMcRunNow')}</button>
                  <button className="btn-ghost me-1" onClick={() => setEditing(x)}>{t(locale, 'admMcEdit')}</button>
                  <button className="btn-danger" disabled={busy} onClick={() => { if (confirm(t(locale, 'admMcDeleteTaskConfirm'))) run(() => api(`/admin/managed/maintenance/tasks/${x.id}`, { method: 'DELETE' })); }}>{t(locale, 'delete')}</button>
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </section>

      {log && (
        <section className="card space-y-2">
          <div className="flex items-center gap-2"><h2 className="font-medium">{t(locale, 'admMcRunLog')}: {log.task?.name}</h2><ToneBadge tone={RUN_TONE[log.status]}>{tk(locale, `admMcRun_${log.status}`, log.status)}</ToneBadge><button className="btn-ghost ms-auto" onClick={() => setLog(null)}>{t(locale, 'close')}</button></div>
          {log.error && <p className="text-sm text-red-700 dark:text-red-400">{log.error}</p>}
          <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded bg-neutral-950 p-3 font-mono text-xs text-neutral-100" dir="ltr">{log.log || t(locale, 'admMcNoLog')}</pre>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-medium">{t(locale, 'admMcRuns')}</h2>
        {!runs ? <Loading /> : (
          <Table head={[t(locale, 'admMcTask'), t(locale, 'status'), t(locale, 'admMcTrigger'), t(locale, 'admMcStartedAt'), t(locale, 'admMcDuration'), '']} empty={runs.length === 0 ? t(locale, 'admMcNoRuns') : undefined}>
            {runs.map((r) => (
              <Row key={r.id}>
                <Cell><span className="font-medium">{r.task?.name ?? r.taskId}</span>{r.task && <div className="text-xs text-neutral-500">{teamOf(r.task.contractId)}</div>}</Cell>
                <Cell><ToneBadge tone={RUN_TONE[r.status]}>{tk(locale, `admMcRun_${r.status}`, r.status)}</ToneBadge>{r.error && <div className="mt-1 max-w-xs truncate text-xs text-red-700 dark:text-red-400" title={r.error}>{r.error}</div>}</Cell>
                <Cell className="text-xs text-neutral-500">{tk(locale, `admMcTrigger_${r.trigger}`, r.trigger)}{r.runner ? ` · ${r.runner}` : ''}</Cell>
                <Cell className="text-xs">{fmtDateTime(r.startedAt ?? r.createdAt, locale)}</Cell>
                <Cell className="text-xs text-neutral-500">{r.startedAt && r.finishedAt ? fmtSpan(new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime(), locale) : '—'}</Cell>
                <Cell className="whitespace-nowrap text-end">
                  {r.ticketId && <Link href={`/admin/managed/tickets/${r.ticketId}`} className="btn-ghost me-1">{t(locale, 'admMcTicket')}</Link>}
                  <button className="btn-ghost" onClick={() => openLog(r)}>{t(locale, 'admMcViewLog')}</button>
                </Cell>
              </Row>
            ))}
          </Table>
        )}
      </section>
    </AdminShell>
  );
}

/** Create or edit a maintenance task. The API computes the next run from the cron and zone. */
function TaskForm({ task, contracts, defaultContract, busy, onCancel, onSave }: { task: MaintenanceTask | null; contracts: Contract[]; defaultContract: string; busy: boolean; onCancel: () => void; onSave: (body: Record<string, unknown>, id?: string) => void }) {
  const { locale } = useShell();
  const [contractId, setContractId] = useState(task?.contractId ?? defaultContract);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [kind, setKind] = useState<MaintenanceTask['kind']>(task?.kind ?? 'PATCHING');
  const [varsError, setVarsError] = useState<string | null>(null);
  useEffect(() => { if (contractId) api<{ data: Asset[] }>(`/admin/managed/contracts/${contractId}/assets`).then((r) => setAssets(r.data.filter((a) => a.status === 'APPROVED'))).catch(() => setAssets([])); else setAssets([]); }, [contractId]);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    let vars: Record<string, unknown> | undefined;
    if (s('vars')) { try { vars = JSON.parse(s('vars')); setVarsError(null); } catch { setVarsError(t(locale, 'admMcVarsInvalid')); return; } }
    const body: Record<string, unknown> = { kind, name: s('name') || undefined, cron: s('cron'), timezone: s('timezone') || undefined, playbook: s('playbook') || undefined, enabled: !!f.get('enabled'), ...(vars ? { vars } : {}) };
    if (task) onSave({ ...body, assetId: s('assetId') || null }, task.id);
    else onSave({ ...body, contractId, assetId: s('assetId') || undefined });
  }
  const contract = contracts.find((c) => c.id === contractId);
  return (
    <form onSubmit={submit} className="card space-y-3">
      <h2 className="font-medium">{task ? t(locale, 'admMcEditTask') : t(locale, 'admMcNewTask')}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t(locale, 'admMcContract')}>
          <select className="input" value={contractId} onChange={(e) => setContractId(e.target.value)} required disabled={!!task}>
            <option value="" disabled>{t(locale, 'admMcChooseContract')}</option>
            {contracts.map((c) => <option key={c.id} value={c.id}>{c.team?.name ?? c.teamId} · {c.plan.name}</option>)}
          </select>
        </Field>
        <Field label={t(locale, 'mcAsset')}>
          <select className="input" name="assetId" defaultValue={task?.assetId ?? ''}>
            <option value="">{t(locale, 'admMcAllAssets')}</option>
            {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label={t(locale, 'mcKind')}><select className="input" value={kind} onChange={(e) => setKind(e.target.value as MaintenanceTask['kind'])}>{KINDS.map((k) => <option key={k} value={k}>{tk(locale, `admMcKind_${k}`)}</option>)}</select></Field>
        <Field label={t(locale, 'name')}><input className="input" name="name" minLength={2} maxLength={120} defaultValue={task?.name ?? ''} placeholder={tk(locale, `admMcKind_${kind}`)} /></Field>
        <Field label={t(locale, 'admMcCron')} hint={t(locale, 'admMcCronHint')}><input className="input font-mono" name="cron" required minLength={9} maxLength={100} dir="ltr" defaultValue={task?.cron ?? (kind === 'BACKUP_TEST' ? '0 4 * * 6' : '0 3 1 * *')} /></Field>
        <Field label={t(locale, 'admMcTimezone')} hint={contract ? `${t(locale, 'admMcDefault')}: ${contract.sla.timeZone}` : undefined}><input className="input" name="timezone" dir="ltr" defaultValue={task?.timezone ?? ''} placeholder="Asia/Riyadh" /></Field>
        <Field label={t(locale, 'admMcPlaybook')} hint={t(locale, 'admMcPlaybookHint')}><input className="input font-mono" name="playbook" dir="ltr" defaultValue={task?.playbook ?? ''} placeholder={kind === 'BACKUP_TEST' ? 'backup-test.yml' : 'patching.yml'} /></Field>
      </div>
      <Field label={t(locale, 'admMcVars')} hint={varsError ?? t(locale, 'admMcVarsHint')}><textarea className="input min-h-16 font-mono text-xs" name="vars" dir="ltr" defaultValue={task?.vars && Object.keys(task.vars).length ? JSON.stringify(task.vars, null, 2) : ''} /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={task?.enabled ?? true} />{t(locale, 'admMcEnabled')}</label>
      {task?.nextRunAt && <p className="text-xs text-neutral-500">{t(locale, 'admMcNextRun')}: {fmtDateTime(task.nextRunAt, locale)} ({fmtRelative(task.nextRunAt, locale)})</p>}
      <div className="flex gap-2"><button className="btn-primary" disabled={busy || !contractId}>{t(locale, 'save')}</button><button type="button" className="btn-ghost" onClick={onCancel}>{t(locale, 'cancel')}</button></div>
    </form>
  );
}
