'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { HeroGrid } from './hero-grid';
import { COPY, LANGS, type Copy, type Lang } from '@/lib/copy';

const LangCtx = createContext<Lang>('en');
export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  const dir = LANGS.find((l) => l.code === lang)?.dir ?? 'ltr';
  useEffect(() => { document.documentElement.lang = lang; document.documentElement.dir = dir; }, [lang, dir]);
  return <LangCtx.Provider value={lang}><div dir={dir}>{children}</div></LangCtx.Provider>;
}
function useCopy(): Copy { return COPY[useContext(LangCtx)]; }
function useLang(): Lang { return useContext(LangCtx); }

const CONSOLE = process.env.NEXT_PUBLIC_CONSOLE_URL ?? 'http://localhost:3000';
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/* ───────────────────────── Header ───────────────────────── */

export function Header() {
  const [open, setOpen] = useState(false);
  const c = useCopy(); const lang = useLang();
  const home = LANGS.find((l) => l.code === lang)?.path ?? '/';
  const links = [
    [`${home}#products`, c.nav.products], [`${home === '/' ? '' : home}/connect`, c.nav.connect], [`${home}#agents`, c.nav.agents], [`${home}#pricing`, c.nav.pricing], [`${home}#marketplace`, c.nav.marketplace], ['/docs', c.nav.docs],
  ];
  const langs = <span className="flex gap-1 text-xs">{LANGS.map((l) => <a key={l.code} href={l.path} className={`rounded px-1.5 py-0.5 ${l.code === lang ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white'}`}>{l.label}</a>)}</span>;
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0b1220]/80 text-white backdrop-blur">
      <div className="container-x flex h-16 items-center gap-8">
        <a href="/" className="flex items-center gap-2.5 text-lg font-bold tracking-tight"><Logo white size={30} /> Progrid</a>
        <nav className="hidden items-center gap-7 text-sm text-slate-300 md:flex">
          {links.map(([h, l]) => <a key={h} href={h} className="hover:text-white">{l}</a>)}
        </nav>
        <div className="ms-auto hidden items-center gap-3 md:flex">
          {langs}
          <a href={`${CONSOLE}/login`} className="text-sm text-slate-300 hover:text-white">{c.nav.signIn}</a>
          <a href={`${CONSOLE}/login`} className="btn-primary py-2">{c.nav.startFree}</a>
        </div>
        <button className="ms-auto md:hidden" aria-label={c.nav.menu} onClick={() => setOpen(!open)}>☰</button>
      </div>
      {open && (
        <div className="border-t border-white/10 px-5 py-4 md:hidden">
          {links.map(([h, l]) => <a key={h} href={h} className="block py-2 text-slate-200" onClick={() => setOpen(false)}>{l}</a>)}
          <div className="py-2">{langs}</div>
          <a href={`${CONSOLE}/login`} className="btn-primary mt-3 w-full">{c.nav.startFree}</a>
        </div>
      )}
    </header>
  );
}

/** The official Progrid mark: a 4 by 5 grid of rounded squares with one cyan dot. Files live in public/brand. */
export function Logo({ white = false, size = 28 }: { white?: boolean; size?: number }) {
  return <img src={white ? '/brand/progrid-mark-white.svg' : '/brand/progrid-mark.svg'} width={Math.round(size * 98 / 124)} height={size} alt="" aria-hidden className="shrink-0" />;
}

/* ───────────────────────── Hero ───────────────────────── */

export function Hero() {
  const c = useCopy();
  return (
    <section className="hero-bg relative overflow-hidden text-white">
      <HeroGrid />
      <div className="container-x relative grid items-center gap-12 py-20 pb-72 sm:py-28 sm:pb-80 lg:grid-cols-2">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-slate-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> {c.hero.badge}
          </span>
          <h1 className="hero-title mt-6 text-4xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-6xl">
            {c.hero.h1a}{c.hero.h1b}.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-slate-300">
            {c.hero.lead}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href={`${CONSOLE}/login`} className="btn-primary">{c.hero.ctaPrimary}</a>
            <a href="#agents" className="btn-light">{c.hero.ctaSecondary}</a>
          </div>
          <dl className="mt-10 grid grid-cols-3 gap-6 border-t border-white/10 pt-6 text-sm">
            {c.hero.stats.map(([v, l]) => (
              <div key={l}><dt className="text-2xl font-bold">{v}</dt><dd className="text-slate-400">{l}</dd></div>
            ))}
          </dl>
        </div>
        <Terminal />
      </div>
    </section>
  );
}

function Terminal() {
  const c = useCopy();
  const [step, setStep] = useState(0);
  useEffect(() => { const id = setInterval(() => setStep((s) => (s + 1) % 5), 1400); return () => clearInterval(id); }, []);
  const status = ['new', 'provisioning', 'provisioning', 'active', 'active'][step];
  return (
    <div className="code relative">
      <div className="mb-3 flex gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-red-400/80" /><i className="h-2.5 w-2.5 rounded-full bg-amber-300/80" /><i className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" /></div>
      <div><span className="c">$</span> <span className="k">prgd</span> servers create <span className="p">--name</span> web-1 <span className="p">--size</span> s-2vcpu-4gb <span className="p">--image</span> wordpress</div>
      <div className="c mt-1">202 Accepted. id srv_9f1c, region sa1</div>
      <div className="mt-3"><span className="c">$</span> <span className="k">prgd</span> servers get srv_9f1c <span className="p">--watch</span></div>
      <div className="mt-1">status: <span className={status === 'active' ? 's' : 'p'}>{status}</span>{step >= 1 && <span className="c">  ip: 185.0.113.42</span>}</div>
      {step >= 3 && <div className="s mt-1">{c.terminal.ready}</div>}
      <div className="c mt-4">{c.terminal.orAgent}</div>
      <div><span className="c">$</span> claude mcp add prgd <span className="p">--token</span> prgd_… <span className="c">{c.terminal.capNote}</span></div>
    </div>
  );
}

/* ───────────────────────── Trust strip ───────────────────────── */

export function TrustStrip() {
  const items = useCopy().trust;
  return (
    <section className="border-b border-slate-200 bg-slate-50">
      <div className="container-x grid gap-6 py-8 sm:grid-cols-2 lg:grid-cols-4">
        {items.map(([i, t, s]) => (
          <div key={t} className="flex gap-3"><span className="text-2xl">{i}</span><div><div className="font-semibold">{t}</div><div className="text-sm text-slate-600">{s}</div></div></div>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────── Products ───────────────────────── */


export function Products() {
  const c = useCopy(); const lang = useLang();
  const prefix = lang === 'en' ? '' : `/${lang}`;
  const GROUPS = c.products.groups;
  return (
    <section id="products" className="py-20">
      <div className="container-x">
        <span className="eyebrow">{c.products.eyebrow}</span>
        <h2 className="h2">{c.products.h2}</h2>
        <p className="lead">{c.products.lead}</p>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {GROUPS.map((g) => (
            <div key={g.name} className={`card ${g.highlight ? 'border-blue-300 ring-1 ring-blue-200' : ''}`}>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">{g.name}</h3>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${g.live ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{g.live ? c.products.available : c.products.roadmap}</span>
              </div>
              <p className="mt-2 text-sm text-slate-600">{g.desc}</p>
              <ul className="mt-4 flex flex-wrap gap-1.5">{g.items.map((i) => <li key={i} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{i}</li>)}</ul>
              {g.href && <a href={`${prefix}${g.href}`} className="mt-4 inline-block text-sm font-semibold text-blue-600 hover:underline">{c.products.learnMore} <span aria-hidden className="inline-block rtl:rotate-180">→</span></a>}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Agents ───────────────────────── */

export function Agents() {
  const c = useCopy();
  return (
    <section id="agents" className="bg-slate-950 py-20 text-white">
      <div className="container-x grid items-center gap-12 lg:grid-cols-2">
        <div>
          <span className="eyebrow text-sky-300">{c.agents.eyebrow}</span>
          <h2 className="h2 text-white">{c.agents.h2}</h2>
          <p className="lead text-slate-300">{c.agents.lead}</p>
          <ul className="mt-8 space-y-4 text-slate-200">
            {c.agents.points.map(([t, d]) => (
              <li key={t} className="flex gap-3"><span className="mt-1 h-5 w-5 flex-none rounded-full bg-sky-500/20 text-center text-xs leading-5 text-sky-300">✓</span><div><div className="font-semibold">{t}</div><div className="text-sm text-slate-400">{d}</div></div></li>
            ))}
          </ul>
        </div>
        <div className="code" dir="ltr">
          <div className="c">{c.agents.codeCreate}</div>
          <div><span className="k">POST</span> /v1/tokens</div>
          <pre className="mt-2 whitespace-pre-wrap">{`{
  "name": "claude-code",
  "isAgent": true,
  "scopes": ["servers:read", "servers:write"],
  "spendCapMinor": 1500,          `}<span className="c">{c.agents.codeCap}</span>{`
  "requireApprovalFor": ["servers:delete", "servers:resize-down"]
}`}</pre>
          <div className="c mt-4">{c.agents.codeOver}</div>
          <div><span className="k">402</span> <span className="p">spend_limit_reached</span></div>
          <div className="c">{`{ "capMinor": 1500, "spentMinor": 900, "addedMonthlyMinor": 2700 }`}</div>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Pricing ───────────────────────── */

interface Price { sku: string; resourceType: string; monthlyMinor: number; hourlyMinor: number; size?: { id: string; name?: string; vcpu: number; memoryMb: number; diskGb: number; transferTb: number } | null }
interface PriceList { currency: 'USD' | 'SAR'; baseCurrency: 'USD' | 'SAR'; fxRate: number; usdToSar?: number; data: Price[] }
const VAT = 0.15;
const FALLBACK: Price[] = [
  { sku: 's-1vcpu-2gb', resourceType: 'server', monthlyMinor: 2900, hourlyMinor: 4, size: { id: 's-1vcpu-2gb', name: 'Starter', vcpu: 1, memoryMb: 2048, diskGb: 40, transferTb: 2 } },
  { sku: 's-2vcpu-4gb', resourceType: 'server', monthlyMinor: 6500, hourlyMinor: 10, size: { id: 's-2vcpu-4gb', name: 'Standard', vcpu: 2, memoryMb: 4096, diskGb: 80, transferTb: 4 } },
  { sku: 's-4vcpu-8gb', resourceType: 'server', monthlyMinor: 12500, hourlyMinor: 19, size: { id: 's-4vcpu-8gb', name: 'Pro', vcpu: 4, memoryMb: 8192, diskGb: 160, transferTb: 6 } },
  { sku: 's-8vcpu-16gb', resourceType: 'server', monthlyMinor: 23900, hourlyMinor: 36, size: { id: 's-8vcpu-16gb', name: 'Business', vcpu: 8, memoryMb: 16384, diskGb: 320, transferTb: 8 } },
  { sku: 'managed-s-2vcpu-4gb', resourceType: 'managed_server', monthlyMinor: 13400, hourlyMinor: 20, size: { id: 's-2vcpu-4gb', name: 'Standard', vcpu: 2, memoryMb: 4096, diskGb: 80, transferTb: 4 } },
  { sku: 'managed-s-4vcpu-8gb', resourceType: 'managed_server', monthlyMinor: 22400, hourlyMinor: 33, size: { id: 's-4vcpu-8gb', name: 'Pro', vcpu: 4, memoryMb: 8192, diskGb: 160, transferTb: 6 } },
  { sku: 'managed-s-8vcpu-16gb', resourceType: 'managed_server', monthlyMinor: 36000, hourlyMinor: 54, size: { id: 's-8vcpu-16gb', name: 'Business', vcpu: 8, memoryMb: 16384, diskGb: 320, transferTb: 8 } },
  { sku: 'snapshot_gb', resourceType: 'snapshot', monthlyMinor: 25, hourlyMinor: 0 },
];
const MANAGED_NAMES: Record<string, string> = { 's-2vcpu-4gb': 'Managed Start', 's-4vcpu-8gb': 'Managed Business', 's-8vcpu-16gb': 'Managed Pro' };

export function Pricing() {
  const c = useCopy(); const lang = useLang();
  const [currency, setCurrency] = useState<'USD' | 'SAR'>('SAR');
  const [list, setList] = useState<PriceList>({ currency: 'SAR', baseCurrency: 'SAR', fxRate: 1, data: FALLBACK });
  useEffect(() => {
    fetch(`${API}/v1/pricing?currency=${currency}`)
      .then((r) => r.json())
      .then((d: PriceList) => setList({ ...d, data: d.data.filter((p) => p.size || p.sku === 'snapshot_gb').sort((a, b) => a.monthlyMinor - b.monthlyMinor) }))
      .catch(() => setList({ currency, baseCurrency: 'SAR', fxRate: currency === 'SAR' ? 1 : 1 / 3.75, data: FALLBACK.map((p) => ({ ...p, monthlyMinor: currency === 'SAR' ? p.monthlyMinor : Math.round(p.monthlyMinor / 3.75), hourlyMinor: currency === 'SAR' ? p.hourlyMinor : Math.round(p.hourlyMinor / 3.75) })) }));
  }, [currency]);
  const cur = list.currency;
  const fmt = (m: number, digits = 2) => new Intl.NumberFormat(lang === 'ar' ? 'ar-SA' : 'en-US', { style: 'currency', currency: cur, maximumFractionDigits: digits }).format(m / 100);
  const plans = list.data.filter((p) => p.resourceType === 'server' && p.size);
  const managed = list.data.filter((p) => p.resourceType === 'managed_server' && p.size).map((m) => ({ ...m, base: plans.find((p) => p.sku === m.size!.id) }));
  const snapshot = list.data.find((p) => p.sku === 'snapshot_gb')?.monthlyMinor ?? 25;
  const ram = (mb: number) => (mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`);
  return (
    <section id="pricing" className="py-20">
      <div className="container-x">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <span className="eyebrow">{c.pricing.eyebrow}</span>
            <h2 className="h2">{c.pricing.h2}</h2>
            <p className="lead">{c.pricing.lead}<code className="rounded bg-slate-100 px-1.5 py-0.5 text-sm" dir="ltr">{c.pricing.leadCode}</code>.</p>
          </div>
          <div className="flex rounded-lg border border-slate-300 p-1 text-sm">
            {(['SAR', 'USD'] as const).map((cc) => <button key={cc} onClick={() => setCurrency(cc)} className={`rounded-md px-4 py-1.5 ${currency === cc ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>{cc}</button>)}
          </div>
        </div>
        <h3 className="mt-10 text-lg font-semibold">{c.pricing.unmanagedH3}</h3>
        <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>{c.pricing.cols.map((h, i) => <th key={h} className={`px-5 py-3 ${i >= 4 ? 'text-end' : 'text-start'}`}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.sku} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium">{p.size!.name || p.sku}{p.size!.id === 's-2vcpu-4gb' && <span className="ms-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">{c.pricing.popular}</span>}</td>
                  <td className="px-5 py-3">{p.size!.vcpu}</td>
                  <td className="px-5 py-3">{ram(p.size!.memoryMb)}</td>
                  <td className="px-5 py-3">{p.size!.diskGb} GB NVMe</td>
                  <td className="px-5 py-3 text-end font-semibold">{fmt(p.monthlyMinor)}</td>
                  <td className="px-5 py-3 text-end text-slate-500">{fmt(Math.round(p.monthlyMinor * (1 + VAT)))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3 className="mt-10 text-lg font-semibold">{c.pricing.managedH3}</h3>
        <p className="mt-1 text-sm text-slate-600">{c.pricing.managedLead}</p>
        <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>{c.pricing.cols.map((h, i) => <th key={h} className={`px-5 py-3 ${i >= 4 ? 'text-end' : 'text-start'}`}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {managed.map((m) => {
                const total = m.monthlyMinor + (m.base?.monthlyMinor ?? 0);
                return (
                  <tr key={m.sku} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-5 py-3 font-medium">{MANAGED_NAMES[m.size!.id] ?? m.sku}</td>
                    <td className="px-5 py-3">{m.size!.vcpu}</td>
                    <td className="px-5 py-3">{ram(m.size!.memoryMb)}</td>
                    <td className="px-5 py-3">{m.size!.diskGb} GB NVMe</td>
                    <td className="px-5 py-3 text-end font-semibold">{fmt(total)}</td>
                    <td className="px-5 py-3 text-end text-slate-500">{fmt(Math.round(total * (1 + VAT)))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          {cur === 'SAR' ? c.pricing.noteTry((list.usdToSar ?? 3.75).toFixed(2)) : c.pricing.noteUsd}
          {c.pricing.noteTail(fmt(snapshot))}
        </p>
      </div>
    </section>
  );
}

/* ───────────────────────── Marketplace ───────────────────────── */

const APPS = ['WordPress', 'WooCommerce', 'Docker', 'Node.js', 'Laravel', 'Django', 'n8n', 'Nextcloud', 'Mattermost', 'Odoo', 'WireGuard', 'Plausible', 'Ghost', 'Coolify', 'Ollama + Open WebUI'];

export function Marketplace() {
  const c = useCopy();
  return (
    <section id="marketplace" className="border-y border-slate-200 bg-slate-50 py-20">
      <div className="container-x">
        <span className="eyebrow">{c.marketplace.eyebrow}</span>
        <h2 className="h2">{c.marketplace.h2}</h2>
        <p className="lead">{c.marketplace.lead}</p>
        <div className="mt-8 flex flex-wrap gap-2">
          {APPS.map((a) => <span key={a} className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium shadow-sm">{a}</span>)}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Compare ───────────────────────── */

export function Compare() {
  const c = useCopy();
  const rows = c.compare.rows;
  return (
    <section className="py-20">
      <div className="container-x">
        <span className="eyebrow">{c.compare.eyebrow}</span>
        <h2 className="h2">{c.compare.h2}</h2>
        <div className="mt-10 overflow-hidden rounded-2xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3 text-start"> </th><th className="px-5 py-3 text-start text-blue-700">{c.compare.cols[0]}</th><th className="px-5 py-3 text-start">{c.compare.cols[1]}</th><th className="px-5 py-3 text-start">{c.compare.cols[2]}</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r[0]} className="border-t border-slate-100"><td className="px-5 py-3 font-medium">{r[0]}</td><td className="px-5 py-3 font-semibold text-blue-700">{r[1]}</td><td className="px-5 py-3 text-slate-600">{r[2]}</td><td className="px-5 py-3 text-slate-600">{r[3]}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── CTA + Footer ───────────────────────── */

export function Cta() {
  const c = useCopy();
  return (
    <section className="hero-bg py-20 text-white">
      <div className="container-x text-center">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{c.cta.h2}</h2>
        <p className="mx-auto mt-4 max-w-xl text-slate-300">{c.cta.lead}</p>
        <div className="mt-8 flex justify-center gap-3">
          <a href={`${CONSOLE}/login`} className="btn-primary">{c.cta.create}</a>
          <a href="/docs/api" className="btn-light">{c.cta.docs}</a>
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  const c = useCopy(); const lang = useLang();
  const cols = c.footer.cols;
  const prefix = lang === 'en' ? '' : `/${lang}`;
  return (
    <footer className="border-t border-slate-200 bg-white py-14 text-sm">
      <div className="container-x grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-1"><div className="flex items-center gap-2.5 font-bold text-[#0b47c9]"><Logo size={30} /> Progrid</div><p className="mt-3 text-slate-500">{c.footer.tagline}</p><p className="mt-3 flex gap-2 text-slate-500">{LANGS.map((l) => <a key={l.code} href={l.path} className="hover:text-slate-900">{l.label}</a>)}</p></div>
        {cols.map(([h, ls]) => <div key={h}><div className="font-semibold">{h}</div><ul className="mt-3 space-y-2 text-slate-600">{ls.map(([l, href]) => <li key={l}><a href={href.startsWith('/docs') || href.startsWith('http') || href === '#' ? href : `${prefix}${href}`} className="hover:text-slate-900">{l}</a></li>)}</ul></div>)}
      </div>
      <div className="container-x mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-6 text-xs text-slate-500"><span>© {new Date().getFullYear()} {c.footer.copyright}</span><span>{c.footer.builtOn}</span></div>
    </footer>
  );
}
