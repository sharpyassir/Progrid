'use client';

import Link from 'next/link';
import { fmtDate, loadAgentDetails } from '@/lib/connect';
import { AgentStatusDot, Empty, ErrorBox, PageHeader, useC, useLoad } from '@/components/connect/ui';

const ICON: Record<string, string> = { trigger: '⚡', agent: '✦', tool: '⚙', condition: '⑂', action: '➤', transform: '{ }', end: '■' };

export default function WorkflowsPage() {
  const { c, cf, cd, locale } = useC();
  const { data, error } = useLoad(loadAgentDetails, []);
  const withWf = (data ?? []).filter((a) => a.workflow);
  const without = (data ?? []).filter((a) => !a.workflow);
  return (
    <div>
      <PageHeader title={c('workflowsTitle')} subtitle={c('workflowsNote')} />
      <div className="space-y-6">
        <ErrorBox error={error} />
        {!data && !error && <p className="text-sm text-neutral-500">{c('loading')}</p>}
        {data && withWf.length === 0 && <Empty title={c('noWorkflows')} body={c('noWorkflow')} action={<Link className="btn-primary" href={data.length ? `/connect/agents/${data[0].id}?tab=workflow` : '/connect/agents/new'}>{data.length ? c('addWorkflow') : c('createAgent')}</Link>} />}
        <ul className="grid gap-3 lg:grid-cols-2">
          {withWf.map((a) => {
            const g = a.workflow!.graph;
            const types = [...new Set(g.nodes.map((n) => n.type))];
            return (
              <li key={a.id} className="card flex flex-col gap-2">
                <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate font-medium">{a.name}</span><AgentStatusDot status={a.status} /></div>
                <p className="text-sm text-neutral-500">{cf('nodesN')(g.nodes.length)} · {c('updated')} {fmtDate(a.workflow!.updatedAt, locale)}</p>
                <ul className="flex flex-wrap gap-1.5" aria-label={c('steps')}>
                  {types.map((t) => <li key={t} className="badge bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300"><span aria-hidden>{ICON[t]}</span> {cd('node_', t)}</li>)}
                </ul>
                <Link href={`/connect/agents/${a.id}?tab=workflow`} className="btn-ghost mt-auto self-start">{c('openEditor')}</Link>
              </li>
            );
          })}
        </ul>
        {without.length > 0 && (
          <section>
            <h2 className="mb-2 font-semibold">{c('withoutWorkflow')}</h2>
            <ul className="divide-y divide-neutral-100 rounded-lg border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
              {without.map((a) => (
                <li key={a.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  <Link href={`/connect/agents/${a.id}?tab=workflow`} className="text-blue-700 hover:underline dark:text-blue-400">{c('addWorkflow')}</Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
