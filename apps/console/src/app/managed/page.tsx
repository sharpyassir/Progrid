'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { t, tf } from '@/lib/i18n';
import { useShell } from '@/components/shell';
import { AssetStatusBadge, Cell, ContractStatusBadge, Empty, ErrorBox, HealthBadge, Loading, ManagedFrame, PriorityBadge, Row, SlaCountdown, Table, TicketStatusBadge, tk, useAccount, useNow } from '@/components/managed';
import { CoverageLabel, PlanCard, PlanPrice, TargetList } from '@/components/managed-plans';
import { errText, fmtDay, fmtPeriod, hours, type Asset, type Contract, type Page, type Plan, type Report, type Ticket } from '@/lib/managed';

interface Data { plans: Plan[]; contracts: Contract[]; contract: Contract | null; assets: Asset[]; tickets: Ticket[]; report: Report | null }

/**
 * Managed cloud overview. Without a contract it shows the plans and the request flow; with one it
 * shows the plan, status, onboarding progress, SLA, assets, open tickets and the latest uptime.
 */
export default function ManagedOverview() {
  const { locale } = useShell();
  const { account, error: accountError } = useAccount();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow();
  const owner = account?.role === 'owner';

  const load = useCallback(async () => {
    if (!account) return;
    const [plans, assets, tickets] = await Promise.all([
      api<{ data: Plan[] }>('/v1/managed/plans'),
      api<{ data: Asset[] }>('/v1/managed/assets'),
      api<Page<Ticket>>('/v1/managed/tickets?status=all&limit=100'),
    ]);
    let contracts: Contract[] = [];
    let contract: Contract | null = null;
    let report: Report | null = null;
    if (account.role === 'owner') {
      contracts = (await api<{ data: Contract[] }>('/v1/managed/contracts')).data;
      const current = contracts.find((c) => c.status !== 'CANCELLED');
      if (current) {
        contract = await api<Contract>(`/v1/managed/contracts/${current.id}`);
        if (current.status !== 'DRAFT') {
          const reports = (await api<{ data: Report[] }>(`/v1/managed/contracts/${current.id}/reports`)).data;
          report = [...reports].sort((a, b) => b.period.localeCompare(a.period))[0] ?? null;
        }
      }
    }
    setData({ plans: plans.data, contracts, contract, assets: contract ? assets.data.filter((a) => a.contractId === contract.id) : assets.data, tickets: tickets.data, report });
  }, [account]);
  useEffect(() => { load().catch((e) => setError(errText(e))); }, [load]);

  const title = t(locale, 'mcTitle');
  if (accountError || error) return <ManagedFrame title={title} owner={owner}><ErrorBox error={accountError ?? error} /></ManagedFrame>;
  if (!account || !data) return <ManagedFrame title={title} owner={owner}><Loading /></ManagedFrame>;

  const { plans, contract, assets, tickets, report } = data;
  const openTickets = tickets.filter((x) => x.status !== 'closed');
  // A member cannot read contracts; assets or tickets tell us the team has one.
  const hasContract = owner ? !!contract : assets.length > 0 || tickets.length > 0;

  if (!hasContract) {
    const cancelled = data.contracts.find((c) => c.status === 'CANCELLED');
    return (
      <ManagedFrame title={title} owner={owner}>
        <section className="space-y-2">
          <p className="max-w-3xl text-sm text-neutral-600 dark:text-neutral-300">{t(locale, 'mcPitch')}</p>
          {cancelled && <p className="text-sm text-neutral-500">{tf(locale, 'mcPreviousCancelled')(cancelled.plan.name, fmtDay(cancelled.cancelledAt, locale))}</p>}
          {!owner && <p className="rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{t(locale, 'mcOwnerOnly')}</p>}
        </section>
        {plans.length === 0
          ? <Empty>{t(locale, 'mcNoPlans')}</Empty>
          : <div className="grid gap-3 md:grid-cols-3">{plans.map((p) => <PlanCard key={p.id} plan={p} canRequest={owner} highlight={p.code === 'BUSINESS'} />)}</div>}
        <p className="text-xs text-neutral-500">{t(locale, 'mcPlansFootnote')}</p>
      </ManagedFrame>
    );
  }

  return (
    <ManagedFrame title={title} owner={owner} actions={<Link href="/managed/tickets?new=1" className="btn-primary">{t(locale, 'newTicket')}</Link>}>
      {contract && <ContractSummary contract={contract} />}
      {!owner && <p className="text-sm text-neutral-500">{t(locale, 'mcMemberNote')}</p>}

      {contract && contract.status !== 'DRAFT' && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label={t(locale, 'mcUptimeLastMonth')} value={report?.data?.uptimePercent != null ? `${report.data.uptimePercent}%` : '—'} sub={report ? fmtPeriod(report.period, locale) : t(locale, 'mcNoReportYet')} />
          <StatCard label={t(locale, 'mcOpenTickets')} value={String(openTickets.length)} sub={tf(locale, 'mcBreachedCount')(openTickets.filter((x) => x.breachedAt).length)} tone={openTickets.some((x) => x.breachedAt) ? 'bad' : undefined} />
          <StatCard label={t(locale, 'mcAssets')} value={String(assets.filter((a) => a.status === 'APPROVED').length)} sub={tf(locale, 'mcAssetsPending')(assets.filter((a) => a.status === 'PENDING').length)} tone={assets.some((a) => a.health === 'UNHEALTHY') ? 'bad' : assets.some((a) => a.health === 'DEGRADED') ? 'warn' : undefined} />
          {contract.usage && <StatCard label={t(locale, 'mcEngineerTime')} value={`${hours(contract.usage.billableMinutes)} / ${hours(contract.usage.includedMinutes)}`} sub={t(locale, 'mcHoursUsedThisMonth')} tone={contract.usage.overageMinutes > 0 ? 'warn' : undefined} />}
        </div>
      )}

      <section className="space-y-2">
        <div className="flex items-center gap-2"><h2 className="font-medium">{t(locale, 'mcAssets')}</h2><Link href="/managed/assets" className="ms-auto text-sm text-blue-600 hover:underline">{t(locale, 'mcViewAll')}</Link></div>
        <Table head={[t(locale, 'name'), t(locale, 'mcKind'), t(locale, 'status'), t(locale, 'mcHealth'), t(locale, 'mcOpenAlerts')]} empty={assets.length === 0 ? t(locale, 'mcNoAssets') : undefined}>
          {assets.slice(0, 8).map((a) => (
            <Row key={a.id}>
              <Cell><span className="font-medium">{a.name}</span>{a.address && <div className="font-mono text-xs text-neutral-500" dir="ltr">{a.address}</div>}</Cell>
              <Cell className="text-neutral-500">{tk(locale, `mcKind_${a.kind}`, a.kind)}</Cell>
              <Cell><AssetStatusBadge s={a.status} /></Cell>
              <Cell>{a.status === 'APPROVED' ? <HealthBadge h={a.health} /> : '—'}</Cell>
              <Cell className={a.openAlerts ? 'font-medium text-red-700 dark:text-red-400' : 'text-neutral-500'}>{a.openAlerts ?? 0}</Cell>
            </Row>
          ))}
        </Table>
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2"><h2 className="font-medium">{t(locale, 'mcOpenTickets')}</h2><Link href="/managed/tickets" className="ms-auto text-sm text-blue-600 hover:underline">{t(locale, 'mcViewAll')}</Link></div>
        <Table head={['#', t(locale, 'subject'), t(locale, 'priority'), t(locale, 'status'), t(locale, 'mcSlaTimeLeft')]} empty={openTickets.length === 0 ? t(locale, 'mcNoOpenTickets') : undefined}>
          {openTickets.slice(0, 8).map((tk2) => (
            <Row key={tk2.id}>
              <Cell className="text-neutral-500">{tk2.number}</Cell>
              <Cell><Link href={`/managed/tickets/${tk2.id}`} className="font-medium hover:underline">{tk2.subject}</Link></Cell>
              <Cell><PriorityBadge p={tk2.priority} /></Cell>
              <Cell><TicketStatusBadge s={tk2.status} /></Cell>
              <Cell>
                <div className="flex flex-col">
                  <SlaCountdown label={t(locale, 'mcResponse')} createdAt={tk2.createdAt} dueAt={tk2.responseDueAt} metAt={tk2.firstRespondedAt} breached={tk2.responseBreached} now={now} />
                  <SlaCountdown label={t(locale, 'mcResolve')} createdAt={tk2.createdAt} dueAt={tk2.resolveDueAt} metAt={tk2.closedAt} breached={tk2.resolveBreached} now={now} />
                </div>
              </Cell>
            </Row>
          ))}
        </Table>
      </section>

      {owner && (
        <div className="flex flex-wrap gap-2 text-sm">
          <Link href="/managed/contract" className="btn-ghost">{t(locale, 'mcContractDetails')}</Link>
          <Link href="/managed/reports" className="btn-ghost">{t(locale, 'mcReports')}</Link>
        </div>
      )}
    </ManagedFrame>
  );
}

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' | 'bad' }) {
  return (
    <div className={`card ${tone === 'bad' ? 'border-red-300 dark:border-red-900' : tone === 'warn' ? 'border-amber-300 dark:border-amber-900' : ''}`}>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold" dir="ltr">{value}</div>
      {sub && <div className="text-xs text-neutral-500">{sub}</div>}
    </div>
  );
}

/** Plan, status, onboarding progress and the SLA of the current contract. */
function ContractSummary({ contract: c }: { contract: Contract }) {
  const { locale } = useShell();
  const ob = c.onboarding;
  const pct = ob && ob.total ? Math.round((ob.done / ob.total) * 100) : 0;
  return (
    <section className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-medium">{c.plan.name}</h2>
          <ContractStatusBadge s={c.status} />
          <span className="text-sm text-neutral-500"><CoverageLabel coverage={c.plan.coverage} /></span>
        </div>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">{tk(locale, `mcStatusNote_${c.status}`)}</p>
        {c.monthlyFeeMinor !== null && <PlanPrice plan={{ priceMinor: c.monthlyFeeMinor, currency: c.currency }} large={false} />}
        {c.status === 'ONBOARDING' && ob && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm"><span className="font-medium">{t(locale, 'mcOnboarding')}</span><span className="text-neutral-500">{tf(locale, 'mcStepsDone')(ob.done, ob.total)}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"><div className="h-full rounded-full bg-blue-600" style={{ width: `${pct}%` }} /></div>
            <ul className="space-y-1 text-sm">
              {ob.items.map((i) => <li key={i.id} className="flex items-start gap-2"><span aria-hidden className={i.done ? 'text-green-600' : 'text-neutral-400'}>{i.done ? '✓' : '○'}</span><span className={i.done ? 'text-neutral-500' : ''}>{tk(locale, `mcOnboard_${i.key}`, i.title)}</span></li>)}
            </ul>
          </div>
        )}
        {c.status === 'DRAFT' && <p className="text-xs text-neutral-500">{tf(locale, 'mcRequestedOn')(fmtDay(c.createdAt, locale))}</p>}
      </div>
      <div className="card space-y-2">
        <h3 className="font-medium">{t(locale, 'mcSla')}</h3>
        <p className="text-xs text-neutral-500">{c.sla.businessHours ? tf(locale, 'mcBusinessHoursNote')(tk(locale, `mcCalendar_${c.calendar}`), c.sla.businessHours.start, c.sla.businessHours.end) : t(locale, 'mcAllHoursNote')}</p>
        <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">{t(locale, 'mcResponseTargets')}</div>
        <TargetList targets={c.sla.responseTargets} coverage={c.sla.coverage} />
      </div>
    </section>
  );
}
