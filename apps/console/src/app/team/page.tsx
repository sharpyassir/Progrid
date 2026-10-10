'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, setToken } from '@/lib/api';
import { Key, Locale, t, tf } from '@/lib/i18n';
import { countryOptions, vatNoteKey, type BillingEntityId, type VatCategory } from '@/lib/countries';
import { useShell } from '@/components/shell';

type Role = 'owner' | 'admin' | 'member' | 'billing' | 'readonly';
interface Member { userId: string; role: Role; email: string; name: string; totpEnabled: boolean; you: boolean }
interface Invitation { id: string; email: string; role: Role; expiresAt: string }
interface TeamInfo {
  team: { id: string; name: string; slug: string; country: string; currency: string; status: string; taxId: string | null; billingEmail: string | null; billingAddress: string | null; billingEntity?: BillingEntityId; entity?: { legalName: string; supportEmail: string; vatCategory?: VatCategory }; pendingCountry?: string | null; pendingCurrency?: string | null; billingChangeAt?: string | null };
  role: Role; members: Member[]; invitations: Invitation[];
}

const ROLES: Role[] = ['owner', 'admin', 'member', 'billing', 'readonly'];
const roleLabel = (locale: Locale, r: Role) => t(locale, `role_${r}` as Extract<Key, `role_${string}`>);

/** Members, invitations, the billing profile printed on invoices, and closing the account. */
export default function TeamPage() {
  const { locale } = useShell();
  const router = useRouter();
  const [info, setInfo] = useState<TeamInfo | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmSlug, setConfirmSlug] = useState('');
  const load = useCallback(() => api<TeamInfo>('/v1/team').then(setInfo).catch((err) => setMsg({ ok: false, text: err instanceof ApiError ? err.message : String(err) })), []);
  useEffect(() => { load(); }, [load]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); await load(); return true; } catch (err) { setMsg({ ok: false, text: err instanceof ApiError ? err.message : String(err) }); return false; }
  }

  if (!info) return <div className="space-y-4"><h1 className="text-xl font-semibold">{t(locale, 'teamNav')}</h1>{msg ? <p className="text-sm text-red-600">{msg.text}</p> : <p className="text-sm text-neutral-500">{t(locale, 'loading')}</p>}</div>;
  const isOwner = info.role === 'owner';
  const canManage = isOwner || info.role === 'admin';
  const canBilling = canManage || info.role === 'billing';

  function invite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const email = String(f.get('email'));
    run(() => api('/v1/team/invitations', { method: 'POST', body: JSON.stringify({ email, role: f.get('role') }) }), tf(locale, 'invitationSent')(email)).then((ok) => ok && form.reset());
  }
  function saveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = { name: f.get('name'), billingEmail: String(f.get('billingEmail') ?? '') || null, taxId: String(f.get('taxId') ?? ''), billingAddress: String(f.get('billingAddress') ?? ''), country: f.get('country') };
    run(() => api('/v1/team', { method: 'PATCH', body: JSON.stringify(body) }), t(locale, 'profileSaved'));
  }
  function changeRole(m: Member, role: Role) {
    if (!confirm(tf(locale, 'roleConfirm')(m.name, roleLabel(locale, role)))) { load(); return; }
    run(() => api(`/v1/team/members/${m.userId}`, { method: 'PATCH', body: JSON.stringify({ role }) }), t(locale, 'roleChanged'));
  }
  async function remove(m: Member) {
    if (!confirm(m.you ? t(locale, 'leaveConfirm') : tf(locale, 'removeConfirm')(m.name))) return;
    const ok = await run(() => api(`/v1/team/members/${m.userId}`, { method: 'DELETE' }), t(locale, 'done'));
    if (ok && m.you) { setToken(null); router.replace('/login'); }
  }
  async function closeAccount(e: FormEvent) {
    e.preventDefault();
    if (!info || confirmSlug !== info.team.slug || !confirm(t(locale, 'closeConfirm'))) return;
    const ok = await run(() => api('/v1/team/close', { method: 'POST', body: JSON.stringify({ confirm: confirmSlug }) }), t(locale, 'done'));
    if (ok) { setToken(null); router.replace('/login'); }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{t(locale, 'teamNav')}: {info.team.name}</h1>
      {msg && <p className={`rounded border p-2 text-sm ${msg.ok ? 'border-green-200 bg-green-50 text-green-800 dark:bg-green-950/30' : 'border-red-200 bg-red-50 text-red-700 dark:bg-red-950/30'}`}>{msg.text}</p>}

      <section className="card p-0">
        <h2 className="border-b border-neutral-100 px-4 py-2 font-medium dark:border-neutral-800">{t(locale, 'members')}</h2>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-neutral-500"><tr><th className="px-4 py-2 text-start">{t(locale, 'name')}</th><th className="px-4 py-2 text-start">{t(locale, 'email')}</th><th className="px-4 py-2 text-start">{t(locale, 'role')}</th><th className="px-4 py-2" /></tr></thead>
          <tbody>
            {info.members.map((m) => (
              <tr key={m.userId} className="border-t border-neutral-100 dark:border-neutral-800">
                <td className="px-4 py-2 font-medium">{m.name}{m.you && <span className="ms-1 text-xs text-neutral-500">({t(locale, 'you')})</span>}</td>
                <td className="px-4 py-2 text-neutral-500">{m.email}</td>
                <td className="px-4 py-2">
                  {isOwner
                    ? <select className="input w-auto py-1" value={m.role} onChange={(e) => changeRole(m, e.target.value as Role)} aria-label={t(locale, 'role')}>{ROLES.map((r) => <option key={r} value={r}>{roleLabel(locale, r)}</option>)}</select>
                    : roleLabel(locale, m.role)}
                </td>
                <td className="px-4 py-2 text-end">
                  {(m.you || canManage) && <button className="btn-danger" onClick={() => remove(m)}>{m.you ? t(locale, 'leaveTeam') : t(locale, 'removeMember')}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {info.invitations.length > 0 && (
          <>
            <h3 className="border-t border-neutral-100 px-4 pb-1 pt-3 text-sm font-medium dark:border-neutral-800">{t(locale, 'pendingInvitations')}</h3>
            <table className="w-full text-sm"><tbody>
              {info.invitations.map((i) => (
                <tr key={i.id} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="px-4 py-2">{i.email}</td><td className="px-4 py-2 text-neutral-500">{roleLabel(locale, i.role)}</td>
                  <td className="px-4 py-2 text-xs text-neutral-500">{t(locale, 'expires')} {new Date(i.expiresAt).toLocaleDateString()}</td>
                  <td className="px-4 py-2 text-end">{canManage && <button className="btn-ghost" onClick={() => confirm(tf(locale, 'revokeInviteConfirm')(i.email)) && run(() => api(`/v1/team/invitations/${i.id}`, { method: 'DELETE' }), t(locale, 'done'))}>{t(locale, 'revoke')}</button>}</td>
                </tr>
              ))}
            </tbody></table>
          </>
        )}
      </section>

      {canManage && (
        <form onSubmit={invite} className="card space-y-3">
          <h2 className="font-medium">{t(locale, 'inviteTitle')}</h2>
          <div className="grid gap-2 sm:grid-cols-[1fr_12rem_auto]">
            <input className="input" name="email" type="email" placeholder={t(locale, 'email')} required />
            <select className="input" name="role" defaultValue="member" aria-label={t(locale, 'role')}>{ROLES.filter((r) => isOwner || r !== 'owner').map((r) => <option key={r} value={r}>{roleLabel(locale, r)}</option>)}</select>
            <button className="btn-primary">{t(locale, 'inviteSend')}</button>
          </div>
        </form>
      )}

      <form onSubmit={saveProfile} className="card space-y-3">
        <h2 className="font-medium">{t(locale, 'teamProfile')}</h2>
        <p className="text-sm text-neutral-500">{t(locale, 'teamProfileLead')}</p>
        <fieldset disabled={!canBilling} className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm"><span>{t(locale, 'teamName')}</span><input className="input" name="name" defaultValue={info.team.name} minLength={2} maxLength={60} required /></label>
          <label className="space-y-1 text-sm"><span>{t(locale, 'billingEmailLabel')}</span><input className="input" name="billingEmail" type="email" defaultValue={info.team.billingEmail ?? ''} /></label>
          <label className="space-y-1 text-sm"><span>{t(locale, 'taxIdLabel')}</span><input className="input" name="taxId" defaultValue={info.team.taxId ?? ''} maxLength={40} dir="ltr" /></label>
          <label className="space-y-1 text-sm"><span>{t(locale, 'billingCountry')}</span><select className="input" name="country" defaultValue={info.team.country}>{countryOptions(locale).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select><span className="block text-xs text-neutral-500">{info.team.entity ? `${t(locale, 'billedBy')}: ${info.team.entity.legalName} · ${t(locale, vatNoteKey(info.team.entity.vatCategory))} ` : ''}{info.team.billingChangeAt && info.team.pendingCurrency ? `${t(locale, 'entityPending').replace('{date}', new Date(info.team.billingChangeAt).toLocaleDateString(locale)).replace('{country}', info.team.pendingCountry ?? info.team.country).replace('{currency}', info.team.pendingCurrency)} ` : ''}{t(locale, 'entityChangeHint')}</span></label>
          <label className="space-y-1 text-sm sm:col-span-2"><span>{t(locale, 'billingAddressLabel')}</span><textarea className="input" name="billingAddress" rows={3} maxLength={500} defaultValue={info.team.billingAddress ?? ''} /></label>
        </fieldset>
        {canBilling && <button className="btn-primary">{t(locale, 'save')}</button>}
      </form>

      {isOwner && (
        <form onSubmit={closeAccount} className="card space-y-3 border-red-300 dark:border-red-900">
          <h2 className="font-medium text-red-700 dark:text-red-400">{t(locale, 'closeAccount')}</h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">{t(locale, 'closeLead')}</p>
          <label className="block space-y-1 text-sm"><span>{tf(locale, 'closeType')(info.team.slug)}</span><input className="input max-w-sm" value={confirmSlug} onChange={(e) => setConfirmSlug(e.target.value)} autoComplete="off" dir="ltr" /></label>
          <button className="btn-danger" disabled={confirmSlug !== info.team.slug}>{t(locale, 'closeButton')}</button>
        </form>
      )}
    </div>
  );
}
