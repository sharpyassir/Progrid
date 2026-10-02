'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError, API_URL, getToken } from '@/lib/api';
import { AdminShell, fmtDate, fmtMoney, Stat } from '@/components/admin-shell';

type Section = 'affiliates' | 'payouts' | 'commissions' | 'flags' | 'tax' | 'settings';
type Cur = 'USD' | 'SAR';
interface Bal { pending: number; approved: number; paid: number; reversed: number }
interface Row {
  id: string; status: string; code: string; name: string; email: string; country: string; channels: string[]; audienceSize: string; contentLanguage: string;
  appliedAt: string; reviewedAt: string | null; statusReason: string | null; referrals: number; openFlags: number; balances: Record<Cur, Bal>;
}
interface Detail extends Omit<Row, 'referrals' | 'openFlags'> {
  promotionPlan: string; termsVersion: string; termsAcceptedAt: string; applicationIp: string | null; clicks: number;
  user: { id: string; email: string; name: string; signupIp: string | null; createdAt: string };
  referrals: { id: string; status: string; blockedReason: string | null; discountPercent: number; attributedAt: string; commissionUntil: string; team: { id: string; name: string; slug: string; country: string } }[];
  payouts: { id: string; currency: Cur; amountMinor: number; status: string; reference: string | null; requestedAt: string; paidAt: string | null }[];
  flags: { id: string; kind: string; detail: Record<string, unknown>; createdAt: string; resolvedAt: string | null }[];
  payoutDetails: Record<string, string> | null;
  taxForms: TaxForm[];
}
interface TaxForm { id: string; formType: string; revision: string; status: string; legalName: string; businessName: string | null; taxClassification: string | null; tinType: string; tinMasked: string | null; country: string; region: string | null; backupWithholding: boolean; backupWithholdingReason: string | null; servicesOutsideUs: boolean; signatureName: string; signedAt: string; signedIp: string | null; expiresAt: string | null; statusReason: string | null }
interface Payout { id: string; currency: Cur; amountMinor: number; withheldMinor: number; netMinor: number; status: string; reference: string | null; note: string | null; requestedAt: string; paidAt: string | null; payingCompany: string; details: Record<string, string> | null; affiliate: { id: string; code: string; name: string; email: string; country: string }; _count: { commissions: number } }
interface Commission { id: string; category: string; currency: Cur; baseMinor: number; rateBp: number; amountMinor: number; reversedMinor: number; status: string; holdUntil: string; payoutId: string | null; createdAt: string; reversalReason: string | null; affiliate: { code: string; name: string }; invoice: { number: string; paidAt: string | null } }
interface Flag { id: string; kind: string; detail: Record<string, unknown>; createdAt: string; resolvedAt: string | null; affiliate: { id: string; code: string; name: string; status: string } }
interface Settings {
  applicationsOpen: boolean; rates: Record<string, number>; cookieDays: number; holdDays: number; commissionMonths: number; minPayoutMinor: Record<Cur, number>;
  promoDiscountPercent: number; promoDiscountMonths: number; flagSignupsPerIpPerDay: number; flagRefundRatePercent: number; termsVersion: string;
  form1099ThresholdMinor: number; taxPayerName: string; taxPayerEin: string; taxPayerAddress: string; taxPayerPhone: string;
}

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'affiliates', label: 'Affiliates' }, { id: 'payouts', label: 'Payouts' }, { id: 'commissions', label: 'Commissions' }, { id: 'flags', label: 'Flags' }, { id: 'tax', label: 'Tax & accounting' }, { id: 'settings', label: 'Settings' },
];
const CATEGORIES = ['web_hosting', 'connect', 'servers', 'managed_cloud', 'ai_usage', 'support'];
const STATUS_TONE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200', approved: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  rejected: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300', suspended: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  requested: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200', paid: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  cancelled: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300', reversed: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  active: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300', blocked: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
};
const Badge = ({ s }: { s: string }) => <span className={`badge ${STATUS_TONE[s] ?? ''}`}>{s}</span>;
const post = (path: string, body: unknown = {}) => api(path, { method: 'POST', body: JSON.stringify(body) });

/** Downloads a CSV export with the session token (a plain link would not carry it). */
async function download(kind: string, q: Record<string, string> = {}) {
  const res = await fetch(`${API_URL}/admin/v1/affiliates/export/${kind}?${new URLSearchParams(q)}`, { headers: { authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = `progrid-affiliate-${kind}-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Back office for the affiliate program (docs/affiliates.md): finance staff. */
export default function AdminAffiliates() {
  const [section, setSection] = useState<Section>('affiliates');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const act = useCallback(async (fn: () => Promise<unknown>, done = 'Done.') => {
    setMsg(null);
    try { await fn(); setMsg({ ok: true, text: done }); return true; } catch (err) { setMsg({ ok: false, text: err instanceof ApiError || err instanceof Error ? err.message : String(err) }); return false; }
  }, []);
  return (
    <AdminShell title="Affiliate program" actions={<a href="/affiliates/portal" className="btn-ghost text-sm">Partner portal</a>}>
      <nav className="flex flex-wrap gap-1 border-b border-neutral-200 text-sm dark:border-neutral-800">
        {SECTIONS.map((s) => <button key={s.id} type="button" onClick={() => { setSection(s.id); setMsg(null); }} className={`-mb-px border-b-2 px-3 py-2 ${section === s.id ? 'border-blue-600 font-medium' : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100'}`}>{s.label}</button>)}
      </nav>
      {msg && <p className={`rounded border p-2 text-sm ${msg.ok ? 'border-green-200 bg-green-50 text-green-800 dark:bg-green-950/30' : 'border-red-200 bg-red-50 text-red-700 dark:bg-red-950/30'}`}>{msg.text}</p>}
      {section === 'affiliates' && <Affiliates act={act} />}
      {section === 'payouts' && <Payouts act={act} />}
      {section === 'commissions' && <Commissions act={act} />}
      {section === 'flags' && <Flags act={act} />}
      {section === 'tax' && <Tax act={act} />}
      {section === 'settings' && <SettingsForm act={act} />}
    </AdminShell>
  );
}

type Act = (fn: () => Promise<unknown>, done?: string) => Promise<boolean>;

function Affiliates({ act }: { act: Act }) {
  const [status, setStatus] = useState('pending');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => api<{ data: Row[] }>(`/admin/v1/affiliates?${new URLSearchParams({ ...(status ? { status } : {}), ...(q ? { q } : {}) })}`).then((r) => setRows(r.data)), [status, q]);
  useEffect(() => { load(); }, [load]);
  const pending = rows?.filter((r) => r.status === 'pending').length ?? 0;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input max-w-[12rem]" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>{['pending', 'approved', 'suspended', 'rejected'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <form onSubmit={(e) => { e.preventDefault(); load(); }} className="flex gap-2"><input className="input" placeholder="Name, email or code" value={q} onChange={(e) => setQ(e.target.value)} /></form>
        <button type="button" className="btn-ghost ms-auto text-sm" onClick={() => act(() => download('affiliates', status ? { status } : {}), 'Exported.')}>Export CSV</button>
        <button type="button" className="btn-ghost text-sm" onClick={() => act(() => download('referrals'), 'Exported.')}>Referrals CSV</button>
      </div>
      {status === 'pending' && rows && <p className="text-sm text-neutral-500">{pending} {pending === 1 ? 'application' : 'applications'} waiting for review.</p>}
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-neutral-500"><tr>{['Affiliate', 'Code', 'Status', 'Country', 'Audience', 'Applied', 'Referrals', 'Approved USD', 'Approved SAR', 'Flags'].map((h) => <th key={h} className="px-4 py-2 text-start">{h}</th>)}</tr></thead>
          <tbody>
            {rows?.map((r) => (
              <tr key={r.id} className="cursor-pointer border-t border-neutral-100 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900" onClick={() => setOpen(r.id)}>
                <td className="px-4 py-2"><div className="font-medium">{r.name}</div><div className="text-xs text-neutral-500">{r.email}</div></td>
                <td className="px-4 py-2 font-mono text-xs">{r.code}</td>
                <td className="px-4 py-2"><Badge s={r.status} /></td>
                <td className="px-4 py-2">{r.country}</td>
                <td className="px-4 py-2 text-xs">{r.audienceSize} · {r.contentLanguage}</td>
                <td className="px-4 py-2 text-xs">{fmtDate(r.appliedAt)}</td>
                <td className="px-4 py-2">{r.referrals}</td>
                <td className="px-4 py-2">{fmtMoney(r.balances.USD.approved, 'USD')}</td>
                <td className="px-4 py-2">{fmtMoney(r.balances.SAR.approved, 'SAR')}</td>
                <td className="px-4 py-2">{r.openFlags ? <span className="badge bg-red-100 text-red-800">{r.openFlags}</span> : '·'}</td>
              </tr>
            ))}
            {rows && !rows.length && <tr><td colSpan={10} className="px-4 py-6 text-center text-neutral-500">Nothing here.</td></tr>}
          </tbody>
        </table>
      </div>
      {open && <AffiliateDetail id={open} act={act} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  );
}

function AffiliateDetail({ id, act, onClose, onChanged }: { id: string; act: Act; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const load = useCallback(() => api<Detail>(`/admin/v1/affiliates/${id}`).then(setD), [id]);
  useEffect(() => { load(); }, [load]);
  const after = async (ok: boolean) => { if (ok) { await load(); onChanged(); } };
  function approve() {
    const code = prompt(`Approve ${d!.name}? Partner code (leave as is or change):`, d!.code);
    if (code !== null) act(() => post(`/admin/v1/affiliates/${id}/approve`, { code: code.trim() || undefined }), 'Approved. The affiliate was emailed.').then(after);
  }
  function withReason(kind: 'reject' | 'suspend', label: string) {
    const reason = prompt(`${label} ${d!.name}. Reason (sent to the affiliate):`, '');
    if (reason && reason.trim().length >= 3) act(() => post(`/admin/v1/affiliates/${id}/${kind}`, { reason: reason.trim() }), `${label}. The affiliate was emailed.`).then(after);
  }
  return (
    <div role="dialog" aria-modal className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="h-full w-full max-w-3xl overflow-y-auto bg-white p-5 shadow-xl dark:bg-neutral-950" onClick={(e) => e.stopPropagation()}>
        {!d ? <p className="text-sm text-neutral-500">Loading…</p> : (
          <div className="space-y-5 text-sm">
            <div className="flex flex-wrap items-start gap-3">
              <div className="flex-1">
                <h2 className="text-lg font-semibold">{d.name} <span className="font-mono text-sm text-neutral-500">{d.code}</span></h2>
                <p className="text-neutral-500">{d.email} · {d.country} · account since {fmtDate(d.user.createdAt)}</p>
              </div>
              <Badge s={d.status} />
              <button type="button" className="btn-ghost text-sm" onClick={onClose}>Close</button>
            </div>
            <div className="flex flex-wrap gap-2">
              {d.status === 'pending' && <><button className="btn-primary text-sm" onClick={approve}>Approve</button><button className="btn-ghost text-sm" onClick={() => withReason('reject', 'Rejected')}>Reject</button></>}
              {d.status === 'approved' && <button className="btn-ghost text-sm text-red-700" onClick={() => withReason('suspend', 'Suspended')}>Suspend</button>}
              {d.status === 'suspended' && <button className="btn-primary text-sm" onClick={() => confirm(`Reinstate ${d.name}?`) && act(() => post(`/admin/v1/affiliates/${id}/reinstate`), 'Reinstated. The affiliate was emailed.').then(after)}>Reinstate</button>}
              <button className="btn-ghost text-sm" onClick={() => act(() => download('commissions', { affiliateId: id }), 'Exported.')}>Commissions CSV</button>
            </div>
            {d.statusReason && <p><span className="text-neutral-500">Reason:</span> {d.statusReason}</p>}
            <section className="grid gap-3 sm:grid-cols-4">
              <Stat label="Clicks" value={d.clicks} />
              <Stat label="Referrals" value={d.referrals.length} />
              <Stat label="Approved" value={fmtMoney(d.balances.USD.approved, 'USD')} sub={fmtMoney(d.balances.SAR.approved, 'SAR')} />
              <Stat label="Paid out" value={fmtMoney(d.balances.USD.paid, 'USD')} sub={fmtMoney(d.balances.SAR.paid, 'SAR')} />
            </section>
            <section className="card space-y-2">
              <h3 className="font-medium">Application</h3>
              <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[160px_1fr]">
                <dt className="text-neutral-500">Channels</dt><dd>{d.channels.map((c) => <a key={c} href={c} target="_blank" rel="noreferrer noopener" className="block truncate text-blue-600 hover:underline" dir="ltr">{c}</a>)}</dd>
                <dt className="text-neutral-500">Audience</dt><dd>{d.audienceSize} · {d.contentLanguage}</dd>
                <dt className="text-neutral-500">Promotion plan</dt><dd className="whitespace-pre-wrap" dir="auto">{d.promotionPlan}</dd>
                <dt className="text-neutral-500">Terms</dt><dd>version {d.termsVersion}, accepted {fmtDate(d.termsAcceptedAt)}</dd>
                <dt className="text-neutral-500">Addresses</dt><dd className="font-mono text-xs">signup {d.user.signupIp ?? '·'} · application {d.applicationIp ?? '·'}</dd>
                <dt className="text-neutral-500">Payout details</dt><dd>{d.payoutDetails ? `${d.payoutDetails.holderName}, ${d.payoutDetails.bankName} (${d.payoutDetails.bankCountry}) ${d.payoutDetails.iban}${d.payoutDetails.swift ? `, ${d.payoutDetails.swift}` : ''}` : 'Not set'}</dd>
              </dl>
            </section>
            <TaxForms forms={d.taxForms} act={act} onChanged={() => after(true)} />
            <section className="space-y-2">
              <h3 className="font-medium">Referrals</h3>
              <div className="card overflow-x-auto p-0"><table className="w-full text-xs">
                <thead className="uppercase text-neutral-500"><tr>{['Team', 'Country', 'Status', 'Discount', 'Referred', 'Earns until'].map((h) => <th key={h} className="px-3 py-2 text-start">{h}</th>)}</tr></thead>
                <tbody>{d.referrals.map((r) => <tr key={r.id} className="border-t border-neutral-100 dark:border-neutral-800"><td className="px-3 py-1.5">{r.team.name} <span className="text-neutral-500">{r.team.slug}</span></td><td className="px-3 py-1.5">{r.team.country}</td><td className="px-3 py-1.5"><Badge s={r.status} /> {r.blockedReason}</td><td className="px-3 py-1.5">{r.discountPercent}%</td><td className="px-3 py-1.5">{fmtDate(r.attributedAt)}</td><td className="px-3 py-1.5">{fmtDate(r.commissionUntil)}</td></tr>)}
                  {!d.referrals.length && <tr><td colSpan={6} className="px-3 py-3 text-neutral-500">No referrals.</td></tr>}</tbody>
              </table></div>
            </section>
            {d.flags.length > 0 && <section className="space-y-1"><h3 className="font-medium">Flags</h3>{d.flags.map((f) => <p key={f.id} className={f.resolvedAt ? 'text-neutral-500 line-through' : ''}>{fmtDate(f.createdAt)} · {f.kind} · <span className="font-mono text-xs">{JSON.stringify(f.detail)}</span></p>)}</section>}
            {d.payouts.length > 0 && <section className="space-y-1"><h3 className="font-medium">Payouts</h3>{d.payouts.map((p) => <p key={p.id}>{fmtDate(p.requestedAt)} · {fmtMoney(p.amountMinor, p.currency)} · <Badge s={p.status} /> {p.reference}</p>)}</section>}
          </div>
        )}
      </aside>
    </div>
  );
}

function Payouts({ act }: { act: Act }) {
  const [status, setStatus] = useState('requested');
  const [rows, setRows] = useState<Payout[] | null>(null);
  const load = useCallback(() => api<{ data: Payout[] }>(`/admin/v1/affiliates/payouts${status ? `?status=${status}` : ''}`).then((r) => setRows(r.data)), [status]);
  useEffect(() => { load(); }, [load]);
  const totals = (cur: Cur) => (rows ?? []).filter((p) => p.status === 'requested' && p.currency === cur).reduce((t, p) => t + p.amountMinor, 0);
  function paid(p: Payout) {
    const reference = prompt(`Mark ${fmtMoney(p.amountMinor - p.withheldMinor, p.currency)} sent to ${p.affiliate.name} by ${p.payingCompany}${p.withheldMinor ? ` (${fmtMoney(p.withheldMinor, p.currency)} backup withholding kept for the IRS)` : ''}. Bank transfer reference:`, '');
    if (reference && reference.trim()) act(() => post(`/admin/v1/affiliates/payouts/${p.id}/paid`, { reference: reference.trim() }), 'Marked paid. The affiliate was emailed.').then((ok) => { if (ok) load(); });
  }
  function cancel(p: Payout) {
    const note = prompt(`Cancel this payout? The commission becomes payable again. Note:`, '');
    if (note !== null) act(() => post(`/admin/v1/affiliates/payouts/${p.id}/cancel`, { note: note || undefined }), 'Cancelled.').then((ok) => { if (ok) load(); });
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label="Waiting, USD (Progrid Technologies LLC)" value={fmtMoney(totals('USD'), 'USD')} />
        <Stat label="Waiting, SAR (Progrid Arabia)" value={fmtMoney(totals('SAR'), 'SAR')} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select className="input max-w-[12rem]" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['requested', 'paid', 'cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <button type="button" className="btn-ghost ms-auto text-sm" onClick={() => act(() => download('payouts', status ? { status } : {}), 'Exported.')}>Export CSV</button>
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-neutral-500"><tr>{['Requested', 'Affiliate', 'Amount', 'Pays', 'Bank details', 'Status', ''].map((h) => <th key={h} className="px-4 py-2 text-start">{h}</th>)}</tr></thead>
          <tbody>
            {rows?.map((p) => (
              <tr key={p.id} className="border-t border-neutral-100 align-top dark:border-neutral-800">
                <td className="px-4 py-2 text-xs">{fmtDate(p.requestedAt)}</td>
                <td className="px-4 py-2"><div className="font-medium">{p.affiliate.name}</div><div className="text-xs text-neutral-500">{p.affiliate.code} · {p.affiliate.email}</div></td>
                <td className="px-4 py-2 font-medium">{fmtMoney(p.amountMinor, p.currency)}{p.withheldMinor > 0 && <div className="text-xs text-amber-700">Send {fmtMoney(p.netMinor, p.currency)}; withhold {fmtMoney(p.withheldMinor, p.currency)} for the IRS</div>}<div className="text-xs text-neutral-500">{p._count.commissions} commissions</div></td>
                <td className="px-4 py-2 text-xs">{p.payingCompany}</td>
                <td className="px-4 py-2 text-xs">{p.details ? <>{p.details.holderName}<br />{p.details.bankName} ({p.details.bankCountry})<br /><span className="font-mono">{p.details.iban}</span>{p.details.swift && <> · <span className="font-mono">{p.details.swift}</span></>}{p.details.note && <><br />{p.details.note}</>}</> : '·'}</td>
                <td className="px-4 py-2"><Badge s={p.status} />{p.reference && <div className="font-mono text-xs">{p.reference}</div>}{p.note && <div className="text-xs text-neutral-500">{p.note}</div>}</td>
                <td className="px-4 py-2 text-end">{p.status === 'requested' && <div className="flex justify-end gap-1"><button className="btn-primary px-2 py-1 text-xs" onClick={() => paid(p)}>Mark paid</button><button className="btn-ghost px-2 py-1 text-xs" onClick={() => cancel(p)}>Cancel</button></div>}</td>
              </tr>
            ))}
            {rows && !rows.length && <tr><td colSpan={7} className="px-4 py-6 text-center text-neutral-500">No payouts.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Commissions({ act }: { act: Act }) {
  const [status, setStatus] = useState('');
  const [currency, setCurrency] = useState('');
  const [rows, setRows] = useState<Commission[] | null>(null);
  const q = { ...(status ? { status } : {}), ...(currency ? { currency } : {}) };
  const load = useCallback(() => api<{ data: Commission[] }>(`/admin/v1/affiliates/commissions?${new URLSearchParams({ ...(status ? { status } : {}), ...(currency ? { currency } : {}) })}`).then((r) => setRows(r.data)), [status, currency]);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input max-w-[12rem]" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{['pending', 'approved', 'paid', 'reversed'].map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select className="input max-w-[8rem]" value={currency} onChange={(e) => setCurrency(e.target.value)}><option value="">USD and SAR</option><option>USD</option><option>SAR</option></select>
        <button type="button" className="btn-ghost ms-auto text-sm" onClick={() => act(() => download('commissions', q), 'Exported.')}>Export CSV</button>
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-neutral-500"><tr>{['Created', 'Affiliate', 'Invoice', 'Category', 'Base', 'Rate', 'Commission', 'Reversed', 'Status', 'Hold until'].map((h) => <th key={h} className="px-4 py-2 text-start">{h}</th>)}</tr></thead>
          <tbody>
            {rows?.map((c) => (
              <tr key={c.id} className="border-t border-neutral-100 dark:border-neutral-800">
                <td className="px-4 py-2 text-xs">{fmtDate(c.createdAt)}</td>
                <td className="px-4 py-2 font-mono text-xs">{c.affiliate.code}</td>
                <td className="px-4 py-2 text-xs">{c.invoice.number}</td>
                <td className="px-4 py-2 text-xs">{c.category}</td>
                <td className="px-4 py-2">{fmtMoney(c.baseMinor, c.currency)}</td>
                <td className="px-4 py-2">{c.rateBp / 100}%</td>
                <td className={`px-4 py-2 font-medium ${c.amountMinor < 0 ? 'text-red-700' : ''}`}>{fmtMoney(c.amountMinor, c.currency)}</td>
                <td className="px-4 py-2" title={c.reversalReason ?? ''}>{c.reversedMinor ? fmtMoney(c.reversedMinor, c.currency) : '·'}</td>
                <td className="px-4 py-2"><Badge s={c.status} /></td>
                <td className="px-4 py-2 text-xs">{fmtDate(c.holdUntil)}</td>
              </tr>
            ))}
            {rows && !rows.length && <tr><td colSpan={10} className="px-4 py-6 text-center text-neutral-500">No commissions.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const FLAG_LABEL: Record<string, string> = {
  self_referral: 'Self referral blocked', signups_from_one_ip: 'Many signups from one address', high_refund_rate: 'High refund rate', chargeback: 'Chargeback',
};

function Flags({ act }: { act: Act }) {
  const [rows, setRows] = useState<Flag[] | null>(null);
  const load = useCallback(() => api<{ data: Flag[] }>('/admin/v1/affiliates/flags').then((r) => setRows(r.data)), []);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead className="text-xs uppercase text-neutral-500"><tr>{['When', 'Affiliate', 'Signal', 'Detail', ''].map((h) => <th key={h} className="px-4 py-2 text-start">{h}</th>)}</tr></thead>
        <tbody>
          {rows?.map((f) => (
            <tr key={f.id} className="border-t border-neutral-100 dark:border-neutral-800">
              <td className="px-4 py-2 text-xs">{fmtDate(f.createdAt)}</td>
              <td className="px-4 py-2">{f.affiliate.name} <span className="font-mono text-xs text-neutral-500">{f.affiliate.code}</span> <Badge s={f.affiliate.status} /></td>
              <td className="px-4 py-2">{FLAG_LABEL[f.kind] ?? f.kind}</td>
              <td className="px-4 py-2 font-mono text-xs">{JSON.stringify(f.detail)}</td>
              <td className="px-4 py-2 text-end"><button className="btn-ghost px-2 py-1 text-xs" onClick={() => act(() => post(`/admin/v1/affiliates/flags/${f.id}/resolve`), 'Resolved.').then((ok) => { if (ok) load(); })}>Resolve</button></td>
            </tr>
          ))}
          {rows && !rows.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-neutral-500">No open flags.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function SettingsForm({ act }: { act: Act }) {
  const [data, setData] = useState<{ settings: Settings; defaults: Settings; updatedAt: string | null } | null>(null);
  const load = useCallback(() => api<{ settings: Settings; defaults: Settings; updatedAt: string | null }>('/admin/v1/affiliates/settings').then(setData), []);
  useEffect(() => { load(); }, [load]);
  if (!data) return <p className="text-sm text-neutral-500">Loading…</p>;
  const s = data.settings;
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const n = (k: string) => Number(f.get(k));
    const body = {
      applicationsOpen: f.get('applicationsOpen') === 'on',
      rates: Object.fromEntries(CATEGORIES.map((c) => [c, n(`rate_${c}`)])),
      cookieDays: n('cookieDays'), holdDays: n('holdDays'), commissionMonths: n('commissionMonths'),
      minPayoutMinor: { USD: Math.round(n('minUSD') * 100), SAR: Math.round(n('minSAR') * 100) },
      promoDiscountPercent: n('promoDiscountPercent'), promoDiscountMonths: n('promoDiscountMonths'),
      flagSignupsPerIpPerDay: n('flagSignupsPerIpPerDay'), flagRefundRatePercent: n('flagRefundRatePercent'), termsVersion: String(f.get('termsVersion')),
      form1099ThresholdMinor: Math.round(n('form1099Threshold') * 100),
      taxPayerName: String(f.get('taxPayerName')), taxPayerEin: String(f.get('taxPayerEin') ?? ''), taxPayerAddress: String(f.get('taxPayerAddress') ?? ''), taxPayerPhone: String(f.get('taxPayerPhone') ?? ''),
    };
    act(() => api('/admin/v1/affiliates/settings', { method: 'PATCH', body: JSON.stringify(body) }), 'Saved. The public page shows the change within five minutes.').then((ok) => { if (ok) load(); });
  }
  const num = (name: string, label: string, value: number, hint?: string, step = '1') => (
    <label key={name} className="block space-y-1 text-sm"><span>{label}</span><input className="input" type="number" name={name} defaultValue={value} step={step} min={0} required />{hint && <span className="block text-xs text-neutral-500">{hint}</span>}</label>
  );
  return (
    <form onSubmit={save} className="space-y-5">
      <section className="card space-y-3">
        <h2 className="font-medium">Commission rates (% of the net paid amount)</h2>
        <div className="grid gap-3 sm:grid-cols-3">{CATEGORIES.map((c) => num(`rate_${c}`, c.replace('_', ' '), s.rates[c], `default ${data.defaults.rates[c]}%`, '0.01'))}</div>
        <p className="text-xs text-neutral-500">New rates apply to invoices paid from now on; commission already earned keeps its rate.</p>
      </section>
      <section className="card grid gap-3 sm:grid-cols-3">
        {num('cookieDays', 'Link window (days)', s.cookieDays, 'How long a click prefills the code')}
        {num('holdDays', 'Hold period (days)', s.holdDays, 'Pending before payable')}
        {num('commissionMonths', 'Commission months', s.commissionMonths, 'After the code is used')}
        {num('minUSD', 'Minimum payout, USD', s.minPayoutMinor.USD / 100, undefined, '0.01')}
        {num('minSAR', 'Minimum payout, SAR', s.minPayoutMinor.SAR / 100, undefined, '0.01')}
        <label className="block space-y-1 text-sm"><span>Terms version</span><input className="input" name="termsVersion" defaultValue={s.termsVersion} required maxLength={40} /></label>
        {num('promoDiscountPercent', 'Customer discount (%)', s.promoDiscountPercent)}
        {num('promoDiscountMonths', 'Discount months', s.promoDiscountMonths)}
        <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" name="applicationsOpen" defaultChecked={s.applicationsOpen} /> Accept new applications</label>
        {num('flagSignupsPerIpPerDay', 'Flag: signups from one address per day', s.flagSignupsPerIpPerDay)}
        {num('flagRefundRatePercent', 'Flag: reversed share of commission (%)', s.flagRefundRatePercent)}
      </section>
      <section className="card space-y-3">
        <h2 className="font-medium">US tax (Forms 1099)</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {num('form1099Threshold', '1099-NEC threshold per payee per year, USD', s.form1099ThresholdMinor / 100, '$2,000 for payments from 2026; check the IRS instructions every year', '0.01')}
          <label className="block space-y-1 text-sm"><span>Payer name</span><input className="input" name="taxPayerName" defaultValue={s.taxPayerName} required maxLength={120} /></label>
          <label className="block space-y-1 text-sm"><span>Payer EIN</span><input className="input" name="taxPayerEin" defaultValue={s.taxPayerEin} placeholder="12-3456789" pattern="(\d{2}-?\d{7})?" dir="ltr" /><span className="block text-xs text-neutral-500">Leave empty until the IRS assigns it</span></label>
          <label className="block space-y-1 text-sm sm:col-span-2"><span>Payer address</span><input className="input" name="taxPayerAddress" defaultValue={s.taxPayerAddress} maxLength={300} /></label>
          <label className="block space-y-1 text-sm"><span>Payer phone</span><input className="input" name="taxPayerPhone" defaultValue={s.taxPayerPhone} maxLength={40} dir="ltr" /></label>
        </div>
      </section>
      <div className="flex items-center gap-3">
        <button className="btn-primary">Save settings</button>
        <span className="text-xs text-neutral-500">Last changed {fmtDate(data.updatedAt)}</span>
      </div>
    </form>
  );
}

/** The affiliate's tax forms (TIN masked), with the IRS B notice switch and "ask for a new form". */
function TaxForms({ forms, act, onChanged }: { forms: TaxForm[]; act: Act; onChanged: () => void }) {
  function backup(f: TaxForm) {
    const on = !f.backupWithholding;
    const reason = prompt(on ? 'Start 24% backup withholding (IRS B notice / CP2100). Reason:' : 'Stop backup withholding (the payee resolved the B notice). Reason:', '');
    if (reason && reason.trim().length >= 3) act(() => post(`/admin/v1/affiliates/tax-forms/${f.id}/backup-withholding`, { on, reason: reason.trim() }), on ? 'Backup withholding on.' : 'Backup withholding off.').then((ok) => { if (ok) onChanged(); });
  }
  function invalidate(f: TaxForm) {
    const reason = prompt('Mark this form invalid. USD payouts stop until the affiliate signs a new one. Reason (sent to them):', '');
    if (reason && reason.trim().length >= 3) act(() => post(`/admin/v1/affiliates/tax-forms/${f.id}/invalidate`, { reason: reason.trim() }), 'Marked invalid. The affiliate was emailed.').then((ok) => { if (ok) onChanged(); });
  }
  return (
    <section className="space-y-2">
      <h3 className="font-medium">US tax forms</h3>
      {!forms.length && <p className="text-neutral-500">None. USD payouts are blocked until the affiliate signs a W-9 or W-8 in the portal.</p>}
      {forms.map((f) => (
        <div key={f.id} className={`card space-y-1 ${f.status !== 'active' ? 'opacity-60' : ''}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{f.revision}</span><Badge s={f.status} />
            {f.backupWithholding && <span className="badge bg-amber-100 text-amber-800">backup withholding 24%</span>}
            {f.status === 'active' && <span className="ms-auto flex gap-1">
              {f.formType === 'W9' && <button className="btn-ghost px-2 py-1 text-xs" onClick={() => backup(f)}>{f.backupWithholding ? 'Stop backup withholding' : 'B notice: start withholding'}</button>}
              <button className="btn-ghost px-2 py-1 text-xs text-red-700" onClick={() => invalidate(f)}>Ask for a new form</button>
            </span>}
          </div>
          <p>{f.legalName}{f.businessName ? ` (${f.businessName})` : ''} · {f.taxClassification ?? ''} · {f.tinType.toUpperCase()} <span className="font-mono">{f.tinMasked ?? 'none'}</span> · {f.country}{f.region ? `, ${f.region}` : ''}</p>
          <p className="text-xs text-neutral-500">Signed by {f.signatureName} {fmtDate(f.signedAt)} from {f.signedIp ?? '·'}{f.expiresAt ? ` · valid until ${fmtDate(f.expiresAt)}` : ''}{f.formType !== 'W9' ? ` · services outside the US: ${f.servicesOutsideUs ? 'yes' : 'no'}` : ''}</p>
          {(f.statusReason || f.backupWithholdingReason) && <p className="text-xs text-neutral-500">{f.statusReason ?? f.backupWithholdingReason}</p>}
        </div>
      ))}
    </section>
  );
}

interface Report1099 {
  year: number; thresholdMinor: number; dueDate: string; backupWithholdingMinor: number;
  payer: { name: string; ein: string; address: string; issues: string[] };
  recipients: { affiliateId: string; code: string; name: string; businessName: string; tinType: string; tin: string; state: string; grossMinor: number; withheldMinor: number; required: boolean; exempt: boolean; issues: string[]; payouts: number }[];
  foreign: { affiliateId: string; code: string; name: string; formType: string; country: string; grossMinor: number; formExpiresAt: string | null; servicesOutsideUs: boolean }[];
}
interface Journal { month: string; currency: Cur; company: string; totals: { earnedMinor: number; reversedMinor: number; paidGrossMinor: number; withheldMinor: number; cashMinor: number }; payable: { openingMinor: number; closingMinor: number }; lines: { date: string; account: string; debitMinor: number; creditMinor: number; memo: string }[] }

/** Year end Forms 1099-NEC, foreign payees on a W-8, backup withholding, and the monthly journal. */
function Tax({ act }: { act: Act }) {
  const [year, setYear] = useState(new Date().getUTCFullYear() - (new Date().getUTCMonth() < 2 ? 1 : 0));
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [currency, setCurrency] = useState<Cur>('USD');
  const [rep, setRep] = useState<Report1099 | null>(null);
  const [j, setJ] = useState<Journal | null>(null);
  useEffect(() => { api<Report1099>(`/admin/v1/affiliates/tax/1099?year=${year}`).then(setRep).catch(() => setRep(null)); }, [year]);
  useEffect(() => { api<Journal>(`/admin/v1/affiliates/tax/accounting?month=${month}&currency=${currency}`).then(setJ).catch(() => setJ(null)); }, [month, currency]);
  const mask = (tin: string) => (tin ? `•••-••-${tin.slice(-4)}` : 'missing');
  const required = rep?.recipients.filter((r) => r.required) ?? [];
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-medium">Forms 1099-NEC</h2>
          <select className="input max-w-[8rem]" value={year} onChange={(e) => setYear(Number(e.target.value))}>{Array.from({ length: 5 }, (_, i) => new Date().getUTCFullYear() - i).map((y) => <option key={y}>{y}</option>)}</select>
          <button type="button" className="btn-primary ms-auto text-sm" disabled={!required.length} onClick={() => act(() => download('1099', { year: String(year) }), 'Exported. The file holds full taxpayer numbers: keep it safe and delete it after filing.')}>Download 1099 file ({required.length})</button>
        </div>
        {rep && (
          <>
            <p className="text-sm text-neutral-500">USD payouts paid in {rep.year} by {rep.payer.name}. File with the IRS (IRIS portal or an e-filing service) and send recipient copies by {rep.dueDate}. Threshold {fmtMoney(rep.thresholdMinor, 'USD')} per payee; any payee with backup withholding is always reported.</p>
            {rep.payer.issues.length > 0 && <p className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">Before filing: {rep.payer.issues.join(', ')} (Settings, US tax).</p>}
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="1099-NEC forms to file" value={required.length} />
              <Stat label="Reported (box 1)" value={fmtMoney(required.reduce((t, r) => t + r.grossMinor, 0), 'USD')} />
              <Stat label="Backup withholding (Form 945)" value={fmtMoney(rep.backupWithholdingMinor, 'USD')} sub="Deposit with the IRS (EFTPS); file Form 945 by January 31" tone={rep.backupWithholdingMinor ? 'warn' : undefined} />
            </div>
            <div className="card overflow-x-auto p-0"><table className="w-full text-sm">
              <thead className="text-xs uppercase text-neutral-500"><tr>{['Payee', 'TIN', 'State', 'Payouts', 'Box 1', 'Box 4', '1099', 'Issues'].map((h) => <th key={h} className="px-4 py-2 text-start">{h}</th>)}</tr></thead>
              <tbody>
                {rep.recipients.map((r) => (
                  <tr key={r.affiliateId} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="px-4 py-2">{r.name || '·'}{r.businessName && <div className="text-xs text-neutral-500">{r.businessName}</div>}<div className="font-mono text-xs text-neutral-500">{r.code}</div></td>
                    <td className="px-4 py-2 font-mono text-xs">{r.tinType.toUpperCase()} {mask(r.tin)}</td>
                    <td className="px-4 py-2">{r.state}</td>
                    <td className="px-4 py-2">{r.payouts}</td>
                    <td className="px-4 py-2">{fmtMoney(r.grossMinor, 'USD')}</td>
                    <td className="px-4 py-2">{r.withheldMinor ? fmtMoney(r.withheldMinor, 'USD') : '·'}</td>
                    <td className="px-4 py-2">{r.exempt ? <span className="badge">exempt (corporation)</span> : r.required ? <span className="badge bg-blue-100 text-blue-800">file</span> : <span className="badge">below threshold</span>}</td>
                    <td className="px-4 py-2 text-xs text-red-700">{r.issues.join(', ')}</td>
                  </tr>
                ))}
                {!rep.recipients.length && <tr><td colSpan={8} className="px-4 py-6 text-center text-neutral-500">No USD payouts to US persons in {rep.year}.</td></tr>}
              </tbody>
            </table></div>
            <h3 className="font-medium">Foreign payees (Form W-8 on file, no 1099)</h3>
            <p className="text-sm text-neutral-500">Commission for services performed outside the US is foreign source income: no US withholding and no Form 1042-S. Keep each W-8 on file.</p>
            <div className="card overflow-x-auto p-0"><table className="w-full text-sm">
              <thead className="text-xs uppercase text-neutral-500"><tr>{['Payee', 'Form', 'Country', 'Paid', 'Services outside US', 'Form valid until'].map((h) => <th key={h} className="px-4 py-2 text-start">{h}</th>)}</tr></thead>
              <tbody>
                {rep.foreign.map((r) => <tr key={r.affiliateId} className="border-t border-neutral-100 dark:border-neutral-800"><td className="px-4 py-2">{r.name}<div className="font-mono text-xs text-neutral-500">{r.code}</div></td><td className="px-4 py-2">{r.formType}</td><td className="px-4 py-2">{r.country}</td><td className="px-4 py-2">{fmtMoney(r.grossMinor, 'USD')}</td><td className="px-4 py-2">{r.servicesOutsideUs ? 'yes' : <span className="text-red-700">no: review</span>}</td><td className="px-4 py-2 text-xs">{fmtDate(r.formExpiresAt)}</td></tr>)}
                {!rep.foreign.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-neutral-500">None.</td></tr>}
              </tbody>
            </table></div>
          </>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-medium">Monthly journal</h2>
          <input type="month" className="input max-w-[11rem]" value={month} onChange={(e) => setMonth(e.target.value)} />
          <select className="input max-w-[8rem]" value={currency} onChange={(e) => setCurrency(e.target.value as Cur)}><option>USD</option><option>SAR</option></select>
          <button type="button" className="btn-ghost ms-auto text-sm" onClick={() => act(() => download('journal', { month, currency }), 'Exported.')}>Journal CSV</button>
        </div>
        {j && (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Commission earned (expense)" value={fmtMoney(j.totals.earnedMinor, j.currency)} />
              <Stat label="Reversed" value={fmtMoney(j.totals.reversedMinor, j.currency)} />
              <Stat label="Paid out (gross)" value={fmtMoney(j.totals.paidGrossMinor, j.currency)} sub={`cash ${fmtMoney(j.totals.cashMinor, j.currency)}, withheld ${fmtMoney(j.totals.withheldMinor, j.currency)}`} />
              <Stat label="Commissions payable" value={fmtMoney(j.payable.closingMinor, j.currency)} sub={`opening ${fmtMoney(j.payable.openingMinor, j.currency)}`} />
            </div>
            <div className="card overflow-x-auto p-0"><table className="w-full text-sm">
              <thead className="text-xs uppercase text-neutral-500"><tr>{['Date', 'Account', 'Debit', 'Credit', 'Memo'].map((h) => <th key={h} className="px-4 py-2 text-start">{h}</th>)}</tr></thead>
              <tbody>
                {j.lines.map((l, i) => <tr key={i} className="border-t border-neutral-100 dark:border-neutral-800"><td className="px-4 py-2 text-xs">{l.date}</td><td className="px-4 py-2">{l.account}</td><td className="px-4 py-2">{l.debitMinor ? fmtMoney(l.debitMinor, j.currency) : ''}</td><td className="px-4 py-2">{l.creditMinor ? fmtMoney(l.creditMinor, j.currency) : ''}</td><td className="px-4 py-2 text-xs text-neutral-500">{l.memo}</td></tr>)}
                {!j.lines.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-neutral-500">No affiliate activity in {j.month}.</td></tr>}
              </tbody>
            </table></div>
            <p className="text-xs text-neutral-500">{j.company}. Sales and marketing expense; the promo code discount is already netted in revenue on the invoices.</p>
          </>
        )}
      </section>
    </div>
  );
}
