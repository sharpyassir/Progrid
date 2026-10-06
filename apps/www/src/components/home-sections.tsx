'use client';

import { useState, type FormEvent } from 'react';
import { getHomeCopy } from '@/lib/copy-home';
import { Logo, useConsole, useCopy, useHref, useLang } from './marketing';
import { useSite } from './site-context';

/* ───────────────────────── Hero ───────────────────────── */

/** Light hero: headline and email signup on the left, a console preview on the right. */
export function HomeHero() {
  const lang = useLang(); const h = getHomeCopy(lang); const c = useCopy(); const consoleUrl = useConsole();
  const [email, setEmail] = useState('');
  const signup = (e: FormEvent) => {
    e.preventDefault();
    const q = new URLSearchParams({ mode: 'signup', ...(email ? { email } : {}) });
    window.location.assign(`${consoleUrl}/login?${q}`);
  };
  return (
    <section className="relative overflow-hidden border-b border-slate-200 bg-gradient-to-b from-[#f3f7fd] via-white to-white">
      <div aria-hidden className="pointer-events-none absolute -end-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-blue-100/60 blur-3xl" />
      <div className="container-x relative grid items-center gap-14 py-16 sm:py-24 lg:grid-cols-[1.05fr_1fr]">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-medium text-blue-700">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" /> {h.hero.eyebrow}
          </span>
          <h1 className="mt-6 text-4xl font-extrabold leading-[1.06] tracking-tight text-[#0b1220] sm:text-5xl lg:text-[3.6rem]">{h.hero.h1}</h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600">{h.hero.lead}</p>
          <form onSubmit={signup} className="mt-8 flex max-w-lg flex-col gap-3 sm:flex-row">
            <label className="sr-only" htmlFor="hero-email">{h.hero.email}</label>
            <input id="hero-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={h.hero.email} autoComplete="email" dir="ltr"
              className="h-12 flex-1 rounded-lg border border-slate-300 bg-white px-4 text-base outline-none ring-blue-500/30 focus:border-blue-500 focus:ring-4" />
            <button className="btn-primary h-12 px-6 text-base">{h.hero.signUp}</button>
          </form>
          <div className="mt-3 flex max-w-lg items-center gap-3 text-xs text-slate-400"><span className="h-px flex-1 bg-slate-200" />{h.hero.or}<span className="h-px flex-1 bg-slate-200" /></div>
          <a href={`${consoleUrl}/login?mode=signup`} className="mt-3 flex h-12 max-w-lg items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-800 hover:bg-slate-50">
            <GoogleMark /> {h.hero.google}
          </a>
          <p className="mt-4 text-sm text-slate-500">{h.hero.fine}</p>
          <p className="sr-only">{c.hero.lead}</p>
        </div>
        <ConsolePreview />
      </div>
    </section>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 48 48" className="h-5 w-5">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** A drawn console window (not a screenshot): servers list with live status. Illustrative only. */
function ConsolePreview() {
  const { site } = useSite();
  const cur = site === 'sa' ? 'SAR' : 'USD';
  const rows: [string, string, string, string, string][] = [
    ['web-1', 'Standard · 2 vCPU · 4 GB', '188.40.211.26', 'active', site === 'sa' ? '65' : '17.33'],
    ['api-1', 'Pro · 4 vCPU · 8 GB', '188.40.211.27', 'active', site === 'sa' ? '125' : '33.33'],
    ['worker-1', 'Starter · 1 vCPU · 2 GB', '188.40.211.28', 'provisioning', site === 'sa' ? '29' : '7.73'],
  ];
  return (
    <div dir="ltr" className="relative">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-blue-900/10">
        <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
          <i className="h-2.5 w-2.5 rounded-full bg-slate-300" /><i className="h-2.5 w-2.5 rounded-full bg-slate-300" /><i className="h-2.5 w-2.5 rounded-full bg-slate-300" />
          <span className="ms-3 rounded-md bg-white px-3 py-0.5 text-[11px] text-slate-400 ring-1 ring-slate-200">console.progrid.{site === 'sa' ? 'sa' : 'co'}/servers</span>
        </div>
        <div className="grid grid-cols-[150px_1fr]">
          <aside className="border-e border-slate-100 bg-white p-3 text-[12px] text-slate-500">
            <div className="mb-3 flex items-center gap-2 font-bold text-[#0b47c9]"><Logo size={16} /> Progrid</div>
            {['Servers', 'Databases', 'Kubernetes', 'Apps', 'Volumes', 'Networking', 'Connect', 'Billing'].map((x, i) => (
              <div key={x} className={`rounded px-2 py-1 ${i === 0 ? 'bg-blue-50 font-semibold text-blue-700' : ''}`}>{x}</div>
            ))}
          </aside>
          <div className="p-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-900">Servers</div>
              <span className="rounded-md bg-blue-600 px-2.5 py-1 text-[11px] font-semibold text-white">Create server</span>
            </div>
            <div className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-100">
              {rows.map(([n, plan, ip, st, price]) => (
                <div key={n} className="flex items-center gap-3 px-3 py-2.5 text-[12px]">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${st === 'active' ? 'bg-emerald-500' : 'animate-pulse bg-amber-400'}`} />
                  <div className="min-w-0 flex-1"><div className="font-semibold text-slate-800">{n}</div><div className="truncate text-slate-400">{plan}</div></div>
                  <span className="hidden font-mono text-slate-500 sm:inline">{ip}</span>
                  <span className="w-20 text-end text-slate-600">{price} {cur}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {[['CPU', '23%', 'w-1/4'], ['Memory', '61%', 'w-3/5'], ['Disk', '38%', 'w-2/5']].map(([k, v, w]) => (
                <div key={k} className="rounded-lg border border-slate-100 p-2.5">
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">{k}</div>
                  <div className="text-sm font-semibold text-slate-800">{v}</div>
                  <div className="mt-1.5 h-1 rounded bg-slate-100"><div className={`h-1 rounded bg-blue-500 ${w}`} /></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="absolute -bottom-6 -start-6 hidden rounded-xl border border-slate-200 bg-white px-4 py-3 text-[12px] shadow-xl sm:block">
        <div className="font-semibold text-slate-900">worker-1 is active</div>
        <div className="text-slate-500">Ready in 58 seconds</div>
      </div>
    </div>
  );
}

/* ───────────────────────── Built on ───────────────────────── */

const STACK = ['Proxmox VE', 'Ceph', 'PostgreSQL', 'Kubernetes', 'Temporal', 'NATS', 'Valkey'];

/** The open source the platform runs on, as a logo style strip (names, not trademarks). */
export function BuiltOn() {
  const h = getHomeCopy(useLang());
  return (
    <section className="border-b border-slate-200 bg-white">
      <div className="container-x py-10 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{h.builtOn}</p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-3" dir="ltr">
          {STACK.map((s) => <span key={s} className="text-lg font-bold tracking-tight text-slate-400">{s}</span>)}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Product showcase (tabs) ───────────────────────── */

export function Showcase() {
  const h = getHomeCopy(useLang()); const href = useHref();
  const [active, setActive] = useState(h.showcase.tabs[0].key);
  const tab = h.showcase.tabs.find((t) => t.key === active) ?? h.showcase.tabs[0];
  return (
    <section id="products" className="scroll-mt-20 py-20">
      <div className="container-x">
        <div className="max-w-3xl">
          <span className="eyebrow">{h.showcase.eyebrow}</span>
          <h2 className="h2">{h.showcase.h2}</h2>
          <p className="lead">{h.showcase.lead}</p>
        </div>
        <div role="tablist" className="mt-10 flex gap-1 overflow-x-auto border-b border-slate-200">
          {h.showcase.tabs.map((t) => (
            <button key={t.key} role="tab" aria-selected={t.key === active} onClick={() => setActive(t.key)}
              className={`-mb-px whitespace-nowrap border-b-2 px-4 py-3 text-sm font-semibold transition ${t.key === active ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-900'}`}>{t.label}</button>
          ))}
        </div>
        <div role="tabpanel" className="grid gap-10 pt-10 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <h3 className="text-2xl font-bold tracking-tight text-slate-900">{tab.title}</h3>
            <p className="mt-4 text-slate-600">{tab.body}</p>
            <ul className="mt-6 space-y-3">
              {tab.bullets.map((b) => <li key={b} className="flex gap-3 text-slate-700"><span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-blue-50 text-xs text-blue-700">✓</span>{b}</li>)}
            </ul>
            <a href={href(tab.href)} className="btn-primary mt-8">{tab.cta}</a>
          </div>
          <div className="grid content-start gap-4 sm:grid-cols-2">
            {tab.cards.map((card) => (
              <a key={card.name} href={href(card.href)} className="group rounded-2xl border border-slate-200 bg-white p-6 transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-lg hover:shadow-blue-900/5">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-[#e4ecf9]"><Logo size={18} /></div>
                <div className="mt-4 font-semibold text-slate-900 group-hover:text-blue-700">{card.name}</div>
                <div className="mt-1 text-sm text-slate-500">{card.desc}</div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Why + stats ───────────────────────── */

const WHY_ICONS = [
  'M4 6h16M4 12h10M4 18h7',
  'M12 3v18M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  'M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7l8-4z',
  'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
];

export function Why() {
  const h = getHomeCopy(useLang());
  return (
    <section className="border-y border-slate-200 bg-[#f6f9fe] py-20">
      <div className="container-x">
        <div className="max-w-3xl">
          <span className="eyebrow">{h.why.eyebrow}</span>
          <h2 className="h2">{h.why.h2}</h2>
        </div>
        <div className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {h.why.items.map((it, i) => (
            <div key={it.title}>
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
                <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-blue-600" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={WHY_ICONS[i % WHY_ICONS.length]} /></svg>
              </div>
              <h3 className="mt-4 font-semibold text-slate-900">{it.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{it.body}</p>
            </div>
          ))}
        </div>
        <dl className="mt-14 grid gap-6 rounded-2xl bg-[#0b1220] p-8 text-white sm:grid-cols-2 lg:grid-cols-4">
          {h.why.stats.map(([v, l]) => (
            <div key={l}><dt className="text-4xl font-extrabold tracking-tight text-cyan-300">{v}</dt><dd className="mt-1 text-sm text-slate-300">{l}</dd></div>
          ))}
        </dl>
      </div>
    </section>
  );
}

/* ───────────────────────── Pricing teaser ───────────────────────── */

export function PriceTeaser() {
  const lang = useLang(); const h = getHomeCopy(lang); const href = useHref(); const site = useSite();
  const currency = site.currency;
  // Book prices are in halalas; dollar prices use the pegged rate, as on the pricing page.
  const fmt = (sarMinor: number) => {
    const minor = currency === 'SAR' ? sarMinor : sarMinor / 3.75;
    const digits = minor < 100 ? 2 : minor % 100 === 0 ? 0 : 2;
    return new Intl.NumberFormat(lang === 'ar' ? 'ar-SA-u-nu-latn' : 'en-US', { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(minor / 100);
  };
  return (
    <section className="py-20">
      <div className="container-x">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <span className="eyebrow">{h.priceTeaser.eyebrow}</span>
            <h2 className="h2">{h.priceTeaser.h2}</h2>
            <p className="lead">{h.priceTeaser.lead}</p>
          </div>
          <a href={href('/pricing')} className="btn-light border border-slate-300">{h.priceTeaser.all} <span aria-hidden className="inline-block rtl:rotate-180">→</span></a>
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {h.priceTeaser.items.map((it) => (
            <div key={it.name} className="rounded-2xl border border-slate-200 p-6">
              <div className="font-semibold text-slate-900">{it.name}</div>
              <div className="mt-1 min-h-10 text-sm text-slate-500">{it.desc}</div>
              <div className="mt-5 text-xs uppercase tracking-wide text-slate-400">{h.priceTeaser.from}</div>
              <div className="flex items-baseline gap-1"><span className="text-3xl font-extrabold tracking-tight text-[#0b1220]" dir="ltr">{fmt(it.sarMinor)}</span><span className="text-sm text-slate-500">{it.unit === 'gb' ? h.priceTeaser.perGb : h.priceTeaser.month}</span></div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-slate-500">{h.priceTeaser.vat}</p>
      </div>
    </section>
  );
}

/* ───────────────────────── Use cases ───────────────────────── */

export function UseCases() {
  const h = getHomeCopy(useLang()); const href = useHref();
  return (
    <section id="solutions" className="scroll-mt-20 border-t border-slate-200 bg-white py-20">
      <div className="container-x">
        <div className="max-w-3xl">
          <span className="eyebrow">{h.useCases.eyebrow}</span>
          <h2 className="h2">{h.useCases.h2}</h2>
          <p className="lead">{h.useCases.lead}</p>
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {h.useCases.items.map((u) => (
            <a key={u.title} href={href(u.href)} className="group flex flex-col rounded-2xl border border-slate-200 p-6 transition hover:border-blue-300 hover:shadow-lg hover:shadow-blue-900/5">
              <h3 className="text-lg font-semibold text-slate-900">{u.title}</h3>
              <p className="mt-2 flex-1 text-sm text-slate-600">{u.body}</p>
              <span className="mt-5 text-sm font-semibold text-blue-700 group-hover:underline">{u.link} <span aria-hidden className="inline-block rtl:rotate-180">→</span></span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── Developers ───────────────────────── */

export function Developers() {
  const h = getHomeCopy(useLang());
  return (
    <section className="border-t border-slate-200 bg-[#f6f9fe] py-20">
      <div className="container-x grid items-center gap-12 lg:grid-cols-2">
        <div>
          <span className="eyebrow">{h.devs.eyebrow}</span>
          <h2 className="h2">{h.devs.h2}</h2>
          <p className="lead">{h.devs.lead}</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {h.devs.items.map((d) => (
              <a key={d.title} href={d.href} className="group rounded-xl border border-slate-200 bg-white p-5 hover:border-blue-300">
                <div className="font-semibold text-slate-900 group-hover:text-blue-700">{d.title}</div>
                <div className="mt-1 text-sm text-slate-500">{d.body}</div>
              </a>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-sm font-semibold text-slate-700">{h.devs.codeTitle}</div>
          <div className="code" dir="ltr">
            <div><span className="c">$</span> <span className="k">curl</span> -fsSL https://get.progrid.co | sh</div>
            <div><span className="c">$</span> <span className="k">prgd</span> login</div>
            <div className="mt-2"><span className="c">$</span> <span className="k">prgd</span> servers create web-1 <span className="p">--size</span> s-2vcpu-4gb <span className="p">--image</span> ubuntu-24-04 <span className="p">--wait</span></div>
            <div className="c mt-1">web-1 is active at 188.40.211.26</div>
            <div className="mt-2"><span className="c">$</span> <span className="k">prgd</span> ssh web-1</div>
          </div>
        </div>
      </div>
    </section>
  );
}
