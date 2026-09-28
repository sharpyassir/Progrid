'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { t, tf } from '@/lib/i18n';
import { useShell } from '@/components/shell';
import { Cell, Empty, ErrorBox, Loading, ManagedFrame, Row, Table, ToneBadge, useAccount } from '@/components/managed';
import { downloadPdf, errText, fmtDay, fmtPeriod, hours, type Contract, type Report } from '@/lib/managed';

/** Monthly reports that were sent to the team, with the PDF. Owners only. */
export default function ManagedReportsPage() {
  const { locale } = useShell();
  const { account, error: accountError } = useAccount();
  const [contract, setContract] = useState<Contract | null | undefined>(undefined);
  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const owner = account?.role === 'owner';

  const load = useCallback(async () => {
    if (!account || account.role !== 'owner') return;
    const cs = (await api<{ data: Contract[] }>('/v1/managed/contracts')).data;
    // Reports of the newest contract that got past the request stage.
    const c = cs.find((x) => x.status !== 'DRAFT') ?? null;
    setContract(c);
    setReports(c ? [...(await api<{ data: Report[] }>(`/v1/managed/contracts/${c.id}/reports`)).data].sort((a, b) => b.period.localeCompare(a.period)) : []);
  }, [account]);
  useEffect(() => { load().catch((e) => setError(errText(e))); }, [load]);

  async function download(r: Report) {
    if (!contract) return;
    setBusy(r.id); setError(null);
    try { await downloadPdf(r.pdfUrl ?? `/v1/managed/contracts/${contract.id}/reports/${r.id}/pdf`, `progrid-managed-report-${r.period}.pdf`); } catch (e) { setError(errText(e)); } finally { setBusy(null); }
  }

  const title = t(locale, 'mcReports');
  if (accountError) return <ManagedFrame title={title} owner={owner}><ErrorBox error={accountError} /></ManagedFrame>;
  if (account && !owner) return <ManagedFrame title={title} owner={owner}><Empty>{t(locale, 'mcReportsOwnerOnly')}</Empty></ManagedFrame>;

  return (
    <ManagedFrame title={title} owner={owner}>
      <p className="max-w-3xl text-sm text-neutral-500">{t(locale, 'mcReportsLead')}</p>
      <ErrorBox error={error} />
      {!reports ? (error ? null : <Loading />) : !contract ? <Empty>{t(locale, 'mcNoContractYet')}</Empty> : (
        <Table head={[t(locale, 'period'), t(locale, 'uptime'), t(locale, 'mcSla'), t(locale, 'mcIncidents'), t(locale, 'mcEngineerTime'), t(locale, 'mcSent'), '']} empty={reports.length === 0 ? t(locale, 'mcNoReports') : undefined}>
          {reports.map((r) => {
            const d = r.data;
            const breached = d ? d.sla.responseBreached + d.sla.resolveBreached : 0;
            const met = d ? d.sla.responseMet + d.sla.resolveMet : 0;
            return (
              <Row key={r.id}>
                <Cell className="font-medium">{fmtPeriod(r.period, locale)}</Cell>
                <Cell dir="ltr">{d?.uptimePercent != null ? `${d.uptimePercent}%` : '—'}</Cell>
                <Cell>{!d ? '—' : breached ? <ToneBadge tone="red">{tf(locale, 'mcSlaBreachedN')(breached)}</ToneBadge> : <ToneBadge tone="green">{t(locale, 'mcSlaAllMet')}</ToneBadge>}{d && <div className="text-xs text-neutral-500">{tf(locale, 'mcSlaMetN')(met)}</div>}</Cell>
                <Cell className="text-neutral-500">{d ? tf(locale, 'mcIncidentsLine')(d.incidents.alerts.critical, d.incidents.alerts.warning) : '—'}</Cell>
                <Cell className="text-neutral-500">{d ? tf(locale, 'mcHoursOf')(hours(d.hours.billableMinutes), hours(d.hours.includedMinutes)) : '—'}</Cell>
                <Cell className="text-xs text-neutral-500">{fmtDay(r.sentAt, locale)}</Cell>
                <Cell className="text-end">{r.hasPdf && <button className="btn-ghost" disabled={busy === r.id} onClick={() => download(r)}>{busy === r.id ? t(locale, 'loading') : t(locale, 'mcDownloadPdf')}</button>}</Cell>
              </Row>
            );
          })}
        </Table>
      )}
    </ManagedFrame>
  );
}
