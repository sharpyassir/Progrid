'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import type { Grant } from '@/lib/types';
import { useLoad } from '@/lib/use-load';
import { useShell } from '@/components/ctx';
import { GrantLine } from '@/components/ops';
import { Card, Empty, ErrorNote, Loading, PageTitle, StatusBadge, TicketLink, Time, useUnits } from '@/components/ui';
import { fmtDuration } from '@/lib/time';

const FILTERS = ['live', 'REQUESTED', 'ACTIVE', 'EXPIRED', 'REVOKED', 'DENIED', 'all'] as const;

interface SessionRow { id: string; grantId: string; asset?: { id: string; name: string }; ticket: { id: string; number: number } | null; status: string; startedAt: string | null; endedAt: string | null; durationSeconds: number | null; endReason: string | null; contractId: string; createdAt: string }

/** My access grants and terminal sessions. */
export default function AccessPage() {
  const { t } = useShell();
  const units = useUnits();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('live');
  const grants = useLoad(() => api<{ data: Grant[] }>(`/ops/v1/access/grants${filter === 'all' ? '' : `?status=${filter}`}`), [filter], { pollMs: 30_000 });
  const sessions = useLoad(() => api<{ data: SessionRow[] }>('/ops/v1/sessions'), []);

  return (
    <div className="space-y-5">
      <PageTitle title={t('navAccess')} sub={t('accessLead')} />
      <Card
        title={t('myGrants')}
        actions={
          <select className="input w-auto py-1" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label={t('status')}>
            {FILTERS.map((f) => <option key={f} value={f}>{t(`grantFilter_${f}`)}</option>)}
          </select>
        }
      >
        <ErrorNote error={grants.error} />
        {!grants.data ? <Loading /> : grants.data.data.length ? (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">{grants.data.data.map((g) => <GrantLine key={g.id} grant={g} onChange={grants.reload} />)}</ul>
        ) : <Empty>{t('noGrants')}</Empty>}
      </Card>
      <Card title={t('mySessions')}>
        <p className="mb-3 text-xs text-neutral-500">{t('sessionsRecordedNote')}</p>
        {!sessions.data ? <Loading /> : sessions.data.data.length ? (
          <div className="-mx-2 overflow-x-auto">
            <table className="table">
              <thead><tr><th>{t('asset')}</th><th>{t('ticket')}</th><th>{t('status')}</th><th>{t('started')}</th><th>{t('duration')}</th><th>{t('endReason')}</th></tr></thead>
              <tbody>
                {sessions.data.data.map((s) => (
                  <tr key={s.id}>
                    <td>{s.asset?.name}</td>
                    <td><TicketLink ticket={s.ticket} /></td>
                    <td><StatusBadge status={s.status} /></td>
                    <td><Time value={s.startedAt ?? s.createdAt} contractId={s.contractId} /></td>
                    <td className="tabular-nums">{s.durationSeconds != null ? fmtDuration(s.durationSeconds, units, false) : '-'}</td>
                    <td className="text-neutral-500">{s.endReason ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>{t('noSessions')}</Empty>}
      </Card>
    </div>
  );
}
