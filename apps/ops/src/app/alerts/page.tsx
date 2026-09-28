'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, post } from '@/lib/api';
import type { Alert, Severity } from '@/lib/types';
import { useLoad } from '@/lib/use-load';
import { useShell } from '@/components/ctx';
import { Badge, Card, Elapsed, Empty, ErrorNote, Loading, PageTitle, StatusBadge, Time, useAction } from '@/components/ui';

const SEVERITIES: Severity[] = ['CRITICAL', 'WARNING', 'INFO'];
const POLL_MS = 15_000;

/** Live alerts on the engineer's contracts, polled every 15 seconds. */
export default function AlertsPage() {
  const { t, contractName } = useShell();
  const [status, setStatus] = useState<'open' | 'FIRING' | 'all'>('open');
  const alerts = useLoad(() => api<{ data: Alert[] }>(`/ops/v1/alerts?status=${status}`), [status], { pollMs: POLL_MS });
  const { busy, run } = useAction();

  const ack = (a: Alert) => run(a.id, () => post(`/ops/v1/alerts/${a.id}/ack`), t('alertAcked')).then(() => alerts.reload());

  return (
    <div>
      <PageTitle title={t('navAlerts')} sub={t('alertsLead')}>
        <div className="flex rounded-md border border-neutral-300 p-0.5 text-sm dark:border-neutral-700" role="tablist">
          {(['open', 'FIRING', 'all'] as const).map((s) => (
            <button key={s} role="tab" aria-selected={status === s} className={`rounded px-3 py-1 ${status === s ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : ''}`} onClick={() => setStatus(s)}>
              {t(`alertFilter_${s}`)}
            </button>
          ))}
        </div>
        <span className="flex items-center gap-1.5 text-xs text-neutral-500"><span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />{t('live')}</span>
      </PageTitle>
      <ErrorNote error={alerts.error} />
      {!alerts.data ? <Loading /> : (
        <div className="grid gap-5 lg:grid-cols-3">
          {SEVERITIES.map((sev) => {
            const list = alerts.data!.data.filter((a) => a.severity === sev);
            return (
              <Card key={sev} title={<span className="flex items-center gap-2"><StatusBadge status={sev} /> <span>{list.length}</span></span>}>
                {!list.length ? <Empty>{t('noAlerts')}</Empty> : (
                  <ul className="space-y-3">
                    {list.map((a) => (
                      <li key={a.id} className={`rounded-md border p-3 text-sm ${a.status === 'FIRING' ? 'border-red-300 dark:border-red-900' : 'border-neutral-200 dark:border-neutral-800'}`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-medium" dir="ltr">{a.name}</span>
                          <StatusBadge status={a.status} />
                        </div>
                        {a.summary && <p dir="auto" className="mt-1 text-start text-neutral-700 dark:text-neutral-300">{a.summary}</p>}
                        <p className="mt-1 text-xs text-neutral-500">
                          {[contractName(a.contractId), a.asset?.name].filter(Boolean).join(' · ')} · <Time value={a.startsAt} contractId={a.contractId} />
                          {a.status === 'FIRING' && <> · {t('firingFor')} <Elapsed from={a.startsAt} /></>}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {a.status === 'FIRING' && <button className="btn-danger" disabled={busy === a.id} onClick={() => ack(a)}>{t('ackAndTake')}</button>}
                          {a.ticketId && <Link className="btn-ghost" href={`/tickets/${a.ticketId}`}>{t('openTicket')}</Link>}
                          {a.assetId && <Link className="text-xs text-blue-600 hover:underline" href={`/assets/${a.assetId}`}>{t('viewAsset')}</Link>}
                          {a.acknowledgedAt && <Badge color="amber">{t('ackedAt')} <Time value={a.acknowledgedAt} mode="time" /></Badge>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
