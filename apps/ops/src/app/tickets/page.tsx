'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import type { Ticket } from '@/lib/types';
import { useLoad } from '@/lib/use-load';
import { useShell } from '@/components/ctx';
import { TicketTable } from '@/components/ops';
import { Card, ErrorNote, Loading, PageTitle } from '@/components/ui';

const STATUSES = ['open', 'answered', 'resolved_pending_pm', 'closed', 'all'] as const;

export default function TicketsPage() {
  const { t, me } = useShell();
  const [mine, setMine] = useState(true);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('open');
  const [priority, setPriority] = useState('');
  const [contractId, setContractId] = useState('');
  const q = new URLSearchParams({ status, ...(mine ? { mine: 'true' } : {}), ...(priority ? { priority } : {}), ...(contractId ? { contractId } : {}) });
  const tickets = useLoad(() => api<{ data: Ticket[] }>(`/ops/v1/tickets?${q}`), [q.toString()], { pollMs: 30_000 });

  return (
    <div>
      <PageTitle title={t('navTickets')} sub={t('ticketsLead')} />
      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-neutral-300 p-0.5 text-sm dark:border-neutral-700">
            <button className={`rounded px-3 py-1 ${mine ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : ''}`} onClick={() => setMine(true)}>{t('mine')}</button>
            <button className={`rounded px-3 py-1 ${!mine ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : ''}`} onClick={() => setMine(false)}>{t('allAssigned')}</button>
          </div>
          <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label={t('status')}>
            {STATUSES.map((s) => <option key={s} value={s}>{t(`ticketFilter_${s}`)}</option>)}
          </select>
          <select className="input w-auto" value={priority} onChange={(e) => setPriority(e.target.value)} aria-label={t('priority')}>
            <option value="">{t('anyPriority')}</option>
            {['P1', 'P2', 'P3', 'P4'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          {me && me.contracts.length > 1 && (
            <select className="input w-auto" value={contractId} onChange={(e) => setContractId(e.target.value)} aria-label={t('contract')}>
              <option value="">{t('allContracts')}</option>
              {me.contracts.map((c) => <option key={c.id} value={c.id}>{c.customer}</option>)}
            </select>
          )}
        </div>
        <ErrorNote error={tickets.error} />
        {!tickets.data ? <Loading /> : <TicketTable tickets={tickets.data.data} showAssignee={!mine} />}
      </Card>
    </div>
  );
}
