'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { money } from '@/lib/api';
import { capi, FINISHED, fmtDate, fmtMs, fmtNum, Run, RunStep, streamRun, upsertStep } from '@/lib/connect';
import { Drawer, ErrorBox, Json, Notice, Segmented, Status, TableCard, Td, Th, useC } from './ui';

const STEP_ICON: Record<RunStep['type'], string> = { node: '◆', model: '✦', tool: '⚙', condition: '⑂', approval: '✋' };

/** Totals for one run: execution time, tokens, tool and API calls, cost estimate. */
export function RunSummary({ run, steps }: { run: Run; steps: RunStep[] }) {
  const { c, cf, locale } = useC();
  const u = run.usage;
  const tools = [...new Set(steps.filter((s) => s.type === 'tool').map((s) => s.name))];
  const items: [string, React.ReactNode][] = [
    [c('status'), <Status key="s" status={run.status} />],
    [c('executionTime'), fmtMs(run.durationMs)],
    [c('tokens'), u ? cf('tokensInOut')(fmtNum(u.inputTokens, locale), fmtNum(u.outputTokens, locale)) : '—'],
    [c('toolsUsed'), tools.length ? <span dir="ltr" className="font-mono text-xs">{tools.join(', ')}</span> : '—'],
    [c('apiCalls'), u ? fmtNum(u.apiCalls, locale) : '—'],
    [c('costEstimate'), run.costEstimateMinor != null ? money(run.costEstimateMinor, run.currency || 'USD', locale) : '—'],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0 rounded-md bg-neutral-50 p-2 dark:bg-neutral-900">
          <dt className="text-xs text-neutral-500">{k}</dt>
          <dd className="mt-0.5 truncate text-sm font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Ordered list of steps: model calls, tools, conditions and workflow steps, each expandable. */
export function RunTimeline({ steps }: { steps: RunStep[] }) {
  const { c, cd, cf, locale } = useC();
  return (
    <ol className="relative space-y-2 border-s border-neutral-200 ps-4 dark:border-neutral-800">
      {steps.map((s) => {
        const failed = s.status === 'failed' || !!s.error;
        return (
          <li key={s.id} className="relative">
            <span aria-hidden className={`absolute -start-[1.6rem] top-2 flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${failed ? 'bg-red-600 text-white' : s.status === 'running' ? 'animate-pulse bg-blue-600 text-white' : 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200'}`}>{STEP_ICON[s.type] ?? '•'}</span>
            <details className="group rounded-md border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900" open={failed}>
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
                <span className="text-xs text-neutral-500">{cd('stepType_', s.type)}</span>
                <span dir="auto" className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                {s.tokens && (s.tokens.input || s.tokens.output) ? <span className="text-xs text-neutral-500">{cf('tokensInOut')(fmtNum(s.tokens.input ?? 0, locale), fmtNum(s.tokens.output ?? 0, locale))}</span> : null}
                <span className="text-xs tabular-nums text-neutral-500">{fmtMs(s.durationMs)}</span>
                <Status status={s.status} />
              </summary>
              <div className="space-y-2 border-t border-neutral-100 p-3 dark:border-neutral-800">
                {s.error && <p className="rounded bg-red-50 p-2 text-sm text-red-800 dark:bg-red-950/30 dark:text-red-300"><span dir="ltr" className="font-mono text-xs">{s.error.code ? `${s.error.code}: ` : ''}</span>{s.error.message}</p>}
                {s.input !== undefined && s.input !== null && <div><div className="mb-1 text-xs font-medium text-neutral-500">{c('stepInput')}</div><Json value={s.input} maxH="max-h-48" /></div>}
                {s.output !== undefined && s.output !== null && <div><div className="mb-1 text-xs font-medium text-neutral-500">{c('stepOutput')}</div><Json value={s.output} maxH="max-h-48" /></div>}
              </div>
            </details>
          </li>
        );
      })}
    </ol>
  );
}

/** A run with its steps; follows the live stream while the run is still going. */
export function useLiveRun(initial: Run | null) {
  const [run, setRun] = useState<Run | null>(initial);
  const [steps, setSteps] = useState<RunStep[]>(initial?.steps ?? []);
  const [lost, setLost] = useState(false);
  useEffect(() => {
    setRun(initial); setSteps(initial?.steps ?? []); setLost(false);
    if (!initial || FINISHED.includes(initial.status)) return;
    const stop = streamRun(initial.id, {
      step: (s) => setSteps((prev) => upsertStep(prev, s)),
      run: (r) => setRun((prev) => ({ ...(prev ?? r), ...r, steps: undefined })),
      end: () => capi<Run>(`/runs/${initial.id}`).then((r) => { setRun(r); if (r.steps) setSteps(r.steps); }).catch(() => undefined),
      error: () => setLost(true),
    });
    return stop;
  }, [initial]);
  return { run, steps, lost };
}

/** Run view used by Test and the run drawer: summary, response, timeline and a raw JSON switch. */
export function RunView({ run: initial, onStatus }: { run: Run; onStatus?: (s: Run['status']) => void }) {
  const { c } = useC();
  const { run, steps, lost } = useLiveRun(initial);
  useEffect(() => { if (run) onStatus?.(run.status); }, [run?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const [view, setView] = useState<'timeline' | 'raw'>('timeline');
  if (!run) return null;
  return (
    <div className="space-y-4">
      {lost && <Notice tone="amber">{c('streamLost')}</Notice>}
      {run.status === 'waiting_approval' && <Notice tone="amber">{c('waitingApprovalNote')} <Link href="/approvals" className="font-medium underline">{c('openApprovals')}</Link></Notice>}
      <RunSummary run={run} steps={steps} />
      {run.error && <ErrorBox error={{ message: run.error.message }} />}
      {run.output !== undefined && run.output !== null && (
        <section>
          <h3 className="mb-1 text-sm font-medium">{c('response')}</h3>
          {typeof run.output === 'string' ? <p dir="auto" className="whitespace-pre-wrap rounded-md bg-neutral-50 p-3 text-sm dark:bg-neutral-900">{run.output}</p> : <Json value={run.output} maxH="max-h-64" />}
        </section>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex-1 text-sm font-medium">{c('timeline')}{!FINISHED.includes(run.status) && <span className="ms-2 badge bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">{c('live')}</span>}</h3>
        <Segmented label={c('rawJson')} value={view} onChange={setView} options={[{ id: 'timeline', label: c('timeline') }, { id: 'raw', label: c('rawJson') }]} />
      </div>
      {view === 'timeline' ? <RunTimeline steps={steps} /> : <Json value={{ ...run, steps }} maxH="max-h-[32rem]" />}
    </div>
  );
}

/** Loads one run by id and shows it in a side drawer. */
export function RunDrawer({ runId, onClose }: { runId: string | null; onClose: () => void }) {
  const { c } = useC();
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setRun(null); setError(null);
    if (runId) capi<Run>(`/runs/${runId}`).then(setRun).catch(setError);
  }, [runId]);
  return (
    <Drawer open={!!runId} onClose={onClose} title={c('runDetail')} wide>
      <ErrorBox error={error} />
      {!run && !error && <p className="text-sm text-neutral-500">{c('loading')}</p>}
      {run && (
        <div className="space-y-4">
          <div className="text-xs text-neutral-500"><span>{c('runId')}: </span><code dir="ltr" className="font-mono">{run.id}</code></div>
          <details><summary className="cursor-pointer text-sm font-medium">{c('input')}</summary><div className="mt-2"><Json value={run.input} maxH="max-h-48" /></div></details>
          <RunView run={run} />
        </div>
      )}
    </Drawer>
  );
}

/** Table of runs. `agentNames` adds the agent column. */
export function RunsTable({ runs, agentNames, onSelect }: { runs: Run[]; agentNames?: Record<string, string>; onSelect: (id: string) => void }) {
  const { c, cd, locale } = useC();
  return (
    <TableCard>
      <thead><tr>
        <Th>{c('started')}</Th>{agentNames && <Th>{c('agent')}</Th>}<Th>{c('status')}</Th><Th>{c('source')}</Th><Th>{c('duration')}</Th><Th>{c('tokens')}</Th><Th end>{c('runId')}</Th>
      </tr></thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id} className="border-t border-neutral-100 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900/60">
            <Td className="whitespace-nowrap">
              <button type="button" className="text-start font-medium text-blue-700 hover:underline focus-visible:underline focus-visible:outline-none dark:text-blue-400" onClick={() => onSelect(r.id)}>{fmtDate(r.startedAt, locale)}</button>
            </Td>
            {agentNames && <Td className="whitespace-nowrap">{agentNames[r.agentId] ? <Link className="hover:underline" href={`/connect/agents/${r.agentId}`}>{agentNames[r.agentId]}</Link> : '—'}</Td>}
            <Td><Status status={r.status} /></Td>
            <Td className="whitespace-nowrap text-neutral-600 dark:text-neutral-300">{cd('src_', r.source)}</Td>
            <Td className="whitespace-nowrap tabular-nums">{fmtMs(r.durationMs)}</Td>
            <Td className="whitespace-nowrap tabular-nums">{r.usage ? fmtNum(r.usage.inputTokens + r.usage.outputTokens, locale) : '—'}</Td>
            <Td className="text-end"><code dir="ltr" className="font-mono text-xs text-neutral-500">{r.id.slice(0, 10)}</code></Td>
          </tr>
        ))}
      </tbody>
    </TableCard>
  );
}
