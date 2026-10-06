'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, money, type Balance, type Server } from '@/lib/api';
import { ht, type HomeKey } from '@/lib/i18n-home';
import { useShell } from '@/components/shell';
import { MetricsChart } from '@/components/metrics-chart';
import { StatusBadge } from '@/components/status-badge';
import type { MetricSeries } from '@/components/server-metrics';

type Account = { user?: { name: string }; team?: { name: string } };
type Counted = 'volumes' | 'databases' | 'buckets' | 'loadBalancers' | 'domains';

const PERIODS = [['1h', 'period1h'], ['6h', 'period6h'], ['24h', 'period24h'], ['7d', 'period7d']] as const;
/** Resource counts on the home page: label, console page, API list. */
const COUNTED: [Counted, string, string][] = [
  ['volumes', '/volumes', '/v1/volumes'], ['databases', '/databases', '/v1/databases'], ['buckets', '/buckets', '/v1/buckets'],
  ['loadBalancers', '/load-balancers', '/v1/load-balancers'], ['domains', '/dns', '/v1/domains'],
];
const QUICK: [HomeKey, string, string][] = [
  ['qaServer', '/servers/new', '+'], ['qaTicket', '/support', '?'], ['qaInvite', '/team', '@'],
  ['qaBilling', '/billing', '$'], ['qaSshKey', '/ssh-keys', '#'], ['qaApiKey', '/agents', '*'],
];

const dateLocale = (l: string) => (l === 'ar' ? 'ar-u-nu-latn' : l === 'tr' ? 'tr-TR' : 'en-US');

/**
 * The console home: who is signed in, what this month will cost, shortcuts to common tasks, a count
 * of everything the team runs and live charts for one server.
 */
export default function Home() {
  const { locale } = useShell();
  const [account, setAccount] = useState<Account | null>(null);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [servers, setServers] = useState<Server[] | null>(null);
  const [counts, setCounts] = useState<Partial<Record<Counted, number>>>({});

  useEffect(() => {
    api<Account>('/v1/account').then(setAccount).catch(() => undefined);
    api<Balance>('/v1/billing/balance').then(setBalance).catch(() => undefined);
    api<{ data: Server[] }>('/v1/servers').then((r) => setServers(r.data)).catch(() => setServers([]));
    for (const [k, , path] of COUNTED) {
      api<{ data: unknown[] }>(path).then((r) => setCounts((c) => ({ ...c, [k]: r.data?.length ?? 0 }))).catch(() => undefined);
    }
  }, []);

  const h = (k: HomeKey, vars?: Record<string, string>) => ht(locale, k, vars);
  const first = account?.user?.name?.trim().split(/\s+/)[0];
  const isNew = servers !== null && servers.length === 0;
  const title = isNew ? h('welcomeNew') : first ? h('welcomeBack', { name: first }) : h('welcomeBackPlain');

  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="text-sm text-neutral-500">{new Date().toLocaleDateString(dateLocale(locale), { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' })}</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">{title}</h1>
          {account?.team?.name && (
            <Link href="/team" className="mt-2 inline-flex items-center gap-2 text-sm">
              <span aria-hidden className="grid h-6 w-6 place-items-center rounded-full bg-violet-600 text-[10px] font-semibold text-white">{account.team.name.slice(0, 2).toUpperCase()}</span>
              <span className="border-b border-dashed border-neutral-400">{account.team.name}</span>
            </Link>
          )}
        </div>
        <Spend balance={balance} />
      </section>

      <section className="card overflow-hidden border-blue-200 bg-gradient-to-br from-blue-50 to-white p-6 dark:border-blue-900 dark:from-blue-950/40 dark:to-neutral-900">
        <p className="text-sm font-medium text-blue-600 dark:text-blue-400">{h('featuredKicker')}</p>
        <h2 className="mt-1 text-xl font-bold">{h('featuredTitle')}</h2>
        <p className="mt-2 max-w-2xl text-sm text-neutral-600 dark:text-neutral-300">{h('featuredBody')}</p>
        <Link href="/connect" className="btn-primary mt-4 rounded-full px-5 py-2">{h('featuredCta')}</Link>
      </section>

      <section>
        <h2 className="mb-3 font-semibold">{h('quickActions')}</h2>
        <div className="flex flex-wrap gap-2">
          {QUICK.map(([k, href, icon]) => (
            <Link key={k} href={href} className="inline-flex items-center gap-2 rounded-full border border-blue-300 px-4 py-2 text-sm text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950">
              <span aria-hidden className="grid h-5 w-5 place-items-center rounded-full bg-blue-100 text-xs font-semibold dark:bg-blue-900">{icon}</span>{h(k)}
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-semibold">{h('resources')}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Count label={h('servers')} href="/servers" n={servers?.length} />
          {COUNTED.map(([k, href]) => <Count key={k} label={h(k)} href={href} n={counts[k]} />)}
        </div>
      </section>

      {servers && (servers.length ? <Health servers={servers} /> : (
        <section className="card flex flex-wrap items-center justify-between gap-4 p-6">
          <div>
            <h2 className="font-semibold">{h('noServersTitle')}</h2>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{h('noServersBody')}</p>
          </div>
          <Link href="/servers/new" className="btn-primary rounded-full px-5 py-2">{h('qaServer')}</Link>
        </section>
      ))}
    </div>
  );
}

function Spend({ balance }: { balance: Balance | null }) {
  const { locale } = useShell();
  if (!balance) return <div className="h-24 w-56 animate-pulse rounded-lg bg-neutral-100 dark:bg-neutral-800" />;
  const m = (minor: number) => money(minor, balance.currency, locale);
  const projected = balance.projectedMonthMinor ?? balance.monthToDateMinor;
  const last = balance.lastMonthMinor;
  const change = last ? Math.round(((projected - last) / last) * 100) : null;
  return (
    <div className="sm:text-end" title={ht(locale, 'projectedHint')}>
      <p className="font-semibold">{ht(locale, 'projected')}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">
        <span dir="ltr">{m(projected)}</span>
        {change !== null && change !== 0 && (
          <span dir="ltr" className={`ms-2 text-lg ${change > 0 ? 'text-red-600' : 'text-emerald-600'}`} title={ht(locale, 'vsLastMonth')}>{change > 0 ? '+' : ''}{change}%</span>
        )}
      </p>
      {balance.todayMinor != null && <p className="text-sm text-neutral-500">{ht(locale, 'today', { amount: m(balance.todayMinor) })}</p>}
      {balance.creditMinor > 0 && <p className="text-xs text-emerald-700 dark:text-emerald-400">{ht(locale, 'credit', { amount: m(balance.creditMinor) })}</p>}
    </div>
  );
}

function Count({ label, href, n }: { label: string; href: string; n: number | undefined }) {
  return (
    <Link href={href} className="card block p-3 hover:border-blue-300 dark:hover:border-blue-800">
      <span className="block text-2xl font-semibold tabular-nums">{n ?? '–'}</span>
      <span className="text-sm text-neutral-500">{label}</span>
    </Link>
  );
}

function Health({ servers }: { servers: Server[] }) {
  const { locale } = useShell();
  const [id, setId] = useState(servers[0].id);
  const [period, setPeriod] = useState<(typeof PERIODS)[number][0]>('1h');
  const [data, setData] = useState<MetricSeries | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    const load = () => api<MetricSeries>(`/v1/servers/${id}/metrics?period=${period}`).then((d) => live && setData(d)).catch(() => undefined);
    load();
    const timer = setInterval(load, 60_000);
    return () => { live = false; clearInterval(timer); };
  }, [id, period]);

  const p = data?.points ?? [];
  const times = p.map((x) => x.at);
  const server = servers.find((s) => s.id === id);
  const hasDisk = p.some((x) => x.diskUsedPercent != null);
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="me-auto font-semibold">{ht(locale, 'health')}</h2>
        <select aria-label={ht(locale, 'healthServer')} className="rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700" value={id} onChange={(e) => setId(e.target.value)}>
          {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select aria-label={ht(locale, 'period')} className="rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
          {PERIODS.map(([v, k]) => <option key={v} value={v}>{ht(locale, k)}</option>)}
        </select>
      </div>
      {server && (
        <p className="mb-3 flex items-center gap-2 text-sm">
          <StatusBadge status={server.status} />
          <Link href={`/servers/${server.id}`} className="text-blue-600 hover:underline">{ht(locale, 'viewServer')}</Link>
        </p>
      )}
      {data && !p.length ? <p className="card text-sm text-neutral-500">{ht(locale, 'noData')}</p> : (
        <div className="grid gap-3 lg:grid-cols-3">
          <MetricsChart title={ht(locale, 'cpu')} unit="%" max={100} times={times} series={[{ name: 'CPU', values: p.map((x) => x.cpu) }]} />
          <MetricsChart title={ht(locale, 'memory')} unit="%" max={100} times={times} series={[{ name: 'Used', values: p.map((x) => (x.memoryTotalMb ? Math.round((x.memoryUsedMb / x.memoryTotalMb) * 1000) / 10 : null)) }]} />
          {hasDisk && <MetricsChart title={ht(locale, 'disk')} unit="%" max={100} times={times} series={[{ name: 'Used', values: p.map((x) => x.diskUsedPercent ?? null) }]} />}
        </div>
      )}
    </section>
  );
}
