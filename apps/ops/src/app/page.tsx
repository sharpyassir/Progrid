'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api, post } from '@/lib/api';
import type { Handover, Shift, Ticket } from '@/lib/types';
import { useLoad } from '@/lib/use-load';
import { useShell } from '@/components/ctx';
import { GrantLine, HandoverView, TicketTable, TimerCard } from '@/components/ops';
import { Badge, Card, Countdown, Empty, ErrorNote, Loading, PageTitle, Time, useAction } from '@/components/ui';
import type { Key } from '@/lib/i18n';

type ChecklistKey = 'pagingAppOnline' | 'vpnWorking' | 'twoFactorWorking' | 'lastHandoverRead';
const CHECKLIST: ChecklistKey[] = ['pagingAppOnline', 'vpnWorking', 'twoFactorWorking', 'lastHandoverRead'];

/** My shift: the home screen of the on call engineer. */
export default function MyShiftPage() {
  const { t, me, reloadMe } = useShell();
  const tickets = useLoad(() => api<{ data: Ticket[] }>('/ops/v1/tickets?mine=true'), [], { pollMs: 30_000 });
  const { busy, run } = useAction();

  if (!me) return <Loading />;
  const shift = me.currentShift;

  return (
    <div className="space-y-5">
      <PageTitle title={t('myShiftTitle', { name: me.user.name.split(' ')[0] })} sub={t('myShiftLead')} />

      {me.openPages.length > 0 && (
        <section className="rounded-lg border-2 border-red-500 bg-red-50 p-4 dark:bg-red-950/30">
          <h2 className="mb-2 font-semibold text-red-800 dark:text-red-300">{t('pagesWaiting', { n: me.openPages.length })}</h2>
          <ul className="divide-y divide-red-200 dark:divide-red-900">
            {me.openPages.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <Badge color="red">{p.urgency === 'high' ? t('urgentPage') : p.urgency}</Badge>
                <bdi className="flex-1">{p.message}</bdi>
                <span className="text-xs text-neutral-500"><Time value={p.sentAt ?? p.createdAt} /></span>
                {p.ticketId && <Link className="text-blue-600 hover:underline" href={`/tickets/${p.ticketId}`}>{t('openTicket')}</Link>}
                <button className="btn-danger" disabled={busy === p.id} onClick={() => run(p.id, () => post(`/ops/v1/pages/${p.id}/ack`), t('pageAcked')).then(() => reloadMe())}>{t('ack')}</button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-red-800/80 dark:text-red-300/80">{t('ackTarget')}</p>
        </section>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="min-w-0 space-y-5 xl:col-span-2">
          <ShiftCard shift={shift} lastHandoverRead={!!me.lastHandover?.read} hasHandover={!!me.lastHandover} />
          <Card title={t('myTickets')} actions={<Link href="/tickets" className="text-sm text-blue-600 hover:underline">{t('allTickets')}</Link>}>
            {tickets.error ? <ErrorNote error={tickets.error} /> : !tickets.data ? <Loading /> : <TicketTable tickets={tickets.data.data} />}
          </Card>
        </div>
        <div className="min-w-0 space-y-5">
          <Card title={t('runningTimer')}>
            <TimerCard timer={me.runningTimer} onStopped={reloadMe} />
          </Card>
          <Card title={t('activeGrants')} actions={<Link href="/access" className="text-sm text-blue-600 hover:underline">{t('allGrants')}</Link>}>
            {me.activeGrants.length ? (
              <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">{me.activeGrants.map((g) => <GrantLine key={g.id} grant={g} onChange={reloadMe} />)}</ul>
            ) : <Empty>{t('noActiveGrants')}</Empty>}
          </Card>
          <Card title={t('lastHandover')}>
            {me.lastHandover ? <HandoverView handover={me.lastHandover} /> : <Empty>{t('noHandoverYet')}</Empty>}
          </Card>
        </div>
      </div>
    </div>
  );
}

function ShiftCard({ shift, lastHandoverRead, hasHandover }: { shift: Shift | null; lastHandoverRead: boolean; hasHandover: boolean }) {
  const { t, reloadMe } = useShell();
  const shifts = useLoad(() => api<{ data: Shift[]; checklist: { key: ChecklistKey; label: string }[] }>('/ops/v1/shifts'), []);
  const [checks, setChecks] = useState<Record<ChecklistKey, boolean>>({ pagingAppOnline: false, vpnWorking: false, twoFactorWorking: false, lastHandoverRead: false });
  const [handover, setHandover] = useState<Handover | null | undefined>(undefined);
  const { busy, run } = useAction();

  const readHandover = () =>
    run('read', async () => {
      const r = await api<{ handover: Handover | null }>('/ops/v1/shifts/handover/latest');
      setHandover(r.handover);
    });

  if (!shift) {
    const next = shifts.data?.data.find((s) => s.state === 'scheduled' && new Date(s.startsAt).getTime() > Date.now());
    return (
      <Card title={t('onCallStatus')}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-block h-3 w-3 rounded-full bg-neutral-400" />
          <span className="font-medium">{t('offCall')}</span>
          <span className="text-sm text-neutral-500">{next ? <>{t('nextShift')}: <Time value={next.startsAt} /> ({t(`role_${next.role}` as Key)})</> : t('noUpcomingShift')}</span>
        </div>
      </Card>
    );
  }

  const started = !!shift.startedAt && !shift.endedAt;
  if (started) {
    return (
      <Card title={t('onCallStatus')} actions={<Link href="/handover" className="btn-ghost">{t('endShift')}</Link>}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="relative flex h-3 w-3"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" /><span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" /></span>
          <span className="font-medium text-green-700 dark:text-green-400">{t('onCallNow')}</span>
          <Badge color="blue">{t(`role_${shift.role}` as Key)}</Badge>
          <span className="text-sm text-neutral-500">{t('since')} <Time value={shift.startedAt} /> · {t('until')} <Time value={shift.endsAt} /></span>
          <span className="text-sm text-neutral-500">{t('shiftEndsIn')} <Countdown to={shift.endsAt} seconds={false} /></span>
        </div>
        <p className="mt-2 text-xs text-neutral-500">{t('endShiftNote')}</p>
      </Card>
    );
  }

  const handoverRead = lastHandoverRead || handover !== undefined || !hasHandover;
  const all = CHECKLIST.every((k) => checks[k]);
  return (
    <Card title={t('onCallStatus')}>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <span className="inline-block h-3 w-3 rounded-full bg-amber-500" />
        <span className="font-medium">{t('shiftNotStarted')}</span>
        <Badge color="blue">{t(`role_${shift.role}` as Key)}</Badge>
        <span className="text-sm text-neutral-500"><Time value={shift.startsAt} /> · <Time value={shift.endsAt} /></span>
      </div>
      <h3 className="mb-2 text-sm font-medium">{t('startChecklist')}</h3>
      <ul className="space-y-2">
        {CHECKLIST.map((k) => {
          const disabled = k === 'lastHandoverRead' && !handoverRead;
          return (
            <li key={k}>
              <label className={`flex items-start gap-2 text-sm ${disabled ? 'opacity-60' : ''}`}>
                <input type="checkbox" className="mt-0.5" disabled={disabled} checked={checks[k]} onChange={(e) => setChecks((c) => ({ ...c, [k]: e.target.checked }))} />
                <span>{t(`chk_${k}` as Key)}</span>
              </label>
            </li>
          );
        })}
      </ul>
      {hasHandover && !lastHandoverRead && handover === undefined && (
        <button className="btn-ghost mt-3" disabled={busy === 'read'} onClick={readHandover}>{t('readLastHandover')}</button>
      )}
      {handover && (
        <div className="mt-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-700">
          <HandoverView handover={handover} />
        </div>
      )}
      {handover === null && <p className="mt-2 text-sm text-neutral-500">{t('noHandoverYet')}</p>}
      <div className="mt-4 flex items-center gap-3">
        <button
          className="btn-primary"
          disabled={!all || busy === 'start'}
          onClick={() => run('start', () => post('/ops/v1/shifts/start', { shiftId: shift.id, checklist: checks }), t('shiftStarted')).then((r) => r && reloadMe())}
        >
          {t('startShift')}
        </button>
        {!all && <span className="text-xs text-neutral-500">{t('checklistHint')}</span>}
      </div>
    </Card>
  );
}

