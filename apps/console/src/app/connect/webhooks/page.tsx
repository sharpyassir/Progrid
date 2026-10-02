'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Agent, capi, del, patch, post, Webhook, WebhookSecrets } from '@/lib/connect';
import { HookSecretsOnce, WebhookRow } from '@/components/connect/agent/deploy';
import { Empty, ErrorBox, PageHeader, useAction, useC, useLoad } from '@/components/connect/ui';

export default function WebhooksPage() {
  const { c } = useC();
  const { data, error, reload } = useLoad(async () => {
    const [hooks, agents] = await Promise.all([capi<{ data: Webhook[] }>('/webhooks'), capi<{ data: Agent[] }>('/agents')]);
    return { hooks: hooks.data, agents: agents.data };
  }, []);
  const { error: actError, run } = useAction();
  const [fresh, setFresh] = useState<WebhookSecrets | null>(null);
  const base = (h: Webhook) => `/agents/${h.agentId}/webhooks/${h.id}`;
  return (
    <div>
      <PageHeader title={c('webhooksTitle')} subtitle={c('webhooksNote')} />
      <div className="space-y-3">
        <ErrorBox error={error ?? actError} />
        {fresh && <HookSecretsOnce hook={fresh} onDone={() => setFresh(null)} />}
        {!data && !error && <p className="text-sm text-neutral-500">{c('loading')}</p>}
        {data && data.hooks.length === 0 && <Empty title={c('noWebhooks')} body={c('cardWebhooksD')} action={data.agents.length ? <Link className="btn-primary" href={`/connect/agents/${data.agents[0].id}?tab=deploy`}>{c('addWebhook')}</Link> : <Link className="btn-primary" href="/connect/agents/new">{c('createAgent')}</Link>} />}
        <ul className="space-y-3">
          {data?.hooks.map((h) => (
            <WebhookRow key={h.id} h={h}
              agentLabel={<Link href={`/connect/agents/${h.agentId}?tab=deploy`} className="text-xs text-blue-700 hover:underline dark:text-blue-400">{h.agentName ?? data.agents.find((a) => a.id === h.agentId)?.name}</Link>}
              onToggle={() => run(async () => { await patch(base(h), { enabled: !h.enabled }); await reload(); })}
              onRotate={() => confirm(c('rotateConfirm')) && run(async () => { setFresh(await post<WebhookSecrets>(`${base(h)}/rotate`)); await reload(); })}
              onDelete={() => confirm(c('deleteWebhookConfirm')) && run(async () => { await del(base(h)); await reload(); })} />
          ))}
        </ul>
      </div>
    </div>
  );
}
