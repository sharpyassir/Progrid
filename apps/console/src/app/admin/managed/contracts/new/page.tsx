'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useId, useState } from 'react';
import { api, money } from '@/lib/api';
import { t, tf } from '@/lib/i18n';
import { AdminShell } from '@/components/admin-shell';
import { useShell } from '@/components/shell';
import { Empty, ErrorBox, Field, Loading, tk, useAccount } from '@/components/managed';
import { errText, isLeadRoles, type Contract, type Plan, type TeamHit } from '@/lib/managed';

/** Support lead: create a contract for a team by hand (it starts as DRAFT, like a customer request). */
export default function AdminNewContract() {
  const { locale } = useShell();
  const router = useRouter();
  const { account } = useAccount();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [team, setTeam] = useState<TeamHit | null>(null);
  const [plan, setPlan] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api<{ data: Plan[] }>('/admin/managed/plans').then((r) => { const active = r.data.filter((p) => p.active); setPlans(active); setPlan(active[0]?.code ?? ''); }).catch((e) => setError(errText(e))); }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string, scale = 1) => { const v = String(f.get(k) ?? '').trim(); return v === '' ? undefined : Math.round(Number(v) * scale); };
    const body = {
      teamId: team?.id, plan, calendar: f.get('calendar'), notes: String(f.get('notes') ?? '').trim() || undefined,
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
          {team ? (
            <>
              <div className="text-sm text-neutral-500">{t(locale, 'team')}</div>
              <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium">{team.name}</span><span className="text-neutral-500">{team.slug} · {team.country}{team.ownerName ? ` · ${team.ownerName}` : ''}</span><button type="button" className="btn-ghost ms-auto" onClick={() => setTeam(null)}>{t(locale, 'admMcChange')}</button></div>
            </>
          ) : <TeamPicker onPick={setTeam} />}
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
        <div className="flex gap-2"><button className="btn-primary" disabled={busy || !team}>{t(locale, 'admMcCreateDraft')}</button><Link href="/admin/managed/contracts" className="btn-ghost">{t(locale, 'cancel')}</Link></div>
      </form>
    </AdminShell>
  );
}

/**
 * Searchable team picker (a combobox): type part of the team name, slug or id, or the owner's
 * name or email. Arrow keys move through the matches, Enter picks one and Escape clears the list.
 */
function TeamPicker({ onPick }: { onPick: (t: TeamHit) => void }) {
  const { locale } = useShell();
  const listId = useId();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<TeamHit[] | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => {
      api<{ data: TeamHit[] }>(`/admin/managed/teams?q=${encodeURIComponent(q.trim())}`).then((r) => { setHits(r.data); setActive(0); setError(null); }).catch((e) => setError(errText(e)));
    }, q ? 250 : 0);
    return () => clearTimeout(id);
  }, [q]);

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    const n = hits?.length ?? 0;
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => (n ? (i + 1) % n : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); setActive((i) => (n ? (i - 1 + n) % n : 0)); }
    else if (e.key === 'Enter' && open && hits?.[active]) { e.preventDefault(); onPick(hits[active]); }
    else if (e.key === 'Escape') setOpen(false);
  }

  const shown = open ? hits ?? [] : [];
  return (
    <div className="relative space-y-1">
      <label className="block text-sm">
        <span className="text-neutral-500">{t(locale, 'team')}</span>
        <input className="input mt-1" role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
          placeholder={t(locale, 'admMcTeamSearch')} value={q} autoComplete="off"
          onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={onKey} />
      </label>
      <ErrorBox error={error} />
      {open && (
        <ul id={listId} role="listbox" aria-label={t(locale, 'team')} className="absolute inset-x-0 z-10 max-h-72 overflow-y-auto rounded-md border border-neutral-200 bg-white text-sm shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
          {hits === null ? <li className="px-3 py-2 text-neutral-500">{t(locale, 'loading')}</li>
            : hits.length === 0 ? <li className="px-3 py-2 text-neutral-500">{t(locale, 'admMcNoTeamsFound')}</li>
            : hits.map((h, i) => (
              <li key={h.id} id={`${listId}-${i}`} role="option" aria-selected={i === active}
                className={`flex cursor-pointer flex-wrap items-baseline gap-x-2 px-3 py-2 ${i === active ? 'bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-neutral-50 dark:hover:bg-neutral-800'}`}
                onMouseDown={(e) => { e.preventDefault(); onPick(h); }} onMouseEnter={() => setActive(i)}>
                <span className="font-medium">{h.name}</span>
                <span className="text-xs text-neutral-500">{h.slug} · {h.country}</span>
                {h.ownerName && <span className="ms-auto text-xs text-neutral-500">{tf(locale, 'admMcOwnerIs')(h.ownerName)}</span>}
              </li>
            ))}
        </ul>
      )}
      <p className="text-xs text-neutral-500">{t(locale, 'admMcTeamSearchHint')}</p>
    </div>
  );
}
