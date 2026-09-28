'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { t, tf } from '@/lib/i18n';
import { AdminShell } from '@/components/admin-shell';
import { useShell } from '@/components/shell';
import { AlertStatusBadge, Empty, ErrorBox, Loading, SeverityBadge, tk, useNow } from '@/components/managed';
import { errText, fmtDateTime, fmtRelative, fmtSpan, type Alert, type Contract, type Page, type Severity } from '@/lib/managed';

const SEVERITIES: Severity[] = ['CRITICAL', 'WARNING', 'INFO'];
type StatusFilter = 'open' | 'FIRING' | 'ACKNOWLEDGED' | 'RESOLVED';

/** Alerts board grouped by severity: acknowledge, resolve and jump to the ticket. */
export default function AdminAlerts() {
  const { locale } = useShell();
  const [status, setStatus] = useState<StatusFilter>('open');
  const [rows, setRows] = useState<Alert[] | null>(null);
  const [teams, setTeams] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const now = useNow();

  const load = useCallback(async () => { setRows((await api<Page<Alert>>(`/admin/managed/alerts?status=${status}&limit=200`)).data); }, [status]);
  useEffect(() => { setRows(null); load().catch((e) => setError(errText(e))); }, [load]);
  // Team names for the contract column.
  useEffect(() => { api<Page<Contract>>('/admin/managed/contracts?limit=200').then((r) => setTeams(Object.fromEntries(r.data.map((c) => [c.id, c.team?.name ?? c.teamId])))).catch(() => undefined); }, []);
  // Keep the board fresh while it is open.
  useEffect(() => { const id = setInterval(() => load().catch(() => undefined), 60_000); return () => clearInterval(id); }, [load]);

  async function act(a: Alert, action: 'ack' | 'resolve') {
    setBusy(a.id); setError(null);
    try {
      if (action === 'ack') await api(`/admin/managed/alerts/${a.id}/ack`, { method: 'POST' });
      else await api(`/admin/managed/alerts/${a.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'RESOLVED' }) });
      await load();
    } catch (e) { setError(errText(e)); } finally { setBusy(null); }
  }

  const statuses: StatusFilter[] = ['open', 'FIRING', 'ACKNOWLEDGED', 'RESOLVED'];
  return (
    <AdminShell title={t(locale, 'admMcAlertsTitle')}>
      <div className="flex flex-wrap gap-1 text-sm">
        {statuses.map((s) => <button key={s} onClick={() => setStatus(s)} className={`rounded px-2 py-1 ${status === s ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'text-neutral-600 dark:text-neutral-300'}`}>{s === 'open' ? t(locale, 'admMcOpenAlertsFilter') : tk(locale, `mcAlertStatus_${s}`)}</button>)}
      </div>
      <ErrorBox error={error} />
      {!rows ? (error ? null : <Loading />) : rows.length === 0 ? <Empty>{status === 'open' ? t(locale, 'admMcNoOpenAlerts') : t(locale, 'admMcNoAlerts')}</Empty> : (
        <div className="grid gap-4 lg:grid-cols-3">
          {SEVERITIES.map((sev) => {
            const group = rows.filter((a) => a.severity === sev);
            return (
              <section key={sev} className="space-y-2">
                <h2 className="flex items-center gap-2 font-medium"><SeverityBadge s={sev} /><span className="text-sm text-neutral-500">{group.length}</span></h2>
                {group.length === 0 && <p className="text-sm text-neutral-500">{t(locale, 'nothingYet')}</p>}
                {group.map((a) => (
                  <div key={a.id} className={`card space-y-2 ${a.status === 'FIRING' && sev === 'CRITICAL' ? 'border-red-300 dark:border-red-900' : ''}`}>
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="break-words font-medium">{a.name}</div>
                        {a.summary && <p className="break-words text-sm text-neutral-600 dark:text-neutral-300">{a.summary}</p>}
                      </div>
                      <AlertStatusBadge s={a.status} />
                    </div>
                    <div className="text-xs text-neutral-500">
                      {a.asset?.name ?? t(locale, 'admMcNoAsset')}{a.contractId && teams[a.contractId] ? <> · <Link href={`/admin/managed/contracts/${a.contractId}`} className="hover:underline">{teams[a.contractId]}</Link></> : null}
                      {' · '}{a.source}
                    </div>
                    <div className="text-xs text-neutral-500" title={fmtDateTime(a.startsAt, locale)}>
                      {tf(locale, 'admMcStarted')(fmtRelative(a.startsAt, locale, now))}
                      {a.resolvedAt ? ` · ${tf(locale, 'admMcLasted')(fmtSpan(new Date(a.resolvedAt).getTime() - new Date(a.startsAt).getTime(), locale))}` : ''}
                      {a.acknowledgedAt && !a.resolvedAt ? ` · ${tf(locale, 'admMcAckedAt')(fmtRelative(a.acknowledgedAt, locale, now))}` : ''}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {a.ticketId && <Link href={`/admin/managed/tickets/${a.ticketId}`} className="btn-ghost">{t(locale, 'admMcOpenTicket')}</Link>}
                      {a.status === 'FIRING' && <button className="btn-primary" disabled={busy === a.id} onClick={() => act(a, 'ack')}>{t(locale, 'admMcAck')}</button>}
                      {a.status !== 'RESOLVED' && <button className="btn-ghost" disabled={busy === a.id} onClick={() => { if (confirm(t(locale, 'admMcResolveConfirm'))) act(a, 'resolve'); }}>{t(locale, 'admMcResolve')}</button>}
                    </div>
                  </div>
                ))}
              </section>
            );
          })}
        </div>
      )}
    </AdminShell>
  );
}
