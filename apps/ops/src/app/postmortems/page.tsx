'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import type { Postmortem } from '@/lib/types';
import { useLoad } from '@/lib/use-load';
import { useShell } from '@/components/ctx';
import { Badge, Card, Countdown, Empty, ErrorNote, Loading, PageTitle, StatusBadge, TicketLink, Time } from '@/components/ui';

export default function PostmortemsPage() {
  const { t, contractName } = useShell();
  const [status, setStatus] = useState('');
  const list = useLoad(() => api<{ data: Postmortem[] }>(`/ops/v1/postmortems${status ? `?status=${status}` : ''}`), [status]);

  return (
    <div>
      <PageTitle title={t('navPostmortems')} sub={t('postmortemsLead')}>
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('status')}>
          <option value="">{t('allStatuses')}</option>
          {['DRAFT', 'SUBMITTED', 'CLOSED'].map((s) => <option key={s} value={s}>{t(`st_${s}` as 'st_DRAFT')}</option>)}
        </select>
      </PageTitle>
      <Card>
        <ErrorNote error={list.error} />
        {!list.data ? <Loading /> : !list.data.data.length ? <Empty>{t('noPostmortems')}</Empty> : (
          <div className="-mx-2 overflow-x-auto">
            <table className="table">
              <thead><tr><th>{t('ticket')}</th><th className="w-full">{t('subject')}</th><th>{t('status')}</th><th>{t('due')}</th></tr></thead>
              <tbody>
                {list.data.data.map((p) => (
                  <tr key={p.id}>
                    <td><TicketLink ticket={p.ticket} /></td>
                    <td><Link href={`/postmortems/${p.id}`} className="font-medium hover:underline"><bdi>{p.ticket.subject}</bdi></Link><div className="text-xs text-neutral-500">{contractName(p.contractId)}</div></td>
                    <td><StatusBadge status={p.status} /> {p.overdue && <Badge color="red">{t('overdue')}</Badge>}</td>
                    <td className="whitespace-nowrap">{p.status === 'DRAFT' ? <Countdown to={p.dueAt} seconds={false} /> : <Time value={p.submittedAt} contractId={p.contractId} mode="date" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
