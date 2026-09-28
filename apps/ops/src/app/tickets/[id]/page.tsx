'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { api, patch, post } from '@/lib/api';
import type { Key } from '@/lib/i18n';
import type { Workspace } from '@/lib/types';
import { useLoad } from '@/lib/use-load';
import { fmtMinutes } from '@/lib/time';
import { useShell } from '@/components/ctx';
import { AUTO_GRANT_MINUTES, MAX_GRANT_MINUTES, onCallNow } from '@/lib/rules';
import { GrantLine } from '@/components/ops';
import { Badge, Card, Countdown, Elapsed, Empty, ErrorNote, Field, Loading, PriorityBadge, StatusBadge, TicketLink, Time, Uptime, useAction, useUnits } from '@/components/ui';

export default function TicketWorkspacePage() {
  const { id } = useParams<{ id: string }>();
  const { t, me, reloadMe } = useShell();
  const ws = useLoad(() => api<Workspace>(`/ops/v1/tickets/${id}`), [id], { pollMs: 30_000 });

  if (ws.error && !ws.data) return <ErrorNote error={ws.error} />;
  if (!ws.data) return <Loading />;
  const w = ws.data;
  const x = w.ticket;
  const set = (next: Workspace) => {
    ws.setData(next);
    void reloadMe();
  };
  const open = x.status === 'open' || x.status === 'answered';

  return (
    <div className="space-y-4">
      <div>
        <Link href="/tickets" className="text-sm text-neutral-500 hover:underline"><span className="inline-block rtl:rotate-180">←</span> {t('navTickets')}</Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight"><span className="font-mono text-neutral-500" dir="ltr">#{x.number}</span> <bdi>{x.subject}</bdi></h1>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
          <PriorityBadge priority={x.priority} />
          <StatusBadge status={x.status} />
          <span>{t('openedAt')} <Time value={x.createdAt} contractId={x.contractId} /></span>
          {x.asset && <>· <Link href={`/assets/${x.asset.id}`} className="hover:underline">{x.asset.name}</Link></>}
          · <span>{t('assignee')}: {x.assignee?.name ?? t('unassigned')}</span>
          {open && x.assigneeId !== me?.user.id && <AssignMe id={x.id} onDone={set} />}
        </div>
      </div>

      {w.escalation.suggested && <EscalateBanner id={x.id} minutes={w.escalation.afterMinutes} />}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0 space-y-4">
          <Conversation w={w} />
          {open && <Composer id={x.id} onDone={set} />}
          {!!w.alerts.length && (
            <Card title={t('ticketAlerts')}>
              <ul className="space-y-1 text-sm">
                {w.alerts.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={a.severity} /><span className="font-mono" dir="ltr">{a.name}</span><StatusBadge status={a.status} />
                    <span className="text-xs text-neutral-500"><Time value={a.startsAt} contractId={a.contractId} /></span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <WorkLogs w={w} />
        </div>

        <aside className="min-w-0 space-y-4">
          <SlaCard w={w} />
          <TimerPanel w={w} onDone={() => ws.reload().then(() => reloadMe())} />
          <AccessPanel w={w} onDone={() => ws.reload().then(() => reloadMe())} />
          <StatusPanel w={w} onDone={set} />
          {!w.escalation.suggested && open && <Card title={t('escalate')}><EscalateForm id={x.id} /></Card>}
          <AssetPanel w={w} />
          <RunbooksPanel w={w} />
        </aside>
      </div>
    </div>
  );
}

function AssignMe({ id, onDone }: { id: string; onDone: (w: Workspace) => void }) {
  const { t, me } = useShell();
  const { busy, run } = useAction();
  return (
    <button className="btn-ghost py-0.5" disabled={!!busy} onClick={() => run('assign', () => patch<Workspace>(`/ops/v1/tickets/${id}`, { assigneeId: me?.user.id }), t('assignedToYou')).then((r) => r && onDone(r))}>
      {t('assignToMe')}
    </button>
  );
}

function Conversation({ w }: { w: Workspace }) {
  const { t } = useShell();
  if (!w.messages.length) return <Card><Empty>{t('noMessages')}</Empty></Card>;
  return (
    <ol className="space-y-3" aria-label={t('conversation')}>
      {w.messages.map((m) => {
        const style = m.internal
          ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30'
          : m.fromSupport
            ? 'border-blue-200 bg-blue-50/60 dark:border-blue-900 dark:bg-blue-950/20'
            : 'border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900';
        return (
          <li key={m.id} className={`rounded-lg border p-3 ${style} ${m.fromSupport ? 'ms-6' : 'me-6'}`}>
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
              <span className="font-medium text-neutral-800 dark:text-neutral-100">{m.fromSupport ? m.author ?? t('engineer') : t('customer')}</span>
              {m.internal && <Badge color="amber">{t('internalNote')}</Badge>}
              {m.rootCause && <Badge color="violet">{t('rootCause')}</Badge>}
              {!m.internal && m.fromSupport && <Badge color="blue">{t('publicReply')}</Badge>}
              <span className="ms-auto"><Time value={m.createdAt} contractId={w.ticket.contractId} /></span>
            </div>
            <div dir="auto" className="whitespace-pre-wrap break-words text-start text-sm">{m.body}</div>
          </li>
        );
      })}
    </ol>
  );
}

function Composer({ id, onDone }: { id: string; onDone: (w: Workspace) => void }) {
  const { t } = useShell();
  const [internal, setInternal] = useState(true);
  const [body, setBody] = useState('');
  const { busy, run } = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run('send', () => post<Workspace>(`/ops/v1/tickets/${id}/messages`, { body, internal }), internal ? t('noteSaved') : t('replySent')).then((r) => {
      if (r) {
        setBody('');
        onDone(r);
      }
    });
  };
  return (
    <form onSubmit={submit} className={`card space-y-3 ${internal ? 'border-amber-300 dark:border-amber-800' : ''}`}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-neutral-300 p-0.5 text-sm dark:border-neutral-700" role="radiogroup" aria-label={t('messageKind')}>
          <button type="button" role="radio" aria-checked={internal} className={`rounded px-3 py-1 ${internal ? 'bg-amber-500 text-neutral-950' : ''}`} onClick={() => setInternal(true)}>{t('internalNote')}</button>
          <button type="button" role="radio" aria-checked={!internal} className={`rounded px-3 py-1 ${!internal ? 'bg-blue-600 text-white' : ''}`} onClick={() => setInternal(false)}>{t('publicReply')}</button>
        </div>
        <span className="text-xs text-neutral-500">{internal ? t('internalHint') : t('publicHint')}</span>
      </div>
      <textarea className="input min-h-28" required maxLength={20000} value={body} onChange={(e) => setBody(e.target.value)} placeholder={internal ? t('notePlaceholder') : t('replyPlaceholder')} />
      <div className="flex justify-end">
        <button className={internal ? 'btn-warn' : 'btn-primary'} disabled={busy === 'send' || !body.trim()}>{internal ? t('saveNote') : t('sendReply')}</button>
      </div>
    </form>
  );
}

function SlaCard({ w }: { w: Workspace }) {
  const { t } = useShell();
  const closed = w.ticket.status === 'closed' || w.ticket.status === 'resolved_pending_pm';
  const row = (label: string, due: string | null, doneAt: string | null, breached: boolean) => (
    <div className="flex items-center justify-between gap-2 py-1.5 text-sm">
      <span className="text-neutral-600 dark:text-neutral-300">{label}</span>
      <span className="flex items-center gap-2">
        {breached && <Badge color="red">{t('breached')}</Badge>}
        {doneAt ? <span className="text-green-700 dark:text-green-400">{t('metAt')} <Time value={doneAt} contractId={w.ticket.contractId} mode="time" /></span> : closed ? <span className="text-neutral-400">-</span> : <Countdown to={due} />}
      </span>
    </div>
  );
  return (
    <Card title={t('sla')}>
      {row(t('slaResponse'), w.sla.responseDueAt, w.sla.firstRespondedAt, w.sla.responseBreached)}
      {row(t('slaResolve'), w.sla.resolveDueAt, closed ? w.ticket.closedAt : null, w.sla.resolveBreached)}
      <p className="mt-1 text-xs text-neutral-500">{t('dueAt')}: <Time value={w.sla.firstRespondedAt ? w.sla.resolveDueAt : w.sla.responseDueAt} contractId={w.ticket.contractId} /></p>
    </Card>
  );
}

function TimerPanel({ w, onDone }: { w: Workspace; onDone: () => void }) {
  const { t, me } = useShell();
  const { busy, run } = useAction();
  const other = me?.runningTimer && me.runningTimer.ticketId !== w.ticket.id ? me.runningTimer : null;
  const open = w.ticket.status === 'open' || w.ticket.status === 'answered';
  return (
    <Card title={t('timer')}>
      {w.timer ? (
        <div className="flex items-center gap-3">
          <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-blue-600" />
          <span className="text-xl font-semibold"><Elapsed from={w.timer.startedAt} /></span>
          <button className="btn-ghost ms-auto" disabled={!!busy} onClick={() => run('stop', () => post('/ops/v1/timers/stop', {}), t('timerStopped')).then((r) => r && onDone())}>{t('stopTimer')}</button>
        </div>
      ) : other ? (
        <div className="space-y-2 text-sm">
          <p>{t('timerElsewhere')} {other.ticket ? <TicketLink ticket={other.ticket} /> : t('maintenanceRun')} (<Elapsed from={other.startedAt} />)</p>
          <button className="btn-ghost" disabled={!!busy} onClick={() => run('stop', () => post('/ops/v1/timers/stop', {}), t('timerStopped')).then((r) => r && onDone())}>{t('stopThatTimer')}</button>
        </div>
      ) : open ? (
        <button className="btn-primary" disabled={!!busy} onClick={() => run('start', () => post('/ops/v1/timers/start', { ticketId: w.ticket.id }), t('timerStarted')).then((r) => r && onDone())}>{t('startTimer')}</button>
      ) : <Empty>{t('ticketNotOpen')}</Empty>}
      <p className="mt-2 text-xs text-neutral-500">{t('timerNote')}</p>
    </Card>
  );
}

function AccessPanel({ w, onDone }: { w: Workspace; onDone: () => void }) {
  const { t, me } = useShell();
  const [reason, setReason] = useState('');
  const [minutes, setMinutes] = useState(60);
  const [asking, setAsking] = useState(false);
  const { busy, run } = useAction();
  const x = w.ticket;
  const open = x.status === 'open' || x.status === 'answered';
  const auto = (x.priority === 'P1' || x.priority === 'P2') && onCallNow(me);
  const live = w.grants.filter((g) => g.status === 'ACTIVE' || g.status === 'REQUESTED' || g.status === 'APPROVED');
  const shellAsset = w.asset && w.asset.asset.kind !== 'SITE';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run('grant', () => post('/ops/v1/access/grants', { assetId: x.assetId, ticketId: x.id, reason, durationMin: auto ? AUTO_GRANT_MINUTES : minutes })).then((r) => {
      if (r) {
        setAsking(false);
        setReason('');
        onDone();
      }
    });
  };

  return (
    <Card title={t('serverAccess')}>
      {w.grants.length ? (
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">{w.grants.map((g) => <GrantLine key={g.id} grant={g} onChange={onDone} />)}</ul>
      ) : <Empty>{t('noGrantsOnTicket')}</Empty>}
      {open && !live.length && (
        !x.assetId ? <p className="text-xs text-neutral-500">{t('noAssetOnTicket')}</p>
        : !shellAsset ? <p className="text-xs text-neutral-500">{t('siteNoShell')}</p>
        : asking ? (
          <form onSubmit={submit} className="mt-3 space-y-3">
            <Field label={t('reason')}>
              <textarea className="input min-h-20" required minLength={5} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('accessReasonPlaceholder')} />
            </Field>
            {auto ? (
              <p className="rounded-md bg-violet-50 px-3 py-2 text-sm text-violet-900 dark:bg-violet-950/40 dark:text-violet-200">{t('autoApprovalEligible', { h: AUTO_GRANT_MINUTES / 60 })}</p>
            ) : (
              <Field label={t('duration')} hint={t('leadApprovalNote', { h: MAX_GRANT_MINUTES / 60 })}>
                <select className="input" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                  {[30, 60, 90, 120, 180, 240].filter((m) => m <= MAX_GRANT_MINUTES).map((m) => <option key={m} value={m}>{t('minutesN', { n: m })}</option>)}
                </select>
              </Field>
            )}
            <div className="flex gap-2">
              <button className="btn-primary" disabled={busy === 'grant'}>{t('requestAccess')}</button>
              <button type="button" className="btn-ghost" onClick={() => setAsking(false)}>{t('cancel')}</button>
            </div>
          </form>
        ) : (
          <button className="btn-primary mt-3" onClick={() => setAsking(true)}>{t('requestAccess')}</button>
        )
      )}
      <p className="mt-2 text-xs text-neutral-500">{t('accessRecordedNote')}</p>
    </Card>
  );
}

function StatusPanel({ w, onDone }: { w: Workspace; onDone: (w: Workspace) => void }) {
  const { t } = useShell();
  const router = useRouter();
  const x = w.ticket;
  const [closing, setClosing] = useState(false);
  const [rootCause, setRootCause] = useState('');
  const { busy, run } = useAction();
  const hasRootCause = w.messages.some((m) => m.rootCause);
  const p1 = x.priority === 'P1';
  const setStatus = (status: 'open' | 'answered' | 'closed', extra: Record<string, unknown> = {}) =>
    run('status', () => patch<Workspace>(`/ops/v1/tickets/${x.id}`, { status, ...extra }), t('statusChanged')).then((r) => {
      if (r) {
        setClosing(false);
        onDone(r);
      }
    });

  const writePostmortem = () =>
    run('pm', () => post<{ id: string }>('/ops/v1/postmortems', { ticketId: x.id })).then((r) => r && router.push(`/postmortems/${r.id}`));

  return (
    <Card title={t('status')}>
      <div className="mb-3 flex items-center gap-2"><StatusBadge status={x.status} /></div>
      {(x.status === 'open' || x.status === 'answered') && !closing && (
        <div className="flex flex-wrap gap-2">
          {x.status === 'open' && <button className="btn-ghost" disabled={!!busy} onClick={() => setStatus('answered')}>{t('markAnswered')}</button>}
          {x.status === 'answered' && <button className="btn-ghost" disabled={!!busy} onClick={() => setStatus('open')}>{t('markOpen')}</button>}
          <button className="btn-ghost" onClick={() => setClosing(true)}>{t('closeTicket')}</button>
        </div>
      )}
      {closing && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void setStatus('closed', rootCause.trim() ? { rootCause: rootCause.trim() } : {});
          }}
        >
          <Field label={hasRootCause ? t('rootCauseOptional') : t('rootCauseRequired')} hint={t('rootCauseHint')}>
            <textarea className="input min-h-24" required={!hasRootCause} minLength={10} maxLength={5000} value={rootCause} onChange={(e) => setRootCause(e.target.value)} />
          </Field>
          {p1 && <p className="rounded-md bg-violet-50 px-3 py-2 text-xs text-violet-900 dark:bg-violet-950/40 dark:text-violet-200">{t('p1PostmortemNote')}</p>}
          <p className="text-xs text-neutral-500">{t('closeRevokesNote')}</p>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy === 'status'}>{t('closeTicket')}</button>
            <button type="button" className="btn-ghost" onClick={() => setClosing(false)}>{t('cancel')}</button>
          </div>
        </form>
      )}
      {x.status === 'resolved_pending_pm' && (
        <div className="space-y-2 text-sm">
          <p>{t('waitingPostmortem')}</p>
          {w.postmortem ? (
            <p className="flex flex-wrap items-center gap-2">
              <StatusBadge status={w.postmortem.status} /> {t('dueAt')} <Time value={w.postmortem.dueAt} contractId={x.contractId} /> <Countdown to={w.postmortem.dueAt} seconds={false} />
              <Link className="btn-primary" href={`/postmortems/${w.postmortem.id}`}>{t('openPostmortem')}</Link>
            </p>
          ) : <button className="btn-primary" disabled={!!busy} onClick={writePostmortem}>{t('writePostmortem')}</button>}
        </div>
      )}
      {x.status === 'closed' && w.postmortem && <p className="text-sm"><Link className="text-blue-600 hover:underline" href={`/postmortems/${w.postmortem.id}`}>{t('openPostmortem')}</Link></p>}
    </Card>
  );
}

function EscalateBanner({ id, minutes }: { id: string; minutes: number }) {
  const { t } = useShell();
  return (
    <section className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/30" role="alert">
      <p className="mb-3 text-sm font-medium text-amber-950 dark:text-amber-100">{t('escalateSuggested', { n: minutes })}</p>
      <EscalateForm id={id} strong />
    </section>
  );
}

function EscalateForm({ id, strong = false }: { id: string; strong?: boolean }) {
  const { t } = useShell();
  const [reason, setReason] = useState('');
  const [open, setOpen] = useState(strong);
  const { busy, run } = useAction();
  if (!open) return <button className="btn-ghost" onClick={() => setOpen(true)}>{t('escalateToLead')}</button>;
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        void run('esc', () => post<{ to: { name: string } }>(`/ops/v1/tickets/${id}/escalate`, { reason })).then((r) => r && setReason(''));
      }}
    >
      <input className="input" required minLength={3} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('escalateReason')} />
      <button className="btn-warn whitespace-nowrap" disabled={busy === 'esc'}>{t('escalateToLead')}</button>
    </form>
  );
}

function AssetPanel({ w }: { w: Workspace }) {
  const { t } = useShell();
  const card = w.asset;
  if (!card) return null;
  const a = card.asset;
  return (
    <Card title={t('asset')} actions={<Link className="text-sm text-blue-600 hover:underline" href={`/assets/${a.id}`}>{t('assetView')}</Link>}>
      <div className="space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{a.name}</span>
          <StatusBadge status={a.health} />
          <span className="text-xs text-neutral-500">{t(`kind_${a.kind}` as Key)}{a.os ? ` · ${a.os}` : ''}</span>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          <dt className="text-neutral-500">{t('lastHeartbeat')}</dt><dd><Time value={a.lastHeartbeatAt} contractId={a.contractId} /></dd>
          {a.heartbeat?.uptimeSeconds != null && <><dt className="text-neutral-500">{t('uptime')}</dt><dd><Uptime s={a.heartbeat.uptimeSeconds} /></dd></>}
          <dt className="text-neutral-500">{t('lastPatch')}</dt><dd>{card.lastPatch ? <><StatusBadge status={card.lastPatch.status} /> <Time value={card.lastPatch.finishedAt} contractId={a.contractId} mode="date" /></> : '-'}</dd>
          <dt className="text-neutral-500">{t('lastBackupTest')}</dt><dd>{card.lastBackupTest ? <><StatusBadge status={card.lastBackupTest.status} /> <Time value={card.lastBackupTest.finishedAt} contractId={a.contractId} mode="date" /></> : '-'}</dd>
        </dl>
        {card.links && (
          <div className="flex flex-wrap gap-2 pt-1">
            <a className="btn-ghost py-1 text-xs" href={card.links.metrics} target="_blank" rel="noreferrer noopener">{t('grafanaMetrics')}</a>
            <a className="btn-ghost py-1 text-xs" href={card.links.logs} target="_blank" rel="noreferrer noopener">{t('lokiLogs')}</a>
          </div>
        )}
        <div>
          <h3 className="mb-1 mt-2 text-xs font-medium text-neutral-500">{t('recentAlerts')}</h3>
          {card.recentAlerts.length ? (
            <ul className="space-y-1 text-xs">
              {card.recentAlerts.slice(0, 5).map((al) => (
                <li key={al.id} className="flex flex-wrap items-center gap-1.5"><StatusBadge status={al.status} /><span className="font-mono" dir="ltr">{al.name}</span><span className="text-neutral-500"><Time value={al.startsAt} contractId={al.contractId} /></span></li>
              ))}
            </ul>
          ) : <Empty>{t('noAlerts')}</Empty>}
        </div>
      </div>
    </Card>
  );
}

function RunbooksPanel({ w }: { w: Workspace }) {
  const { t } = useShell();
  return (
    <Card title={t('suggestedRunbooks')} actions={<Link className="text-sm text-blue-600 hover:underline" href="/runbooks">{t('allRunbooks')}</Link>}>
      {w.suggestedRunbooks.length ? (
        <ul className="space-y-2 text-sm">
          {w.suggestedRunbooks.map((r) => (
            <li key={r.id}>
              <Link className="font-medium text-blue-600 hover:underline dark:text-blue-400" href={`/runbooks/${r.slug}`}>{r.title}</Link>
              <div className="mt-0.5 flex flex-wrap gap-1">{r.tags.slice(0, 4).map((tag) => <span key={tag} className="badge bg-neutral-100 font-mono text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300" dir="ltr">{tag}</span>)}</div>
            </li>
          ))}
        </ul>
      ) : <Empty>{t('noSuggestions')}</Empty>}
    </Card>
  );
}

function WorkLogs({ w }: { w: Workspace }) {
  const { t } = useShell();
  const units = useUnits();
  if (!w.workLogs.length) return null;
  return (
    <Card title={t('timeOnTicket')}>
      <ul className="divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
        {w.workLogs.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-3 py-1.5">
            <span className="font-medium tabular-nums">{fmtMinutes(l.minutes, units)}</span>
            <span className="text-neutral-600 dark:text-neutral-300">{l.user?.name}</span>
            {l.note && <bdi className="text-neutral-500">{l.note}</bdi>}
            <span className="ms-auto text-xs text-neutral-500"><Time value={l.workedAt} contractId={w.ticket.contractId} /></span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

