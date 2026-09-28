'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { API_URL, api, post } from '@/lib/api';
import type { Key } from '@/lib/i18n';
import type { Run, Task } from '@/lib/types';
import { useLoad } from '@/lib/use-load';
import { useShell } from '@/components/ctx';
import { Card, Empty, ErrorNote, Loading, PageTitle, StatusBadge, Time, useAction } from '@/components/ui';

export default function MaintenancePage() {
  return (
    <Suspense>
      <Maintenance />
    </Suspense>
  );
}

function Maintenance() {
  const { t, contractName } = useShell();
  const router = useRouter();
  const selected = useSearchParams().get('run');
  const tasks = useLoad(() => api<{ data: Task[] }>('/ops/v1/maintenance/tasks'), []);
  const runs = useLoad(() => api<{ data: Run[] }>('/ops/v1/maintenance/runs'), [], { pollMs: 15_000 });
  const { busy, run } = useAction();
  const open = (id: string) => router.push(`/maintenance?run=${id}`);

  const runNow = (task: Task) => run(task.id, () => post<Run>(`/ops/v1/maintenance/tasks/${task.id}/run`), t('runStarted')).then((r) => {
    if (r) {
      void runs.reload();
      open(r.id);
    }
  });
  const retry = (r: Run) => run(r.id, () => post<Run>(`/ops/v1/maintenance/runs/${r.id}/retry`), t('runStarted')).then((n) => {
    if (n) {
      void runs.reload();
      open(n.id);
    }
  });

  return (
    <div className="space-y-5">
      <PageTitle title={t('navMaintenance')} sub={t('maintenanceLead')} />
      {selected && <LiveLog runId={selected} onEnd={() => runs.reload()} />}
      <Card title={t('tasks')}>
        <ErrorNote error={tasks.error} />
        {!tasks.data ? <Loading /> : tasks.data.data.length ? (
          <div className="-mx-2 overflow-x-auto">
            <table className="table">
              <thead><tr><th>{t('task')}</th><th>{t('kind')}</th><th>{t('asset')}</th><th>{t('schedule')}</th><th>{t('nextRun')}</th><th>{t('lastRun')}</th><th /></tr></thead>
              <tbody>
                {tasks.data.data.map((x) => (
                  <tr key={x.id}>
                    <td><div className="font-medium">{x.name}</div><div className="text-xs text-neutral-500">{contractName(x.contractId)}</div></td>
                    <td className="whitespace-nowrap">{t(`mkind_${x.kind}` as Key)}</td>
                    <td>{x.asset ? <Link className="hover:underline" href={`/assets/${x.asset.id}`}>{x.asset.name}</Link> : <span className="text-neutral-500">{t('allAssets')}</span>}</td>
                    <td className="font-mono text-xs" dir="ltr">{x.cron}<div className="text-neutral-500">{x.timezone}</div></td>
                    <td>{x.enabled ? <Time value={x.nextRunAt} contractId={x.contractId} /> : <span className="text-neutral-500">{t('paused')}</span>}</td>
                    <td><Time value={x.lastRunAt} contractId={x.contractId} /></td>
                    <td><button className="btn-ghost whitespace-nowrap" disabled={busy === x.id} onClick={() => runNow(x)}>{t('runNow')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>{t('noTasks')}</Empty>}
        <p className="mt-3 text-xs text-neutral-500">{t('runsOnPlatform')}</p>
      </Card>
      <Card title={t('runHistory')}>
        <ErrorNote error={runs.error} />
        {!runs.data ? <Loading /> : runs.data.data.length ? (
          <div className="-mx-2 overflow-x-auto">
            <table className="table">
              <thead><tr><th>{t('status')}</th><th>{t('task')}</th><th>{t('trigger')}</th><th>{t('started')}</th><th>{t('finished')}</th><th>{t('ticket')}</th><th /></tr></thead>
              <tbody>
                {runs.data.data.map((r) => (
                  <tr key={r.id} className={selected === r.id ? 'bg-blue-50/60 dark:bg-blue-950/20' : ''}>
                    <td><StatusBadge status={r.status} /></td>
                    <td>{r.task?.name}{r.error && <div className="text-xs text-red-600">{r.error}</div>}</td>
                    <td className="text-neutral-500">{t(`trigger_${r.trigger}` as Key)}</td>
                    <td><Time value={r.startedAt ?? r.createdAt} contractId={r.task?.contractId} /></td>
                    <td><Time value={r.finishedAt} contractId={r.task?.contractId} /></td>
                    <td>{r.ticketId && <Link className="text-blue-600 hover:underline" href={`/tickets/${r.ticketId}`}>{t('openTicket')}</Link>}</td>
                    <td className="whitespace-nowrap">
                      <button className="text-sm text-blue-600 hover:underline" onClick={() => open(r.id)}>{t('output')}</button>
                      {r.status === 'FAILED' && <button className="btn-ghost ms-2 py-1" disabled={busy === r.id} onClick={() => retry(r)}>{t('retry')}</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>{t('noRuns')}</Empty>}
      </Card>
    </div>
  );
}

/**
 * The run's log, live, through Server Sent Events. EventSource cannot send headers, so it relies
 * on the HttpOnly prgd_ops_session cookie (withCredentials). The stream starts at offset 0 on
 * every connection, so a reconnect replaces the text from its offset on.
 */
function LiveLog({ runId, onEnd }: { runId: string; onEnd: () => void }) {
  const { t } = useShell();
  const [log, setLog] = useState('');
  const [status, setStatus] = useState<string>('QUEUED');
  const [ended, setEnded] = useState<{ status: string; error?: string | null } | null>(null);
  const [failed, setFailed] = useState(false);
  const [run, setRun] = useState<Run | null>(null);
  const pre = useRef<HTMLPreElement>(null);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  useEffect(() => {
    setLog('');
    setEnded(null);
    setFailed(false);
    api<Run>(`/ops/v1/maintenance/runs/${runId}`).then(setRun).catch(() => undefined);
    const es = new EventSource(`${API_URL}/ops/v1/maintenance/runs/${runId}/stream`, { withCredentials: true });
    es.addEventListener('log', (e) => {
      const { offset, chunk } = JSON.parse((e as MessageEvent).data) as { offset: number; chunk: string };
      setLog((prev) => prev.slice(0, offset) + chunk);
    });
    es.addEventListener('status', (e) => setStatus((JSON.parse((e as MessageEvent).data) as { status: string }).status));
    es.addEventListener('end', (e) => {
      const d = JSON.parse((e as MessageEvent).data) as { status: string; error?: string | null };
      setStatus(d.status);
      setEnded(d);
      es.close();
      onEndRef.current();
    });
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) setFailed(true);
    };
    return () => es.close();
  }, [runId]);

  useEffect(() => {
    const el = pre.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [log]);

  return (
    <Card
      title={<span className="flex items-center gap-2">{t('liveOutput')} <StatusBadge status={status} /> {!ended && !failed && <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />}</span>}
      actions={<Link href="/maintenance" className="text-sm text-neutral-500 hover:underline">{t('close')}</Link>}
    >
      {run && <p className="mb-2 text-sm text-neutral-600 dark:text-neutral-300">{run.task?.name} · <Time value={run.startedAt ?? run.createdAt} contractId={run.task?.contractId} />{run.ticketId && <> · <Link className="text-blue-600 hover:underline" href={`/tickets/${run.ticketId}`}>{t('openTicket')}</Link></>}</p>}
      <pre ref={pre} dir="ltr" className="max-h-[28rem] min-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-neutral-950 p-3 font-mono text-xs leading-relaxed text-neutral-100">{log || t('waitingForOutput')}</pre>
      {ended?.error && <p className="mt-2 text-sm text-red-600">{ended.error}</p>}
      {failed && <p className="mt-2 text-sm text-red-600">{t('streamFailed')}</p>}
    </Card>
  );
}
