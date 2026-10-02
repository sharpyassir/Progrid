'use client';

import Link from 'next/link';
import { Agent, capi, fmtDate } from '@/lib/connect';
import { AgentStatusDot, Empty, ErrorBox, FourSteps, PageHeader, TableCard, Td, Th, useC, useLoad } from '@/components/connect/ui';

export default function AgentsListPage() {
  const { c, cf, locale } = useC();
  const { data, error } = useLoad(() => capi<{ data: Agent[] }>('/agents').then((r) => r.data), []);
  return (
    <div>
      <PageHeader title={c('agentsTitle')} subtitle={c('agentsNote')} actions={<Link href="/connect/agents/new" className="btn-primary">+ {c('createAgent')}</Link>} />
      <ErrorBox error={error} className="mb-4" />
      {!data && !error && <p className="text-sm text-neutral-500">{c('loading')}</p>}
      {data && data.length === 0 && (
        <div className="space-y-4">
          <Empty title={c('noAgents')} body={c('emptyBody')} action={<Link href="/connect/agents/new" className="btn-primary">{c('createAgent')}</Link>} />
          <FourSteps links={['/connect/agents/new']} />
        </div>
      )}
      {data && data.length > 0 && (
        <TableCard>
          <thead><tr><Th>{c('name')}</Th><Th>{c('status')}</Th><Th>{c('model')}</Th><Th>{c('tools')}</Th><Th>{c('version')}</Th><Th>{c('lastRun')}</Th></tr></thead>
          <tbody>
            {data.map((a) => (
              <tr key={a.id} className="border-t border-neutral-100 dark:border-neutral-800">
                <Td className="min-w-48">
                  <Link href={`/connect/agents/${a.id}`} className="font-medium text-blue-700 hover:underline dark:text-blue-400">{a.name}</Link>
                  {a.description && <div className="max-w-sm truncate text-xs text-neutral-500"><bdi>{a.description}</bdi></div>}
                </Td>
                <Td><AgentStatusDot status={a.status} /></Td>
                <Td className="whitespace-nowrap"><code dir="ltr" className="font-mono text-xs">{a.model}</code></Td>
                <Td className="whitespace-nowrap">{cf('toolsN')(a.toolIds.length)}</Td>
                <Td className="whitespace-nowrap">{a.deployedVersion ? cf('versionN')(a.deployedVersion) : a.currentVersion ? cf('versionN')(a.currentVersion) : '—'}</Td>
                <Td className="whitespace-nowrap text-neutral-500">{a.lastRunAt ? fmtDate(a.lastRunAt, locale) : c('never')}</Td>
              </tr>
            ))}
          </tbody>
        </TableCard>
      )}
    </div>
  );
}
