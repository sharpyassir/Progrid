'use client';

import { useState } from 'react';
import { money } from '@/lib/api';
import { AgentVersion, capi, fmtDate, fmtMs, fmtNum, Page, post, Run, UsageReport } from '@/lib/connect';
import { RunDrawer, RunsTable } from '../runs';
import { Empty, ErrorBox, Notice, useAction, useC, useLoad } from '../ui';
import { RunFilters, usePagedRuns } from '../run-filters';
import type { AgentTabProps } from './types';

export function LogsTab({ agent }: AgentTabProps) {
  const { c } = useC();
  const [runId, setRunId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const { runs, error, more, loadMore } = usePagedRuns(`/agents/${agent.id}/runs`, filters);
  return (
    <div className="space-y-3">
      <RunFilters value={filters} onChange={setFilters} dates={false} />
      <ErrorBox error={error} />
      {runs && runs.length === 0 && <p className="card text-sm text-neutral-500">{c('noRunsMatch')}</p>}
      {runs && runs.length > 0 && <RunsTable runs={runs} onSelect={setRunId} />}
      {more && <button type="button" className="btn-ghost" onClick={loadMore}>{c('loadMore')}</button>}
      <RunDrawer runId={runId} onClose={() => setRunId(null)} />
    </div>
  );
}

export function UsageTab({ agent }: AgentTabProps) {
  const { c, locale } = useC();
  const usage = useLoad(() => capi<UsageReport>(`/usage?period=${new Date().toISOString().slice(0, 7)}`), []);
  const runs = useLoad(() => capi<Page<Run>>(`/agents/${agent.id}/runs`).then((r) => r.data), [agent.id]);
  const row = usage.data?.byAgent.find((r) => r.agentId === agent.id);
  const list = runs.data ?? [];
  const avg = list.length ? Math.round(list.reduce((n, r) => n + (r.durationMs ?? 0), 0) / list.length) : null;
  const cards: [string, string][] = [
    [c('executions'), fmtNum(row?.executions ?? null, locale)],
    [c('aiInput'), fmtNum(row?.aiInputTokens ?? null, locale)],
    [c('aiOutput'), fmtNum(row?.aiOutputTokens ?? null, locale)],
    [c('toolCalls'), fmtNum(row?.toolCalls ?? null, locale)],
    [c('avgDuration'), fmtMs(avg)],
    [c('estimatedCost'), usage.data && !usage.data.pricingConfigured ? c('pricingNotSet') : row?.estimatedCostMinor != null && usage.data ? money(row.estimatedCostMinor, usage.data.currency, locale) : '—'],
  ];
  return (
    <div className="space-y-3">
      <p className="text-sm text-neutral-500">{c('agentUsageNote')} {usage.data && <span dir="ltr">({usage.data.period})</span>}</p>
      <ErrorBox error={usage.error} />
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {cards.map(([k, v]) => <div key={k} className="card min-w-0"><dt className="text-xs text-neutral-500">{k}</dt><dd className="mt-1 truncate text-xl font-semibold tabular-nums">{v}</dd></div>)}
      </dl>
    </div>
  );
}

export function VersionsTab({ agent, reload }: AgentTabProps) {
  const { c, cf, locale } = useC();
  const versions = useLoad(() => capi<{ data: AgentVersion[] }>(`/agents/${agent.id}/versions`).then((r) => r.data), [agent.id, agent.currentVersion]);
  const { busy, error, run } = useAction();
  const [notice, setNotice] = useState<string | null>(null);
  async function deploy(v: number) {
    const r = await run(() => post(`/agents/${agent.id}/deploy`, { version: v }));
    if (r !== undefined) { await reload(); setNotice(c('deployedOk')); }
  }
  if (versions.data && versions.data.length === 0) return <Empty title={c('noVersions')} />;
  return (
    <div className="space-y-3">
      <ErrorBox error={error ?? versions.error} />
      {notice && <Notice>{notice}</Notice>}
      <ol className="space-y-2">
        {versions.data?.map((v) => (
          <li key={v.version} className="card flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="font-mono text-sm font-semibold" dir="ltr">{cf('versionN')(v.version)}</span>
            {agent.deployedVersion === v.version && agent.status === 'deployed' && <span className="badge bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">{c('liveBadge')}</span>}
            <span className="min-w-0 flex-1 text-sm">{v.note || '—'}</span>
            <span className="text-xs text-neutral-500">{c('createdBy')} {v.createdBy} · {fmtDate(v.createdAt, locale)}</span>
            {!(agent.deployedVersion === v.version && agent.status === 'deployed') && <button type="button" className="btn-ghost px-2 py-1 text-xs" disabled={busy} onClick={() => deploy(v.version)}>{c('deployThis')}</button>}
          </li>
        ))}
      </ol>
    </div>
  );
}
