'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { api, del, post } from '@/lib/api';
import type { Entry, Ticket, Timesheet, WorkLogStatus } from '@/lib/types';
import { useLoad } from '@/lib/use-load';
import { currentMonth, dayKey, fmtDate, fmtMinutes, nowLocalInput, zonedToUtc } from '@/lib/time';
import { useShell } from '@/components/ctx';
import { Badge, Card, Empty, ErrorNote, Field, Loading, PageTitle, StatusBadge, TicketLink, Time, useAction, useUnits } from '@/components/ui';

const STATUSES: WorkLogStatus[] = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PAID'];

export default function TimesheetPage() {
  const { t, tz, locale } = useShell();
  const units = useUnits();
  const [month, setMonth] = useState(() => currentMonth(tz));
  const [adding, setAdding] = useState(false);
  const sheet = useLoad(() => api<Timesheet>(`/ops/v1/timesheet?month=${month}`), [month]);
  const { busy, run } = useAction();

  const days = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of sheet.data?.entries ?? []) {
      const k = dayKey(e.startedAt ?? e.workedAt, tz);
      map.set(k, [...(map.get(k) ?? []), e]);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [sheet.data, tz]);

  const drafts = sheet.data?.entries.filter((e) => e.status === 'DRAFT').length ?? 0;

  const submit = () =>
    run('submit', () => post<{ submitted: number }>('/ops/v1/timesheet/submit', { month })).then((r) => {
      if (r) {
        void sheet.reload();
      }
    });

  return (
    <div className="space-y-5">
      <PageTitle title={t('navTimesheet')} sub={t('timesheetLead')}>
        <input type="month" className="input w-auto" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label={t('month')} dir="ltr" />
        <button className="btn-ghost" onClick={() => setAdding((a) => !a)}>{t('manualEntry')}</button>
        <button className="btn-primary" disabled={!drafts || busy === 'submit'} onClick={submit}>{t('submitMonth', { n: drafts })}</button>
      </PageTitle>

      {sheet.data && (
        <div className="flex flex-wrap gap-3">
          <div className="card min-w-40 py-3">
            <div className="text-xs text-neutral-500">{t('totalTime')}</div>
            <div className="text-xl font-semibold tabular-nums">{fmtMinutes(sheet.data.totals.minutes, units)}</div>
          </div>
          {STATUSES.filter((s) => sheet.data!.totals.byStatus[s]).map((s) => (
            <div key={s} className="card min-w-32 py-3">
              <StatusBadge status={s} />
              <div className="mt-1 text-lg font-semibold tabular-nums">{fmtMinutes(sheet.data!.totals.byStatus[s] ?? 0, units)}</div>
            </div>
          ))}
        </div>
      )}

      {adding && <ManualEntry onDone={() => { setAdding(false); void sheet.reload(); }} onCancel={() => setAdding(false)} />}

      <ErrorNote error={sheet.error} />
      {!sheet.data ? <Loading /> : !days.length ? <Card><Empty>{t('noEntries')}</Empty></Card> : (
        <div className="space-y-4">
          {days.map(([day, entries]) => (
            <Card key={day} title={fmtDate(`${day}T12:00:00Z`, 'UTC', locale)} actions={<span className="text-sm tabular-nums text-neutral-500">{fmtMinutes(entries.reduce((a, e) => a + e.minutes, 0), units)}</span>}>
              <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {entries.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 py-2 text-sm">
                    <span className="w-16 font-semibold tabular-nums">{fmtMinutes(e.minutes, units)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        {e.ticket ? <TicketLink ticket={e.ticket} /> : <span className="text-neutral-500">{t('maintenanceRun')}</span>}
                        <span className="text-neutral-600 dark:text-neutral-300">{e.customer}</span>
                        <StatusBadge status={e.status} />
                        {e.source === 'MANUAL' && <Badge color="amber" title={e.reason ?? ''}>{t('manual')}</Badge>}
                        {e.flagged && <Badge color="red" title={e.reason ?? ''}>{t('flagged')}</Badge>}
                        {!e.billable && <Badge>{t('notBillable')}</Badge>}
                      </span>
                      <span className="mt-0.5 block text-xs text-neutral-500">
                        {e.startedAt && <><Time value={e.startedAt} contractId={e.contractId} mode="time" /> - <Time value={e.endedAt} contractId={e.contractId} mode="time" /> · </>}
                        {t('terminalMinutes')}: <span className="tabular-nums">{e.sessionMinutes ?? 0}</span>
                        {e.note && <> · <bdi>{e.note}</bdi></>}
                      </span>
                      {e.source === 'MANUAL' && e.reason && <span className="mt-0.5 block text-xs text-amber-700 dark:text-amber-300">{t('reason')}: <bdi>{e.reason}</bdi></span>}
                      {e.reviewComment && <span className="mt-0.5 block text-xs text-red-600">{t('reviewComment')}: <bdi>{e.reviewComment}</bdi></span>}
                    </span>
                    {(e.status === 'DRAFT' || e.status === 'REJECTED') && (
                      <button className="text-xs text-red-600 hover:underline" disabled={busy === e.id} onClick={() => confirm(t('deleteEntryConfirm')) && run(e.id, () => del(`/ops/v1/timesheet/entries/${e.id}`), t('entryDeleted')).then(() => sheet.reload())}>{t('delete')}</button>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ManualEntry({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { t, tz } = useShell();
  const tickets = useLoad(() => api<{ data: Ticket[] }>('/ops/v1/tickets?mine=true&status=all'), []);
  const [ticketId, setTicketId] = useState('');
  const [startedAt, setStartedAt] = useState(() => nowLocalInput(tz, new Date(Date.now() - 3600_000)));
  const [minutes, setMinutes] = useState(30);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [billable, setBillable] = useState(true);
  const { busy, run } = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run('add', () => post('/ops/v1/timesheet/entries', { ticketId, minutes, startedAt: zonedToUtc(startedAt, tz).toISOString(), reason, note: note || undefined, billable }), t('entryAdded')).then((r) => r && onDone());
  };

  return (
    <Card title={t('manualEntry')}>
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 md:col-span-2 dark:bg-amber-950/40 dark:text-amber-100">{t('manualNote')}</p>
        <Field label={t('ticket')}>
          <select className="input" required value={ticketId} onChange={(e) => setTicketId(e.target.value)}>
            <option value="">{tickets.data ? t('chooseTicket') : t('loading')}</option>
            {tickets.data?.data.map((x) => <option key={x.id} value={x.id}>#{x.number} {x.subject}</option>)}
          </select>
        </Field>
        <Field label={t('startedAtYourTime')}>
          <input type="datetime-local" className="input" dir="ltr" required value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
        </Field>
        <Field label={t('minutes')}>
          <input type="number" className="input" min={1} max={720} required value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} /> {t('billable')}</label>
        <Field label={t('reasonRequired')}>
          <textarea className="input min-h-20" required minLength={5} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('manualReasonPlaceholder')} />
        </Field>
        <Field label={t('noteOptional')}>
          <textarea className="input min-h-20" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex gap-2 md:col-span-2">
          <button className="btn-primary" disabled={busy === 'add'}>{t('addEntry')}</button>
          <button type="button" className="btn-ghost" onClick={onCancel}>{t('cancel')}</button>
        </div>
      </form>
    </Card>
  );
}
