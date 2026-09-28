'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, money } from '@/lib/api';
import { t } from '@/lib/i18n';
import { AdminShell } from '@/components/admin-shell';
import { useShell } from '@/components/shell';
import { Cell, ContractStatusBadge, ErrorBox, Loading, Row, Table, tk, ToneBadge, useAccount } from '@/components/managed';
import { CONTRACT_STATUSES, errText, fmtDay, isLeadRoles, type Contract, type ContractStatus, type Page } from '@/lib/managed';

/** Back office: managed cloud contracts with status filter; support leads create one by hand. */
export default function AdminContracts() {
  const { locale } = useShell();
  const router = useRouter();
  const { account } = useAccount();
  const [status, setStatus] = useState<'' | ContractStatus>('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Contract[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lead = account ? isLeadRoles(account.staffRoles) : false;

  const url = useCallback((after?: string) => `/admin/managed/contracts?limit=100${status ? `&status=${status}` : ''}${after ? `&cursor=${after}` : ''}`, [status]);
  useEffect(() => {
    setRows(null); setError(null);
    api<Page<Contract>>(url()).then((r) => { setRows(r.data); setCursor(r.meta?.next_cursor ?? null); }).catch((e) => setError(errText(e)));
  }, [url]);
  async function more() {
    if (!cursor) return;
    try { const r = await api<Page<Contract>>(url(cursor)); setRows((x) => [...(x ?? []), ...r.data]); setCursor(r.meta?.next_cursor ?? null); } catch (e) { setError(errText(e)); }
  }

  const needle = q.trim().toLowerCase();
  const shown = (rows ?? []).filter((c) => !needle || c.team?.name.toLowerCase().includes(needle) || c.team?.slug.includes(needle) || c.plan.name.toLowerCase().includes(needle));
  const counts = (rows ?? []).reduce<Record<string, number>>((a, c) => ({ ...a, [c.status]: (a[c.status] ?? 0) + 1 }), {});

  return (
    <AdminShell title={t(locale, 'admMcContractsTitle')} actions={lead ? <Link href="/admin/managed/contracts/new" className="btn-primary">{t(locale, 'admMcNewContract')}</Link> : undefined}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="flex flex-wrap gap-1">
          <button onClick={() => setStatus('')} className={`rounded px-2 py-1 ${status === '' ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'text-neutral-600 dark:text-neutral-300'}`}>{t(locale, 'mcTicketFilter_all')}</button>
          {CONTRACT_STATUSES.map((s) => (
            <button key={s} onClick={() => setStatus(s)} className={`rounded px-2 py-1 ${status === s ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'text-neutral-600 dark:text-neutral-300'}`}>
              {tk(locale, `mcStatus_${s}`)}{!status && counts[s] ? ` (${counts[s]})` : ''}
            </button>
          ))}
        </div>
        <input className="input ms-auto sm:!w-64" placeholder={t(locale, 'admMcSearchTeam')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ErrorBox error={error} />
      {!rows ? (error ? null : <Loading />) : (
        <Table head={[t(locale, 'team'), t(locale, 'mcPlan'), t(locale, 'status'), t(locale, 'mcMonthlyFee'), t(locale, 'mcAssets'), t(locale, 'created'), t(locale, 'mcTermEnds')]} empty={shown.length === 0 ? t(locale, 'admMcNoContracts') : undefined}>
          {shown.map((c) => (
            <Row key={c.id} onClick={() => router.push(`/admin/managed/contracts/${c.id}`)}>
              <Cell><Link href={`/admin/managed/contracts/${c.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{c.team?.name ?? c.teamId}</Link><div className="text-xs text-neutral-500">{c.team?.slug}</div></Cell>
              <Cell>{c.plan.name}<div className="text-xs text-neutral-500">{tk(locale, `mcCoverage_${c.plan.coverage}`)}</div></Cell>
              <Cell><ContractStatusBadge s={c.status} />{c.onCallOverride && <div className="mt-1"><ToneBadge tone="amber">{t(locale, 'admMcOnCallOverride')}</ToneBadge></div>}</Cell>
              <Cell>{c.monthlyFeeMinor === null ? <span className="text-amber-700 dark:text-amber-400">{t(locale, 'admMcPriceMissing')}</span> : money(c.monthlyFeeMinor, c.currency, locale)}</Cell>
              <Cell className="text-neutral-500">{c.assetCount ?? 0}{c.maxAssets ? ` / ${c.maxAssets}` : ''}</Cell>
              <Cell className="text-xs text-neutral-500">{fmtDay(c.createdAt, locale)}</Cell>
              <Cell className="text-xs text-neutral-500">{fmtDay(c.termEndsAt, locale) || '—'}</Cell>
            </Row>
          ))}
        </Table>
      )}
      {cursor && <button className="btn-ghost" onClick={more}>{t(locale, 'mcLoadMore')}</button>}
    </AdminShell>
  );
}
