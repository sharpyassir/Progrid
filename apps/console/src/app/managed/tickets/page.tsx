'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useShell } from '@/components/shell';
import { Cell, ErrorBox, Field, Loading, ManagedFrame, PriorityBadge, Row, SlaCountdown, Table, TicketStatusBadge, tk, useAccount, useNow } from '@/components/managed';
import { errText, fmtDateTime, PRIORITIES, type Asset, type Page, type Priority, type Ticket } from '@/lib/managed';

export default function ManagedTicketsPage() {
  return <Suspense><Tickets /></Suspense>;
}

function Tickets() {
  const { locale } = useShell();
  const router = useRouter();
  const params = useSearchParams();
  const { account } = useAccount();
  const [status, setStatus] = useState<'all' | 'open' | 'answered' | 'closed'>('all');
  const [priority, setPriority] = useState<'' | Priority>('');
  const [rows, setRows] = useState<Ticket[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [showNew, setShowNew] = useState(params.get('new') === '1');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow();

  const query = useCallback((after?: string) => `/v1/managed/tickets?status=${status}${priority ? `&priority=${priority}` : ''}&limit=50${after ? `&cursor=${after}` : ''}`, [status, priority]);
  const load = useCallback(async () => {
    const r = await api<Page<Ticket>>(query());
    setRows(r.data);
    setCursor(r.meta?.next_cursor ?? null);
  }, [query]);
  useEffect(() => { setRows(null); load().catch((e) => setError(errText(e))); }, [load]);
  useEffect(() => { api<{ data: Asset[] }>('/v1/managed/assets').then((r) => setAssets(r.data.filter((a) => a.status === 'APPROVED'))).catch(() => setAssets([])); }, []);

  async function more() {
    if (!cursor) return;
    try {
      const r = await api<Page<Ticket>>(query(cursor));
      setRows((x) => [...(x ?? []), ...r.data]);
      setCursor(r.meta?.next_cursor ?? null);
    } catch (e) { setError(errText(e)); }
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      const created = await api<Ticket>('/v1/managed/tickets', {
        method: 'POST',
        body: JSON.stringify({ subject: f.get('subject'), body: f.get('body'), priority: f.get('priority'), ...(f.get('assetId') ? { assetId: f.get('assetId') } : {}) }),
      });
      router.push(`/managed/tickets/${created.id}`);
    } catch (err) {
      setError(errText(err));
      setBusy(false);
    }
  }

  return (
    <ManagedFrame title={t(locale, 'mcTicketsTitle')} owner={account?.role === 'owner'} actions={<button className="btn-primary" onClick={() => setShowNew((v) => !v)}>{t(locale, 'newTicket')}</button>}>
      <ErrorBox error={error} />
      {showNew && (
        <form onSubmit={submit} className="card space-y-3">
          <Field label={t(locale, 'subject')}><input className="input" name="subject" required minLength={3} maxLength={140} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t(locale, 'priority')}>
              <select className="input" name="priority" defaultValue="P3">
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}: {tk(locale, `mcPrioShort_${p}`)}</option>)}
              </select>
            </Field>
            <Field label={t(locale, 'mcAssetOptional')}>
              <select className="input" name="assetId" defaultValue="">
                <option value="">{t(locale, 'mcNoSpecificAsset')}</option>
                {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          </div>
          <ul className="grid gap-1 text-xs text-neutral-500 sm:grid-cols-2">
            {PRIORITIES.map((p) => <li key={p} className="flex gap-2"><PriorityBadge p={p} /><span>{tk(locale, `mcPrioHint_${p}`)}</span></li>)}
          </ul>
          <Field label={t(locale, 'message')}><textarea className="input min-h-32" name="body" required maxLength={20000} /></Field>
          <p className="text-xs text-neutral-500">{t(locale, 'mcTicketFormNote')}</p>
          <div className="flex gap-2"><button className="btn-primary" disabled={busy}>{t(locale, 'openTicket')}</button><button type="button" className="btn-ghost" onClick={() => setShowNew(false)}>{t(locale, 'cancel')}</button></div>
        </form>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="flex gap-1">
          {(['all', 'open', 'answered', 'closed'] as const).map((s) => (
            <button key={s} onClick={() => setStatus(s)} className={`rounded px-2 py-1 ${status === s ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'text-neutral-600 dark:text-neutral-300'}`}>{tk(locale, `mcTicketFilter_${s}`)}</button>
          ))}
        </div>
        <select className="input ms-auto !w-auto py-1" value={priority} onChange={(e) => setPriority(e.target.value as '' | Priority)} aria-label={t(locale, 'priority')}>
          <option value="">{t(locale, 'mcAllPriorities')}</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      {!rows ? <Loading /> : (
        <Table head={['#', t(locale, 'subject'), t(locale, 'priority'), t(locale, 'status'), t(locale, 'mcSlaTimeLeft'), t(locale, 'updated')]} empty={rows.length === 0 ? t(locale, 'mcNoTicketsMatch') : undefined}>
          {rows.map((x) => (
            <Row key={x.id}>
              <Cell className="text-neutral-500">{x.number}</Cell>
              <Cell><Link href={`/managed/tickets/${x.id}`} className="font-medium hover:underline">{x.subject}</Link>{x.source && x.source !== 'customer' && <div className="text-xs text-neutral-500">{tk(locale, `mcSource_${x.source}`, x.source)}</div>}</Cell>
              <Cell><PriorityBadge p={x.priority} /></Cell>
              <Cell><TicketStatusBadge s={x.status} /></Cell>
              <Cell>
                {x.status === 'closed' ? <span className="text-xs text-neutral-500">{fmtDateTime(x.closedAt, locale)}</span> : (
                  <div className="flex flex-col">
                    <SlaCountdown label={t(locale, 'mcResponse')} createdAt={x.createdAt} dueAt={x.responseDueAt} metAt={x.firstRespondedAt} breached={x.responseBreached} now={now} />
                    <SlaCountdown label={t(locale, 'mcResolve')} createdAt={x.createdAt} dueAt={x.resolveDueAt} breached={x.resolveBreached} now={now} />
                  </div>
                )}
              </Cell>
              <Cell className="text-xs text-neutral-500">{fmtDateTime(x.updatedAt, locale)}</Cell>
            </Row>
          ))}
        </Table>
      )}
      {cursor && <button className="btn-ghost" onClick={more}>{t(locale, 'mcLoadMore')}</button>}
    </ManagedFrame>
  );
}
