'use client';

import { useState } from 'react';
import { Agent, capi } from '@/lib/connect';
import { RunDrawer, RunsTable } from '@/components/connect/runs';
import { RunFilters, usePagedRuns } from '@/components/connect/run-filters';
import { ErrorBox, PageHeader, useC, useLoad } from '@/components/connect/ui';

export default function LogsPage() {
  const { c } = useC();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [runId, setRunId] = useState<string | null>(null);
  const agents = useLoad(() => capi<{ data: Agent[] }>('/agents').then((r) => r.data), []).data ?? [];
  const names = Object.fromEntries(agents.map((a) => [a.id, a.name]));
  const { runs, error, more, loadMore } = usePagedRuns('/logs', filters);
  return (
    <div>
      <PageHeader title={c('nLogs')} subtitle={c('logsNote')} />
      <div className="space-y-3">
        <RunFilters value={filters} onChange={setFilters} agents={agents} />
        <ErrorBox error={error} />
        {!runs && !error && <p className="text-sm text-neutral-500">{c('loading')}</p>}
        {runs && runs.length === 0 && <p className="card text-sm text-neutral-500">{c('noRunsMatch')}</p>}
        {runs && runs.length > 0 && <RunsTable runs={runs} agentNames={names} onSelect={setRunId} />}
        {more && <button type="button" className="btn-ghost" onClick={loadMore}>{c('loadMore')}</button>}
      </div>
      <RunDrawer runId={runId} onClose={() => setRunId(null)} />
    </div>
  );
}
