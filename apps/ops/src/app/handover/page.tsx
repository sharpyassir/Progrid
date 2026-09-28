'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { api, post } from '@/lib/api';
import type { Task, Ticket } from '@/lib/types';
import { useLoad } from '@/lib/use-load';
import { fmtDateTime } from '@/lib/time';
import { useShell } from '@/components/ctx';
import { Card, Empty, Field, Loading, PageTitle, PriorityBadge, StatusBadge, TicketLink, Time, useAction } from '@/components/ui';

/** End of shift: the handover form. Ending a shift requires it. */
export default function HandoverPage() {
  const { t, me, reloadMe, tz, locale } = useShell();
  const router = useRouter();
  const mine = useLoad(() => api<{ data: Ticket[] }>('/ops/v1/tickets?mine=true'), []);
  const others = useLoad(() => api<{ data: Ticket[] }>('/ops/v1/tickets'), []);
  const tasks = useLoad(() => api<{ data: Task[] }>('/ops/v1/maintenance/tasks'), []);
  const [extra, setExtra] = useState<string[]>([]);
  const [risks, setRisks] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const { busy, run } = useAction();

  // Prefill pending maintenance with what runs in the next 24 hours.
  useEffect(() => {
    if (pending !== null || !tasks.data) return;
    const soon = tasks.data.data.filter((x) => x.enabled && x.nextRunAt && new Date(x.nextRunAt).getTime() - Date.now() < 86_400_000);
    setPending(soon.map((x) => `- ${x.name}${x.asset ? ` (${x.asset.name})` : ''}: ${fmtDateTime(x.nextRunAt, tz, locale)}`).join('\n'));
  }, [tasks.data, pending, tz, locale]);

  const shift = me?.currentShift;
  const running = !!shift?.startedAt && !shift.endedAt;
  const myIds = new Set(mine.data?.data.map((x) => x.id));
  const unassigned = (others.data?.data ?? []).filter((x) => !myIds.has(x.id));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!shift) return;
    void run('end', () => post<{ grantsRevoked: number }>('/ops/v1/shifts/end', { shiftId: shift.id, handover: { risks, pendingMaintenance: pending ?? '', notes, ticketIds: extra } }), t('shiftEnded')).then(async (r) => {
      if (r) {
        await reloadMe();
        router.push('/');
      }
    });
  };

  if (!me) return <Loading />;

  return (
    <div className="max-w-4xl">
      <PageTitle title={t('navHandover')} sub={t('handoverLead')} />
      {!running && <p className="mb-4 rounded-md bg-neutral-100 px-3 py-2 text-sm dark:bg-neutral-800">{t('noRunningShift')}</p>}
      {running && shift && <p className="mb-4 text-sm text-neutral-600 dark:text-neutral-300">{t('shiftWindow')}: <Time value={shift.startedAt} /> - <Time value={shift.endsAt} /></p>}
      <form onSubmit={submit} className="space-y-4">
        <Card title={t('openTickets')}>
          <p className="mb-2 text-xs text-neutral-500">{t('handoverTicketsNote')}</p>
          {!mine.data ? <Loading /> : mine.data.data.length ? (
            <ul className="space-y-1.5 text-sm">
              {mine.data.data.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-2"><input type="checkbox" checked disabled aria-label={t('included')} /><TicketLink ticket={x} /><PriorityBadge priority={x.priority} /><span>{x.subject}</span><StatusBadge status={x.status} /></li>
              ))}
            </ul>
          ) : <Empty>{t('noOpenTicketsOfYours')}</Empty>}
          {unassigned.length > 0 && (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm text-blue-600">{t('addOtherTickets', { n: unassigned.length })}</summary>
              <ul className="mt-2 space-y-1.5 text-sm">
                {unassigned.map((x) => (
                  <li key={x.id}>
                    <label className="flex flex-wrap items-center gap-2">
                      <input type="checkbox" checked={extra.includes(x.id)} onChange={(e) => setExtra((ids) => (e.target.checked ? [...ids, x.id] : ids.filter((i) => i !== x.id)))} />
                      <TicketLink ticket={x} /><PriorityBadge priority={x.priority} /><span>{x.subject}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Card>
        <Card>
          <div className="space-y-4">
            <Field label={t('risks')} hint={t('risksHint')}>
              <textarea className="input min-h-24" maxLength={10000} value={risks} onChange={(e) => setRisks(e.target.value)} />
            </Field>
            <Field label={t('pendingMaintenance')} hint={t('pendingHint')}>
              <textarea className="input min-h-24" maxLength={10000} value={pending ?? ''} onChange={(e) => setPending(e.target.value)} />
            </Field>
            <Field label={t('notes')}>
              <textarea className="input min-h-32" maxLength={20000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
        </Card>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" disabled={!running || busy === 'end'}>{t('endShiftWithHandover')}</button>
          <span className="text-xs text-neutral-500">{t('endShiftNote')}</span>
        </div>
      </form>
    </div>
  );
}
