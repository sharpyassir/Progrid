'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useShell } from '@/components/shell';
import { ErrorBox, Loading, PriorityBadge, SlaCountdown, TicketStatusBadge, tk, useNow } from '@/components/managed';
import { errText, fmtDateTime, type Asset, type Ticket } from '@/lib/managed';

/** One managed ticket: the public conversation, SLA countdowns, reply box and close button. */
export default function ManagedTicketPage() {
  const { id } = useParams<{ id: string }>();
  const { locale } = useShell();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [asset, setAsset] = useState<Asset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow(15_000);

  const load = useCallback(async () => {
    const tk2 = await api<Ticket>(`/v1/managed/tickets/${id}`);
    setTicket(tk2);
    if (tk2.assetId) api<{ data: Asset[] }>('/v1/managed/assets').then((r) => setAsset(r.data.find((a) => a.id === tk2.assetId) ?? null)).catch(() => undefined);
  }, [id]);
  useEffect(() => { load().catch((e) => setLoadError(errText(e))); }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); await load(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }
  async function reply(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const body = String(new FormData(form).get('body') ?? '');
    await run(async () => { await api(`/v1/managed/tickets/${id}/messages`, { method: 'POST', body: JSON.stringify({ body }) }); form.reset(); });
  }

  const back = <Link href="/managed/tickets" className="text-sm text-neutral-500 hover:underline"><span className="rtl:hidden">←</span><span className="ltr:hidden">→</span> {t(locale, 'mcTicketsTitle')}</Link>;
  if (loadError) return <div className="mx-auto max-w-3xl space-y-4">{back}<ErrorBox error={loadError} /></div>;
  if (!ticket) return <div className="mx-auto max-w-3xl space-y-4">{back}<Loading /></div>;
  const closed = ticket.status === 'closed';

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {back}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">#{ticket.number} {ticket.subject}</h1>
        <PriorityBadge p={ticket.priority} />
        <TicketStatusBadge s={ticket.status} />
        {!closed && <button className="btn-ghost ms-auto" disabled={busy} onClick={() => { if (confirm(t(locale, 'mcCloseConfirm'))) run(() => api(`/v1/managed/tickets/${id}/close`, { method: 'POST' })); }}>{t(locale, 'closeTicket')}</button>}
      </div>
      <div className="card grid gap-3 text-sm sm:grid-cols-3">
        <div><div className="text-xs text-neutral-500">{t(locale, 'mcResponseDue')}</div><SlaCountdown createdAt={ticket.createdAt} dueAt={ticket.responseDueAt} metAt={ticket.firstRespondedAt} breached={ticket.responseBreached} now={now} /><div className="text-xs text-neutral-500">{fmtDateTime(ticket.responseDueAt, locale)}</div></div>
        <div><div className="text-xs text-neutral-500">{t(locale, 'mcResolveDue')}</div><SlaCountdown createdAt={ticket.createdAt} dueAt={ticket.resolveDueAt} metAt={ticket.closedAt} breached={ticket.resolveBreached} now={now} /><div className="text-xs text-neutral-500">{fmtDateTime(ticket.resolveDueAt, locale)}</div></div>
        <div><div className="text-xs text-neutral-500">{t(locale, 'mcAsset')}</div><div>{asset?.name ?? (ticket.assetId ? '…' : t(locale, 'mcNoSpecificAsset'))}</div><div className="text-xs text-neutral-500">{tk(locale, `mcPrioHint_${ticket.priority}`)}</div></div>
      </div>
      <ErrorBox error={error} />

      <div className="space-y-3">
        {(ticket.messages ?? []).map((m) => (
          <div key={m.id} className={`card ${m.fromSupport ? 'border-blue-200 bg-blue-50/40 dark:border-blue-900 dark:bg-blue-950/20' : ''}`}>
            <div className="mb-1 flex items-center gap-2 text-xs text-neutral-500"><span className="font-medium text-neutral-800 dark:text-neutral-200">{m.author}</span>{m.fromSupport && <span className="badge bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200">{t(locale, 'mcProgridEngineers')}</span>}<span className="ms-auto">{fmtDateTime(m.createdAt, locale)}</span></div>
            <p className="whitespace-pre-wrap text-sm" dir="auto">{m.body}</p>
          </div>
        ))}
      </div>

      <form onSubmit={reply} className="card space-y-2">
        <textarea className="input min-h-28" name="body" required maxLength={20000} placeholder={t(locale, closed ? 'reopenPlaceholder' : 'replyPlaceholder')} />
        <div className="flex gap-2"><button className="btn-primary" disabled={busy}>{t(locale, closed ? 'reopenTicket' : 'sendReply')}</button></div>
      </form>
    </div>
  );
}
