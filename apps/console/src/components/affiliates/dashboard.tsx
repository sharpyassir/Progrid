'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError, money } from '@/lib/api';
import { useUrls } from '@/lib/urls';
import { countryOptions } from '@/lib/countries';
import { CopyButton, CopyField, ErrorBox, Notice, TableCard, Td, Th, useAction, useLoad } from '@/components/connect/ui';
import { CURRENCIES, date, Stat, useA, type AffiliateInfo, type Cur, type Program } from './common';

interface Sums { pending: number; approved: number; paid: number; reversed: number }
interface Balance { pending: number; available: number; requested: number; paidOut: number; minPayoutMinor: number }
interface Dashboard { code: string; links: string[]; range: { from: string; to: string }; clicks: number; signups: number; payingCustomers: number; commissions: Record<Cur, Sums>; balances: Record<Cur, Balance> }
interface Referral { id: string; customer: string; signedUpAt: string; commissionUntil: string; status: string; services: string[]; commission: { currency: string; amountMinor: number }[] }
interface Payout { id: string; currency: Cur; amountMinor: number; status: string; reference: string | null; requestedAt: string; paidAt: string | null }
interface Details { method: string; holderName: string; bankName: string; bankCountry: string; ibanLast4: string; swift: string | null; note: string | null }

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));

/** Code, links, statistics for a period and the balances. */
export function DashboardTab({ affiliate, program }: { affiliate: AffiliateInfo; program: Program }) {
  const { a, af, locale } = useA();
  const { console: consoleUrl } = useUrls();
  const [range, setRange] = useState({ from: daysAgo(30), to: iso(new Date()) });
  const [draft, setDraft] = useState(range);
  const { data, error } = useLoad(() => api<Dashboard>(`/v1/affiliates/me/dashboard?from=${range.from}&to=${range.to}`), [range.from, range.to]);
  const preset = (n: number) => { const r = { from: daysAgo(n), to: iso(new Date()) }; setRange(r); setDraft(r); };
  const used = CURRENCIES.filter((c) => data && (Object.values(data.commissions[c]).some(Boolean) || Object.values(data.balances[c]).some((v, i) => i < 4 && v)));
  const shown = used.length ? used : CURRENCIES;

  return (
    <div className="space-y-5">
      <section className="card space-y-3">
        <div className="grid gap-4 md:grid-cols-[1fr_2fr]">
          <div>
            <div className="text-xs text-neutral-500">{a('yourCode')}</div>
            <div className="mt-1 flex items-center gap-2"><span className="font-mono text-2xl font-semibold" dir="ltr">{affiliate.code}</span><CopyButton text={affiliate.code ?? ''} label={a('yourCode')} /></div>
          </div>
          <div className="min-w-0 space-y-2">
            <div className="text-xs text-neutral-500">{a('yourLinks')}</div>
            {affiliate.links.map((l) => <CopyField key={l} value={l} label={a('yourLinks')} />)}
            <div className="text-xs text-neutral-500">{a('promoLink')}</div>
            <CopyField value={`${consoleUrl}/login?promo=${affiliate.code}`} label={a('promoLink')} />
            <p className="text-xs text-neutral-500">{a('linkHint')}</p>
          </div>
        </div>
      </section>

      <section className="flex flex-wrap items-end gap-2">
        <div className="me-2 text-sm font-medium">{a('range')}</div>
        <button type="button" className="btn-ghost text-sm" onClick={() => preset(7)}>{a('last7')}</button>
        <button type="button" className="btn-ghost text-sm" onClick={() => preset(30)}>{a('last30')}</button>
        <button type="button" className="btn-ghost text-sm" onClick={() => preset(90)}>{a('last90')}</button>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (draft.from <= draft.to) setRange(draft); }}>
          <label className="text-xs text-neutral-500">{a('from')}<input type="date" className="input mt-0.5 block" value={draft.from} max={draft.to} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></label>
          <label className="text-xs text-neutral-500">{a('to')}<input type="date" className="input mt-0.5 block" value={draft.to} min={draft.from} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></label>
          <button className="btn-ghost text-sm">{a('apply')}</button>
        </form>
      </section>

      <ErrorBox error={error} />
      {!data ? <p className="text-sm text-neutral-500">{a('loading')}</p> : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label={a('clicks')} value={String(data.clicks)} />
            <Stat label={a('signups')} value={String(data.signups)} />
            <Stat label={a('paying')} value={String(data.payingCustomers)} />
          </div>
          <section className="space-y-2">
            <h2 className="font-medium">{a('earned')}</h2>
            {shown.map((c) => (
              <div key={c} className="grid gap-3 sm:grid-cols-4">
                <Stat label={`${a('pending')} · ${c}`} value={money(data.commissions[c].pending, c, locale)} />
                <Stat label={`${a('approved')} · ${c}`} value={money(data.commissions[c].approved, c, locale)} />
                <Stat label={`${a('paid')} · ${c}`} value={money(data.commissions[c].paid, c, locale)} />
                <Stat label={`${a('reversed')} · ${c}`} value={money(data.commissions[c].reversed, c, locale)} />
              </div>
            ))}
          </section>
          <section className="space-y-2">
            <h2 className="font-medium">{a('balances')}</h2>
            <p className="text-xs text-neutral-500">{af('pendingHint')(program.holdDays)}</p>
            {shown.map((c) => (
              <div key={c} className="grid gap-3 sm:grid-cols-4">
                <Stat label={`${a('pending')} · ${c}`} value={money(data.balances[c].pending, c, locale)} />
                <Stat label={`${a('available')} · ${c}`} value={money(data.balances[c].available, c, locale)} hint={`${a('minimum')}: ${money(data.balances[c].minPayoutMinor, c, locale)}`} />
                <Stat label={`${a('requested')} · ${c}`} value={money(data.balances[c].requested, c, locale)} />
                <Stat label={`${a('paid')} · ${c}`} value={money(data.balances[c].paidOut, c, locale)} />
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

/** Referred customers, anonymized by the API. */
export function ReferralsTab() {
  const { a, ad, locale } = useA();
  const [rows, setRows] = useState<Referral[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const load = useCallback((cursor?: string) => run(async () => {
    const r = await api<{ data: Referral[]; meta: { next_cursor: string | null } }>(`/v1/affiliates/me/referrals${cursor ? `?cursor=${cursor}` : ''}`);
    setRows((prev) => (cursor && prev ? [...prev, ...r.data] : r.data));
    setNext(r.meta.next_cursor);
  }), [run]);
  useEffect(() => { load(); }, [load]);

  if (!rows) return <><ErrorBox error={error} /><p className="text-sm text-neutral-500">{a('loading')}</p></>;
  if (!rows.length) return <div className="card text-sm text-neutral-500">{a('noReferrals')}</div>;
  const tone: Record<string, string> = { paying: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300', signed_up: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300', not_eligible: 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400' };
  return (
    <div className="space-y-3">
      <TableCard>
        <thead><tr><Th>{a('customer')}</Th><Th>{a('signedUp')}</Th><Th>{a('status')}</Th><Th>{a('services')}</Th><Th>{a('earnsUntil')}</Th><Th end>{a('commission')}</Th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-neutral-100 dark:border-neutral-800">
              <Td className="font-mono text-xs" >{r.customer}</Td>
              <Td>{date(r.signedUpAt, locale)}</Td>
              <Td><span className={`badge ${tone[r.status] ?? ''}`}>{ad('st_', r.status)}</span></Td>
              <Td className="text-xs">{r.services.map((s) => ad('cat_', s)).join(', ') || '·'}</Td>
              <Td>{r.status === 'not_eligible' ? '·' : date(r.commissionUntil, locale)}</Td>
              <Td className="text-end">{r.commission.length ? r.commission.map((c) => <div key={c.currency}>{money(c.amountMinor, c.currency, locale)}</div>) : '·'}</Td>
            </tr>
          ))}
        </tbody>
      </TableCard>
      <ErrorBox error={error} />
      {next && <button type="button" className="btn-ghost text-sm" disabled={busy} onClick={() => load(next)}>{a('loadMore')}</button>}
    </div>
  );
}

/** Payout per currency, payout details and history. */
export function PayoutsTab({ onDetailsSaved }: { onDetailsSaved: () => void }) {
  const { a, af, ad, locale } = useA();
  const dash = useLoad(() => api<Dashboard>('/v1/affiliates/me/dashboard'), []);
  const hist = useLoad(() => api<{ data: Payout[] }>('/v1/affiliates/me/payouts'), []);
  const det = useLoad(() => api<{ details: Details | null }>('/v1/affiliates/me/payout-details'), []);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const req = useAction();
  const save = useAction();
  const countries = countryOptions(locale);
  const details = det.data?.details ?? null;

  async function request(currency: Cur) {
    setNotice(null);
    const r = await req.run(() => api<Payout>('/v1/affiliates/me/payouts', { method: 'POST', body: JSON.stringify({ currency }) }));
    if (r) { setNotice(a('payoutRequested')); dash.reload(); hist.reload(); }
  }
  async function saveDetails(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { method: 'bank_transfer', holderName: f.get('holderName'), bankName: f.get('bankName'), bankCountry: f.get('bankCountry'), iban: f.get('iban'), swift: String(f.get('swift') ?? '') || undefined, note: String(f.get('note') ?? '') || undefined };
    const r = await save.run(() => api<{ details: Details }>('/v1/affiliates/me/payout-details', { method: 'PUT', body: JSON.stringify(body) }));
    if (r) { det.setData(r); setEditing(false); onDetailsSaved(); }
  }

  return (
    <div className="space-y-5">
      {notice && <Notice>{notice}</Notice>}
      <ErrorBox error={req.error ?? dash.error} />
      <section className="grid gap-3 sm:grid-cols-2">
        {CURRENCIES.map((c) => {
          const b = dash.data?.balances[c];
          const enough = !!b && b.available > 0 && b.available >= b.minPayoutMinor;
          return (
            <div key={c} className="card space-y-2">
              <div className="text-xs text-neutral-500">{a('available')} · {c}</div>
              <div className="text-2xl font-semibold" dir="ltr" style={{ unicodeBidi: 'isolate' }}>{b ? money(b.available, c, locale) : '…'}</div>
              {b && b.requested > 0 && <div className="text-xs text-neutral-500">{a('requested')}: {money(b.requested, c, locale)}</div>}
              <button type="button" className="btn-primary text-sm" disabled={!enough || !details || req.busy} onClick={() => request(c)}>{req.busy ? a('requesting') : a('requestPayout')}</button>
              {b && !enough && <p className="text-xs text-neutral-500">{af('belowMin')(money(b.minPayoutMinor, c, locale))}</p>}
              {b && enough && !details && <p className="text-xs text-amber-700 dark:text-amber-400">{a('needDetails')}</p>}
            </div>
          );
        })}
      </section>

      <section className="card space-y-3">
        <div>
          <h2 className="font-medium">{a('detailsH')}</h2>
          <p className="mt-1 text-sm text-neutral-500">{a('detailsLead')}</p>
        </div>
        {details && !editing ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div><span className="badge me-2 bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">{a('onFile')}</span>{details.holderName} · {details.bankName} · {a('ending')} <span dir="ltr">{details.ibanLast4}</span></div>
            <button type="button" className="btn-ghost text-sm" onClick={() => setEditing(true)}>{a('change')}</button>
          </div>
        ) : (
          <form onSubmit={saveDetails} className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1 text-sm"><span>{a('holderName')}</span><input className="input" name="holderName" required minLength={2} maxLength={120} defaultValue={details?.holderName} /></label>
            <label className="block space-y-1 text-sm"><span>{a('bankName')}</span><input className="input" name="bankName" required minLength={2} maxLength={120} defaultValue={details?.bankName} /></label>
            <label className="block space-y-1 text-sm"><span>{a('bankCountry')}</span>
              <select className="input" name="bankCountry" required defaultValue={details?.bankCountry ?? ''}><option value="" disabled>…</option>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
            </label>
            <label className="block space-y-1 text-sm"><span>{a('iban')}</span><input className="input font-mono" name="iban" required pattern="[A-Za-z0-9 ]{6,40}" dir="ltr" autoComplete="off" /></label>
            <label className="block space-y-1 text-sm"><span>{a('swift')}</span><input className="input font-mono" name="swift" pattern="[A-Za-z0-9 ]{8,11}" dir="ltr" defaultValue={details?.swift ?? ''} autoComplete="off" /></label>
            <label className="block space-y-1 text-sm sm:col-span-2"><span>{a('note')}</span><input className="input" name="note" maxLength={300} defaultValue={details?.note ?? ''} /></label>
            <div className="sm:col-span-2 flex items-center gap-2">
              <button className="btn-primary text-sm" disabled={save.busy}>{a('saveDetails')}</button>
              {details && <button type="button" className="btn-ghost text-sm" onClick={() => setEditing(false)}>×</button>}
            </div>
            <div className="sm:col-span-2"><ErrorBox error={save.error} /></div>
          </form>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">{a('historyH')}</h2>
        {!hist.data ? <p className="text-sm text-neutral-500">{a('loading')}</p> : !hist.data.data.length ? <div className="card text-sm text-neutral-500">{a('noPayouts')}</div> : (
          <TableCard>
            <thead><tr><Th>{a('requestedOn')}</Th><Th end>{a('amount')}</Th><Th>{a('status')}</Th><Th>{a('paidOn')}</Th><Th>{a('reference')}</Th></tr></thead>
            <tbody>
              {hist.data.data.map((p) => (
                <tr key={p.id} className="border-t border-neutral-100 dark:border-neutral-800">
                  <Td>{date(p.requestedAt, locale)}</Td>
                  <Td className="text-end">{money(p.amountMinor, p.currency, locale)}</Td>
                  <Td>{ad('ps_', p.status)}</Td>
                  <Td>{date(p.paidAt, locale) || '·'}</Td>
                  <Td className="font-mono text-xs">{p.reference ?? '·'}</Td>
                </tr>
              ))}
            </tbody>
          </TableCard>
        )}
      </section>
    </div>
  );
}

const LOGOS = [
  { file: 'progrid-logo.png', label: 'Progrid logo (PNG)' },
  { file: 'progrid-mark.svg', label: 'Progrid mark (SVG)' },
  { file: 'progrid-mark-white.svg', label: 'Progrid mark, white (SVG)' },
];
const BANNERS = [
  { file: 'progrid-728x90.svg', size: '728 × 90' },
  { file: 'progrid-300x250.svg', size: '300 × 250' },
  { file: 'progrid-1200x630.svg', size: '1200 × 630' },
  { file: 'progrid-1200x630-ar.svg', size: '1200 × 630 (العربية)' },
];

/** Logos, banners and copy with the affiliate's code filled in. */
export function AssetsTab({ code, program }: { code: string; program: Program }) {
  const { a, af } = useA();
  return (
    <div className="space-y-5">
      <Notice tone="blue"><strong>{a('disclosureH')}.</strong> {a('disclosure')}</Notice>
      <section className="space-y-2">
        <h2 className="font-medium">{a('logosH')}</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {LOGOS.map((l) => (
            <div key={l.file} className="card flex flex-col items-center gap-3">
              <div className={`flex h-20 w-full items-center justify-center rounded ${l.file.includes('white') ? 'bg-[#0b1730]' : 'bg-neutral-50 dark:bg-neutral-100'}`}><img src={`/affiliates/${l.file}`} alt={l.label} className="max-h-14 max-w-[80%]" /></div>
              <div className="text-xs text-neutral-500">{l.label}</div>
              <a href={`/affiliates/${l.file}`} download className="btn-ghost text-sm">{a('download')}</a>
            </div>
          ))}
        </div>
      </section>
      <section className="space-y-2">
        <h2 className="font-medium">{a('banners')}</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {BANNERS.map((b) => (
            <div key={b.file} className="card space-y-2">
              <img src={`/affiliates/${b.file}`} alt={`Progrid banner ${b.size}`} className="mx-auto max-h-40 w-auto max-w-full rounded" />
              <div className="flex items-center justify-between text-xs text-neutral-500"><span dir="ltr">{b.size}</span><a href={`/affiliates/${b.file}`} download className="btn-ghost text-sm">{a('download')}</a></div>
            </div>
          ))}
        </div>
      </section>
      <section className="space-y-2">
        <h2 className="font-medium">{a('copyH')}</h2>
        {af('snippets')(code, program.promoDiscountPercent, program.promoDiscountMonths).map((s) => (
          <div key={s} className="card flex items-start gap-3 text-sm"><p className="flex-1">{s}</p><CopyButton text={s} label={a('copy')} /></div>
        ))}
      </section>
    </div>
  );
}

export function isNotAffiliate(e: unknown) {
  return e instanceof ApiError && e.code === 'not_an_affiliate';
}
