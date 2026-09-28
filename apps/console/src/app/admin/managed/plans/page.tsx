'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, money } from '@/lib/api';
import { t, tf } from '@/lib/i18n';
import { AdminShell } from '@/components/admin-shell';
import { useShell } from '@/components/shell';
import { Cell, ErrorBox, Field, Loading, OkBox, PriorityBadge, Row, Table, tk, ToneBadge, useAccount } from '@/components/managed';
import { CoverageLabel } from '@/components/managed-plans';
import { errText, fmtTarget, hours, isFullStaffRoles, PRIORITIES, type Coverage, type Plan, type Priority, type Targets } from '@/lib/managed';

type AdminPlan = Plan & { contractCount?: number };
/** Target units: hours, or days. A day is one 8 hour working day on business hours plans and 24 hours on 24/7 plans. */
type Unit = 'hours' | 'days';
type TargetDraft = Record<Priority, { value: string; unit: Unit }>;

const dayMinutes = (coverage: Coverage) => (coverage === 'BUSINESS_HOURS' ? 480 : 1440);
const trimNum = (n: number) => String(Math.round(n * 100) / 100);

function toDraft(targets: Targets | undefined, coverage: Coverage, fallback: Targets): TargetDraft {
  const day = dayMinutes(coverage);
  const out = {} as TargetDraft;
  for (const p of PRIORITIES) {
    const m = targets?.[p] ?? fallback[p];
    out[p] = m >= day && m % day === 0 ? { value: trimNum(m / day), unit: 'days' } : { value: trimNum(m / 60), unit: 'hours' };
  }
  return out;
}

/** Minutes for one entered target, or null when it is not a positive number. */
function oneMinutes(t: { value: string; unit: Unit }, coverage: Coverage) {
  const n = Number(t.value);
  if (t.value.trim() === '' || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(t.unit === 'days' ? n * dayMinutes(coverage) : n * 60);
}

function toMinutes(d: TargetDraft, coverage: Coverage): Targets | null {
  const out = {} as Targets;
  for (const p of PRIORITIES) {
    const m = oneMinutes(d[p], coverage);
    if (m === null) return null;
    out[p] = m;
  }
  return out;
}

const DEFAULT_RESPONSE: Targets = { P1: 60, P2: 240, P3: 480, P4: 1440 };
const DEFAULT_RESOLVE: Targets = { P1: 480, P2: 960, P3: 2400, P4: 4800 };

/**
 * Back office: managed cloud plans. Full staff create and edit them (price or custom price,
 * coverage, limits, included time, hourly rate and SLA targets); engineers and support leads
 * see the list read only. Changes apply to new contracts and to existing ones that do not
 * override the value.
 */
export default function AdminPlans() {
  const { locale } = useShell();
  const { account } = useAccount();
  const [plans, setPlans] = useState<AdminPlan[] | null>(null);
  const [editing, setEditing] = useState<AdminPlan | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const full = account ? isFullStaffRoles(account.staffRoles) : false;

  const load = useCallback(async () => setPlans((await api<{ data: AdminPlan[] }>('/admin/managed/plans')).data), []);
  useEffect(() => { load().catch((e) => setError(errText(e))); }, [load]);

  const title = t(locale, 'admMcPlansTitle');
  return (
    <AdminShell title={title} actions={full && !editing ? <button className="btn-primary" onClick={() => { setOk(null); setEditing('new'); }}>{t(locale, 'admMcNewPlan')}</button> : undefined}>
      {account && !full && <p className="rounded border border-neutral-200 bg-neutral-50 p-2 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300">{t(locale, 'admMcPlansReadOnly')}</p>}
      <ErrorBox error={error} />
      <OkBox msg={ok} />
      {editing && full && (
        <PlanForm key={editing === 'new' ? 'new' : editing.id} plan={editing === 'new' ? null : editing} nextSort={(plans?.length ?? 0) * 10 + 10}
          onCancel={() => setEditing(null)}
          onSaved={async (p) => { setEditing(null); setOk(tf(locale, 'admMcPlanSaved')(p.name)); await load().catch((e) => setError(errText(e))); }} />
      )}
      {!plans ? (error ? null : <Loading />) : (
        <Table head={[t(locale, 'name'), t(locale, 'price'), t(locale, 'mcCoverage'), t(locale, 'admMcLimits'), t(locale, 'admMcTargets'), t(locale, 'status'), '']} empty={plans.length === 0 ? t(locale, 'admMcNoPlans') : undefined}>
          {plans.map((p) => (
            <Row key={p.id}>
              <Cell>
                <span className="font-medium">{p.name}</span> <code className="text-xs text-neutral-500" dir="ltr">{p.code}</code>
                {p.description && <div className="max-w-xs text-xs text-neutral-500">{p.description}</div>}
                <div className="text-xs text-neutral-500">{tf(locale, 'admMcSortAndContracts')(p.sortOrder, p.contractCount ?? 0)}</div>
              </Cell>
              <Cell className="whitespace-nowrap">
                {p.priceMinor === null ? t(locale, 'mcCustomPrice') : <>{money(p.priceMinor, p.currency, locale)}<span className="text-xs text-neutral-500">{t(locale, 'perMonth')}</span></>}
                <div className="text-xs text-neutral-500">{tf(locale, 'admMcHourlyRateIs')(money(p.hourlyRateMinor, p.currency, locale))}</div>
              </Cell>
              <Cell className="text-sm"><CoverageLabel coverage={p.coverage} /></Cell>
              <Cell className="text-xs text-neutral-500">
                <div>{p.maxAssets === null ? t(locale, 'admMcNoAssetLimit') : tf(locale, 'admMcMaxAssetsIs')(p.maxAssets)}</div>
                <div>{tf(locale, 'admMcIncludedHoursIs')(hours(p.includedEngineerMinutes))}</div>
              </Cell>
              <Cell className="text-xs">
                <ul className="space-y-0.5">
                  {PRIORITIES.map((pr) => <li key={pr} className="flex items-center gap-1.5 whitespace-nowrap"><PriorityBadge p={pr} /><span>{fmtTarget(p.responseTargets[pr], p.coverage, locale)}</span><span className="text-neutral-400">/</span><span className="text-neutral-500">{fmtTarget(p.resolveTargets[pr], p.coverage, locale)}</span></li>)}
                </ul>
              </Cell>
              <Cell>{p.active ? <ToneBadge tone="green">{t(locale, 'admMcActive')}</ToneBadge> : <ToneBadge tone="grey">{t(locale, 'admMcInactive')}</ToneBadge>}</Cell>
              <Cell className="text-end">{full && <button className="btn-ghost" onClick={() => { setOk(null); setEditing(p); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>{t(locale, 'admMcEdit')}</button>}</Cell>
            </Row>
          ))}
        </Table>
      )}
      {plans && <p className="text-xs text-neutral-500">{t(locale, 'admMcPlansFootnote')}</p>}
    </AdminShell>
  );
}

function PlanForm({ plan, nextSort, onCancel, onSaved }: { plan: AdminPlan | null; nextSort: number; onCancel: () => void; onSaved: (p: Plan) => void }) {
  const { locale } = useShell();
  const [coverage, setCoverage] = useState<Coverage>(plan?.coverage ?? 'BUSINESS_HOURS');
  const [custom, setCustom] = useState(plan ? plan.priceMinor === null : false);
  const [currency, setCurrency] = useState(plan?.currency ?? 'SAR');
  const [response, setResponse] = useState<TargetDraft>(() => toDraft(plan?.responseTargets, plan?.coverage ?? 'BUSINESS_HOURS', DEFAULT_RESPONSE));
  const [resolve, setResolve] = useState<TargetDraft>(() => toDraft(plan?.resolveTargets, plan?.coverage ?? 'BUSINESS_HOURS', DEFAULT_RESOLVE));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    const responseTargets = toMinutes(response, coverage), resolveTargets = toMinutes(resolve, coverage);
    if (!responseTargets || !resolveTargets) { setError(t(locale, 'admMcTargetsPositive')); return; }
    const short = PRIORITIES.find((p) => resolveTargets[p] < responseTargets[p]);
    if (short) { setError(tf(locale, 'admMcResolveShorter')(short)); return; }
    const body: Record<string, unknown> = {
      name: s('name'), description: s('description'),
      priceMinor: custom ? null : Math.round(Number(s('price')) * 100), currency, coverage,
      maxAssets: s('maxAssets') ? Number(s('maxAssets')) : null,
      includedEngineerMinutes: Math.round(Number(s('includedHours') || 0) * 60),
      hourlyRateMinor: Math.round(Number(s('hourlyRate')) * 100),
      responseTargets, resolveTargets, active: !!f.get('active'), sortOrder: Number(s('sortOrder') || 0),
    };
    if (!plan) body.code = s('code').toUpperCase();
    setBusy(true); setError(null);
    try {
      const saved = await api<Plan>(plan ? `/admin/managed/plans/${plan.id}` : '/admin/managed/plans', { method: plan ? 'PATCH' : 'POST', body: JSON.stringify(body) });
      onSaved(saved);
    } catch (err) { setError(errText(err)); setBusy(false); }
  }

  const dayHint = coverage === 'BUSINESS_HOURS' ? t(locale, 'admMcUnitBusinessDay') : t(locale, 'admMcUnitCalendarDay');
  return (
    <form onSubmit={submit} className="card space-y-4" aria-label={plan ? t(locale, 'admMcEditPlan') : t(locale, 'admMcNewPlan')}>
      <h2 className="font-medium">{plan ? tf(locale, 'admMcEditPlanNamed')(plan.name) : t(locale, 'admMcNewPlan')}</h2>
      <ErrorBox error={error} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t(locale, 'admMcPlanCode')} hint={plan ? t(locale, 'admMcPlanCodeFixed') : t(locale, 'admMcPlanCodeHint')}>
          <input className="input font-mono uppercase" name="code" dir="ltr" required={!plan} disabled={!!plan} defaultValue={plan?.code ?? ''} pattern="[A-Za-z][A-Za-z0-9_]{1,31}" maxLength={32} />
        </Field>
        <Field label={t(locale, 'name')}><input className="input" name="name" required minLength={2} maxLength={80} defaultValue={plan?.name ?? ''} /></Field>
        <Field label={t(locale, 'mcCoverage')}>
          <select className="input" value={coverage} onChange={(e) => setCoverage(e.target.value as Coverage)}>
            <option value="BUSINESS_HOURS">{tk(locale, 'mcCoverage_BUSINESS_HOURS')}</option>
            <option value="TWENTY_FOUR_SEVEN">{tk(locale, 'mcCoverage_TWENTY_FOUR_SEVEN')}</option>
          </select>
        </Field>
        <Field label={t(locale, 'admMcSortOrder')} hint={t(locale, 'admMcSortOrderHint')}><input className="input" name="sortOrder" type="number" dir="ltr" defaultValue={plan?.sortOrder ?? nextSort} /></Field>
      </div>
      <Field label={t(locale, 'admMcDescription')}><textarea className="input min-h-16" name="description" maxLength={2000} defaultValue={plan?.description ?? ''} /></Field>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t(locale, 'price')}</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t(locale, 'admMcMonthlyPrice')} hint={custom ? t(locale, 'admMcCustomPriceHint') : t(locale, 'admMcExclVatHint')}>
            <input className="input" name="price" type="number" min={0} step="0.01" dir="ltr" required={!custom} disabled={custom} defaultValue={plan?.priceMinor != null ? plan.priceMinor / 100 : ''} />
          </Field>
          <Field label={t(locale, 'admMcCurrency')}>
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}><option value="SAR">SAR</option><option value="USD">USD</option></select>
          </Field>
          <Field label={t(locale, 'admMcHourlyRate')} hint={t(locale, 'admMcHourlyRateHint')}>
            <input className="input" name="hourlyRate" type="number" min={0} step="0.01" dir="ltr" required defaultValue={plan ? plan.hourlyRateMinor / 100 : ''} />
          </Field>
          <label className="flex items-center gap-2 self-center text-sm"><input type="checkbox" checked={custom} onChange={(e) => setCustom(e.target.checked)} />{t(locale, 'admMcCustomPriceToggle')}</label>
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label={t(locale, 'admMcMaxAssets')} hint={t(locale, 'admMcMaxAssetsHint')}><input className="input" name="maxAssets" type="number" min={1} dir="ltr" defaultValue={plan?.maxAssets ?? ''} /></Field>
        <Field label={t(locale, 'admMcIncludedHours')} hint={t(locale, 'admMcIncludedHoursHint')}><input className="input" name="includedHours" type="number" min={0} step="0.25" dir="ltr" required defaultValue={plan ? plan.includedEngineerMinutes / 60 : 2} /></Field>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t(locale, 'admMcTargets')}</legend>
        <p className="text-xs text-neutral-500">{coverage === 'BUSINESS_HOURS' ? t(locale, 'admMcTargetsBusinessNote') : t(locale, 'admMcTargetsAllHoursNote')}</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="text-xs text-neutral-500"><tr><th className="py-1 text-start font-medium">{t(locale, 'priority')}</th><th className="py-1 text-start font-medium">{t(locale, 'mcResponse')}</th><th className="py-1 text-start font-medium">{t(locale, 'mcResolve')}</th></tr></thead>
            <tbody>
              {PRIORITIES.map((p) => (
                <tr key={p} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="py-2 pe-3"><span className="flex items-center gap-2"><PriorityBadge p={p} /><span className="text-xs text-neutral-500">{tk(locale, `mcPrioShort_${p}`)}</span></span></td>
                  {([[response, setResponse, 'response'], [resolve, setResolve, 'resolve']] as const).map(([draft, set, kind]) => {
                    const minutes = oneMinutes(draft[p], coverage);
                    return (
                      <td key={kind} className="py-2 pe-3">
                        <div className="flex items-center gap-1.5">
                          <input className="input !w-24" type="number" min={0.25} step="0.25" dir="ltr" required value={draft[p].value} aria-label={`${p} ${t(locale, kind === 'response' ? 'mcResponse' : 'mcResolve')}`}
                            onChange={(e) => set((d) => ({ ...d, [p]: { ...d[p], value: e.target.value } }))} />
                          <select className="input !w-auto" value={draft[p].unit} aria-label={t(locale, 'admMcUnit')} onChange={(e) => set((d) => ({ ...d, [p]: { ...d[p], unit: e.target.value as Unit } }))}>
                            <option value="hours">{coverage === 'BUSINESS_HOURS' ? t(locale, 'admMcUnitBusinessHours') : t(locale, 'admMcUnitHours')}</option>
                            <option value="days">{coverage === 'BUSINESS_HOURS' ? t(locale, 'admMcUnitBusinessDays') : t(locale, 'admMcUnitDays')}</option>
                          </select>
                        </div>
                        <div className="mt-0.5 text-xs text-neutral-500">{minutes ? tf(locale, 'admMcTargetIs')(fmtTarget(minutes, coverage, locale), minutes) : ''}</div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-neutral-500">{dayHint}</p>
      </fieldset>

      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={plan?.active ?? true} />{t(locale, 'admMcPlanActive')}</label>
      <div className="flex gap-2"><button className="btn-primary" disabled={busy}>{busy ? t(locale, 'loading') : t(locale, 'save')}</button><button type="button" className="btn-ghost" onClick={onCancel}>{t(locale, 'cancel')}</button></div>
    </form>
  );
}
