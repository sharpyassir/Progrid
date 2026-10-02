'use client';

import Link from 'next/link';
import { useState } from 'react';
import { money, WWW_URL } from '@/lib/api';
import { Agent, capi, Connection, fmtNum, loadAgentDetails, Overview, Template } from '@/lib/connect';
import { AgentStatusDot, ErrorBox, FourSteps, useC, useLoad } from '@/components/connect/ui';
import { RunDrawer, RunsTable } from '@/components/connect/runs';

export default function ConnectOverviewPage() {
  const { c, cf, locale } = useC();
  const [runId, setRunId] = useState<string | null>(null);
  const overview = useLoad(() => capi<Overview>('/overview'), []);
  const agents = useLoad(() => capi<{ data: Agent[] }>('/agents').then((r) => r.data), []);
  const side = useLoad(async () => {
    const [conns, tpls, details] = await Promise.all([
      capi<{ data: Connection[] }>('/connections').then((r) => r.data.length).catch(() => null),
      capi<{ data: Template[] }>('/templates').then((r) => r.data.length).catch(() => null),
      loadAgentDetails().catch(() => null),
    ]);
    return { conns, tpls, hooks: details?.reduce((n, a) => n + a.webhooks.length, 0) ?? null, keys: details?.reduce((n, a) => n + a.keys.length, 0) ?? null };
  }, []);

  const o = overview.data;
  const list = agents.data ?? [];
  const names = Object.fromEntries(list.map((a) => [a.id, a.name]));
  const empty = o ? o.agents === 0 : agents.data ? list.length === 0 : false;
  const usage = o?.usageThisPeriod;
  const n = (v: number | null | undefined) => (v == null ? '—' : fmtNum(v, locale));

  const cards: { href: string; title: string; desc: string; count?: string; external?: boolean }[] = [
    { href: '/connect/templates', title: c('nTemplates'), desc: c('cardTemplatesD'), count: side.data?.tpls != null ? cf('templatesCount')(side.data.tpls) : undefined },
    { href: '/connect/connections', title: c('nConnections'), desc: c('cardConnectionsD'), count: n(side.data?.conns) },
    { href: '/connect/keys', title: c('nKeys'), desc: c('cardKeysD'), count: n(side.data?.keys) },
    { href: '/connect/webhooks', title: c('nWebhooks'), desc: c('cardWebhooksD'), count: n(side.data?.hooks) },
    { href: '/connect/logs', title: c('nLogs'), desc: c('cardLogsD'), count: o ? n(o.runs24h) : undefined },
    { href: '/connect/usage', title: c('nUsage'), desc: c('cardUsageD'),
      count: usage ? (usage.pricingConfigured && usage.estimatedCostMinor != null ? money(usage.estimatedCostMinor, usage.currency ?? 'USD', locale) : n(usage.executions)) : undefined },
    { href: `${WWW_URL}/docs/connect`, title: c('nDocs'), desc: c('cardDocsD'), external: true },
  ];

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{c('product')}</h1>
          <p className="mt-1 max-w-2xl text-neutral-600 dark:text-neutral-400">{c('positioning')}</p>
        </div>
        <Link href="/connect/agents/new" className="btn-primary px-4 py-2 text-base">+ {c('createAgent')}</Link>
      </section>

      <ErrorBox error={overview.error ?? agents.error} />

      {empty ? (
        <section aria-labelledby="get-started" className="rounded-xl border border-neutral-200 bg-gradient-to-b from-blue-50/60 to-white p-5 dark:border-neutral-800 dark:from-blue-950/20 dark:to-neutral-950">
          <h2 id="get-started" className="text-lg font-semibold">{c('emptyTitle')}</h2>
          <p className="mb-4 text-sm text-neutral-500">{c('emptyBody')}</p>
          <FourSteps links={['/connect/agents/new', undefined, undefined, undefined]} />
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/connect/agents/new" className="btn-primary">{c('createAgent')}</Link>
            <Link href="/connect/agents/new?path=ai" className="btn-ghost">{c('pathAi')}</Link>
            <Link href="/connect/templates" className="btn-ghost">{c('nTemplates')}</Link>
          </div>
        </section>
      ) : (
        <section aria-labelledby="my-agents">
          <div className="mb-3 flex items-center gap-3">
            <h2 id="my-agents" className="flex-1 text-lg font-semibold">{c('myAgents')}</h2>
            <Link href="/connect/agents" className="text-sm text-blue-700 hover:underline dark:text-blue-400">{c('viewAll')}</Link>
          </div>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Stat label={c('nAgents')} value={o ? n(o.agents) : '…'} sub={o ? cf('agentsDeployed')(o.deployed) : undefined} />
            <Stat label={c('runs24h')} value={o ? n(o.runs24h) : '…'} sub={o ? cf('failed24h')(o.failed24h) : undefined} warn={!!o?.failed24h} />
            <Stat label={c('executions')} value={usage?.executions != null ? n(usage.executions) : '—'} sub={c('billingPeriod')} />
          </div>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {list.slice(0, 6).map((a) => (
              <li key={a.id}>
                <Link href={`/connect/agents/${a.id}`} className="card block h-full hover:border-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:border-blue-700">
                  <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate font-medium"><bdi>{a.name}</bdi></span><AgentStatusDot status={a.status} /></div>
                  <p className="mt-1 line-clamp-2 text-sm text-neutral-500"><bdi>{a.description || '—'}</bdi></p>
                  <p className="mt-2 text-xs text-neutral-500">{cf('toolsN')(a.toolIds.length)}{a.deployedVersion ? ` · ${cf('versionN')(a.deployedVersion)}` : ''}</p>
                </Link>
              </li>
            ))}
            <li>
              <Link href="/connect/agents/new" className="flex h-full min-h-24 items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 p-4 text-sm font-medium text-blue-700 hover:border-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-neutral-700 dark:text-blue-400">+ {c('createAgent')}</Link>
            </li>
          </ul>
        </section>
      )}

      <section>
        <ul className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          {cards.map((card) => (
            <li key={card.href}>
              <Link href={card.href} target={card.external ? '_blank' : undefined} rel={card.external ? 'noreferrer' : undefined}
                className="card flex h-full flex-col hover:border-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:border-blue-700">
                <span className="flex items-center gap-2 font-medium">{card.title}{card.external && <span aria-hidden className="text-neutral-400">↗</span>}</span>
                <span className="mt-1 flex-1 text-sm text-neutral-500">{card.desc}</span>
                {card.count !== undefined && <span className="mt-3 text-lg font-semibold tabular-nums">{card.count}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {!empty && (
        <section aria-labelledby="activity">
          <div className="mb-3 flex items-center gap-3">
            <h2 id="activity" className="flex-1 text-lg font-semibold">{c('recentActivity')}</h2>
            <Link href="/connect/logs" className="text-sm text-blue-700 hover:underline dark:text-blue-400">{c('viewAll')}</Link>
          </div>
          {o && o.recentRuns.length === 0 ? <p className="card text-sm text-neutral-500">{c('noRuns')}</p> : o && <RunsTable runs={o.recentRuns} agentNames={names} onSelect={setRunId} />}
        </section>
      )}
      <RunDrawer runId={runId} onClose={() => setRunId(null)} />
    </div>
  );
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className="card min-w-0 p-3 sm:p-4">
      <div className="truncate text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums sm:text-2xl">{value}</div>
      {sub && <div className={`mt-0.5 text-xs ${warn ? 'text-red-700 dark:text-red-400' : 'text-neutral-500'}`}>{sub}</div>}
    </div>
  );
}
