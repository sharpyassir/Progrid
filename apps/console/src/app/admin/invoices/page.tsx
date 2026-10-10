'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { ENTITY_NAME, type BillingEntityId } from '@/lib/countries';
import { AdminShell, fmtDate, fmtMoney } from '@/components/admin-shell';
import { StatusBadge } from '@/components/status-badge';
import { useShell } from '@/components/shell';
import { t, tf } from '@/lib/i18n';

interface InvoicePayment { id: string; provider: string; providerRef: string | null; status: string; amountMinor: number; refundedMinor: number; currency: string; paidAt: string | null; createdAt: string }
interface CreditNote { id: string; number: string; amountMinor: number; reason: string; createdAt: string }
interface Invoice {
  id: string; number: string; status: string; subtotalMinor: number; taxMinor: number; totalMinor: number; creditedMinor: number; currency: string; periodStart: string; dueAt: string | null; eInvoiceType: string | null;
  billingEntity: BillingEntityId;
  team: { id: string; name: string; slug: string; country: string }; payments: InvoicePayment[]; creditNotes: CreditNote[];
}
interface Payment extends InvoicePayment { team: { id: string; name: string }; invoice: { number: string } | null }

type Panel = { invoiceId: string; kind: 'credit' | 'record' } | null;

const STATUSES = ['open', 'paid', 'credited', 'void', 'uncollectible'];
const CARD = ['moyasar', 'stripe', 'fake'];

/** Back office invoices: refunds, credit notes, void, bank transfers and write offs, each behind a confirm dialog. */
export default function AdminInvoices() {
  const { locale } = useShell();
  const [status, setStatus] = useState('');
  const [entity, setEntity] = useState('');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [panel, setPanel] = useState<Panel>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => Promise.all([
    api<{ data: Invoice[] }>(`/admin/v1/invoices?${new URLSearchParams({ ...(status ? { status } : {}), ...(entity ? { entity } : {}) })}`).then((r) => setInvoices(r.data)),
    api<{ data: Payment[] }>('/admin/v1/payments?status=succeeded').then((r) => setPayments(r.data)),
  ]), [status, entity]);
  useEffect(() => { load(); }, [load]);

  async function run(question: string, fn: () => Promise<unknown>) {
    if (!confirm(question)) return;
    setMsg(null);
    try { await fn(); setMsg(t(locale, 'done')); setPanel(null); await load(); } catch (err) { setMsg(err instanceof ApiError ? err.message : String(err)); }
  }
  const post = (path: string, body: unknown) => api(path, { method: 'POST', body: JSON.stringify(body), idempotent: true });
  const minor = (v: FormDataEntryValue | null) => (v === null || v === '' ? undefined : Math.round(Number(v) * 100));
  const due = (i: Invoice) => i.totalMinor - i.creditedMinor;

  function refund(p: Payment | InvoicePayment, label: string) {
    const left = p.amountMinor - p.refundedMinor;
    const input = prompt(`${t(locale, 'amount')} (${p.currency}). ${t(locale, 'leaveEmptyForFull')}: ${fmtMoney(left, p.currency)}`, '');
    if (input === null) return;
    const amountMinor = minor(input.trim());
    const note = 'invoice' in p && !p.invoice ? `\n\n${t(locale, 'refundTopupNote')}` : '';
    run(tf(locale, 'refundConfirm')(fmtMoney(amountMinor ?? left, p.currency), label) + note, () => post(`/admin/v1/payments/${p.id}/refund`, { amountMinor }));
  }
  function creditNote(e: FormEvent<HTMLFormElement>, i: Invoice) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const amountMinor = minor(f.get('amount')) ?? 0;
    run(tf(locale, 'creditNoteConfirm')(fmtMoney(amountMinor, i.currency), i.number), () => post(`/admin/v1/invoices/${i.id}/credit-notes`, { amountMinor, reason: String(f.get('reason') ?? '') }));
  }
  function record(e: FormEvent<HTMLFormElement>, i: Invoice) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    run(tf(locale, 'recordPaymentConfirm')(fmtMoney(due(i), i.currency), i.number), () => post(`/admin/v1/invoices/${i.id}/payments`, { provider: f.get('provider'), reference: String(f.get('reference') ?? '') || undefined }));
  }

  return (
    <AdminShell title={t(locale, 'invoices')} actions={<div className="flex gap-2">
      <select className="input w-auto py-1" value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Billing company"><option value="">All invoices</option><option value="progrid_arabia">Progrid Arabia</option><option value="progrid_llc">Progrid Technologies LLC (PRGD-US, history)</option></select>
      <select className="input w-auto py-1" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t(locale, 'status')}>
        <option value="">{t(locale, 'allStatuses')}</option>
        {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
    </div>}>
      <p className="text-sm text-neutral-500">{t(locale, 'adminInvoicesLead')}</p>
      {msg && <p className="rounded border border-neutral-200 bg-neutral-50 p-2 text-sm dark:border-neutral-800 dark:bg-neutral-900">{msg}</p>}
      <section className="card p-0">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-neutral-500"><tr>
            <th className="px-4 py-2 text-start">{t(locale, 'invoiceNumber')}</th><th className="px-4 py-2 text-start">{t(locale, 'team')}</th><th className="px-4 py-2 text-start">{t(locale, 'period')}</th>
            <th className="px-4 py-2 text-start">{t(locale, 'status')}</th><th className="px-4 py-2 text-end">{t(locale, 'total')}</th><th className="px-4 py-2 text-end">{t(locale, 'amountDue')}</th><th className="px-4 py-2 text-end">{t(locale, 'actions')}</th>
          </tr></thead>
          <tbody>
            {invoices.length === 0 && <tr><td className="px-4 py-3 text-neutral-500" colSpan={7}>{t(locale, 'noInvoices')}</td></tr>}
            {invoices.map((i) => {
              const unpaid = i.status === 'open';
              const card = i.payments.filter((p) => p.status === 'succeeded' && CARD.includes(p.provider) && p.amountMinor > p.refundedMinor);
              return (
                <tr key={i.id} className="border-t border-neutral-100 align-top dark:border-neutral-800">
                  <td className="px-4 py-2 font-mono">{i.number}
                    {i.creditNotes.map((n) => <div key={n.id} className="text-xs text-neutral-500">{n.number}: {fmtMoney(n.amountMinor, i.currency)} · {n.reason}</div>)}
                  </td>
                  <td className="px-4 py-2"><Link href={`/admin/teams/${i.team.id}`} className="hover:underline">{i.team.name}</Link> <span className="text-xs text-neutral-500">{i.team.country} · {ENTITY_NAME[i.billingEntity] ?? i.billingEntity}</span></td>
                  <td className="px-4 py-2 text-neutral-500">{i.periodStart.slice(0, 7)}</td>
                  <td className="px-4 py-2"><StatusBadge status={i.status === 'paid' ? 'active' : i.status === 'open' ? 'pending' : i.status} />{unpaid && i.dueAt && new Date(i.dueAt) < new Date() && <span className="ms-1 text-xs text-red-600">{t(locale, 'overdue')}</span>}</td>
                  <td className="px-4 py-2 text-end font-medium">{fmtMoney(i.totalMinor, i.currency)}</td>
                  <td className="px-4 py-2 text-end">{unpaid ? fmtMoney(due(i), i.currency) : '—'}</td>
                  <td className="px-4 py-2 text-end">
                    <div className="flex flex-wrap justify-end gap-1">
                      {card.map((p) => <button key={p.id} className="btn-ghost px-2 py-0.5 text-xs" onClick={() => refund(p, i.number)}>{t(locale, 'refund')} {fmtMoney(p.amountMinor - p.refundedMinor, p.currency)}</button>)}
                      {['open', 'paid'].includes(i.status) && <button className="btn-ghost px-2 py-0.5 text-xs" onClick={() => setPanel({ invoiceId: i.id, kind: 'credit' })}>{t(locale, 'creditNote')}</button>}
                      {['open', 'uncollectible'].includes(i.status) && <button className="btn-ghost px-2 py-0.5 text-xs" onClick={() => setPanel({ invoiceId: i.id, kind: 'record' })}>{t(locale, 'recordPayment')}</button>}
                      {unpaid && <button className="btn-ghost px-2 py-0.5 text-xs" onClick={() => run(tf(locale, 'uncollectibleConfirm')(i.number), () => post(`/admin/v1/invoices/${i.id}/uncollectible`, {}))}>{t(locale, 'markUncollectible')}</button>}
                      {unpaid && <button className="btn-ghost px-2 py-0.5 text-xs text-red-600" onClick={() => run(tf(locale, 'voidConfirm')(i.number), () => post(`/admin/v1/invoices/${i.id}/void`, {}))}>{t(locale, 'voidInvoice')}</button>}
                    </div>
                    {panel?.invoiceId === i.id && panel.kind === 'credit' && (
                      <form className="mt-2 grid gap-1 text-start" onSubmit={(e) => creditNote(e, i)}>
                        <p className="text-xs text-neutral-500">{t(locale, 'creditNoteNote')}</p>
                        <input className="input py-1 text-xs" name="amount" type="number" min="0.01" step="0.01" placeholder={`${t(locale, 'amount')} (${i.currency})`} required />
                        <input className="input py-1 text-xs" name="reason" minLength={3} maxLength={500} placeholder={t(locale, 'reason')} required />
                        <div className="flex justify-end gap-1"><button type="button" className="btn-ghost px-2 py-0.5 text-xs" onClick={() => setPanel(null)}>{t(locale, 'cancel')}</button><button className="btn-primary px-2 py-0.5 text-xs">{t(locale, 'creditNote')}</button></div>
                      </form>
                    )}
                    {panel?.invoiceId === i.id && panel.kind === 'record' && (
                      <form className="mt-2 grid gap-1 text-start" onSubmit={(e) => record(e, i)}>
                        <select className="input py-1 text-xs" name="provider" defaultValue="bank_transfer" aria-label={t(locale, 'method')}>
                          <option value="bank_transfer">{t(locale, 'bankTransfer')}</option><option value="manual">{t(locale, 'manualPayment')}</option>
                        </select>
                        <input className="input py-1 text-xs" name="reference" maxLength={200} placeholder={t(locale, 'reference')} />
                        <div className="flex justify-end gap-1"><button type="button" className="btn-ghost px-2 py-0.5 text-xs" onClick={() => setPanel(null)}>{t(locale, 'cancel')}</button><button className="btn-primary px-2 py-0.5 text-xs">{t(locale, 'recordPayment')} {fmtMoney(due(i), i.currency)}</button></div>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
      <section className="card p-0">
        <h2 className="border-b border-neutral-100 px-4 py-2 font-medium dark:border-neutral-800">{t(locale, 'cardPayments')}</h2>
        <table className="w-full text-sm"><tbody>
          {payments.map((p) => (
            <tr key={p.id} className="border-t border-neutral-100 dark:border-neutral-800">
              <td className="px-4 py-2 text-xs text-neutral-500">{fmtDate(p.paidAt ?? p.createdAt)}</td>
              <td className="px-4 py-2"><Link href={`/admin/teams/${p.team.id}`} className="hover:underline">{p.team.name}</Link></td>
              <td className="px-4 py-2 text-xs text-neutral-500">{p.provider} · {p.invoice?.number ?? t(locale, 'topUp')}</td>
              <td className="px-4 py-2 text-end">{fmtMoney(p.amountMinor, p.currency)}{p.refundedMinor > 0 && <span className="ms-1 text-xs text-neutral-500">({fmtMoney(p.refundedMinor, p.currency)} {t(locale, 'refunded')})</span>}</td>
              <td className="px-4 py-2 text-end">
                {CARD.includes(p.provider) && p.amountMinor > p.refundedMinor && <button className="btn-ghost px-2 py-0.5 text-xs" onClick={() => refund(p, p.invoice?.number ?? t(locale, 'topUp'))}>{t(locale, 'refund')}</button>}
                {/* Moyasar sends no dispute events: finance records a chargeback here (Stripe ones arrive by webhook). Reverses affiliate commission. */}
                {p.invoice && <button className="btn-ghost ms-1 px-2 py-0.5 text-xs" onClick={() => { const reason = prompt(`Record a chargeback on ${p.invoice!.number}? Reason (optional):`, ''); if (reason !== null) run(`Record a chargeback on ${p.invoice!.number}? Affiliate commission on this invoice is reversed.`, () => post(`/admin/v1/payments/${p.id}/dispute`, { reason: reason || undefined })); }}>Chargeback</button>}
              </td>
            </tr>
          ))}
        </tbody></table>
      </section>
    </AdminShell>
  );
}
