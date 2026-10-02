'use client';

import Link from 'next/link';
import { del, loadAgentDetails, patch, post, Webhook } from '@/lib/connect';
import { WebhookRow } from '@/components/connect/agent/deploy';
import { Empty, ErrorBox, PageHeader, useAction, useC, useLoad } from '@/components/connect/ui';

export default function WebhooksPage() {
  const { c } = useC();
  const { data, error, reload } = useLoad(loadAgentDetails, []);
  const { error: actError, run } = useAction();
  const all = (data ?? []).flatMap((a) => a.webhooks.map((h) => ({ h, agent: a })));
  const base = (h: Webhook) => `/agents/${h.agentId}/webhooks/${h.id}`;
  return (
    <div>
      <PageHeader title={c('webhooksTitle')} subtitle={c('webhooksNote')} />
      <div className="space-y-3">
        <ErrorBox error={error ?? actError} />
        {!data && !error && <p className="text-sm text-neutral-500">{c('loading')}</p>}
        {data && all.length === 0 && <Empty title={c('noWebhooks')} body={c('cardWebhooksD')} action={data.length ? <Link className="btn-primary" href={`/connect/agents/${data[0].id}?tab=deploy`}>{c('addWebhook')}</Link> : <Link className="btn-primary" href="/connect/agents/new">{c('createAgent')}</Link>} />}
        <ul className="space-y-3">
          {all.map(({ h, agent }) => (
            <WebhookRow key={h.id} h={h}
              agentLabel={<Link href={`/connect/agents/${agent.id}?tab=deploy`} className="text-xs text-blue-700 hover:underline dark:text-blue-400">{agent.name}</Link>}
              onToggle={() => run(async () => { await patch(base(h), { enabled: !h.enabled }); await reload(); })}
              onRotate={() => confirm(c('rotateConfirm')) && run(async () => { await post(`${base(h)}/rotate`); await reload(); })}
              onDelete={() => confirm(c('deleteWebhookConfirm')) && run(async () => { await del(base(h)); await reload(); })} />
          ))}
        </ul>
      </div>
    </div>
  );
}
