'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { StatusBadge } from '@/components/status-badge';
import { AppRun, RUN_ACTIVE, RUN_STATUS_BADGE, duration } from '@/lib/app-platform';

const QUICK = ['npx prisma migrate deploy', 'npx prisma db seed', 'npx prisma migrate status'];
const TIMEOUTS = [[60, '1 min'], [300, '5 min'], [600, '10 min'], [1800, '30 min'], [3600, '60 min']] as const;

/**
 * Console of an app: one off commands in a fresh container from the live image. The selected
 * run is polled every two seconds while it runs.
 */
export function RunConsole({ appId, locale, canRun }: { appId: string; locale: string; canRun: boolean }) {
  const [runs, setRuns] = useState<AppRun[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<AppRun | null>(null);
  const [command, setCommand] = useState('');
  const [timeoutSeconds, setTimeoutSeconds] = useState(600);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/v1/app-platform/apps/${appId}/runs`;

  const loadRuns = useCallback(() => api<{ data: AppRun[] }>(base).then((r) => setRuns(r.data)).catch(() => undefined), [base]);
  useEffect(() => { loadRuns(); }, [loadRuns]);
  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const r = await api<AppRun>(`${base}/${selected}`);
        if (stopped) return;
        setDetail(r);
        if (RUN_ACTIVE.includes(r.status)) timer = setTimeout(tick, 2000);
        else loadRuns();
      } catch (err) {
        if (!stopped) setError(err instanceof ApiError ? err.message : String(err));
      }
    };
    tick();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [base, selected, loadRuns]);

  async function start(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api<AppRun>(base, { method: 'POST', idempotent: true, body: JSON.stringify({ command: command.trim(), timeoutSeconds }) });
      setSelected(r.id);
      await loadRuns();
    } catch (err) { setError(err instanceof ApiError ? err.message : String(err)); } finally { setBusy(false); }
  }

  async function cancel(id: string) {
    setBusy(true); setError(null);
    try { setDetail(await api<AppRun>(`${base}/${id}/cancel`, { method: 'POST' })); await loadRuns(); }
    catch (err) { setError(err instanceof ApiError ? err.message : String(err)); } finally { setBusy(false); }
  }

  return (
    <section className="card space-y-3 text-sm">
      <div>
        <h2 className="font-medium">Console</h2>
        <p className="text-xs text-neutral-500">Each command runs once in a fresh container from the app&apos;s live image, with its environment variables, attached databases and limits. It is not interactive (no TTY, no input), stops at the timeout, and is recorded in the audit log.</p>
      </div>
      <form className="flex flex-wrap items-center gap-2" onSubmit={start}>
        <input className="input min-w-0 flex-1 font-mono text-xs" dir="ltr" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx prisma migrate deploy" maxLength={2000} required aria-label="Command" />
        <select className="input w-auto" value={timeoutSeconds} onChange={(e) => setTimeoutSeconds(Number(e.target.value))} aria-label="Timeout">
          {TIMEOUTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <button className="btn-primary" disabled={busy || !canRun || !command.trim()}>Run</button>
      </form>
      <div className="flex flex-wrap gap-1">
        {QUICK.map((q) => <button key={q} type="button" className="rounded-full border border-neutral-300 px-2 py-0.5 font-mono text-xs text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800" dir="ltr" onClick={() => setCommand(q)}>{q}</button>)}
      </div>
      {!canRun && <p className="text-xs text-neutral-500">Commands run once the app has a live deploy.</p>}
      {error && <p className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/30">{error}</p>}

      {detail && (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={RUN_STATUS_BADGE[detail.status] ?? detail.status} />
            <span className="text-xs text-neutral-500">{detail.status.replace('_', ' ')}{detail.exitCode != null ? ` · exit ${detail.exitCode}` : ''} · {duration(detail.durationMs)}</span>
            <code className="min-w-0 truncate font-mono text-xs" dir="ltr">{detail.command}</code>
            {RUN_ACTIVE.includes(detail.status) && <button type="button" className="btn-ghost ms-auto" disabled={busy} onClick={() => cancel(detail.id)}>Cancel</button>}
          </div>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-neutral-950 p-3 text-start font-mono text-xs leading-relaxed text-neutral-100" dir="ltr">{detail.output || (RUN_ACTIVE.includes(detail.status) ? 'Starting…' : 'No output.')}</pre>
        </div>
      )}

      <table className="w-full">
        <thead><tr className="text-start text-xs text-neutral-500"><th className="py-1 text-start font-normal">Status</th><th className="py-1 text-start font-normal">Command</th><th className="py-1 text-start font-normal">Started</th><th className="py-1 text-start font-normal">Duration</th><th className="py-1 text-start font-normal">Exit</th></tr></thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} onClick={() => setSelected(r.id)} className={`cursor-pointer border-t border-neutral-100 dark:border-neutral-800 ${selected === r.id ? 'bg-neutral-50 dark:bg-neutral-900' : 'hover:bg-neutral-50 dark:hover:bg-neutral-900'}`}>
              <td className="py-1.5"><StatusBadge status={RUN_STATUS_BADGE[r.status] ?? r.status} /></td>
              <td className="max-w-[16rem] truncate py-1.5 font-mono text-xs" dir="ltr">{r.command}</td>
              <td className="py-1.5 text-xs text-neutral-500">{new Date(r.createdAt).toLocaleString(locale)}</td>
              <td className="py-1.5 text-xs">{duration(r.durationMs)}</td>
              <td className="py-1.5 font-mono text-xs">{r.exitCode ?? '—'}</td>
            </tr>
          ))}
          {runs.length === 0 && <tr><td colSpan={5} className="py-1.5 text-neutral-500">No commands run yet.</td></tr>}
        </tbody>
      </table>
    </section>
  );
}
