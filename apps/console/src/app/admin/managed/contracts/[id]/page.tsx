'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError, money, withVat } from '@/lib/api';
import { t, tf } from '@/lib/i18n';
import { AdminShell } from '@/components/admin-shell';
import { useShell } from '@/components/shell';
import { AssetStatusBadge, Cell, ContractStatusBadge, ErrorBox, Field, HealthBadge, Loading, OkBox, OwnerBadge, Row, Table, tk, Toggle, ToneBadge, useAccount } from '@/components/managed';
import { ASSET_KINDS, errText, fmtDateTime, fmtDay, fmtRelative, hours, isLeadRoles, OWNERS, periodOf, type Asset, type AssetKind, type Contract, type OnboardingItem, type Owner, type Responsibility } from '@/lib/managed';

interface UsageDetail { period: string; currency: string; monthlyFeeMinor: number | null; hourlyRateMinor: number; includedMinutes: number; billableMinutes: number; nonBillableMinutes: number; overageMinutes: number; estimatedOverageMinor: number; lines: { resourceType: string; amountMinor: number; currency: string; quantity: number; invoiceId: string | null }[] }

/** Back office contract: lifecycle, terms, onboarding, assets, responsibility matrix and usage. */
export default function AdminContractDetail() {
  const { id } = useParams<{ id: string }>();
  const { locale } = useShell();
  const { account } = useAccount();
  const [c, setC] = useState<Contract | null>(null);
  const [checklist, setChecklist] = useState<OnboardingItem[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lead = account ? isLeadRoles(account.staffRoles) : false;

  const load = useCallback(async () => {
    const [contract, ob, as] = await Promise.all([
      api<Contract>(`/admin/managed/contracts/${id}`),
      api<{ data: OnboardingItem[] }>(`/admin/managed/contracts/${id}/onboarding`),
      api<{ data: Asset[] }>(`/admin/managed/contracts/${id}/assets`),
    ]);
    setC(contract); setChecklist(ob.data); setAssets(as.data);
  }, [id]);
  useEffect(() => { load().catch((e) => setLoadError(errText(e))); }, [load]);

  /** Runs a change, shows the result and reloads. Returns false when it failed. */
  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true); setError(null); setOk(null);
    try { await fn(); if (done) setOk(done); await load(); return true; } catch (e) { setError(errText(e)); return false; } finally { setBusy(false); }
  }
  const post = (path: string, body?: unknown) => api(`/admin/managed/${path}`, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
  const patch = (path: string, body: unknown) => api(`/admin/managed/${path}`, { method: 'PATCH', body: JSON.stringify(body) });

  const title = c ? `${c.team?.name ?? c.teamId}: ${c.plan.name}` : t(locale, 'admMcContract');
  if (loadError) return <AdminShell title={title}><ErrorBox error={loadError} /></AdminShell>;
  if (!c) return <AdminShell title={title}><Loading /></AdminShell>;

  return (
    <AdminShell title={title} actions={<Link href="/admin/managed/contracts" className="btn-ghost">{t(locale, 'back')}</Link>}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <ContractStatusBadge s={c.status} />
        <span className="text-neutral-500">{tk(locale, `mcCoverage_${c.plan.coverage}`)} · {tk(locale, `mcCalendar_${c.calendar}`)} · {c.currency}</span>
        {c.onCallOverride && <ToneBadge tone="amber">{t(locale, 'admMcOnCallOverride')}</ToneBadge>}
        {c.team && <span className="text-neutral-500">· {c.team.slug}{c.team.status && c.team.status !== 'active' ? ` · ${c.team.status}` : ''}</span>}
      </div>
      <ErrorBox error={error} />
      <OkBox msg={ok} />

      {lead && <Lifecycle c={c} busy={busy} run={run} post={post} />}
      {!lead && <p className="text-xs text-neutral-500">{t(locale, 'admMcLifecycleLeadOnly')}</p>}

      <Terms c={c} lead={lead} busy={busy} run={run} patch={patch} />

      {c.status !== 'DRAFT' && <Onboarding c={c} items={checklist} lead={lead} busy={busy} run={run} post={post} patch={patch} />}

      <Assets c={c} assets={assets} lead={lead} busy={busy} run={run} post={post} patch={patch} />

      <Matrix c={c} rows={c.responsibilities ?? []} lead={lead} busy={busy} run={run} post={post} patch={patch} />

      <UsagePanel contractId={c.id} />

      {c.status === 'CANCELLED' && <Handover id={c.id} />}
    </AdminShell>
  );
}

type Run = (fn: () => Promise<unknown>, done?: string) => Promise<boolean>;
type Call = (path: string, body?: unknown) => Promise<unknown>;

function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2"><h2 className="font-medium">{title}</h2><div className="ms-auto flex gap-2">{actions}</div></div>
      {children}
    </section>
  );
}

/** Activate, suspend, resume, renew and cancel. Support leads and full staff only. */
function Lifecycle({ c, busy, run, post }: { c: Contract; busy: boolean; run: Run; post: Call }) {
  const { locale } = useShell();
  const [needOverride, setNeedOverride] = useState(false);

  async function activate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const signedAt = String(f.get('signedAt') ?? '');
    const body = { signedByName: String(f.get('signedByName') ?? '').trim(), liabilityCapMinor: Math.round(Number(f.get('cap')) * 100), ...(signedAt ? { signedAt: new Date(signedAt).toISOString() } : {}), ...(f.get('override') ? { overrideOnCallRule: true } : {}) };
    await run(async () => {
      try { await post(`contracts/${c.id}/activate`, body); } catch (err) {
        // 24/7 plans need two people on call; offer the recorded override.
        if (err instanceof ApiError && err.code === 'on_call_rule') setNeedOverride(true);
        throw err;
      }
    }, t(locale, 'admMcActivated'));
  }
  const ask = (q: string) => { const r = prompt(q); return r === null ? null : r.trim(); };

  return (
    <div className="card space-y-3">
      <h2 className="font-medium">{t(locale, 'admMcLifecycle')}</h2>
      {c.status === 'DRAFT' && (
        <form onSubmit={activate} className="space-y-3">
          <p className="text-sm text-neutral-500">{t(locale, 'admMcActivateLead')}</p>
          {c.monthlyFeeMinor === null && <p className="text-sm text-amber-700 dark:text-amber-400">{t(locale, 'admMcSetPriceFirst')}</p>}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t(locale, 'admMcSignedByName')}><input className="input" name="signedByName" required minLength={2} maxLength={120} /></Field>
            <Field label={tf(locale, 'admMcLiabilityCapIn')(c.currency)} hint={c.monthlyFeeMinor ? tf(locale, 'admMcCapHint')(money(c.monthlyFeeMinor * 12, c.currency, locale)) : undefined}><input className="input" name="cap" type="number" min={0} step="0.01" required dir="ltr" /></Field>
            <Field label={t(locale, 'admMcSignedAt')} hint={t(locale, 'admMcSignedAtHint')}><input className="input" name="signedAt" type="date" dir="ltr" /></Field>
          </div>
          {c.plan.coverage === 'TWENTY_FOUR_SEVEN' && (
            <label className={`flex items-start gap-2 text-sm ${needOverride ? 'text-amber-800 dark:text-amber-200' : 'text-neutral-500'}`}>
              <input type="checkbox" name="override" className="mt-1" />
              <span>{t(locale, 'admMcOverrideOnCall')}</span>
            </label>
          )}
          <button className="btn-primary" disabled={busy || c.monthlyFeeMinor === null}>{t(locale, 'admMcActivate')}</button>
        </form>
      )}
      <div className="flex flex-wrap gap-2">
        {(c.status === 'ACTIVE' || c.status === 'ONBOARDING') && (
          <button className="btn-ghost" disabled={busy} onClick={() => { const r = ask(t(locale, 'admMcSuspendPrompt')); if (r !== null) run(() => post(`contracts/${c.id}/suspend`, { reason: r || undefined }), t(locale, 'admMcSuspendedOk')); }}>{t(locale, 'admMcSuspend')}</button>
        )}
        {c.status === 'SUSPENDED' && <button className="btn-ghost" disabled={busy} onClick={() => run(() => post(`contracts/${c.id}/resume`, {}), t(locale, 'admMcResumedOk'))}>{t(locale, 'admMcResume')}</button>}
        {(c.status === 'ACTIVE' || c.status === 'SUSPENDED') && (
          <button className="btn-ghost" disabled={busy} onClick={() => { const r = ask(tf(locale, 'admMcRenewPrompt')(c.termMonths)); if (r !== null) run(() => post(`contracts/${c.id}/renew`, r ? { termMonths: Number(r) } : {}), t(locale, 'admMcRenewedOk')); }}>{t(locale, 'admMcRenew')}</button>
        )}
        {c.status !== 'CANCELLED' && (
          <button className="btn-danger" disabled={busy} onClick={() => { const r = ask(t(locale, 'admMcCancelPrompt')); if (r !== null && confirm(t(locale, 'admMcCancelConfirm'))) run(() => post(`contracts/${c.id}/cancel`, { reason: r || undefined }), t(locale, 'admMcCancelledOk')); }}>{t(locale, 'admMcCancelContract')}</button>
        )}
      </div>
    </div>
  );
}

/** Fee, included time, limits, liability, dates; support leads edit the overrides. */
function Terms({ c, lead, busy, run, patch }: { c: Contract; lead: boolean; busy: boolean; run: Run; patch: Call }) {
  const { locale } = useShell();
  const [editing, setEditing] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string, scale = 1) => { const v = String(f.get(k) ?? '').trim(); return v === '' ? null : Math.round(Number(v) * scale); };
    const cap = num('cap', 100);
    const body = { calendar: f.get('calendar'), notes: String(f.get('notes') ?? ''), priceOverrideMinor: num('price', 100), includedMinutesOverride: num('hours', 60), maxAssetsOverride: num('maxAssets'), termMonths: num('termMonths') ?? undefined, ...(cap !== null ? { liabilityCapMinor: cap } : {}) };
    if (await run(() => patch(`contracts/${c.id}`, body), t(locale, 'profileSaved'))) setEditing(false);
  }
  const dates: [string, string | null][] = [
    [t(locale, 'mcRequested'), c.createdAt], [t(locale, 'mcSigned'), c.signedAt], [t(locale, 'mcOnboardingStarted'), c.onboardingStartedAt], [t(locale, 'mcActivated'), c.activatedAt],
    [t(locale, 'mcTermEnds'), c.termEndsAt], [t(locale, 'mcRenewed'), c.renewedAt], [t(locale, 'mcSuspended'), c.suspendedAt], [t(locale, 'mcCancelled'), c.cancelledAt],
  ];
  return (
    <Section title={t(locale, 'admMcTerms')} actions={lead && c.status !== 'CANCELLED' && !editing ? <button className="btn-ghost" onClick={() => setEditing(true)}>{t(locale, 'admMcEdit')}</button> : undefined}>
      {!editing ? (
        <div className="card space-y-3 text-sm">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div><div className="text-xs text-neutral-500">{t(locale, 'mcMonthlyFee')}</div>{c.monthlyFeeMinor === null ? <span className="text-amber-700 dark:text-amber-400">{t(locale, 'admMcPriceMissing')}</span> : <><div className="font-medium">{money(c.monthlyFeeMinor, c.currency, locale)}</div><div className="text-xs text-neutral-500">{tf(locale, 'admMcWithVat')(money(withVat(c.monthlyFeeMinor), c.currency, locale))}</div></>}{c.priceOverrideMinor != null && <div className="text-xs text-neutral-500">{t(locale, 'admMcOverridden')}</div>}</div>
            <div><div className="text-xs text-neutral-500">{t(locale, 'mcIncludedTime')}</div><div className="font-medium">{tf(locale, 'mcHoursPerMonth')(hours(c.includedEngineerMinutes))}</div><div className="text-xs text-neutral-500">{tf(locale, 'mcPerHour')(money(c.hourlyRateMinor, c.currency, locale))}</div></div>
            <div><div className="text-xs text-neutral-500">{t(locale, 'mcMaxAssets')}</div><div className="font-medium">{c.maxAssets ?? t(locale, 'mcCustom')}</div></div>
            <div><div className="text-xs text-neutral-500">{t(locale, 'mcTerm')}</div><div className="font-medium">{tf(locale, 'mcTermMonths')(c.termMonths)}</div>{c.liabilityCapMinor != null && <div className="text-xs text-neutral-500">{tf(locale, 'mcLiabilityCap')(money(c.liabilityCapMinor, c.currency, locale))}</div>}</div>
          </div>
          {c.signedByName && <p className="text-xs text-neutral-500">{tf(locale, 'mcSignedBy')(c.signedByName, fmtDay(c.signedAt, locale))}</p>}
          <div className="grid gap-3 border-t border-neutral-100 pt-3 sm:grid-cols-4 dark:border-neutral-800">{dates.filter(([, d]) => d).map(([l, d]) => <div key={l}><div className="text-xs text-neutral-500">{l}</div><div>{fmtDay(d, locale)}</div></div>)}</div>
          {c.notes && <p className="whitespace-pre-wrap border-t border-neutral-100 pt-3 text-neutral-600 dark:border-neutral-800 dark:text-neutral-300">{c.notes}</p>}
          {c.cancelReason && <p className="text-xs text-neutral-500">{tf(locale, 'mcCancelReason')(c.cancelReason)}</p>}
          {!!c.suspensions?.length && <p className="text-xs text-neutral-500">{t(locale, 'admMcPastSuspensions')}: {c.suspensions.map((s) => tf(locale, 'admMcRange')(fmtDay(s.from, locale), fmtDay(s.to, locale))).join(', ')}</p>}
        </div>
      ) : (
        <form onSubmit={save} className="card space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t(locale, 'mcCalendar')}><select className="input" name="calendar" defaultValue={c.calendar}><option value="SA">{t(locale, 'mcCalendar_SA')}</option><option value="TR">{t(locale, 'mcCalendar_TR')}</option></select></Field>
            <Field label={t(locale, 'admMcPriceOverride')} hint={t(locale, 'admMcOverrideHint')}><input className="input" name="price" type="number" min={0} step="0.01" dir="ltr" defaultValue={c.priceOverrideMinor != null ? c.priceOverrideMinor / 100 : ''} /></Field>
            <Field label={t(locale, 'admMcIncludedHoursOverride')}><input className="input" name="hours" type="number" min={0} step="0.5" dir="ltr" defaultValue={c.includedMinutesOverride != null ? c.includedMinutesOverride / 60 : ''} /></Field>
            <Field label={t(locale, 'admMcMaxAssetsOverride')}><input className="input" name="maxAssets" type="number" min={1} dir="ltr" defaultValue={c.maxAssetsOverride ?? ''} /></Field>
            <Field label={tf(locale, 'admMcLiabilityCapIn')(c.currency)}><input className="input" name="cap" type="number" min={0} step="0.01" dir="ltr" defaultValue={c.liabilityCapMinor != null ? c.liabilityCapMinor / 100 : ''} /></Field>
            <Field label={t(locale, 'admMcTermMonths')}><input className="input" name="termMonths" type="number" min={1} max={60} dir="ltr" defaultValue={c.termMonths} /></Field>
          </div>
          <Field label={t(locale, 'notes')}><textarea className="input min-h-20" name="notes" defaultValue={c.notes ?? ''} maxLength={4000} /></Field>
          <div className="flex gap-2"><button className="btn-primary" disabled={busy}>{t(locale, 'save')}</button><button type="button" className="btn-ghost" onClick={() => setEditing(false)}>{t(locale, 'cancel')}</button></div>
        </form>
      )}
    </Section>
  );
}

/** Onboarding checklist with toggles and the system's own readiness hint per item. */
function Onboarding({ c, items, lead, busy, run, post, patch }: { c: Contract; items: OnboardingItem[]; lead: boolean; busy: boolean; run: Run; post: Call; patch: Call }) {
  const { locale } = useShell();
  const done = items.filter((i) => i.done).length;
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    if (await run(() => post(`contracts/${c.id}/onboarding`, { key: f.get('key'), title: f.get('title') }))) form.reset();
  }
  return (
    <Section title={`${t(locale, 'mcOnboarding')} (${tf(locale, 'mcStepsDone')(done, items.length)})`}>
      {c.status === 'ONBOARDING' && <p className="text-xs text-neutral-500">{t(locale, 'admMcOnboardingNote')}</p>}
      <Table head={['', t(locale, 'admMcItem'), t(locale, 'admMcSystemCheck'), t(locale, 'admMcDoneAt')]} empty={items.length === 0 ? t(locale, 'nothingYet') : undefined}>
        {items.map((i) => (
          <Row key={i.id}>
            <Cell><Toggle on={i.done} label={i.title} disabled={busy || c.status === 'CANCELLED'} onChange={(v) => run(() => patch(`contracts/${c.id}/onboarding/${i.key}`, { done: v }))} /></Cell>
            <Cell><span className={i.done ? 'text-neutral-500' : 'font-medium'}>{tk(locale, `mcOnboard_${i.key}`, i.title)}</span>{i.note && <div className="text-xs text-neutral-500">{i.note}</div>}</Cell>
            <Cell>{i.check ? <span className={`text-xs ${i.check.ready ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'}`}>{i.check.ready ? '✓ ' : ''}{i.check.hint}</span> : <span className="text-xs text-neutral-400">—</span>}</Cell>
            <Cell className="text-xs text-neutral-500">{fmtDateTime(i.doneAt, locale)}</Cell>
          </Row>
        ))}
      </Table>
      {lead && c.status !== 'CANCELLED' && (
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <Field label={t(locale, 'admMcItemKey')}><input className="input !w-40 font-mono" name="key" required pattern="[a-z][a-z0-9_]{1,40}" dir="ltr" placeholder="vpn_access" /></Field>
          <div className="min-w-60 flex-1"><Field label={t(locale, 'admMcItemTitle')}><input className="input" name="title" required minLength={2} maxLength={200} /></Field></div>
          <button className="btn-ghost" disabled={busy}>{t(locale, 'admMcAddItem')}</button>
        </form>
      )}
    </Section>
  );
}

/** Assets: approve or reject requests, monitoring and backup toggles, heartbeat tokens. */
function Assets({ c, assets, lead, busy, run, post, patch }: { c: Contract; assets: Asset[]; lead: boolean; busy: boolean; run: Run; post: Call; patch: Call }) {
  const { locale } = useShell();
  const [token, setToken] = useState<{ assetId: string; token: string; heartbeatUrl: string } | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [kind, setKind] = useState<AssetKind>('EXTERNAL_SERVER');

  async function rotate(a: Asset) {
    if (a.hasHeartbeatToken && !confirm(t(locale, 'admMcRotateConfirm'))) return;
    await run(async () => setToken(await api<{ assetId: string; token: string; heartbeatUrl: string }>(`/admin/managed/assets/${a.id}/heartbeat-token`, { method: 'POST' })));
  }
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const s = (k: string) => String(f.get(k) ?? '').trim() || undefined;
    const body = { kind, name: s('name'), serverId: kind === 'PLATFORM_SERVER' ? s('serverId') : undefined, address: kind === 'PLATFORM_SERVER' ? undefined : s('address'), managementAddress: s('managementAddress'), provider: s('provider'), os: s('os'), notes: s('notes'), monitoringEnabled: !!f.get('monitoring'), backupEnabled: !!f.get('backup') };
    if (await run(() => post(`contracts/${c.id}/assets`, body), t(locale, 'admMcAssetAdded'))) { form.reset(); setShowNew(false); }
  }

  return (
    <Section title={`${t(locale, 'mcAssets')} (${assets.length}${c.maxAssets ? ` / ${c.maxAssets}` : ''})`} actions={lead && c.status !== 'CANCELLED' ? <button className="btn-ghost" onClick={() => setShowNew((v) => !v)}>{t(locale, 'admMcAddAsset')}</button> : undefined}>
      {token && (
        <div className="card space-y-2 border-amber-300 dark:border-amber-800">
          <p className="text-sm font-medium">{t(locale, 'admMcTokenOnce')}</p>
          <code className="block break-all rounded bg-neutral-100 p-2 font-mono text-xs dark:bg-neutral-800" dir="ltr">{token.token}</code>
          <p className="text-xs text-neutral-500">{t(locale, 'admMcHeartbeatUrl')}: <code className="font-mono" dir="ltr">{token.heartbeatUrl}</code></p>
          <div className="flex gap-2"><button className="btn-ghost" onClick={() => navigator.clipboard?.writeText(token.token)}>{t(locale, 'admMcCopy')}</button><button className="btn-ghost" onClick={() => setToken(null)}>{t(locale, 'admMcDoneSaved')}</button></div>
        </div>
      )}
      {showNew && (
        <form onSubmit={add} className="card space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={t(locale, 'mcKind')}><select className="input" value={kind} onChange={(e) => setKind(e.target.value as AssetKind)}>{ASSET_KINDS.map((k) => <option key={k} value={k}>{tk(locale, `mcKind_${k}`)}</option>)}</select></Field>
            <Field label={t(locale, 'name')}><input className="input" name="name" required maxLength={120} /></Field>
            {kind === 'PLATFORM_SERVER'
              ? <Field label={t(locale, 'admMcServerId')}><input className="input font-mono" name="serverId" required dir="ltr" /></Field>
              : <Field label={t(locale, kind === 'SITE' ? 'mcSiteUrl' : 'mcAddress')}><input className="input" name="address" required dir="ltr" /></Field>}
            {kind !== 'SITE' && <Field label={t(locale, 'admMcManagementAddress')}><input className="input" name="managementAddress" dir="ltr" placeholder="10.200.0.12" /></Field>}
            <Field label={t(locale, 'mcProvider')}><input className="input" name="provider" maxLength={80} /></Field>
            {kind !== 'SITE' && <Field label={t(locale, 'mcOs')}><input className="input" name="os" maxLength={80} dir="ltr" /></Field>}
          </div>
          <Field label={t(locale, 'notes')}><textarea className="input min-h-16" name="notes" maxLength={2000} /></Field>
          <div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" name="monitoring" defaultChecked />{t(locale, 'admMcMonitoring')}</label><label className="flex items-center gap-2"><input type="checkbox" name="backup" defaultChecked={kind !== 'SITE'} />{t(locale, 'backups')}</label></div>
          <div className="flex gap-2"><button className="btn-primary" disabled={busy}>{t(locale, 'admMcAddAsset')}</button><button type="button" className="btn-ghost" onClick={() => setShowNew(false)}>{t(locale, 'cancel')}</button></div>
        </form>
      )}
      <Table head={[t(locale, 'name'), t(locale, 'status'), t(locale, 'mcHealth'), t(locale, 'admMcMonitoring'), t(locale, 'backups'), t(locale, 'admMcHeartbeat'), '']} empty={assets.length === 0 ? t(locale, 'admMcNoAssets') : undefined}>
        {assets.map((a) => (
          <Row key={a.id}>
            <Cell>
              <span className="font-medium">{a.name}</span> <span className="text-xs text-neutral-500">{tk(locale, `mcKind_${a.kind}`)}</span>
              <div className="font-mono text-xs text-neutral-500" dir="ltr">{[a.address, a.managementAddress].filter(Boolean).join(' · ')}</div>
              <div className="text-xs text-neutral-500">{[a.provider, a.os].filter(Boolean).join(' · ')}</div>
              {a.notes && <div className="max-w-sm text-xs text-neutral-500">{a.notes}</div>}
            </Cell>
            <Cell><AssetStatusBadge s={a.status} />{a.rejectedReason && <div className="mt-1 max-w-xs text-xs text-red-700 dark:text-red-400">{a.rejectedReason}</div>}</Cell>
            <Cell><HealthBadge h={a.health} />{!!a.openAlerts && <div className="text-xs text-red-700 dark:text-red-400">{tf(locale, 'mcOpenAlertsCount')(a.openAlerts)}</div>}</Cell>
            <Cell><Toggle on={a.monitoringEnabled} label={t(locale, 'admMcMonitoring')} disabled={!lead || busy} onChange={(v) => run(() => patch(`assets/${a.id}`, { monitoringEnabled: v }))} /></Cell>
            <Cell><Toggle on={a.backupEnabled} label={t(locale, 'backups')} disabled={!lead || busy} onChange={(v) => run(() => patch(`assets/${a.id}`, { backupEnabled: v }))} /></Cell>
            <Cell className="text-xs text-neutral-500">
              {a.kind === 'EXTERNAL_SERVER' ? <>
                <div title={fmtDateTime(a.lastHeartbeatAt, locale)}>{a.lastHeartbeatAt ? fmtRelative(a.lastHeartbeatAt, locale) : t(locale, 'admMcNoHeartbeat')}</div>
                {a.status === 'APPROVED' && <button className="text-blue-600 hover:underline" disabled={busy} onClick={() => rotate(a)}>{a.hasHeartbeatToken ? t(locale, 'admMcRotateToken') : t(locale, 'admMcCreateToken')}</button>}
              </> : '—'}
            </Cell>
            <Cell className="whitespace-nowrap text-end">
              {a.status === 'PENDING' && <>
                <button className="btn-ghost me-1" disabled={busy} onClick={() => run(() => post(`assets/${a.id}/approve`), t(locale, 'admMcApproved'))}>{t(locale, 'admMcApprove')}</button>
                <button className="btn-danger" disabled={busy} onClick={() => { const r = prompt(t(locale, 'admMcRejectPrompt')); if (r?.trim()) run(() => post(`assets/${a.id}/reject`, { reason: r.trim() }), t(locale, 'admMcRejected')); }}>{t(locale, 'admMcReject')}</button>
              </>}
              {lead && a.status !== 'PENDING' && <button className="btn-danger" disabled={busy} onClick={() => { if (confirm(tf(locale, 'admMcRemoveAssetConfirm')(a.name))) run(() => api(`/admin/managed/assets/${a.id}`, { method: 'DELETE' })); }}>{t(locale, 'admMcRemove')}</button>}
            </Cell>
          </Row>
        ))}
      </Table>
    </Section>
  );
}

/** Responsibility matrix editor. Engineers read it; support leads change it. */
function Matrix({ c, rows, lead, busy, run, post, patch }: { c: Contract; rows: Responsibility[]; lead: boolean; busy: boolean; run: Run; post: Call; patch: Call }) {
  const { locale } = useShell();
  const [edit, setEdit] = useState<string | null>(null);
  const editable = lead && c.status !== 'CANCELLED';
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    if (await run(() => post(`contracts/${c.id}/responsibilities`, { area: f.get('area'), owner: f.get('owner'), notes: String(f.get('notes') ?? '') || undefined }))) form.reset();
  }
  async function save(e: FormEvent<HTMLFormElement>, r: Responsibility) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (await run(() => patch(`contracts/${c.id}/responsibilities/${r.id}`, { area: f.get('area'), owner: f.get('owner'), notes: String(f.get('notes') ?? '') }))) setEdit(null);
  }
  return (
    <Section title={t(locale, 'admMcMatrix')}>
      <Table head={[t(locale, 'mcArea'), t(locale, 'mcWhoOwnsIt'), t(locale, 'notes'), '']} empty={rows.length === 0 ? t(locale, 'nothingYet') : undefined}>
        {rows.map((r) => edit === r.id ? (
          <tr key={r.id} className="border-t border-neutral-100 dark:border-neutral-800">
            <td colSpan={4} className="px-4 py-2">
              <form onSubmit={(e) => save(e, r)} className="flex flex-wrap items-start gap-2">
                <input className="input min-w-48 flex-1" name="area" defaultValue={r.area} required minLength={2} maxLength={160} />
                <select className="input !w-36" name="owner" defaultValue={r.owner}>{OWNERS.map((o) => <option key={o} value={o}>{tk(locale, `mcOwner_${o}`)}</option>)}</select>
                <input className="input min-w-48 flex-1" name="notes" defaultValue={r.notes ?? ''} maxLength={1000} />
                <button className="btn-primary" disabled={busy}>{t(locale, 'save')}</button><button type="button" className="btn-ghost" onClick={() => setEdit(null)}>{t(locale, 'cancel')}</button>
              </form>
            </td>
          </tr>
        ) : (
          <Row key={r.id}>
            <Cell className="font-medium">{r.area}</Cell>
            <Cell>{editable ? (
              <select className="input !w-36 py-1" value={r.owner} disabled={busy} onChange={(e) => run(() => patch(`contracts/${c.id}/responsibilities/${r.id}`, { owner: e.target.value as Owner }))} aria-label={t(locale, 'mcWhoOwnsIt')}>
                {OWNERS.map((o) => <option key={o} value={o}>{tk(locale, `mcOwner_${o}`)}</option>)}
              </select>
            ) : <OwnerBadge o={r.owner} />}</Cell>
            <Cell className="text-neutral-500">{r.notes}</Cell>
            <Cell className="whitespace-nowrap text-end">{editable && <>
              <button className="btn-ghost me-1" onClick={() => setEdit(r.id)}>{t(locale, 'admMcEdit')}</button>
              <button className="btn-danger" disabled={busy} onClick={() => { if (confirm(tf(locale, 'admMcRemoveAreaConfirm')(r.area))) run(() => api(`/admin/managed/contracts/${c.id}/responsibilities/${r.id}`, { method: 'DELETE' })); }}>{t(locale, 'admMcRemove')}</button>
            </>}</Cell>
          </Row>
        ))}
      </Table>
      {editable && (
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1"><Field label={t(locale, 'mcArea')}><input className="input" name="area" required minLength={2} maxLength={160} /></Field></div>
          <Field label={t(locale, 'mcWhoOwnsIt')}><select className="input !w-36" name="owner" defaultValue="SHARED">{OWNERS.map((o) => <option key={o} value={o}>{tk(locale, `mcOwner_${o}`)}</option>)}</select></Field>
          <div className="min-w-48 flex-1"><Field label={t(locale, 'notes')}><input className="input" name="notes" maxLength={1000} /></Field></div>
          <button className="btn-ghost" disabled={busy}>{t(locale, 'admMcAddArea')}</button>
        </form>
      )}
    </Section>
  );
}

/** Included, used and overage time for a month, with the managed lines already accrued. */
function UsagePanel({ contractId }: { contractId: string }) {
  const { locale } = useShell();
  const [period, setPeriod] = useState(periodOf(new Date()));
  const [u, setU] = useState<UsageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setU(null); setError(null); api<UsageDetail>(`/admin/managed/contracts/${contractId}/usage?period=${period}`).then(setU).catch((e) => setError(errText(e))); }, [contractId, period]);
  return (
    <Section title={t(locale, 'admMcUsage')} actions={<input type="month" className="input !w-auto py-1" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} dir="ltr" />}>
      <ErrorBox error={error} />
      {!u ? (error ? null : <Loading />) : (
        <div className="card space-y-2 text-sm">
          <div className="grid gap-4 sm:grid-cols-4">
            <div><div className="text-xs text-neutral-500">{t(locale, 'admMcIncluded')}</div><div className="font-medium">{hours(u.includedMinutes)} h</div></div>
            <div><div className="text-xs text-neutral-500">{t(locale, 'admMcBillable')}</div><div className="font-medium">{hours(u.billableMinutes)} h</div><div className="text-xs text-neutral-500">{tf(locale, 'mcNonBillable')(hours(u.nonBillableMinutes))}</div></div>
            <div><div className="text-xs text-neutral-500">{t(locale, 'admMcOverage')}</div><div className={`font-medium ${u.overageMinutes ? 'text-amber-700 dark:text-amber-400' : ''}`}>{hours(u.overageMinutes)} h</div></div>
            <div><div className="text-xs text-neutral-500">{t(locale, 'admMcOverageEstimate')}</div><div className="font-medium">{money(u.estimatedOverageMinor, u.currency, locale)}</div><div className="text-xs text-neutral-500">{tf(locale, 'admMcWithVat')(money(withVat(u.estimatedOverageMinor), u.currency, locale))}</div></div>
          </div>
          {u.lines.length > 0 && (
            <ul className="border-t border-neutral-100 pt-2 text-xs text-neutral-500 dark:border-neutral-800">
              {u.lines.map((l, i) => <li key={i}>{tk(locale, `admMcLine_${l.resourceType}`, l.resourceType)}: {money(l.amountMinor, l.currency, locale)}{l.invoiceId ? ` · ${t(locale, 'admMcInvoiced')}` : ''}</li>)}
            </ul>
          )}
        </div>
      )}
    </Section>
  );
}

function Handover({ id }: { id: string }) {
  const { locale } = useShell();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <Section title={t(locale, 'admMcHandover')} actions={!text ? <button className="btn-ghost" onClick={() => api<{ text: string }>(`/admin/managed/contracts/${id}/handover`).then((r) => setText(r.text)).catch((e) => setError(errText(e)))}>{t(locale, 'admMcShowHandover')}</button> : undefined}>
      <ErrorBox error={error} />
      {text && <pre className="card overflow-x-auto whitespace-pre-wrap font-mono text-xs" dir="ltr">{text}</pre>}
    </Section>
  );
}
