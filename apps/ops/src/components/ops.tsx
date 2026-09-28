'use client';

import Link from 'next/link';
import { useState } from 'react';
import { post } from '@/lib/api';
import type { Key } from '@/lib/i18n';
import type { Grant, Handover, Run, Ticket, Timer } from '@/lib/types';
import { useShell } from './ctx';
import { Badge, Countdown, Elapsed, Empty, PriorityBadge, StatusBadge, TicketLink, Time, useAction } from './ui';

/** The next SLA target of a ticket: the response until the first reply, then the resolution. */
export const slaDue = (t: Pick<Ticket, 'status' | 'firstRespondedAt' | 'responseDueAt' | 'resolveDueAt'>) =>
  t.status === 'closed' || t.status === 'resolved_pending_pm' ? null : t.firstRespondedAt ? t.resolveDueAt : t.responseDueAt;

export function TicketTable({ tickets, showAssignee = false }: { tickets: Ticket[]; showAssignee?: boolean }) {
  const { t, contractName } = useShell();
  if (!tickets.length) return <Empty>{t('noTickets')}</Empty>;
  return (
    <div className="-mx-2 overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>{t('ticket')}</th>
            <th>{t('priority')}</th>
            <th className="w-full">{t('subject')}</th>
            <th>{t('status')}</th>
            {showAssignee && <th>{t('assignee')}</th>}
            <th>{t('slaLeft')}</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((x) => (
            <tr key={x.id}>
              <td><TicketLink ticket={x} /></td>
              <td><PriorityBadge priority={x.priority} /></td>
              <td>
                <Link href={`/tickets/${x.id}`} className="font-medium hover:underline"><bdi>{x.subject}</bdi></Link>
                <div className="text-xs text-neutral-500">{[contractName(x.contractId), x.asset?.name].filter(Boolean).join(' · ')}</div>
              </td>
              <td><StatusBadge status={x.status} /></td>
              {showAssignee && <td className="whitespace-nowrap text-neutral-600 dark:text-neutral-300">{x.assignee?.name ?? <span className="text-neutral-400">{t('unassigned')}</span>}</td>}
              <td className="whitespace-nowrap">
                <Countdown to={slaDue(x)} seconds={false} />
                <div className="text-xs text-neutral-500">{x.firstRespondedAt ? t('slaResolve') : t('slaResponse')}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function GrantLine({ grant, onChange }: { grant: Grant; onChange?: () => void }) {
  const { t } = useShell();
  const [extending, setExtending] = useState(false);
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState(60);
  const { busy, run } = useAction();
  const g = grant;
  const canExtend = g.status === 'ACTIVE' && g.extensions < 1;
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusBadge status={g.status} />
        {g.auto && <Badge color="violet">{t('autoApproved')}</Badge>}
        {g.emergency && <Badge color="red">{t('emergency')}</Badge>}
        <Link href={`/assets/${g.assetId}`} className="font-medium hover:underline">{g.asset?.name ?? g.assetId}</Link>
        {g.ticket && <TicketLink ticket={g.ticket} />}
        {g.maintenanceRunId && <span className="text-xs text-neutral-500">{t('maintenanceRun')}</span>}
        <span className="ms-auto flex items-center gap-2 text-sm">
          {g.status === 'ACTIVE' && (
            <>
              <span className="text-neutral-500">{t('expiresIn')}</span>
              <Countdown to={g.expiresAt} warnSeconds={900} />
            </>
          )}
          {g.status === 'REQUESTED' && <span className="text-neutral-500">{t('waitingForLead')}</span>}
        </span>
      </div>
      <p dir="auto" className="mt-1 text-start text-sm text-neutral-600 dark:text-neutral-300">{g.reason}</p>
      <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-neutral-500">
        <span>{t('requested')}: <Time value={g.createdAt} contractId={g.contractId} /></span>
        <span>{t('duration')}: {t('minutesN', { n: g.grantedMinutes ?? g.requestedMinutes })}</span>
        {g.expiresAt && g.status !== 'REQUESTED' && <span>{t('until')}: <Time value={g.expiresAt} contractId={g.contractId} /></span>}
        {g.extensions > 0 && <span>{t('extendedOnce')}{g.extensionReason ? `: ${g.extensionReason}` : ''}</span>}
        {g.denyReason && <span className="text-red-600">{t('denied')}: {g.denyReason}</span>}
        {g.revokeReason && <span className="text-red-600">{t('revoked')}: {g.revokeReason}</span>}
      </div>
      {g.status === 'ACTIVE' && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Link className="btn-primary" href={`/terminal?grant=${g.id}`}>{t('openTerminal')}</Link>
          {canExtend && !extending && <button className="btn-ghost" onClick={() => setExtending(true)}>{t('extendOnce')}</button>}
        </div>
      )}
      {extending && (
        <form
          className="mt-3 grid gap-2 rounded-md bg-neutral-50 p-3 sm:grid-cols-[1fr_8rem_auto] dark:bg-neutral-800/50"
          onSubmit={(e) => {
            e.preventDefault();
            void run('extend', () => post(`/ops/v1/access/grants/${g.id}/extend`, { reason, minutes }), t('grantExtended')).then((r) => {
              if (r) {
                setExtending(false);
                onChange?.();
              }
            });
          }}
        >
          <input className="input" required minLength={5} maxLength={1000} placeholder={t('extensionReason')} value={reason} onChange={(e) => setReason(e.target.value)} />
          <select className="input" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} aria-label={t('duration')}>
            {[30, 60, 90, 120, 180, 240].map((m) => <option key={m} value={m}>{t('minutesN', { n: m })}</option>)}
          </select>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy === 'extend'}>{t('extend')}</button>
            <button type="button" className="btn-ghost" onClick={() => setExtending(false)}>{t('cancel')}</button>
          </div>
          <p className="text-xs text-neutral-500 sm:col-span-3">{t('extensionNote')}</p>
        </form>
      )}
    </li>
  );
}

export function TimerCard({ timer, onStopped }: { timer: Timer | null; onStopped?: () => void }) {
  const { t } = useShell();
  const { busy, run } = useAction();
  if (!timer) return <Empty>{t('noTimer')}</Empty>;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-blue-600" />
      <span className="text-2xl font-semibold"><Elapsed from={timer.startedAt} /></span>
      <span className="text-sm text-neutral-500">
        {timer.ticket ? <TicketLink ticket={timer.ticket} /> : t('maintenanceRun')} · {t('since')} <Time value={timer.startedAt} contractId={timer.contractId} mode="time" />
      </span>
      <button className="btn-ghost ms-auto" disabled={busy === 'stop'} onClick={() => run('stop', () => post('/ops/v1/timers/stop', {}), t('timerStopped')).then((r) => r && onStopped?.())}>{t('stopTimer')}</button>
    </div>
  );
}

export function HandoverView({ handover }: { handover: Handover }) {
  const { t } = useShell();
  const h = handover;
  return (
    <div className="space-y-3 text-sm">
      <p className="text-xs text-neutral-500">{t('handoverBy', { name: h.author.name ?? '' })} · <Time value={h.createdAt} /></p>
      <div>
        <h3 className="mb-1 font-medium">{t('openTickets')}</h3>
        {h.openTickets.length ? (
          <ul className="space-y-1">
            {h.openTickets.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2"><TicketLink ticket={x} /><PriorityBadge priority={x.priority} /><bdi>{x.subject}</bdi><StatusBadge status={x.status} /></li>
            ))}
          </ul>
        ) : <Empty>{t('none')}</Empty>}
      </div>
      {([['risks', h.risks], ['pendingMaintenance', h.pendingMaintenance], ['notes', h.notes]] as const).map(([k, v]) => (
        <div key={k}>
          <h3 className="mb-1 font-medium">{t(k)}</h3>
          <p dir="auto" className="whitespace-pre-wrap text-start text-neutral-700 dark:text-neutral-300">{v || <span className="text-neutral-400">{t('none')}</span>}</p>
        </div>
      ))}
    </div>
  );
}

export function RunList({ runs, contractId }: { runs: Run[]; contractId: string }) {
  const { t } = useShell();
  if (!runs.length) return <Empty>{t('noRuns')}</Empty>;
  return (
    <ul className="divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
      {runs.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-2 py-1.5">
          <StatusBadge status={r.status} />
          <Link className="hover:underline" href={`/maintenance?run=${r.id}`}>{r.task?.name ?? r.taskId}</Link>
          <span className="text-xs text-neutral-500">{t(`trigger_${r.trigger}` as Key)}</span>
          <span className="ms-auto text-xs text-neutral-500"><Time value={r.finishedAt ?? r.startedAt ?? r.createdAt} contractId={contractId} /></span>
          {r.error && <p className="w-full text-xs text-red-600">{r.error}</p>}
        </li>
      ))}
    </ul>
  );
}
