'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, money, withVat } from '@/lib/api';
import { t, tf } from '@/lib/i18n';
import { useShell } from '@/components/shell';
import { Cell, ContractStatusBadge, Empty, ErrorBox, Loading, ManagedFrame, OkBox, OwnerBadge, PriorityBadge, Row, Table, tk, Toggle, useAccount } from '@/components/managed';
import { CoverageLabel, PlanPrice } from '@/components/managed-plans';
import { errText, fmtDay, fmtDayUtc, fmtTarget, hours, OWNERS, PRIORITIES, type Contract, type ContractStatus, type ManagedSummary } from '@/lib/managed';
import type { Locale } from '@/lib/i18n';

/** Contract detail for the team owner: SLA targets, responsibility matrix, usage and dates. */
export default function ManagedContractPage() {
  const { locale } = useShell();
  const { account, error: accountError } = useAccount();
  const [contract, setContract] = useState<Contract | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ManagedSummary['contract']>(null);
  const owner = account?.role === 'owner';

  const load = useCallback(async () => {
    if (!account) return;
    // Members cannot read the contract, only the summary: they see the renewal state read only.
    if (account.role !== 'owner') { setSummary((await api<ManagedSummary>('/v1/managed/summary')).contract); return; }
    const cs = (await api<{ data: Contract[] }>('/v1/managed/contracts')).data;
    const c = cs.find((x) => x.status !== 'CANCELLED') ?? cs[0];
    setContract(c ? await api<Contract>(`/v1/managed/contracts/${c.id}`) : null);
  }, [account]);
  useEffect(() => { load().catch((e) => setError(errText(e))); }, [load]);

  const title = t(locale, 'mcContract');
  if (accountError || error) return <ManagedFrame title={title} owner={owner}><ErrorBox error={accountError ?? error} /></ManagedFrame>;
  if (account && !owner) return (
    <ManagedFrame title={title} owner={owner}>
      <Empty>{t(locale, 'mcContractOwnerOnly')}</Empty>
      {summary && <Renewal c={summary} locale={locale} />}
    </ManagedFrame>
  );
  if (contract === undefined) return <ManagedFrame title={title} owner={owner}><Loading /></ManagedFrame>;
  if (contract === null) return <ManagedFrame title={title} owner={owner}><Empty>{t(locale, 'mcNoContractYet')}</Empty></ManagedFrame>;

  const c = contract;
  const u = c.usage;
  const overageMinor = u ? Math.round((u.overageMinutes / 60) * c.hourlyRateMinor) : 0;
  const usedPct = u && u.includedMinutes ? Math.min(100, Math.round((u.billableMinutes / u.includedMinutes) * 100)) : 0;
  const dates: [string, string | null][] = [
    [t(locale, 'mcRequested'), c.createdAt], [t(locale, 'mcSigned'), c.signedAt], [t(locale, 'mcOnboardingStarted'), c.onboardingStartedAt],
    [t(locale, 'mcActivated'), c.activatedAt], [t(locale, 'mcTermEnds'), c.termEndsAt], [t(locale, 'mcRenewed'), c.renewedAt],
    [t(locale, 'mcSuspended'), c.suspendedAt], [t(locale, 'mcCancelled'), c.cancelledAt],
  ];

  return (
    <ManagedFrame title={title} owner={owner}>
      <section className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-medium">{c.plan.name}</h2><ContractStatusBadge s={c.status} /><span className="text-sm text-neutral-500"><CoverageLabel coverage={c.plan.coverage} /></span></div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div><div className="text-xs text-neutral-500">{t(locale, 'mcMonthlyFee')}</div>{c.monthlyFeeMinor === null ? <PlanPrice plan={{ priceMinor: null, currency: c.currency }} large={false} /> : <PlanPrice plan={{ priceMinor: c.monthlyFeeMinor, currency: c.currency }} large={false} />}</div>
          <div><div className="text-xs text-neutral-500">{t(locale, 'mcIncludedTime')}</div><div className="font-medium">{tf(locale, 'mcHoursPerMonth')(hours(c.includedEngineerMinutes))}</div><div className="text-xs text-neutral-500">{tf(locale, 'mcPerHourExtra')(money(c.hourlyRateMinor, c.currency, locale))}</div></div>
          <div><div className="text-xs text-neutral-500">{t(locale, 'mcMaxAssets')}</div><div className="font-medium">{c.maxAssets ?? t(locale, 'mcCustom')}</div></div>
          <div><div className="text-xs text-neutral-500">{t(locale, 'mcTerm')}</div><div className="font-medium">{tf(locale, 'mcTermMonths')(c.termMonths)}</div>{c.liabilityCapMinor !== null && <div className="text-xs text-neutral-500">{tf(locale, 'mcLiabilityCap')(money(c.liabilityCapMinor, c.currency, locale))}</div>}</div>
        </div>
        {c.signedByName && <p className="text-xs text-neutral-500">{tf(locale, 'mcSignedBy')(c.signedByName, fmtDay(c.signedAt, locale))}</p>}
      </section>

      <Renewal c={c} locale={locale} onChange={setContract} />

      <section className="space-y-2">
        <h2 className="font-medium">{t(locale, 'mcSlaTargets')}</h2>
        <p className="text-xs text-neutral-500">{c.sla.businessHours ? tf(locale, 'mcBusinessHoursNote')(tk(locale, `mcCalendar_${c.calendar}`), c.sla.businessHours.start, c.sla.businessHours.end) : t(locale, 'mcAllHoursNote')}</p>
        <Table head={[t(locale, 'priority'), t(locale, 'mcWhenToUse'), t(locale, 'mcFirstResponse'), t(locale, 'mcResolution')]}>
          {PRIORITIES.map((p) => (
            <Row key={p}>
              <Cell><PriorityBadge p={p} /></Cell>
              <Cell className="text-neutral-600 dark:text-neutral-300">{tk(locale, `mcPrioHint_${p}`)}</Cell>
              <Cell>{fmtTarget(c.sla.responseTargets[p], c.sla.coverage, locale)}</Cell>
              <Cell>{fmtTarget(c.sla.resolveTargets[p], c.sla.coverage, locale)}</Cell>
            </Row>
          ))}
        </Table>
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">{t(locale, 'mcResponsibilities')}</h2>
        <p className="text-xs text-neutral-500">{t(locale, 'mcResponsibilitiesLead')}</p>
        <div className="flex flex-wrap gap-3 text-xs text-neutral-500">{OWNERS.map((o) => <span key={o} className="flex items-center gap-1"><OwnerBadge o={o} />{tk(locale, `mcOwnerHint_${o}`)}</span>)}</div>
        <Table head={[t(locale, 'mcArea'), t(locale, 'mcWhoOwnsIt'), t(locale, 'notes')]} empty={!c.responsibilities?.length ? t(locale, 'mcNoResponsibilities') : undefined}>
          {(c.responsibilities ?? []).map((r) => (
            <Row key={r.id}><Cell className="font-medium">{r.area}</Cell><Cell><OwnerBadge o={r.owner} /></Cell><Cell className="text-neutral-500">{r.notes}</Cell></Row>
          ))}
        </Table>
      </section>

      {u && (
        <section className="space-y-2">
          <h2 className="font-medium">{t(locale, 'mcUsageThisMonth')}</h2>
          <div className="card space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span>{tf(locale, 'mcHoursOf')(hours(u.billableMinutes), hours(u.includedMinutes))}</span>
              {u.nonBillableMinutes > 0 && <span className="text-xs text-neutral-500">{tf(locale, 'mcNonBillable')(hours(u.nonBillableMinutes))}</span>}
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800"><div className={`h-full rounded-full ${u.overageMinutes > 0 ? 'bg-amber-500' : 'bg-blue-600'}`} style={{ width: `${usedPct}%` }} /></div>
            {u.overageMinutes > 0
              ? <p className="text-sm text-amber-800 dark:text-amber-200">{tf(locale, 'mcOverageEstimate')(hours(u.overageMinutes), money(overageMinor, c.currency, locale), money(withVat(overageMinor), c.currency, locale))}</p>
              : <p className="text-sm text-neutral-500">{t(locale, 'mcNoOverage')}</p>}
            <p className="text-xs text-neutral-500">{t(locale, 'mcUsageNote')}</p>
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-medium">{t(locale, 'mcDates')}</h2>
        <div className="card grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {dates.filter(([, d]) => d).map(([label, d]) => <div key={label}><div className="text-xs text-neutral-500">{label}</div><div>{fmtDay(d, locale)}</div></div>)}
        </div>
        {c.cancelReason && <p className="text-xs text-neutral-500">{tf(locale, 'mcCancelReason')(c.cancelReason)}</p>}
      </section>
    </ManagedFrame>
  );
}

type RenewalState = { id: string; status: ContractStatus; termEndsAt: string | null; autoRenew: boolean; cancelAt: string | null; termMonths?: number };

/** Start of next month in UTC: when a cancellation made today takes effect (same rule as the API). */
const nextMonthStart = () => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1)).toISOString(); };

/**
 * Renewal and cancellation. Owners (`onChange` given) toggle auto renewal, cancel with a
 * confirmation and undo a scheduled cancellation; members see the same state read only.
 */
function Renewal({ c, locale, onChange }: { c: RenewalState; locale: Locale; onChange?: (c: Contract) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  if (c.status === 'CANCELLED') return null;
  const canEdit = !!onChange;
  const billed = c.status === 'ACTIVE' || c.status === 'SUSPENDED';

  async function call(path: string, method: 'POST' | 'PATCH', body: unknown, done: string) {
    setBusy(true); setError(null); setOk(null);
    try {
      onChange?.(await api<Contract>(`/v1/managed/contracts/${c.id}${path}`, { method, body: JSON.stringify(body) }));
      setOk(done);
      return true;
    } catch (e) { setError(errText(e)); return false; } finally { setBusy(false); }
  }
  async function cancel() {
    if (await call('/cancel', 'POST', reason.trim() ? { reason: reason.trim() } : {}, t(locale, billed ? 'mcCancelScheduledOk' : 'mcCancelledNowOk'))) { setConfirming(false); setReason(''); }
  }

  return (
    <section className="space-y-2">
      <h2 className="font-medium">{t(locale, 'mcRenewal')}</h2>
      <ErrorBox error={error} />
      <OkBox msg={ok} />
      {c.cancelAt ? (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          <div className="min-w-0 flex-1">
            <div className="font-medium">{tf(locale, 'mcCancelsOn')(fmtDayUtc(c.cancelAt, locale))}</div>
            <div className="text-xs">{t(locale, 'mcCancelScheduledNote')}</div>
          </div>
          {canEdit && <button className="btn-ghost" disabled={busy} onClick={() => call('/cancel/undo', 'POST', {}, t(locale, 'mcCancelUndoneOk'))}>{t(locale, 'mcUndo')}</button>}
        </div>
      ) : (
        <div className="card space-y-3 text-sm">
          {c.termEndsAt && <div className="font-medium">{c.autoRenew ? tf(locale, 'mcRenewsOn')(fmtDayUtc(c.termEndsAt, locale)) : tf(locale, 'mcEndsOn')(fmtDayUtc(c.termEndsAt, locale))}</div>}
          <div className="flex items-start gap-3">
            <Toggle on={c.autoRenew} disabled={!canEdit || busy} label={t(locale, 'mcAutoRenew')} onChange={(v) => call('', 'PATCH', { autoRenew: v }, t(locale, v ? 'mcAutoRenewOnOk' : 'mcAutoRenewOffOk'))} />
            <div>
              <div>{t(locale, 'mcAutoRenew')}</div>
              <div className="text-xs text-neutral-500">{c.autoRenew ? tf(locale, 'mcAutoRenewOnNote')(c.termMonths ?? 12) : t(locale, 'mcAutoRenewOffNote')}</div>
            </div>
          </div>
          {canEdit
            ? <div className="border-t border-neutral-100 pt-3 dark:border-neutral-800"><button className="btn-danger" disabled={busy} onClick={() => setConfirming(true)}>{t(locale, 'mcCancelContract')}</button></div>
            : <p className="text-xs text-neutral-500">{t(locale, 'mcRenewalOwnerOnly')}</p>}
        </div>
      )}
      {confirming && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => !busy && setConfirming(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="cancel-title" className="card w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Escape' && !busy) setConfirming(false); }}>
            <h3 id="cancel-title" className="font-medium">{t(locale, 'mcCancelTitle')}</h3>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">{billed ? tf(locale, 'mcCancelExplain')(fmtDayUtc(nextMonthStart(), locale)) : t(locale, 'mcCancelNowExplain')}</p>
            <label className="block text-sm">
              <span className="text-neutral-500">{t(locale, 'mcCancelReasonLabel')}</span>
              <textarea className="input mt-1 min-h-20" value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} autoFocus />
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <button className="btn-ghost" disabled={busy} onClick={() => setConfirming(false)}>{t(locale, 'mcKeepContract')}</button>
              <button className="btn-danger" disabled={busy} onClick={cancel}>{t(locale, 'mcCancelContract')}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
