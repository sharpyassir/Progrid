'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { AdminShell, fmtDate, fmtMoney } from '@/components/admin-shell';

interface Invoice { id: string; number: string; status: string; totalMinor: number; creditedMinor?: number; currency: string; periodStart: string; dueAt: string | null; eInvoiceType: string | null; team: { id: string; name: string; slug: string; country: string } }
interface Fx { rate: number; history: { rate: string; source: string; at: string }[] }
interface Price { id: string; resourceType: string; sku: string; monthlyMinor: number; unit: string; validFrom: string }

export default function AdminFinance() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [fx, setFx] = useState<Fx | null>(null);
  const [prices, setPrices] = useState<Price[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => Promise.all([
    api<{ data: Invoice[] }>('/admin/v1/invoices').then((r) => setInvoices(r.data)),
    api<Fx>('/admin/v1/fx').then(setFx),
    api<{ data: Price[] }>('/admin/v1/prices').then((r) => setPrices(r.data)),
  ]), []);
  useEffect(() => { load(); }, [load]);
  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg(null);
    try { const r = await fn(); setMsg(typeof r === 'object' && r ? `${ok} ${JSON.stringify(r)}` : ok); await load(); } catch (err) { setMsg(err instanceof ApiError ? err.message : String(err)); }
  }
  const open = invoices.filter((i) => i.status === 'open');
  return (
    <AdminShell title="Finance" actions={<>
      <button className="btn-ghost" onClick={() => run(() => api('/admin/v1/billing/rollup', { method: 'POST', body: '{}' }), 'Rated the previous hour.')}>Rate previous hour</button>
      <button className="btn-ghost" onClick={() => confirm('Issue invoices for the previous month for every team?') && run(() => api('/admin/v1/billing/issue-invoices', { method: 'POST' }), 'Issued.')}>Issue monthly invoices</button>
    </>}>
      {msg && <p className="rounded border border-neutral-200 bg-neutral-50 p-2 text-sm dark:border-neutral-800 dark:bg-neutral-900">{msg}</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-3">
          <h2 className="font-medium">Exchange rate</h2>
          <p className="text-sm">USD to SAR: <span className="text-2xl font-semibold">{fx?.rate.toFixed(4) ?? '…'}</span></p>
          <p className="text-xs text-neutral-500">Prices are kept in riyals. Dollar prices and invoices use the rate stored at the hour of usage. The hourly job refreshes it from the provider; set it by hand when the provider is down or the central bank rate must be used.</p>
          <form className="flex gap-2" onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const rate = Number(new FormData(e.currentTarget).get('rate')); run(() => api('/admin/v1/fx', { method: 'POST', body: JSON.stringify({ rate }) }), 'Rate set.'); }}>
            <input className="input max-w-[10rem]" name="rate" type="number" step="0.0001" min="0.0001" placeholder="41.2500" required />
            <button className="btn-primary">Set rate</button>
            <button type="button" className="btn-ghost" onClick={() => run(() => api('/admin/v1/fx/refresh', { method: 'POST' }), 'Refreshed from the provider.')}>Refresh now</button>
          </form>
          <table className="w-full text-xs"><tbody>{fx?.history.slice(0, 6).map((h, i) => <tr key={i} className="border-t border-neutral-100 dark:border-neutral-800"><td className="py-1 text-neutral-500">{fmtDate(h.at)}</td><td className="py-1">{Number(h.rate).toFixed(4)}</td><td className="py-1 text-neutral-500">{h.source}</td></tr>)}</tbody></table>
        </section>
        <section className="card space-y-3">
          <h2 className="font-medium">Price list (SAR, excluding VAT)</h2>
          <p className="text-xs text-neutral-500">Changing a price closes the old row and opens a new one from now. Hours already rated keep their rate. Most prices are per month. Connect prices are per unit shown: per_1k is per 1,000 executions or tool calls, per_10m is per 10M tokens of that model.</p>
          <table className="w-full text-sm"><tbody>
            {prices.map((p) => (
              <tr key={p.id} className="border-t border-neutral-100 dark:border-neutral-800">
                <td className="py-1 font-mono text-xs">{p.sku}</td><td className="py-1 text-xs text-neutral-500">{p.resourceType} · {p.unit}</td>
                <td className="py-1 text-end">
                  <form className="inline-flex gap-1" onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const v = Number(new FormData(e.currentTarget).get('usd')); if (confirm(`Set ${p.sku} to SAR ${v} (${p.unit})?`)) run(() => api('/admin/v1/prices', { method: 'POST', body: JSON.stringify({ sku: p.sku, monthlyMinor: Math.round(v * 100) }) }), 'Price set.'); }}>
                    <input className="input w-24 py-0.5 text-end text-xs" name="usd" type="number" step="0.01" min="0" defaultValue={(p.monthlyMinor / 100).toFixed(2)} /><button className="btn-ghost px-2 py-0.5 text-xs">Set</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody></table>
        </section>
      </div>
      <section className="card flex flex-wrap items-center gap-3">
        <h2 className="font-medium">Invoices</h2>
        <span className="text-sm text-neutral-500">{open.length} open · {fmtMoney(open.filter((i) => i.currency === 'SAR').reduce((s, i) => s + i.totalMinor - (i.creditedMinor ?? 0), 0), 'SAR')} + {fmtMoney(open.filter((i) => i.currency === 'USD').reduce((s, i) => s + i.totalMinor - (i.creditedMinor ?? 0), 0), 'USD')} outstanding</span>
        <Link href="/admin/invoices" className="btn-ghost ms-auto">Refunds, credit notes and payments</Link>
      </section>
    </AdminShell>
  );
}
