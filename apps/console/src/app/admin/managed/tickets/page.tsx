'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { t, tf } from '@/lib/i18n';
import { AdminShell } from '@/components/admin-shell';
import { useShell } from '@/components/shell';
import { AlertStatusBadge, Cell, ErrorBox, Field, Loading, OkBox, PriorityBadge, Row, SeverityBadge, SlaCountdown, Table, TicketStatusBadge, tk, useAccount, useNow } from '@/components/managed';
import { errText, fmtDateTime, hours, isLeadRoles, PRIORITIES, type Page, type Priority, type StaffMember, type Ticket, type TicketStatus } from '@/lib/managed';

type Assignee = '' | 'me' | 'none';

/**
 * Managed ticket queue: due soonest first, with SLA countdowns that turn amber at 75 percent
 * and red at 100 percent of the target. The selected ticket opens on the right.
 */
export default function AdminManagedTickets() {
  const params = useParams<{ id?: string }>();
  const router = useRouter();
  const { locale } = useShell();
  const { account } = useAccount();
  const [status, setStatus] = useState<TicketStatus | 'all'>('open');
  const [assignee, setAssignee] = useState<Assignee>('');
  const [priority, setPriority] = useState<'' | Priority>('');
  const [breached, setBreached] = useState(false);
  const [rows, setRows] = useState<Ticket[] | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow(15_000);
  const selected = params?.id;
  const lead = account ? isLeadRoles(account.staffRoles) : false;

  const loadList = useCallback(async () => {
    const q = new URLSearchParams({ status, limit: '100' });
    if (assignee) q.set('assignee', assignee);
    if (priority) q.set('priority', priority);
    if (breached) q.set('breached', 'true');
    setRows((await api<Page<Ticket>>(`/admin/managed/tickets?${q}`)).data);
  }, [status, assignee, priority, breached]);
  const loadTicket = useCallback(async () => { setTicket(selected ? await api<Ticket>(`/admin/managed/tickets/${selected}`) : null); }, [selected]);
  useEffect(() => { setRows(null); loadList().catch((e) => setError(errText(e))); }, [loadList]);
  useEffect(() => { loadTicket().catch((e) => setError(errText(e))); }, [loadTicket]);
  useEffect(() => { api<{ data: StaffMember[] }>('/admin/managed/staff').then((r) => setStaff(r.data)).catch(() => setStaff([])); }, []);

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true); setError(null); setOk(null);
    try { await fn(); if (done) setOk(done); await Promise.all([loadList(), loadTicket()]); return true; } catch (e) { setError(errText(e)); return false; } finally { setBusy(false); }
  }
  const update = (body: Record<string, unknown>) => run(() => api(`/admin/managed/tickets/${selected}`, { method: 'PATCH', body: JSON.stringify(body) }), t(locale, 'admMcTicketUpdated'));

  const filterBtn = (active: boolean) => `rounded px-2 py-1 ${active ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'text-neutral-600 dark:text-neutral-300'}`;

  return (
    <AdminShell title={t(locale, 'admMcTicketsTitle')}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select className="input !w-auto py-1" value={status} onChange={(e) => setStatus(e.target.value as TicketStatus | 'all')} aria-label={t(locale, 'status')}>
          <option value="open">{t(locale, 'admMcWaitingOnUs')}</option><option value="answered">{t(locale, 'admMcWaitingOnCustomer')}</option><option value="closed">{t(locale, 'mcTicketFilter_closed')}</option><option value="all">{t(locale, 'mcTicketFilter_all')}</option>
        </select>
        <div className="flex gap-1">
          <button className={filterBtn(assignee === '')} onClick={() => setAssignee('')}>{t(locale, 'admMcAnyone')}</button>
          <button className={filterBtn(assignee === 'me')} onClick={() => setAssignee('me')}>{t(locale, 'admMcAssignedToMe')}</button>
          <button className={filterBtn(assignee === 'none')} onClick={() => setAssignee('none')}>{t(locale, 'admMcUnassigned')}</button>
        </div>
        <label className="flex items-center gap-1"><input type="checkbox" checked={breached} onChange={(e) => setBreached(e.target.checked)} />{t(locale, 'admMcBreachedOnly')}</label>
        <select className="input !w-auto py-1" value={priority} onChange={(e) => setPriority(e.target.value as '' | Priority)} aria-label={t(locale, 'priority')}>
          <option value="">{t(locale, 'mcAllPriorities')}</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <ErrorBox error={error} />
      <OkBox msg={ok} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div>
          {!rows ? <Loading /> : (
            <Table head={['#', t(locale, 'subject'), t(locale, 'team'), t(locale, 'admMcAssignee'), t(locale, 'mcSlaTimeLeft')]} empty={rows.length === 0 ? t(locale, 'admMcQueueEmpty') : undefined}>
              {rows.map((r) => (
                <Row key={r.id} className={selected === r.id ? 'bg-neutral-50 dark:bg-neutral-900' : ''} onClick={() => router.push(`/admin/managed/tickets/${r.id}`)}>
                  <Cell className="text-neutral-500">{r.number}</Cell>
                  <Cell><div className="flex items-center gap-2"><PriorityBadge p={r.priority} /><span className="font-medium">{r.subject}</span></div><div className="text-xs text-neutral-500">{r.asset?.name}{r.source && r.source !== 'customer' ? ` · ${tk(locale, `mcSource_${r.source}`, r.source)}` : ''}</div></Cell>
                  <Cell>{r.team?.name ?? '—'}<div className="text-xs text-neutral-500">{r.plan?.name}</div></Cell>
                  <Cell className="text-xs">{r.assignee?.name ?? <span className="text-amber-700 dark:text-amber-400">{t(locale, 'admMcUnassigned')}</span>}</Cell>
                  <Cell>
                    {r.status === 'closed' ? <TicketStatusBadge s={r.status} /> : (
                      <div className="flex flex-col">
                        <SlaCountdown label={t(locale, 'mcResponse')} createdAt={r.createdAt} dueAt={r.responseDueAt} metAt={r.firstRespondedAt} breached={r.responseBreached} now={now} />
                        <SlaCountdown label={t(locale, 'mcResolve')} createdAt={r.createdAt} dueAt={r.resolveDueAt} breached={r.resolveBreached} now={now} />
                      </div>
                    )}
                  </Cell>
                </Row>
              ))}
            </Table>
          )}
        </div>
        <div className="space-y-3">
          {!selected && <p className="text-sm text-neutral-500">{t(locale, 'admMcPickTicket')}</p>}
          {selected && !ticket && !error && <Loading />}
          {ticket && <TicketDetail ticket={ticket} staff={staff} me={account?.user.id ?? ''} lead={lead} busy={busy} now={now} run={run} update={update} />}
        </div>
      </div>
    </AdminShell>
  );
}

function TicketDetail({ ticket, staff, me, lead, busy, now, run, update }: { ticket: Ticket; staff: StaffMember[]; me: string; lead: boolean; busy: boolean; now: number; run: (fn: () => Promise<unknown>, done?: string) => Promise<boolean>; update: (b: Record<string, unknown>) => Promise<boolean> }) {
  const { locale } = useShell();
  const [internal, setInternal] = useState(false);
  const logged = (ticket.workLogs ?? []).reduce((a, w) => a + w.minutes, 0);

  async function reply(e: FormEvent<HTMLFormElement>, close: boolean) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = String(new FormData(form).get('body') ?? '');
    if (await run(() => api(`/admin/managed/tickets/${ticket.id}/messages`, { method: 'POST', body: JSON.stringify({ body, internal, close: !internal && close }) }), internal ? t(locale, 'admMcNoteAdded') : t(locale, 'admMcReplySent'))) form.reset();
  }
  async function logTime(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const minutes = Math.round(Number(f.get('hours') || 0) * 60) + Number(f.get('minutes') || 0);
    if (minutes < 1) return;
    if (await run(() => api('/admin/managed/worklogs', { method: 'POST', body: JSON.stringify({ contractId: ticket.contractId, ticketId: ticket.id, minutes, billable: !!f.get('billable'), note: String(f.get('note') ?? '') || undefined }) }), t(locale, 'admMcTimeLogged'))) form.reset();
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-medium">#{ticket.number} {ticket.subject}</h2>
        <PriorityBadge p={ticket.priority} />
        <TicketStatusBadge s={ticket.status} />
      </div>
      <p className="text-xs text-neutral-500">
        {ticket.team && <Link href={`/admin/managed/contracts/${ticket.contractId}`} className="hover:underline">{ticket.team.name}</Link>}
        {ticket.asset && <> · {ticket.asset.name}</>}
        {ticket.source && ticket.source !== 'customer' && <> · {tk(locale, `mcSource_${ticket.source}`, ticket.source)}</>}
        {' · '}{fmtDateTime(ticket.createdAt, locale)}
      </p>

      <div className="card grid gap-3 text-sm sm:grid-cols-2">
        <div><div className="text-xs text-neutral-500">{t(locale, 'mcResponseDue')}</div><SlaCountdown createdAt={ticket.createdAt} dueAt={ticket.responseDueAt} metAt={ticket.firstRespondedAt} breached={ticket.responseBreached} now={now} /><div className="text-xs text-neutral-500">{fmtDateTime(ticket.responseDueAt, locale)}</div></div>
        <div><div className="text-xs text-neutral-500">{t(locale, 'mcResolveDue')}</div><SlaCountdown createdAt={ticket.createdAt} dueAt={ticket.resolveDueAt} metAt={ticket.closedAt} breached={ticket.resolveBreached} now={now} /><div className="text-xs text-neutral-500">{fmtDateTime(ticket.resolveDueAt, locale)}</div></div>
        <Field label={t(locale, 'admMcAssignee')}>
          <div className="flex gap-2">
            <select className="input py-1" value={ticket.assigneeId ?? ''} disabled={busy || !lead} onChange={(e) => update({ assigneeId: e.target.value || null })}>
              <option value="">{t(locale, 'admMcUnassigned')}</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              {ticket.assignee && !staff.some((s) => s.id === ticket.assignee!.id) && <option value={ticket.assignee.id}>{ticket.assignee.name}</option>}
            </select>
            {ticket.assigneeId !== me && <button type="button" className="btn-ghost whitespace-nowrap" disabled={busy} onClick={() => update({ assigneeId: me })}>{t(locale, 'admMcTakeIt')}</button>}
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t(locale, 'priority')}><select className="input py-1" value={ticket.priority} disabled={busy} onChange={(e) => { if (confirm(t(locale, 'admMcPriorityConfirm'))) update({ priority: e.target.value }); }}>{PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}</select></Field>
          <Field label={t(locale, 'status')}><select className="input py-1" value={ticket.status} disabled={busy} onChange={(e) => update({ status: e.target.value })}>{(['open', 'answered', 'closed'] as const).map((s) => <option key={s} value={s}>{tk(locale, `mcTicketStatus_${s}`)}</option>)}</select></Field>
        </div>
      </div>

      {!!ticket.alerts?.length && (
        <div className="card space-y-1 text-sm">
          <div className="text-xs font-medium text-neutral-500">{t(locale, 'admMcLinkedAlerts')}</div>
          {ticket.alerts.map((a) => <div key={a.id} className="flex items-center gap-2"><SeverityBadge s={a.severity} /><AlertStatusBadge s={a.status} /><Link href="/admin/managed/alerts" className="hover:underline">{a.name}</Link></div>)}
        </div>
      )}

      {(ticket.messages ?? []).map((m) => (
        <div key={m.id} className={`card ${m.internal ? 'border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20' : m.fromSupport ? 'border-blue-200 bg-blue-50/40 dark:border-blue-900 dark:bg-blue-950/20' : ''}`}>
          <div className="mb-1 flex items-center gap-2 text-xs text-neutral-500"><span className="font-medium text-neutral-800 dark:text-neutral-200">{m.author}</span>{m.internal && <span className="badge bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{t(locale, 'admMcInternalNote')}</span>}<span className="ms-auto">{fmtDateTime(m.createdAt, locale)}</span></div>
          <p className="whitespace-pre-wrap text-sm" dir="auto">{m.body}</p>
        </div>
      ))}

      <form onSubmit={(e) => reply(e, false)} className={`card space-y-2 ${internal ? 'border-amber-300 dark:border-amber-800' : ''}`}>
        <div className="flex gap-1 text-sm">
          <button type="button" className={`rounded px-2 py-1 ${!internal ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'text-neutral-600 dark:text-neutral-300'}`} onClick={() => setInternal(false)}>{t(locale, 'admMcPublicReply')}</button>
          <button type="button" className={`rounded px-2 py-1 ${internal ? 'bg-amber-600 text-white' : 'text-neutral-600 dark:text-neutral-300'}`} onClick={() => setInternal(true)}>{t(locale, 'admMcInternalNote')}</button>
        </div>
        <textarea className="input min-h-28" name="body" required maxLength={20000} placeholder={internal ? t(locale, 'admMcNotePlaceholder') : t(locale, 'admMcReplyPlaceholder')} />
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" disabled={busy}>{internal ? t(locale, 'admMcAddNote') : t(locale, 'admMcSendReply')}</button>
          {!internal && <button type="button" className="btn-ghost" disabled={busy} onClick={(e) => { const form = (e.currentTarget as HTMLButtonElement).form!; if (form.reportValidity()) reply({ preventDefault() {}, currentTarget: form } as unknown as FormEvent<HTMLFormElement>, true); }}>{t(locale, 'admMcReplyAndClose')}</button>}
        </div>
      </form>

      <form onSubmit={logTime} className="card space-y-2">
        <div className="flex items-center gap-2 text-sm"><span className="font-medium">{t(locale, 'admMcLogTime')}</span><span className="ms-auto text-xs text-neutral-500">{tf(locale, 'admMcLoggedOnTicket')(hours(logged))}</span></div>
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t(locale, 'admMcHours')}><input className="input !w-20" name="hours" type="number" min={0} max={24} step="1" defaultValue="0" dir="ltr" /></Field>
          <Field label={t(locale, 'admMcMinutes')}><input className="input !w-20" name="minutes" type="number" min={0} max={59} step="5" defaultValue="15" dir="ltr" /></Field>
          <div className="min-w-40 flex-1"><Field label={t(locale, 'notes')}><input className="input" name="note" maxLength={2000} /></Field></div>
          <label className="flex items-center gap-1 pb-2 text-sm"><input type="checkbox" name="billable" defaultChecked />{t(locale, 'admMcBillable')}</label>
          <button className="btn-ghost" disabled={busy}>{t(locale, 'admMcLog')}</button>
        </div>
      </form>
    </>
  );
}
