'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { t, tf } from '@/lib/i18n';
import { AdminShell } from '@/components/admin-shell';
import { useShell } from '@/components/shell';
import { Cell, ErrorBox, Field, Loading, Row, Table, ToneBadge } from '@/components/managed';
import { errText, fmtDateTime, fmtPeriod, periodOf, type Contract, type Page, type Report } from '@/lib/managed';

/** Monthly reports: drafts to review and send, sent ones, and generating a report by hand. */
export default function AdminReports() {
  const { locale } = useShell();
  const router = useRouter();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [contractId, setContractId] = useState('');
  const [status, setStatus] = useState<'' | 'DRAFT' | 'SENT'>('');
  const [rows, setRows] = useState<Report[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api<Page<Contract>>('/admin/managed/contracts?limit=200').then((r) => setContracts(r.data)).catch((e) => setError(errText(e))); }, []);
  const load = useCallback(async () => {
    const q = new URLSearchParams();
    if (contractId) q.set('contractId', contractId);
    if (status) q.set('status', status);
    setRows((await api<{ data: Report[] }>(`/admin/managed/reports?${q}`)).data);
  }, [contractId, status]);
  useEffect(() => { setRows(null); load().catch((e) => setError(errText(e))); }, [load]);

  async function generate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError(null);
    try {
      const r = await api<Report>(`/admin/managed/reports/${f.get('contractId')}/generate`, { method: 'POST', body: JSON.stringify({ period: f.get('period') }) });
      router.push(`/admin/managed/reports/${r.id}`);
    } catch (err) { setError(errText(err)); setBusy(false); }
  }

  const name = (id: string) => { const c = contracts.find((x) => x.id === id); return c ? c.team?.name ?? c.teamId : id.slice(0, 8); };
  const last = new Date(); last.setMonth(last.getMonth() - 1);

  return (
    <AdminShell title={t(locale, 'admMcReportsTitle')}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select className="input !w-auto py-1" value={contractId} onChange={(e) => setContractId(e.target.value)} aria-label={t(locale, 'admMcContract')}>
          <option value="">{t(locale, 'admMcAllContracts')}</option>
          {contracts.map((c) => <option key={c.id} value={c.id}>{c.team?.name ?? c.teamId} · {c.plan.name}</option>)}
        </select>
        <div className="flex gap-1">
          {(['', 'DRAFT', 'SENT'] as const).map((s) => <button key={s} onClick={() => setStatus(s)} className={`rounded px-2 py-1 ${status === s ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'text-neutral-600 dark:text-neutral-300'}`}>{s ? t(locale, s === 'DRAFT' ? 'admMcDraft' : 'mcSent') : t(locale, 'mcTicketFilter_all')}</button>)}
        </div>
      </div>
      <ErrorBox error={error} />

      <form onSubmit={generate} className="card flex flex-wrap items-end gap-2">
        <div className="min-w-60 flex-1"><Field label={t(locale, 'admMcGenerateFor')}>
          <select className="input" name="contractId" required defaultValue="">
            <option value="" disabled>{t(locale, 'admMcChooseContract')}</option>
            {contracts.filter((c) => c.status !== 'DRAFT').map((c) => <option key={c.id} value={c.id}>{c.team?.name ?? c.teamId} · {c.plan.name}</option>)}
          </select>
        </Field></div>
        <Field label={t(locale, 'period')}><input className="input !w-auto" type="month" name="period" required dir="ltr" defaultValue={periodOf(last)} /></Field>
        <button className="btn-ghost" disabled={busy}>{busy ? t(locale, 'loading') : t(locale, 'admMcGenerate')}</button>
      </form>

      {!rows ? (error ? null : <Loading />) : (
        <Table head={[t(locale, 'period'), t(locale, 'team'), t(locale, 'status'), t(locale, 'uptime'), t(locale, 'mcSla'), t(locale, 'admMcGenerated'), t(locale, 'mcSent')]} empty={rows.length === 0 ? t(locale, 'admMcNoReports') : undefined}>
          {rows.map((r) => {
            const d = r.data;
            const breached = d ? d.sla.responseBreached + d.sla.resolveBreached : 0;
            return (
              <Row key={r.id} onClick={() => router.push(`/admin/managed/reports/${r.id}`)}>
                <Cell><Link href={`/admin/managed/reports/${r.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{fmtPeriod(r.period, locale)}</Link></Cell>
                <Cell>{name(r.contractId)}</Cell>
                <Cell>{r.status === 'SENT' ? <ToneBadge tone="green">{t(locale, 'mcSent')}</ToneBadge> : <ToneBadge tone="amber">{t(locale, 'admMcDraft')}</ToneBadge>}</Cell>
                <Cell dir="ltr">{d?.uptimePercent != null ? `${d.uptimePercent}%` : '—'}</Cell>
                <Cell>{!d ? '—' : breached ? <ToneBadge tone="red">{tf(locale, 'mcSlaBreachedN')(breached)}</ToneBadge> : <ToneBadge tone="green">{t(locale, 'mcSlaAllMet')}</ToneBadge>}</Cell>
                <Cell className="text-xs text-neutral-500">{fmtDateTime(r.generatedAt, locale)}</Cell>
                <Cell className="text-xs text-neutral-500">{fmtDateTime(r.sentAt, locale) || '—'}</Cell>
              </Row>
            );
          })}
        </Table>
      )}
    </AdminShell>
  );
}
