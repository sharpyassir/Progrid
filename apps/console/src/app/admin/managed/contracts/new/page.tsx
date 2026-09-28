'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError, money } from '@/lib/api';
import { t } from '@/lib/i18n';
import { AdminShell } from '@/components/admin-shell';
import { useShell } from '@/components/shell';
import { Empty, ErrorBox, Field, Loading, tk, useAccount } from '@/components/managed';
import { errText, isLeadRoles, type Contract, type Plan } from '@/lib/managed';

interface TeamHit { id: string; name: string; slug: string; country: string; currency: string }

/** Support lead: create a contract for a team by hand (it starts as DRAFT, like a customer request). */
export default function AdminNewContract() {
  const { locale } = useShell();
  const router = useRouter();
  const { account } = useAccount();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<TeamHit[]>([]);
  const [searchBlocked, setSearchBlocked] = useState(false);
  const [team, setTeam] = useState<TeamHit | null>(null);
  const [teamId, setTeamId] = useState('');
  const [plan, setPlan] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api<{ data: Plan[] }>('/admin/managed/plans').then((r) => { const active = r.data.filter((p) => p.active); setPlans(active); setPlan(active[0]?.code ?? ''); }).catch((e) => setError(errText(e))); }, []);
  // Team search needs the support area; without it the lead pastes the team id.
  useEffect(() => {
    if (searchBlocked || q.trim().length < 2) { setHits([]); return; }
    const id = setTimeout(() => {
      api<{ data: TeamHit[] }>(`/admin/v1/teams?q=${encodeURIComponent(q.trim())}`).then((r) => setHits(r.data.slice(0, 8))).catch((e) => { if (e instanceof ApiError && e.status === 403) setSearchBlocked(true); });
    }, 250);
    return () => clearTimeout(id);
  }, [q, searchBlocked]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string, scale = 1) => { const v = String(f.get(k) ?? '').trim(); return v === '' ? undefined : Math.round(Number(v) * scale); };
    const body = {
      teamId: team?.id ?? teamId.trim(), plan, calendar: f.get('calendar'), notes: String(f.get('notes') ?? '').trim() || undefined,
      priceOverrideMinor: num('price', 100), includedMinutesOverride: num('hours', 60), maxAssetsOverride: num('maxAssets'), termMonths: num('termMonths'),
    };
    setBusy(true); setError(null);
    try {
      const c = await api<Contract>('/admin/managed/contracts', { method: 'POST', body: JSON.stringify(body) });
      router.push(`/admin/managed/contracts/${c.id}`);
    } catch (err) { setError(errText(err)); setBusy(false); }
  }

  const title = t(locale, 'admMcNewContract');
  if (!account || !plans) return <AdminShell title={title}>{error ? <ErrorBox error={error} /> : <Loading />}</AdminShell>;
  if (!isLeadRoles(account.staffRoles)) return <AdminShell title={title}><Empty>{t(locale, 'admMcLeadOnly')}</Empty></AdminShell>;
  const selected = plans.find((p) => p.code === plan);

  return (
    <AdminShell title={title}>
      <form onSubmit={submit} className="card max-w-3xl space-y-4">
        <ErrorBox error={error} />
        <div className="space-y-2">
          <div className="text-sm text-neutral-500">{t(locale, 'team')}</div>
          {team ? (
            <div className="flex items-center gap-2 text-sm"><span className="font-medium">{team.name}</span><span className="text-neutral-500">{team.slug} · {team.country} · {team.currency}</span><button type="button" className="btn-ghost ms-auto" onClick={() => setTeam(null)}>{t(locale, 'admMcChange')}</button></div>
          ) : searchBlocked ? (
            <Field label={t(locale, 'admMcTeamId')} hint={t(locale, 'admMcTeamSearchBlocked')}><input className="input font-mono" dir="ltr" value={teamId} onChange={(e) => setTeamId(e.target.value)} required /></Field>
          ) : (
            <div className="space-y-1">
              <input className="input" placeholder={t(locale, 'admMcTeamSearch')} value={q} onChange={(e) => setQ(e.target.value)} />
              {hits.length > 0 && (
                <ul className="divide-y divide-neutral-100 rounded-md border border-neutral-200 text-sm dark:divide-neutral-800 dark:border-neutral-800">
                  {hits.map((h) => <li key={h.id}><button type="button" className="flex w-full gap-2 px-3 py-2 text-start hover:bg-neutral-50 dark:hover:bg-neutral-800" onClick={() => { setTeam(h); setHits([]); }}><span className="font-medium">{h.name}</span><span className="text-neutral-500">{h.slug} · {h.country}</span></button></li>)}
                </ul>
              )}
              <button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => setSearchBlocked(true)}>{t(locale, 'admMcEnterTeamId')}</button>
            </div>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t(locale, 'mcPlan')}>
            <select className="input" value={plan} onChange={(e) => setPlan(e.target.value)} required>
              {plans.map((p) => <option key={p.id} value={p.code}>{p.name} ({p.priceMinor === null ? t(locale, 'mcCustomPrice') : money(p.priceMinor, p.currency, locale)})</option>)}
            </select>
          </Field>
          <Field label={t(locale, 'mcCalendar')}>
            <select className="input" name="calendar" defaultValue={team?.country === 'TR' ? 'TR' : 'SA'}><option value="SA">{t(locale, 'mcCalendar_SA')}</option><option value="TR">{t(locale, 'mcCalendar_TR')}</option></select>
          </Field>
          <Field label={t(locale, 'admMcPriceOverride')} hint={selected?.custom ? t(locale, 'admMcPriceRequiredCustom') : t(locale, 'admMcOverrideHint')}>
            <input className="input" name="price" type="number" min={0} step="0.01" required={!!selected?.custom} dir="ltr" />
          </Field>
          <Field label={t(locale, 'admMcIncludedHoursOverride')} hint={selected ? tk(locale, 'admMcPlanDefault') + ': ' + selected.includedEngineerMinutes / 60 : undefined}>
            <input className="input" name="hours" type="number" min={0} step="0.5" dir="ltr" />
          </Field>
          <Field label={t(locale, 'admMcMaxAssetsOverride')} hint={selected ? tk(locale, 'admMcPlanDefault') + ': ' + (selected.maxAssets ?? t(locale, 'mcCustom')) : undefined}>
            <input className="input" name="maxAssets" type="number" min={1} dir="ltr" />
          </Field>
          <Field label={t(locale, 'admMcTermMonths')}><input className="input" name="termMonths" type="number" min={1} max={60} placeholder="12" dir="ltr" /></Field>
        </div>
        <Field label={t(locale, 'notes')}><textarea className="input min-h-24" name="notes" maxLength={4000} /></Field>
        <p className="text-xs text-neutral-500">{t(locale, 'admMcNewContractNote')}</p>
        <div className="flex gap-2"><button className="btn-primary" disabled={busy || (!team && !teamId.trim())}>{t(locale, 'admMcCreateDraft')}</button><Link href="/admin/managed/contracts" className="btn-ghost">{t(locale, 'cancel')}</Link></div>
      </form>
    </AdminShell>
  );
}
