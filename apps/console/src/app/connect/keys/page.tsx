'use client';

import Link from 'next/link';
import { loadAgentDetails } from '@/lib/connect';
import { KeysSection } from '@/components/connect/agent/deploy';
import { Empty, ErrorBox, PageHeader, useC, useLoad } from '@/components/connect/ui';

export default function KeysPage() {
  const { c } = useC();
  const { data, error, reload } = useLoad(loadAgentDetails, []);
  return (
    <div>
      <PageHeader title={c('keysTitle')} subtitle={c('keysNote')} actions={<Link href="/agents" className="btn-ghost">{c('teamTokens')}</Link>} />
      <div className="space-y-4">
        <ErrorBox error={error} />
        {!data && !error && <p className="text-sm text-neutral-500">{c('loading')}</p>}
        {data && data.length === 0 && <Empty title={c('createAgentFirst')} action={<Link className="btn-primary" href="/connect/agents/new">{c('createAgent')}</Link>} />}
        {data?.map((a) => <KeysSection key={a.id} agentId={a.id} agentName={a.name} keys={a.keys} reload={reload} />)}
      </div>
    </div>
  );
}
