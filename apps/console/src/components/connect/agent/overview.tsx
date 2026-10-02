'use client';

import { useRouter } from 'next/navigation';
import { capi, del, fmtDate, fmtMs, Page, Run } from '@/lib/connect';
import { CopyField, ErrorBox, FourSteps, useAction, useC, useLoad } from '../ui';
import type { AgentTabProps } from './types';

export function OverviewTab({ agent }: AgentTabProps) {
  const { c, cf, cd, locale } = useC();
  const router = useRouter();
  const runs = useLoad(() => capi<Page<Run>>(`/agents/${agent.id}/runs`).then((r) => r.data), [agent.id]);
  const { busy, error, run } = useAction();
  const day = Date.now() - 864e5;
  const recent = (runs.data ?? []).filter((r) => Date.parse(r.startedAt) >= day);
  const done = recent.filter((r) => r.status === 'succeeded' || r.status === 'failed');
  const ok = done.filter((r) => r.status === 'succeeded').length;
  const durations = recent.map((r) => r.durationMs).filter((x): x is number => x != null);
  const base = `/connect/agents/${agent.id}?tab=`;
  const steps = [true, agent.tools.length > 0, (runs.data ?? []).some((r) => r.source === 'test'), agent.status === 'deployed'];

  async function remove() {
    if (!confirm(c('deleteAgentConfirm'))) return;
    const r = await run(() => del(`/agents/${agent.id}`));
    if (r !== undefined) router.push('/connect/agents');
  }

  const rows: [string, React.ReactNode][] = [
    [c('status'), cd('st_', agent.status)],
    [c('agentId'), <CopyField key="id" value={agent.id} label={c('agentId')} />],
    [c('endpoint'), <CopyField key="ep" value={agent.runEndpoint} label={c('endpoint')} />],
    [c('model'), <code key="m" dir="ltr" className="font-mono text-xs">{agent.model}</code>],
    [c('latestVersion'), agent.currentVersion ? cf('versionN')(agent.currentVersion) : '—'],
    [c('deployedVersion'), agent.deployedVersion ? cf('versionN')(agent.deployedVersion) : c('notDeployed')],
    [c('tools'), cf('toolsN')(agent.tools.length)],
    [c('lastRun'), agent.lastRunAt ? fmtDate(agent.lastRunAt, locale) : c('never')],
  ];
  return (
    <div className="space-y-6">
      {!steps.every(Boolean) && (
        <section>
          <h2 className="mb-3 font-semibold">{c('nextSteps')}</h2>
          <FourSteps done={steps} links={[`${base}instructions`, `${base}tools`, `${base}test`, `${base}deploy`]} />
        </section>
      )}
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <section className="card min-w-0">
          <dl className="divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
            {rows.map(([k, v]) => (
              <div key={k} className="grid gap-1 py-2 sm:grid-cols-[10rem_1fr] sm:items-center">
                <dt className="text-neutral-500">{k}</dt><dd className="min-w-0">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="card">
          <h2 className="mb-3 font-semibold">{c('last24h')}</h2>
          <dl className="grid grid-cols-3 gap-2 lg:grid-cols-1">
            <div><dt className="text-xs text-neutral-500">{c('runs')}</dt><dd className="text-xl font-semibold tabular-nums">{runs.data ? recent.length : '…'}</dd></div>
            <div><dt className="text-xs text-neutral-500">{c('successRate')}</dt><dd className="text-xl font-semibold tabular-nums">{done.length ? `${Math.round((ok / done.length) * 100)}%` : '—'}</dd></div>
            <div><dt className="text-xs text-neutral-500">{c('avgDuration')}</dt><dd className="text-xl font-semibold tabular-nums">{durations.length ? fmtMs(Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)) : '—'}</dd></div>
          </dl>
        </section>
      </div>
      <ErrorBox error={error ?? runs.error} />
      <div className="border-t border-neutral-200 pt-4 dark:border-neutral-800">
        <button type="button" className="btn-danger" disabled={busy} onClick={remove}>{c('deleteAgent')}</button>
      </div>
    </div>
  );
}
