'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { Key } from '@/lib/i18n';
import type { AssetView } from '@/lib/types';
import { useLoad } from '@/lib/use-load';
import { useShell } from '@/components/ctx';
import { RunList, TicketTable } from '@/components/ops';
import { Card, Empty, ErrorNote, Loading, PageTitle, StatusBadge, Time, Uptime } from '@/components/ui';

export default function AssetPage() {
  const { id } = useParams<{ id: string }>();
  const { t, contractName } = useShell();
  const view = useLoad(() => api<AssetView>(`/ops/v1/assets/${id}`), [id], { pollMs: 60_000 });

  if (view.error && !view.data) return <ErrorNote error={view.error} />;
  if (!view.data) return <Loading />;
  const v = view.data;
  const a = v.asset;

  return (
    <div className="space-y-5">
      <PageTitle title={a.name} sub={[contractName(a.contractId), t(`kind_${a.kind}` as Key), a.os, a.provider].filter(Boolean).join(' · ')}>
        {v.links && (
          <>
            <a className="btn-ghost" href={v.links.metrics} target="_blank" rel="noreferrer noopener">{t('grafanaMetrics')}</a>
            <a className="btn-ghost" href={v.links.logs} target="_blank" rel="noreferrer noopener">{t('lokiLogs')}</a>
          </>
        )}
      </PageTitle>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title={t('health')}>
          <div className="mb-3 flex items-center gap-2"><StatusBadge status={a.health} />{!a.monitoringEnabled && <span className="text-xs text-neutral-500">{t('monitoringOff')}</span>}</div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-neutral-500">{t('lastHeartbeat')}</dt><dd><Time value={a.lastHeartbeatAt} contractId={a.contractId} /></dd>
            <dt className="text-neutral-500">{t('agentStatus')}</dt><dd>{a.heartbeat?.status ?? '-'}</dd>
            <dt className="text-neutral-500">{t('hostname')}</dt><dd className="font-mono text-xs" dir="ltr">{a.heartbeat?.hostname ?? '-'}</dd>
            <dt className="text-neutral-500">{t('uptime')}</dt><dd>{a.heartbeat?.uptimeSeconds != null ? <Uptime s={a.heartbeat.uptimeSeconds} /> : '-'}</dd>
            <dt className="text-neutral-500">{t('managementAddress')}</dt><dd className="font-mono text-xs" dir="ltr">{a.managementAddress ?? '-'}</dd>
          </dl>
          {!v.links && <p className="mt-3 text-xs text-neutral-500">{t('noGrafana')}</p>}
          {a.notes && <p dir="auto" className="mt-3 whitespace-pre-wrap text-start rounded-md bg-neutral-50 p-2 text-sm dark:bg-neutral-800/50">{a.notes}</p>}
        </Card>

        <Card title={t('recentAlerts')} className="lg:col-span-2">
          {v.recentAlerts.length ? (
            <ul className="divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
              {v.recentAlerts.map((al) => (
                <li key={al.id} className="flex flex-wrap items-center gap-2 py-1.5">
                  <StatusBadge status={al.severity} /><span className="font-mono" dir="ltr">{al.name}</span><StatusBadge status={al.status} />
                  <bdi className="text-neutral-500">{al.summary}</bdi>
                  <span className="ms-auto text-xs text-neutral-500"><Time value={al.startsAt} contractId={al.contractId} /></span>
                  {al.ticketId && <Link className="text-xs text-blue-600 hover:underline" href={`/tickets/${al.ticketId}`}>{t('openTicket')}</Link>}
                </li>
              ))}
            </ul>
          ) : <Empty>{t('noAlerts')}</Empty>}
        </Card>
      </div>

      <Card title={t('openTickets')}><TicketTable tickets={v.openTickets} showAssignee /></Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={t('maintenanceHistory')}><RunList runs={v.maintenanceHistory} contractId={a.contractId} /></Card>
        <Card title={t('backups')}>
          <p className="mb-2 text-sm">{v.backups.enabled ? t('backupsOn') : t('backupsOff')}</p>
          <h3 className="mb-1 text-xs font-medium text-neutral-500">{t('backupTests')}</h3>
          <RunList runs={v.backups.tests} contractId={a.contractId} />
        </Card>
      </div>

      <Card title={t('responsibilityMatrix')}>
        {v.responsibilities.length ? (
          <table className="table">
            <thead><tr><th>{t('area')}</th><th>{t('owner')}</th><th className="w-full">{t('notes')}</th></tr></thead>
            <tbody>
              {v.responsibilities.map((r) => (
                <tr key={r.id}><td className="whitespace-nowrap font-medium"><bdi>{r.area}</bdi></td><td><StatusBadge status={r.owner} /></td><td dir="auto" className="text-start text-neutral-600 dark:text-neutral-300">{r.notes}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <Empty>{t('none')}</Empty>}
      </Card>
    </div>
  );
}
