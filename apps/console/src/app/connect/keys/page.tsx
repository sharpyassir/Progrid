'use client';

import Link from 'next/link';
import { Agent, AgentKey, capi } from '@/lib/connect';
import { KeysSection } from '@/components/connect/agent/deploy';
import { Empty, ErrorBox, PageHeader, useC, useLoad } from '@/components/connect/ui';

export default function KeysPage() {
  const { c } = useC();
  // GET /keys lists every agent's active keys; agents without keys still get a section to create one.
  const { data, error, reload } = useLoad(async () => {
    const [agents, keys] = await Promise.all([capi<{ data: Agent[] }>('/agents'), capi<{ data: AgentKey[] }>('/keys')]);
    return agents.data.map((a) => ({ agent: a, keys: keys.data.filter((k) => k.agentId === a.id) }));
  }, []);
  return (
    <div>
      <PageHeader title={c('keysTitle')} subtitle={c('keysNote')} actions={<Link href="/agents" className="btn-ghost">{c('teamTokens')}</Link>} />
      <div className="space-y-4">
        <ErrorBox error={error} />
        {!data && !error && <p className="text-sm text-neutral-500">{c('loading')}</p>}
        {data && data.length === 0 && <Empty title={c('createAgentFirst')} action={<Link className="btn-primary" href="/connect/agents/new">{c('createAgent')}</Link>} />}
        {data?.map(({ agent, keys }) => <KeysSection key={agent.id} agentId={agent.id} agentName={agent.name} keys={keys} reload={reload} />)}
      </div>
    </div>
  );
}
