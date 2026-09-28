'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { t, tf } from '@/lib/i18n';
import { AdminShell } from '@/components/admin-shell';
import { useShell } from '@/components/shell';
import { Cell, ErrorBox, Field, Loading, OkBox, Row, Table, ToneBadge, useAccount } from '@/components/managed';
import { errText, fmtDay, fmtPeriod, hours, isLeadRoles, periodOf, type Contract, type Page, type WorkLog } from '@/lib/managed';

interface WorkLogPage extends Page<WorkLog> { totals: { billableMinutes: number; nonBillableMinutes: number } }

/** Engineer time: entries for a month, totals per contract, and a form to add time. */
export default function AdminWorklogs() {
  const { locale } = useShell();
  const { account } = useAccount();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [period, setPeriod] = useState(periodOf(new Date()));
  const [contractId, setContractId] = useState('');
  const [mine, setMine] = useState(false);
  const [data, setData] = useState<WorkLogPage | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lead = account ? isLeadRoles(account.staffRoles) : false;

  useEffect(() => { api<Page<Contract>>('/admin/managed/contracts?limit=200').then((r) => setContracts(r.data)).catch((e) => setError(errText(e))); }, []);
  const load = useCallback(async () => {
    const [y, m] = period.split('-').map(Number);
    const q = new URLSearchParams({ limit: '200', from: new Date(y, m - 1, 1).toISOString(), to: new Date(y, m, 1).toISOString() });
    if (contractId) q.set('contractId', contractId);
    if (mine) q.set('userId', 'me');
    setData(await api<WorkLogPage>(`/admin/managed/worklogs?${q}`));
  }, [period, contractId, mine]);
  useEffect(() => { setData(null); load().catch((e) => setError(errText(e))); }, [load]);

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true); setError(null); setOk(null);
    try { await fn(); if (done) setOk(done); await load(); return true; } catch (e) { setError(errText(e)); return false; } finally { setBusy(false); }
  }
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const minutes = Math.round(Number(f.get('hours') || 0) * 60) + Number(f.get('minutes') || 0);
    const workedAt = String(f.get('workedAt') ?? '');
    const body = { contractId: f.get('contractId'), ticketId: String(f.get('ticketId') ?? '').trim() || undefined, minutes, billable: !!f.get('billable'), note: String(f.get('note') ?? '').trim() || undefined, ...(workedAt ? { workedAt: new Date(`${workedAt}T12:00:00`).toISOString() } : {}) };
    if (await run(() => api('/admin/managed/worklogs', { method: 'POST', body: JSON.stringify(body) }), t(locale, 'admMcTimeLogged'))) { form.reset(); setShowNew(false); }
  }

  const contractName = (id: string) => { const c = contracts.find((x) => x.id === id); return c ? `${c.team?.name ?? c.teamId} · ${c.plan.name}` : id.slice(0, 8); };
  // Totals per contract for the loaded month (the API returns the overall totals only).
  const byContract = useMemo(() => {
    const m = new Map<string, { billable: number; other: number }>();
    for (const w of data?.data ?? []) {
      const x = m.get(w.contractId) ?? { billable: 0, other: 0 };
      if (w.billable) x.billable += w.minutes; else x.other += w.minutes;
      m.set(w.contractId, x);
    }
    return [...m.entries()].sort((a, b) => b[1].billable - a[1].billable);
  }, [data]);
  const truncated = !!data?.meta?.next_cursor;

  return (
    <AdminShell title={t(locale, 'admMcWorklogsTitle')} actions={<button className="btn-primary" onClick={() => setShowNew((v) => !v)}>{t(locale, 'admMcAddTime')}</button>}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input type="month" className="input !w-auto py-1" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} dir="ltr" aria-label={t(locale, 'period')} />
        <select className="input !w-auto py-1" value={contractId} onChange={(e) => setContractId(e.target.value)} aria-label={t(locale, 'admMcContract')}>
          <option value="">{t(locale, 'admMcAllContracts')}</option>
          {contracts.map((c) => <option key={c.id} value={c.id}>{contractName(c.id)}</option>)}
        </select>
        <label className="flex items-center gap-1"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />{t(locale, 'admMcOnlyMine')}</label>
      </div>
      <ErrorBox error={error} />
      <OkBox msg={ok} />

      {showNew && (
        <form onSubmit={add} className="card space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t(locale, 'admMcContract')}>
              <select className="input" name="contractId" required defaultValue={contractId}>
                <option value="" disabled>{t(locale, 'admMcChooseContract')}</option>
                {contracts.filter((c) => c.status !== 'DRAFT').map((c) => <option key={c.id} value={c.id}>{contractName(c.id)}</option>)}
              </select>
            </Field>
            <Field label={t(locale, 'admMcTicketId')} hint={t(locale, 'admMcTicketIdHint')}><input className="input font-mono" name="ticketId" dir="ltr" /></Field>
            <Field label={t(locale, 'admMcWorkedOn')}><input className="input" type="date" name="workedAt" dir="ltr" /></Field>
            <div className="flex items-end gap-2">
              <Field label={t(locale, 'admMcHours')}><input className="input !w-20" name="hours" type="number" min={0} max={24} defaultValue="1" dir="ltr" /></Field>
              <Field label={t(locale, 'admMcMinutes')}><input className="input !w-20" name="minutes" type="number" min={0} max={59} step="5" defaultValue="0" dir="ltr" /></Field>
            </div>
          </div>
          <Field label={t(locale, 'notes')}><input className="input" name="note" maxLength={2000} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="billable" defaultChecked />{t(locale, 'admMcBillableLong')}</label>
          <div className="flex gap-2"><button className="btn-primary" disabled={busy}>{t(locale, 'admMcLog')}</button><button type="button" className="btn-ghost" onClick={() => setShowNew(false)}>{t(locale, 'cancel')}</button></div>
        </form>
      )}

      {!data ? (error ? null : <Loading />) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="card"><div className="text-xs text-neutral-500">{t(locale, 'admMcBillable')}</div><div className="mt-1 text-2xl font-semibold">{hours(data.totals.billableMinutes)} h</div><div className="text-xs text-neutral-500">{fmtPeriod(period, locale)}</div></div>
            <div className="card"><div className="text-xs text-neutral-500">{t(locale, 'admMcNonBillable')}</div><div className="mt-1 text-2xl font-semibold">{hours(data.totals.nonBillableMinutes)} h</div></div>
            <div className="card"><div className="text-xs text-neutral-500">{t(locale, 'admMcEntries')}</div><div className="mt-1 text-2xl font-semibold">{data.data.length}{truncated ? '+' : ''}</div></div>
          </div>

          <section className="space-y-2">
            <h2 className="font-medium">{tf(locale, 'admMcTotalsByContract')(fmtPeriod(period, locale))}</h2>
            {truncated && <p className="text-xs text-amber-700 dark:text-amber-400">{t(locale, 'admMcTotalsTruncated')}</p>}
            <Table head={[t(locale, 'admMcContract'), t(locale, 'admMcBillable'), t(locale, 'admMcNonBillable'), t(locale, 'admMcIncluded'), '']} empty={byContract.length === 0 ? t(locale, 'admMcNoTime') : undefined}>
              {byContract.map(([id, v]) => {
                const c = contracts.find((x) => x.id === id);
                const over = c ? Math.max(0, v.billable - c.includedEngineerMinutes) : 0;
                return (
                  <Row key={id}>
                    <Cell><Link href={`/admin/managed/contracts/${id}`} className="font-medium hover:underline">{contractName(id)}</Link></Cell>
                    <Cell>{hours(v.billable)} h</Cell>
                    <Cell className="text-neutral-500">{hours(v.other)} h</Cell>
                    <Cell className="text-neutral-500">{c ? `${hours(c.includedEngineerMinutes)} h` : '—'}</Cell>
                    <Cell>{over > 0 && <ToneBadge tone="amber">{tf(locale, 'admMcOverBy')(hours(over))}</ToneBadge>}</Cell>
                  </Row>
                );
              })}
            </Table>
          </section>

          <section className="space-y-2">
            <h2 className="font-medium">{t(locale, 'admMcEntries')}</h2>
            <Table head={[t(locale, 'admMcWorkedOn'), t(locale, 'admMcEngineer'), t(locale, 'admMcContract'), t(locale, 'admMcTime'), t(locale, 'notes'), '']} empty={data.data.length === 0 ? t(locale, 'admMcNoTime') : undefined}>
              {data.data.map((w) => (
                <Row key={w.id}>
                  <Cell className="text-xs">{fmtDay(w.workedAt, locale)}</Cell>
                  <Cell>{w.user?.name ?? w.userId}</Cell>
                  <Cell className="text-xs">{contractName(w.contractId)}{w.ticketId && <div><Link href={`/admin/managed/tickets/${w.ticketId}`} className="text-blue-600 hover:underline">{t(locale, 'admMcTicket')}</Link></div>}</Cell>
                  <Cell>{hours(w.minutes)} h {!w.billable && <ToneBadge tone="grey">{t(locale, 'admMcNotBilled')}</ToneBadge>}{w.billedPeriod && <div className="text-xs text-neutral-500">{tf(locale, 'admMcBilledIn')(w.billedPeriod)}</div>}</Cell>
                  <Cell className="text-xs text-neutral-500">{w.note}</Cell>
                  <Cell className="text-end">{(lead || w.userId === account?.user.id) && !w.billedPeriod && <button className="btn-danger" disabled={busy} onClick={() => { if (confirm(t(locale, 'admMcDeleteEntryConfirm'))) run(() => api(`/admin/managed/worklogs/${w.id}`, { method: 'DELETE' })); }}>{t(locale, 'delete')}</button>}</Cell>
                </Row>
              ))}
            </Table>
          </section>
        </>
      )}
    </AdminShell>
  );
}
