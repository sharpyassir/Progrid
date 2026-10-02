'use client';

import { FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError, API_URL, Balance, getToken, money } from '@/lib/api';
import { t, tf, type Locale } from '@/lib/i18n';
import { normalizeCode } from '@/lib/referral';
import { useShell } from '@/components/shell';
import { StatusBadge } from '@/components/status-badge';

interface UsageRow { resourceType: string; resourceId: string; unit: string; quantity: number; amountMinor: number; currency: string }
interface Invoice { id: string; number: string; currency: string; totalMinor: number; status: string; periodStart: string; dueAt: string | null; paidAt: string | null; eInvoiceType: string | null }
interface Payment { id: string; provider: string; currency: string; amountMinor: number; status: string; failureReason: string | null; createdAt: string; invoice: { number: string } | null }

const PRESETS: Record<string, number[]> = { USD: [1000, 2500, 5000, 10000], SAR: [5000, 10000, 25000, 50000] };

function BillingPage() {
  const { locale } = useShell();
  const outcome = useSearchParams().get('payment');
  const [balance, setBalance] = useState<Balance | null>(null);
  const [usage, setUsage] = useState<UsageRow[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [amount, setAmount] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => Promise.all([
    api<Balance>('/v1/billing/balance').then(setBalance),
    api<{ data: UsageRow[] }>('/v1/billing/usage').then((r) => setUsage(r.data)),
    api<{ data: Invoice[] }>('/v1/billing/invoices').then((r) => setInvoices(r.data)),
    api<{ data: Payment[] }>('/v1/billing/payments').then((r) => setPayments(r.data)).catch(() => undefined),
  ]), []);
  useEffect(() => { load(); }, [load]);

  async function go(fn: () => Promise<{ redirectUrl: string }>) {
    setBusy(true); setError(null);
    try { const r = await fn(); window.location.href = r.redirectUrl; }
    catch (err) { setError(err instanceof ApiError ? err.message : String(err)); setBusy(false); }
  }
  function topup(e: FormEvent) {
    e.preventDefault();
    if (!amount) return;
    go(() => api('/v1/billing/topup', { method: 'POST', idempotent: true, body: JSON.stringify({ amountMinor: Math.round(Number(amount) * 100) }) }));
  }
  async function openPdf(inv: Invoice) {
    const res = await fetch(`${API_URL}/v1/billing/invoices/${inv.id}/pdf`, { headers: { authorization: `Bearer ${getToken()}` } });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  if (!balance) return <p className="text-sm text-neutral-500">{t(locale, 'loading')}</p>;
  const cur = balance.currency;
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{t(locale, 'billing')}</h1>
      {outcome === 'success' && <p className="rounded border border-green-200 bg-green-50 p-2 text-sm text-green-800 dark:bg-green-950/30">Payment received. Thank you.</p>}
      {outcome === 'cancel' && <p className="rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-950/30">The payment was not completed. Nothing was charged.</p>}
      {error && <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/30">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t(locale, 'balance')} value={money(balance.creditMinor, cur, locale)} />
        <Stat label={t(locale, 'mtd')} value={money(balance.monthToDateMinor, cur, locale)} />
        <Stat label={t(locale, 'status')} value={balance.status} />
      </div>

      {balance.billingEntity && (
        <section className="card space-y-1 text-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-medium">{t(locale, 'billedBy')}: {balance.billingEntity.legalName}</h2>
            <span className="text-xs text-neutral-500">{t(locale, 'billingCountry')}: {balance.billingCountry} · {balance.billingEntity.currency}</span>
          </div>
          <p className="text-neutral-600 dark:text-neutral-400">{t(locale, balance.billingEntity.id === 'progrid_arabia' ? 'entityNote_progrid_arabia' : 'entityNote_progrid_llc')}</p>
          {balance.pendingChange && <p className="text-amber-700 dark:text-amber-400">{t(locale, 'entityPending').replace('{date}', new Date(balance.pendingChange.effectiveAt).toLocaleDateString(locale)).replace('{company}', balance.pendingChange.billingEntity.legalName)}</p>}
          <p className="text-xs text-neutral-500">{t(locale, 'entityChangeHint')} <a className="underline" href={balance.billingEntity.termsUrl} target="_blank" rel="noreferrer">{t(locale, 'termsLink')}</a> · {balance.billingEntity.supportEmail}</p>
        </section>
      )}

      <PromoCard locale={locale} canAdd={!invoices.some((i) => i.status === 'paid' && i.totalMinor > 0)} />

      <section className="card space-y-3">
        <h2 className="font-medium">Add credit</h2>
        <p className="text-sm text-neutral-500">{t(locale, 'addCreditLead')}</p>
        <form onSubmit={topup} className="flex flex-wrap items-center gap-2">
          {PRESETS[cur].map((m) => <button type="button" key={m} onClick={() => setAmount(m / 100)} className={`btn-ghost ${amount === m / 100 ? 'ring-2 ring-blue-500' : ''}`}>{money(m, cur, locale)}</button>)}
          <input className="input max-w-[10rem]" type="number" min={cur === 'SAR' ? 20 : 5} step="1" placeholder={`Other (${cur})`} value={amount} onChange={(e) => setAmount(e.target.value === '' ? '' : Number(e.target.value))} />
          <button className="btn-primary" disabled={busy || !amount}>{busy ? 'Redirecting…' : 'Pay by card'}</button>
        </form>
      </section>

      <section id="usage" className="card scroll-mt-4 p-0">
        <h2 className="border-b border-neutral-100 px-4 py-2 font-medium dark:border-neutral-800">This month</h2>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-neutral-500"><tr><th className="px-4 py-2 text-start">Resource</th><th className="px-4 py-2 text-start">Usage</th><th className="px-4 py-2 text-end">Amount</th></tr></thead>
          <tbody>
            {usage.length === 0 && <tr><td className="px-4 py-3 text-neutral-500" colSpan={3}>—</td></tr>}
            {usage.map((u) => (
              <tr key={u.resourceId + u.unit} className="border-t border-neutral-100 dark:border-neutral-800">
                <td className="px-4 py-2">{u.resourceType} <span className="font-mono text-xs text-neutral-500">{u.resourceId.includes(':') ? `${u.resourceId.split(':')[0].slice(-6)} ${u.resourceId.split(':').slice(1).join(':')}` : u.resourceId.slice(-6)}</span></td>
                <td className="px-4 py-2">{Math.round(u.quantity * 100) / 100} {u.unit}</td>
                <td className="px-4 py-2 text-end">{money(u.amountMinor, u.currency, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card p-0">
        <h2 className="border-b border-neutral-100 px-4 py-2 font-medium dark:border-neutral-800">Invoices</h2>
        <table className="w-full text-sm">
          <tbody>
            {invoices.length === 0 && <tr><td className="px-4 py-3 text-neutral-500">No invoices yet. The first one is issued on the first of next month.</td></tr>}
            {invoices.map((i) => (
              <tr key={i.id} className="border-t border-neutral-100 first:border-0 dark:border-neutral-800">
                <td className="px-4 py-2 font-mono">{i.number}</td>
                <td className="px-4 py-2 text-neutral-500">{i.periodStart.slice(0, 7)} {i.eInvoiceType && `· ${i.eInvoiceType}`}</td>
                <td className="px-4 py-2"><StatusBadge status={i.status === 'paid' ? 'active' : i.status === 'open' ? 'pending' : i.status} /> {i.status === 'open' && i.dueAt && <span className="ms-1 text-xs text-neutral-500">due {new Date(i.dueAt).toLocaleDateString(locale)}</span>}</td>
                <td className="px-4 py-2 text-end font-medium">{money(i.totalMinor, i.currency, locale)}</td>
                <td className="px-4 py-2 text-end whitespace-nowrap">
                  <button className="btn-ghost me-1" onClick={() => openPdf(i)}>PDF</button>
                  {i.status === 'open' && <button className="btn-primary" disabled={busy} onClick={() => go(() => api(`/v1/billing/invoices/${i.id}/pay`, { method: 'POST', idempotent: true }))}>Pay</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {payments.length > 0 && (
        <section className="card p-0">
          <h2 className="border-b border-neutral-100 px-4 py-2 font-medium dark:border-neutral-800">Payments</h2>
          <table className="w-full text-sm">
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-neutral-100 first:border-0 dark:border-neutral-800">
                  <td className="px-4 py-2 text-neutral-500">{new Date(p.createdAt).toLocaleString(locale)}</td>
                  <td className="px-4 py-2">{p.invoice ? `Invoice ${p.invoice.number}` : 'Credit top up'} <span className="text-xs text-neutral-500">via {p.provider}</span></td>
                  <td className="px-4 py-2"><StatusBadge status={p.status === 'succeeded' ? 'active' : p.status} /> {p.failureReason && <span className="ms-1 text-xs text-red-600">{p.failureReason}</span>}</td>
                  <td className="px-4 py-2 text-end">{money(p.amountMinor, p.currency, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

interface Referral { code: string; source: string; discountPercent: number; discountUntil: string | null }

/** The partner promo code on this account, or a form to add one before the first paid invoice (docs/affiliates.md). */
function PromoCard({ locale, canAdd }: { locale: Locale; canAdd: boolean }) {
  const [referral, setReferral] = useState<Referral | null | undefined>(undefined);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<{ referral: Referral | null }>('/v1/billing/referral').then((r) => setReferral(r.referral)).catch(() => setReferral(null)); }, []);

  async function apply(e: FormEvent) {
    e.preventDefault();
    const c = normalizeCode(code);
    if (!c) return setError(t(locale, 'promoInvalid'));
    setBusy(true); setError(null);
    try { setReferral((await api<{ referral: Referral }>('/v1/billing/promo-code', { method: 'POST', body: JSON.stringify({ code: c }) })).referral); }
    catch (err) { setError(err instanceof ApiError ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  if (referral === undefined) return null;
  if (referral && (referral.source === 'promo_code' || !canAdd)) {
    const until = referral.discountUntil ? new Date(referral.discountUntil).toLocaleDateString(locale) : '';
    return <section className="card text-sm"><h2 className="font-medium">{t(locale, 'promoTitle')}</h2><p className="mt-1 text-neutral-600 dark:text-neutral-400">{tf(locale, 'promoActive')(referral.code, referral.discountUntil ? referral.discountPercent : 0, until)}</p></section>;
  }
  if (!canAdd) return null;
  return (
    <section className="card space-y-3">
      <h2 className="font-medium">{t(locale, 'promoTitle')}</h2>
      <p className="text-sm text-neutral-500">{t(locale, 'promoNote')}</p>
      <form onSubmit={apply} className="flex flex-wrap items-center gap-2">
        <input className="input max-w-[14rem] uppercase" dir="ltr" maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} placeholder={t(locale, 'promoTitle')} />
        <button className="btn-primary" disabled={busy || !code.trim()}>{t(locale, 'promoApply')}</button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="card"><div className="text-xs text-neutral-500">{label}</div><div className="mt-1 text-lg font-semibold">{value}</div></div>;
}

export default function Page() {
  return <Suspense><BillingPage /></Suspense>;
}
