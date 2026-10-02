'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { AgentDetail, capi } from '@/lib/connect';
import { AgentStatusDot, ErrorBox, PageHeader, TabBar, useC } from '@/components/connect/ui';
import { OverviewTab } from '@/components/connect/agent/overview';
import { InstructionsTab } from '@/components/connect/agent/instructions';
import { ToolsTab } from '@/components/connect/agent/tools';
import { WorkflowTab } from '@/components/connect/agent/workflow';
import { TestTab } from '@/components/connect/agent/test';
import { DeployTab } from '@/components/connect/agent/deploy';
import { ApiTab } from '@/components/connect/agent/api';
import { LogsTab, UsageTab, VersionsTab } from '@/components/connect/agent/history';

const TABS = ['overview', 'instructions', 'tools', 'workflow', 'test', 'deploy', 'api', 'logs', 'usage', 'versions'] as const;
type Tab = (typeof TABS)[number];

export default function AgentPage() {
  return <Suspense fallback={null}><Agent /></Suspense>;
}

function Agent() {
  const { id } = useParams<{ id: string }>();
  const { c, cd } = useC();
  const router = useRouter();
  const params = useSearchParams();
  const tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'overview';
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [error, setError] = useState<unknown>(null);

  const reload = useCallback(async () => {
    try { setAgent(await capi<AgentDetail>(`/agents/${id}`)); setError(null); }
    catch (e) { if (e instanceof ApiError && e.status === 404) router.replace('/connect/agents'); else setError(e); }
  }, [id, router]);
  useEffect(() => { reload(); }, [reload]);
  const setTab = (t: Tab) => router.replace(`/connect/agents/${id}?tab=${t}`, { scroll: false });

  if (!agent) return error ? <ErrorBox error={error} /> : <p className="text-sm text-neutral-500">{c('loading')}</p>;
  const props = { agent, reload, setTab };
  return (
    <div>
      <PageHeader back={{ href: '/connect/agents', label: c('agentsTitle') }}
        title={<span className="flex flex-wrap items-center gap-3"><span dir="auto">{agent.name}</span><AgentStatusDot status={agent.status} /></span>}
        subtitle={agent.description ? <span dir="auto">{agent.description}</span> : undefined}
        actions={<>
          <button type="button" className="btn-ghost" onClick={() => setTab('test')}>{c('tTest')}</button>
          <button type="button" className="btn-primary" onClick={() => setTab('deploy')}>{c('tDeploy')}</button>
        </>} />
      <TabBar label={c('agentTabs')} value={tab} onChange={setTab} tabs={TABS.map((t) => ({ id: t, label: cd('t', t.charAt(0).toUpperCase() + t.slice(1)) }))} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="min-w-0">
        {tab === 'overview' && <OverviewTab {...props} />}
        {tab === 'instructions' && <InstructionsTab {...props} />}
        {tab === 'tools' && <ToolsTab {...props} />}
        {tab === 'workflow' && <WorkflowTab {...props} />}
        {tab === 'test' && <TestTab {...props} />}
        {tab === 'deploy' && <DeployTab {...props} />}
        {tab === 'api' && <ApiTab {...props} />}
        {tab === 'logs' && <LogsTab {...props} />}
        {tab === 'usage' && <UsageTab {...props} />}
        {tab === 'versions' && <VersionsTab {...props} />}
      </div>
    </div>
  );
}
