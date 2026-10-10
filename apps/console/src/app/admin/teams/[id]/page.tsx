'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { billingForCountry, countryOptions, ENTITY_NAME, type BillingEntityId } from '@/lib/countries';
import { AdminShell, Stat, fmtDate, fmtMoney } from '@/components/admin-shell';
import { StatusBadge } from '@/components/status-badge';

interface Team {
  id: string; name: string; slug: string; country: string; currency: string; status: string; kycLevel: number; taxId: string | null; createdAt: string;
  billingEntity: BillingEntityId; pendingCountry: string | null; pendingCurrency: string | null; billingChangeAt: string | null;
  members: { role: string; user: { id: string; email: string; name: string } }[];
  projects: { id: string; name: string; slug: string; spendLimitMinor: number | null; _count: { servers: number } }[];
  abuseFlags: { id: string; kind: string; score: number; source: string; createdAt: string }[];
  credits: { id: string; kind: string; amountMinor: number; remainingMinor: number; reason: string | null; expiresAt: string | null; createdAt: string }[];
  invoices: { id: string; number: string; status: string; totalMinor: number; currency: string; periodStart: string; billingEntity: BillingEntityId }[];
}

export default function AdminTeam() {
  const { id } = useParams<{ id: string }>();
  const [t, setT] = useState<Team | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => api<Team>(`/admin/v1/teams/${id}`).then(setT), [id]);
  useEffect(() => { load(); }, [load]);
  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg(null);
    try { await fn(); setMsg(ok); await load(); } catch (err) { setMsg(err instanceof ApiError ? err.message : String(err)); }
  }
  async function credit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await run(() => api(`/admin/v1/teams/${id}/credits`, { method: 'POST', body: JSON.stringify({ kind: f.get('kind'), amountMinor: Math.round(Number(f.get('amount')) * 100), reason: f.get('reason') || undefined }) }), 'Credit added.');
    e.currentTarget.reset();
  }
  async function billingCountry(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const country = String(f.get('country') ?? '');
    // Currency: the country's (SA: SAR, else USD) unless staff keep another one (credit left in it).
    const picked = String(f.get('currency') ?? '');
    const currency = picked || billingForCountry(country).currency;
    const scheduled = currency !== t!.currency;
    const question = scheduled
      ? `Change ${t!.name} to ${country} and ${currency} from the first day of next month? VAT follows the country (SA 15%, else 0%). Credit left in ${t!.currency} is not converted.`
      : `Change the billing country of ${t!.name} to ${country} now? The currency stays ${t!.currency}; VAT follows the country (SA 15%, else 0%).`;
    if (!confirm(question)) return;
    await run(() => api(`/admin/v1/teams/${id}/billing-country`, { method: 'POST', body: JSON.stringify({ country, reason: f.get('reason'), ...(picked ? { currency: picked } : {}) }) }), scheduled ? 'Currency change scheduled for the next month.' : 'Billing country changed.');
  }
  if (!t) return <AdminShell title="Team"><p className="text-sm text-neutral-500">Loading…</p></AdminShell>;
  const credit_ = t.credits.reduce((s, c) => s + (!c.expiresAt || new Date(c.expiresAt) > new Date() ? c.remainingMinor : 0), 0);
  return (
    <AdminShell title={t.name} actions={<>
      {t.status === 'suspended'
        ? <button className="btn-primary" onClick={() => run(() => api(`/admin/v1/teams/${id}/reinstate`, { method: 'POST' }), 'Team reinstated.')}>Reinstate</button>
        : <button className="btn-danger" onClick={() => { const reason = prompt('Reason for suspension:'); if (reason) run(() => api(`/admin/v1/teams/${id}/suspend`, { method: 'POST', body: JSON.stringify({ reason }) }), 'Team suspended.'); }}>Suspend</button>}
      {t.kycLevel < 1 && <button className="btn-ghost" onClick={() => run(() => api(`/admin/v1/teams/${id}/verify`, { method: 'POST', body: JSON.stringify({ kycLevel: 1 }) }), 'Marked as verified.')}>Mark verified</button>}
    </>}>
      {msg && <p className="rounded border border-neutral-200 bg-neutral-50 p-2 text-sm dark:border-neutral-800 dark:bg-neutral-900">{msg}</p>}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Status" value={t.status} sub={`KYC level ${t.kycLevel} · ${t.country} · ${t.currency}${t.taxId ? ` · tax id ${t.taxId}` : ''}`} tone={t.status === 'suspended' ? 'bad' : undefined} />
        <Stat label="Credit balance" value={fmtMoney(credit_, t.currency)} sub={`Billed by ${ENTITY_NAME[t.billingEntity]}${t.billingChangeAt && (t.pendingCurrency || t.pendingCountry) ? ` · ${t.pendingCountry ?? t.country}, ${t.pendingCurrency ?? t.currency} from ${fmtDate(t.billingChangeAt)}` : ''}`} />
        <Stat label="Servers" value={t.projects.reduce((s, p) => s + p._count.servers, 0)} sub={`${t.projects.length} projects`} />
        <Stat label="Open flags" value={t.abuseFlags.length} tone={t.abuseFlags.length ? 'bad' : undefined} />
      </div>
      <section className="card space-y-2">
        <h2 className="font-medium">Billing country and currency</h2>
        <p className="text-xs text-neutral-500">Progrid Arabia bills every team. The billing country decides VAT (Saudi Arabia 15%, elsewhere 0% as a zero-rated export of services) and the currency (SAR in Saudi Arabia, USD elsewhere). A change that keeps the currency applies now; a change of currency starts on the first day of next month. Keep the current currency only while the team still holds credit in it. Recorded in the audit log. Finance staff only.</p>
        <form className="flex flex-wrap items-center gap-2" onSubmit={billingCountry}>
          <select className="input w-auto" name="country" defaultValue={t.pendingCountry ?? t.country}>{countryOptions('en').map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}</select>
          <select className="input w-auto" name="currency" defaultValue="" aria-label="Currency">
            <option value="">Currency of the country</option>
            <option value="SAR">SAR</option>
            <option value="USD">USD</option>
          </select>
          <input className="input w-72" name="reason" placeholder="Reason (kept in the audit log)" required minLength={3} />
          <button className="btn-ghost">Change</button>
          {t.billingChangeAt && (t.pendingCurrency || t.pendingCountry) && <button type="button" className="btn-ghost" onClick={() => { const reason = prompt('Reason for cancelling the change:'); if (reason) run(() => api(`/admin/v1/teams/${id}/billing-country/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }), 'Scheduled change cancelled.'); }}>Cancel scheduled change</button>}
        </form>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card p-0">
          <h2 className="border-b border-neutral-100 px-4 py-2 font-medium dark:border-neutral-800">Members</h2>
          <table className="w-full text-sm"><tbody>{t.members.map((m) => <tr key={m.user.id} className="border-t border-neutral-100 dark:border-neutral-800"><td className="px-4 py-2">{m.user.name}</td><td className="px-4 py-2 text-neutral-500">{m.user.email}</td><td className="px-4 py-2"><span className="badge bg-neutral-100 dark:bg-neutral-800">{m.role}</span></td></tr>)}</tbody></table>
        </section>
        <section className="card p-0">
          <h2 className="border-b border-neutral-100 px-4 py-2 font-medium dark:border-neutral-800">Projects</h2>
          <table className="w-full text-sm"><tbody>{t.projects.map((p) => <tr key={p.id} className="border-t border-neutral-100 dark:border-neutral-800"><td className="px-4 py-2">{p.name} <span className="text-xs text-neutral-500">{p.slug}</span></td><td className="px-4 py-2">{p._count.servers} servers</td><td className="px-4 py-2 text-neutral-500">{p.spendLimitMinor != null ? `limit ${fmtMoney(p.spendLimitMinor, t.currency)}` : 'no limit'}</td></tr>)}</tbody></table>
        </section>
        <section className="card space-y-3">
          <h2 className="font-medium">Add credit</h2>
          <form onSubmit={credit} className="grid gap-2 sm:grid-cols-[8rem_8rem_1fr_auto]">
            <select className="input" name="kind" defaultValue="goodwill"><option value="goodwill">goodwill</option><option value="promo">promo</option><option value="refund">refund</option><option value="prepaid">prepaid</option></select>
            <input className="input" name="amount" type="number" min={1} step="0.01" placeholder={`Amount (${t.currency})`} required />
            <input className="input" name="reason" placeholder="Reason (shown in the ledger)" />
            <button className="btn-primary">Add</button>
          </form>
          <table className="w-full text-sm"><tbody>{t.credits.map((c) => <tr key={c.id} className="border-t border-neutral-100 dark:border-neutral-800"><td className="py-1 text-xs text-neutral-500">{fmtDate(c.createdAt)}</td><td className="py-1">{c.kind}</td><td className="py-1 text-neutral-500">{c.reason}</td><td className="py-1 text-end">{fmtMoney(c.remainingMinor, t.currency)} <span className="text-xs text-neutral-500">of {fmtMoney(c.amountMinor, t.currency)}</span></td></tr>)}</tbody></table>
        </section>
        <section className="card p-0">
          <h2 className="border-b border-neutral-100 px-4 py-2 font-medium dark:border-neutral-800">Invoices</h2>
          <table className="w-full text-sm"><tbody>
            {t.invoices.length === 0 && <tr><td className="px-4 py-3 text-neutral-500">None yet.</td></tr>}
            {t.invoices.map((i) => <tr key={i.id} className="border-t border-neutral-100 dark:border-neutral-800"><td className="px-4 py-2 font-mono">{i.number}</td><td className="px-4 py-2 text-neutral-500">{i.periodStart.slice(0, 7)}</td><td className="px-4 py-2"><StatusBadge status={i.status === 'paid' ? 'active' : i.status} /></td><td className="px-4 py-2 text-end">{fmtMoney(i.totalMinor, i.currency)}</td></tr>)}
          </tbody></table>
        </section>
      </div>
    </AdminShell>
  );
}
