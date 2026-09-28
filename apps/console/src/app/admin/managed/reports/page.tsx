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

const label = (r: Report) => (r.teamName ? `${r.teamName} · ${r.planName ?? ''}` : r.contractId.slice(0, 8));

/** Monthly reports: drafts to review and send, sent ones, and generating a report by hand. */
export default function AdminReports() {
  const { locale } = useShell();
  const router = useRouter();
  // Contracts seen in the report rows (they carry team and plan names) fill the filter.
  const [known, setKnown] = useState<Map<string, string>>(new Map());
  const [contracts, setContracts] = useState<Contract[] | null>(null);
  const [showGenerate, setShowGenerate] = useState(false);
  const [contractId, setContractId] = useState('');
  const [status, setStatus] = useState<'' | 'DRAFT' | 'SENT'>('');
  const [rows, setRows] = useState<Report[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The contract list is only needed to generate a report by hand, so it loads when that form opens.
  useEffect(() => {
    if (!showGenerate || contracts) return;
    api<Page<Contract>>('/admin/managed/contracts?limit=200').then((r) => setContracts(r.data.filter((c) => c.status !== 'DRAFT'))).catch((e) => setError(errText(e)));
  }, [showGenerate, contracts]);
  const load = useCallback(async () => {
    const q = new URLSearchParams();
    if (contractId) q.set('contractId', contractId);
    if (status) q.set('status', status);
    const data = (await api<{ data: Report[] }>(`/admin/managed/reports?${q}`)).data;
    setRows(data);
    setKnown((m) => { const next = new Map(m); for (const r of data) next.set(r.contractId, label(r)); return next; });
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

  const last = new Date(); last.setMonth(last.getMonth() - 1);

  return (
    <AdminShell title={t(locale, 'admMcReportsTitle')} actions={<button className="btn-primary" onClick={() => setShowGenerate((v) => !v)}>{t(locale, 'admMcGenerateReport')}</button>}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select className="input !w-auto py-1" value={contractId} onChange={(e) => setContractId(e.target.value)} aria-label={t(locale, 'admMcContract')}>
          <option value="">{t(locale, 'admMcAllContracts')}</option>
          {[...known.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <div className="flex gap-1">
          {(['', 'DRAFT', 'SENT'] as const).map((s) => <button key={s} onClick={() => setStatus(s)} className={`rounded px-2 py-1 ${status === s ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'text-neutral-600 dark:text-neutral-300'}`}>{s ? t(locale, s === 'DRAFT' ? 'admMcDraft' : 'mcSent') : t(locale, 'mcTicketFilter_all')}</button>)}
        </div>
      </div>
      <ErrorBox error={error} />

      {showGenerate && (
        <form onSubmit={generate} className="card flex flex-wrap items-end gap-2">
          <div className="min-w-60 flex-1"><Field label={t(locale, 'admMcGenerateFor')}>
            <select className="input" name="contractId" required defaultValue={contractId}>
              <option value="" disabled>{contracts ? t(locale, 'admMcChooseContract') : t(locale, 'loading')}</option>
              {(contracts ?? []).map((c) => <option key={c.id} value={c.id}>{c.team?.name ?? c.teamId} · {c.plan.name}</option>)}
            </select>
          </Field></div>
          <Field label={t(locale, 'period')}><input className="input !w-auto" type="month" name="period" required dir="ltr" defaultValue={periodOf(last)} /></Field>
          <button className="btn-primary" disabled={busy || !contracts}>{busy ? t(locale, 'loading') : t(locale, 'admMcGenerate')}</button>
          <button type="button" className="btn-ghost" onClick={() => setShowGenerate(false)}>{t(locale, 'cancel')}</button>
        </form>
      )}

      {!rows ? (error ? null : <Loading />) : (
        <Table head={[t(locale, 'period'), t(locale, 'team'), t(locale, 'status'), t(locale, 'uptime'), t(locale, 'mcSla'), t(locale, 'admMcGenerated'), t(locale, 'mcSent')]} empty={rows.length === 0 ? t(locale, 'admMcNoReports') : undefined}>
          {rows.map((r) => {
            const d = r.data;
            const breached = d ? d.sla.responseBreached + d.sla.resolveBreached : 0;
            return (
              <Row key={r.id} onClick={() => router.push(`/admin/managed/reports/${r.id}`)}>
                <Cell><Link href={`/admin/managed/reports/${r.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{fmtPeriod(r.period, locale)}</Link></Cell>
                <Cell>{r.teamName ?? r.contractId.slice(0, 8)}{r.planName && <div className="text-xs text-neutral-500">{r.planName}</div>}</Cell>
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
