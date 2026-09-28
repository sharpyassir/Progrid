'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { t, tf } from '@/lib/i18n';
import { AdminShell } from '@/components/admin-shell';
import { useShell } from '@/components/shell';
import { Cell, ErrorBox, Loading, OkBox, Row, Table, tk, ToneBadge } from '@/components/managed';
import { downloadPdf, errText, fmtDateTime, fmtPeriod, hours, type Report } from '@/lib/managed';

/** One monthly report: the data summary, the engineer's recommendations, send, regenerate and PDF. */
export default function AdminReportDetail() {
  const { id } = useParams<{ id: string }>();
  const { locale } = useShell();
  const [r, setR] = useState<Report | null>(null);
  const [recs, setRecs] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const rep = await api<Report>(`/admin/managed/reports/${id}`);
    setR(rep); setRecs(rep.recommendations ?? '');
  }, [id]);
  useEffect(() => { load().catch((e) => setLoadError(errText(e))); }, [load]);

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true); setError(null); setOk(null);
    try { await fn(); setOk(done); await load(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }

  const title = r ? `${fmtPeriod(r.period, locale)}${r.teamName ? `: ${r.teamName}` : ''}` : t(locale, 'admMcReportsTitle');
  if (loadError) return <AdminShell title={title}><ErrorBox error={loadError} /></AdminShell>;
  if (!r) return <AdminShell title={title}><Loading /></AdminShell>;
  const d = r.data;
  const draft = r.status === 'DRAFT';
  const dirty = recs !== (r.recommendations ?? '');

  return (
    <AdminShell title={title} actions={<Link href="/admin/managed/reports" className="btn-ghost">{t(locale, 'back')}</Link>}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {draft ? <ToneBadge tone="amber">{t(locale, 'admMcDraft')}</ToneBadge> : <ToneBadge tone="green">{t(locale, 'mcSent')}</ToneBadge>}
        <span className="text-neutral-500">{tf(locale, 'admMcGeneratedAt')(fmtDateTime(r.generatedAt, locale))}{r.sentAt ? ` · ${tf(locale, 'admMcSentAt')(fmtDateTime(r.sentAt, locale))}` : ''}</span>
        <Link href={`/admin/managed/contracts/${r.contractId}`} className="text-blue-600 hover:underline">{r.planName ? `${t(locale, 'admMcContract')}: ${r.planName}` : t(locale, 'admMcContract')}</Link>
        <div className="ms-auto flex flex-wrap gap-2">
          {r.hasPdf && <button className="btn-ghost" disabled={busy} onClick={() => run(() => downloadPdf(`/admin/managed/reports/${r.id}/pdf`, `progrid-managed-report-${r.period}.pdf`), t(locale, 'admMcDownloaded'))}>{t(locale, 'mcDownloadPdf')}</button>}
          <button className="btn-ghost" disabled={busy} onClick={() => { if (confirm(t(locale, 'admMcRegenerateConfirm'))) run(() => api(`/admin/managed/reports/${r.contractId}/generate`, { method: 'POST', body: JSON.stringify({ period: r.period }) }), t(locale, 'admMcRegenerated')); }}>{t(locale, 'admMcRegenerate')}</button>
          {draft && <button className="btn-primary" disabled={busy || dirty || !r.hasPdf} title={dirty ? t(locale, 'admMcSaveFirst') : undefined} onClick={() => { if (confirm(t(locale, 'admMcSendConfirm'))) run(() => api(`/admin/managed/reports/${r.id}/send`, { method: 'POST' }), t(locale, 'admMcReportSent')); }}>{t(locale, 'admMcSendReport')}</button>}
        </div>
      </div>
      <ErrorBox error={error} />
      <OkBox msg={ok} />

      {!d ? <p className="text-sm text-neutral-500">{t(locale, 'admMcNoData')}</p> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatBox label={t(locale, 'uptime')} value={d.uptimePercent != null ? `${d.uptimePercent}%` : '—'} tone={d.uptimePercent != null && d.uptimePercent < 99.5 ? 'warn' : undefined} />
            <StatBox label={t(locale, 'mcIncidents')} value={String(d.incidents.alerts.total)} sub={tf(locale, 'mcIncidentsLine')(d.incidents.alerts.critical, d.incidents.alerts.warning)} tone={d.incidents.alerts.critical ? 'bad' : undefined} />
            <StatBox label={t(locale, 'mcSla')} value={`${d.sla.responseMet + d.sla.resolveMet} / ${d.sla.responseMet + d.sla.resolveMet + d.sla.responseBreached + d.sla.resolveBreached}`} sub={tf(locale, 'admMcSlaLine')(d.sla.tickets, d.sla.responseBreached, d.sla.resolveBreached)} tone={d.sla.responseBreached + d.sla.resolveBreached ? 'bad' : undefined} />
            <StatBox label={t(locale, 'mcEngineerTime')} value={`${hours(d.hours.billableMinutes)} / ${hours(d.hours.includedMinutes)} h`} sub={d.hours.overageMinutes ? tf(locale, 'admMcOverBy')(hours(d.hours.overageMinutes)) : tf(locale, 'mcNonBillable')(hours(d.hours.nonBillableMinutes))} tone={d.hours.overageMinutes ? 'warn' : undefined} />
            <StatBox label={t(locale, 'admMcPatchRuns')} value={`${d.patches.succeeded} / ${d.patches.runs}`} sub={d.patches.failed ? tf(locale, 'admMcFailedN')(d.patches.failed) : undefined} tone={d.patches.failed ? 'warn' : undefined} />
            <StatBox label={t(locale, 'admMcBackupTests')} value={`${d.backupTests.succeeded} / ${d.backupTests.runs}`} sub={d.backupTests.failed ? tf(locale, 'admMcFailedN')(d.backupTests.failed) : undefined} tone={d.backupTests.failed ? 'warn' : undefined} />
            <StatBox label={t(locale, 'mcPlan')} value={d.plan.name} sub={`${tk(locale, `mcCoverage_${d.plan.coverage}`, d.plan.coverage)} · ${d.calendar}`} />
          </div>

          <section className="space-y-2">
            <h2 className="font-medium">{t(locale, 'admMcUptimePerAsset')}</h2>
            <Table head={[t(locale, 'name'), t(locale, 'mcKind'), t(locale, 'admMcObserved'), t(locale, 'admMcDowntime'), t(locale, 'uptime')]} empty={d.assets.length === 0 ? t(locale, 'nothingYet') : undefined}>
              {d.assets.map((a) => (
                <Row key={a.id}>
                  <Cell className="font-medium">{a.name}</Cell>
                  <Cell className="text-neutral-500">{tk(locale, `mcKind_${a.kind}`, a.kind)}</Cell>
                  <Cell className="text-neutral-500">{hours(a.observedMinutes)} h</Cell>
                  <Cell className={a.downtimeMinutes ? 'text-red-700 dark:text-red-400' : 'text-neutral-500'}>{a.downtimeMinutes} {t(locale, 'minutesShort')}</Cell>
                  <Cell dir="ltr">{a.uptimePercent != null ? `${a.uptimePercent}%` : '—'}</Cell>
                </Row>
              ))}
            </Table>
          </section>

          {d.incidents.majorTickets.length > 0 && (
            <section className="space-y-2">
              <h2 className="font-medium">{t(locale, 'admMcMajorTickets')}</h2>
              <Table head={['#', t(locale, 'subject'), t(locale, 'priority'), t(locale, 'admMcOpened'), t(locale, 'mcTicketStatus_closed')]}>
                {d.incidents.majorTickets.map((x) => (
                  <Row key={x.id}>
                    <Cell className="text-neutral-500">{x.number}</Cell>
                    <Cell><Link href={`/admin/managed/tickets/${x.id}`} className="hover:underline">{x.subject}</Link></Cell>
                    <Cell>{x.priority}</Cell>
                    <Cell className="text-xs">{fmtDateTime(x.openedAt, locale)}</Cell>
                    <Cell className="text-xs">{fmtDateTime(x.closedAt, locale) || '—'}</Cell>
                  </Row>
                ))}
              </Table>
            </section>
          )}
        </>
      )}

      <section className="space-y-2">
        <h2 className="font-medium">{t(locale, 'admMcRecommendations')}</h2>
        <p className="text-xs text-neutral-500">{draft ? t(locale, 'admMcRecommendationsHint') : t(locale, 'admMcRecommendationsLocked')}</p>
        <textarea className="input min-h-40" value={recs} onChange={(e) => setRecs(e.target.value)} readOnly={!draft} maxLength={10000} dir="auto" />
        {draft && <button className="btn-primary" disabled={busy || !dirty} onClick={() => run(() => api(`/admin/managed/reports/${r.id}`, { method: 'PATCH', body: JSON.stringify({ recommendations: recs }) }), t(locale, 'admMcRecommendationsSaved'))}>{t(locale, 'save')}</button>}
      </section>
    </AdminShell>
  );
}

function StatBox({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' | 'bad' }) {
  return (
    <div className={`card ${tone === 'bad' ? 'border-red-300 dark:border-red-900' : tone === 'warn' ? 'border-amber-300 dark:border-amber-800' : ''}`}>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-xl font-semibold" dir="auto">{value}</div>
      {sub && <div className="text-xs text-neutral-500">{sub}</div>}
    </div>
  );
}
