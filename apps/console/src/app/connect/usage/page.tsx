'use client';

import Link from 'next/link';
import { useState } from 'react';
import { money } from '@/lib/api';
import { fmtBytes } from '@/lib/format';
import { Agent, capi, fmtNum, UsageReport } from '@/lib/connect';
import { ErrorBox, PageHeader, TableCard, Td, Th, useC, useLoad } from '@/components/connect/ui';

/** The last twelve billing periods, newest first, as YYYY-MM. */
function periods() {
  const d = new Date();
  return Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
}

export default function UsagePage() {
  const { c, cf, locale } = useC();
  const [period, setPeriod] = useState(periods()[0]);
  const { data, error } = useLoad(() => capi<UsageReport>(`/usage?period=${period}`), [period]);
  const agents = useLoad(() => capi<{ data: Agent[] }>('/agents').then((r) => r.data), []).data ?? [];
  const n = (v: number | undefined) => fmtNum(v ?? null, locale);
  const t = data?.totals;
  const cost = !data ? '…' : data.pricingConfigured ? money(data.estimatedCostMinor, data.currency, locale) : c('pricingNotSet');
  const monthLabel = (p: string) => new Date(`${p}-01T00:00:00Z`).toLocaleDateString(locale === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  // Every day of the period, so one busy day is not drawn as the whole chart.
  const days = (() => {
    if (!data) return [];
    const [y, m] = period.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const out: { date: string; executions: number }[] = [];
    for (let d = 1; d <= last; d++) {
      const date = `${period}-${String(d).padStart(2, '0')}`;
      out.push({ date, executions: data.byDay.find((x) => x.date === date)?.executions ?? 0 });
    }
    return out;
  })();
  const max = Math.max(1, ...days.map((d) => d.executions));
  const cards: [string, string][] = t ? [
    [c('executions'), n(t.executions)], [c('workflowExecutions'), n(t.workflowExecutions)], [c('aiInput'), n(t.aiInputTokens)], [c('aiOutput'), n(t.aiOutputTokens)],
    [c('aiCache'), n(t.aiCacheReadTokens)], [c('toolCalls'), n(t.toolCalls)], [c('apiCalls'), n(t.apiCalls)], [c('compute'), cf('seconds')(n(t.computeSeconds))], [c('storage'), fmtBytes(t.storageBytes)],
  ] : [];
  return (
    <div>
      <PageHeader title={c('nUsage')} subtitle={c('usageNote')} actions={
        <label className="flex items-center gap-2 whitespace-nowrap text-sm">{c('billingPeriod')}
          <select className="input w-auto py-1.5" value={period} onChange={(e) => setPeriod(e.target.value)}>{periods().map((p) => <option key={p} value={p}>{monthLabel(p)}</option>)}</select>
        </label>} />
      <div className="space-y-5">
        <ErrorBox error={error} />
        <section className="card flex flex-wrap items-end gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-sm text-neutral-500">{c('estimatedCost')} · {monthLabel(period)}</div>
            <div className={`mt-1 font-semibold ${data && !data.pricingConfigured ? 'text-xl text-neutral-600 dark:text-neutral-300' : 'text-3xl tabular-nums'}`}>{cost}</div>
            {data && !data.pricingConfigured && <p className="mt-1 text-sm text-neutral-500">{c('pricingNotSetNote')}</p>}
          </div>
          <Link href="/billing" className="btn-ghost">{c('seeBilling')}</Link>
        </section>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {cards.map(([k, v]) => <div key={k} className="card min-w-0"><dt className="truncate text-xs text-neutral-500">{k}</dt><dd className="mt-1 truncate text-xl font-semibold tabular-nums">{v}</dd></div>)}
        </dl>
        {data && data.byDay.length > 0 && days.length > 0 && (
          <section className="card">
            <h2 className="mb-3 font-semibold">{c('perDay')}</h2>
            <div className="flex h-32 items-end gap-1" role="img" aria-label={c('perDay')} dir="ltr">
              {days.map((d) => (
                <div key={d.date} className="group relative flex h-full min-w-0 flex-1 items-end" title={`${d.date}: ${d.executions}`}>
                  <div className="w-full rounded-t bg-blue-600/80 dark:bg-blue-500/80" style={{ height: d.executions ? `${Math.max(2, (d.executions / max) * 100)}%` : '0' }} />
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-xs text-neutral-500" dir="ltr"><span>{days[0].date}</span><span>{days[days.length - 1].date}</span></div>
          </section>
        )}
        {data && data.byAgent.length > 0 && (
          <section>
            <h2 className="mb-2 font-semibold">{c('byAgent')}</h2>
            <TableCard>
              <thead><tr><Th>{c('agent')}</Th><Th end>{c('executions')}</Th><Th end>{c('aiInput')}</Th><Th end>{c('aiOutput')}</Th><Th end>{c('toolCalls')}</Th><Th end>{c('estimatedCost')}</Th></tr></thead>
              <tbody>
                {data.byAgent.map((r) => (
                  <tr key={r.agentId} className="border-t border-neutral-100 dark:border-neutral-800">
                    <Td className="whitespace-nowrap"><Link href={`/connect/agents/${r.agentId}?tab=usage`} className="text-blue-700 hover:underline dark:text-blue-400">{r.agentName ?? agents.find((a) => a.id === r.agentId)?.name ?? r.agentId}{r.deleted ? ` (${c('deletedAgent')})` : ''}</Link></Td>
                    <Td className="text-end tabular-nums">{n(r.executions)}</Td><Td className="text-end tabular-nums">{n(r.aiInputTokens)}</Td><Td className="text-end tabular-nums">{n(r.aiOutputTokens)}</Td><Td className="text-end tabular-nums">{n(r.toolCalls)}</Td>
                    <Td className="whitespace-nowrap text-end">{data.pricingConfigured && r.estimatedCostMinor != null ? money(r.estimatedCostMinor, data.currency, locale) : '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </TableCard>
          </section>
        )}
      </div>
    </div>
  );
}
