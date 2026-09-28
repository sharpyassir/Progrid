'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import type { Locale } from '@/lib/i18n';
import { PROVIDER_NAME, socialError, ts, tsf, type SocialProvider } from '@/lib/i18n-social';
import { GoogleLogo, MicrosoftLogo, startSocial } from './social-buttons';

interface Identity { id: string; provider: SocialProvider; email: string; lastUsedAt: string | null; createdAt: string }
interface Identities { data: Identity[]; hasPassword: boolean; available: SocialProvider[] }

/** Security card: the password and the linked Google and Microsoft accounts, with link and unlink. */
export function SignInMethods({ locale }: { locale: Locale }) {
  const params = useSearchParams();
  const [state, setState] = useState<Identities | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api<Identities>('/v1/account/identities').then(setState).catch(() => setState(null)), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const linked = params.get('linked') as SocialProvider | null;
    if (linked && PROVIDER_NAME[linked]) setNotice(tsf(locale, 'linkedNotice')(PROVIDER_NAME[linked]));
  }, [params, locale]);

  if (!state) return null;
  const providers = Array.from(new Set<SocialProvider>([...state.available, ...state.data.map((i) => i.provider)]));
  const methods = state.data.length + (state.hasPassword ? 1 : 0);

  async function unlink(i: Identity) {
    setBusy(true); setError(null); setNotice(null);
    try {
      await api(`/v1/account/identities/${i.id}`, { method: 'DELETE' });
      setNotice(tsf(locale, 'unlinkedNotice')(PROVIDER_NAME[i.provider]));
      await load();
    } catch (err) {
      setError(err instanceof ApiError && err.code === 'last_sign_in_method' ? ts(locale, 'lastSignInMethod') : err instanceof ApiError ? err.message : String(err));
    } finally { setBusy(false); }
  }

  async function link(p: SocialProvider) {
    setBusy(true); setError(null);
    try { await startSocial(p, { intent: 'link', locale, returnPath: '/security' }); }
    catch (err) { setError(err instanceof ApiError ? err.message : socialError(locale, 'generic')); setBusy(false); }
  }

  return (
    <section className="card space-y-3">
      <h2 className="font-medium">{ts(locale, 'signInMethods')}</h2>
      <p className="text-sm text-neutral-600 dark:text-neutral-300">{ts(locale, 'signInMethodsNote')}</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {notice && <p className="text-sm text-green-700">{notice}</p>}
      <ul className="divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
        <li className="flex flex-wrap items-center gap-3 py-2">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-neutral-100 text-xs dark:bg-neutral-800" aria-hidden="true">•••</span>
          <div className="min-w-0 flex-1">
            <p>{ts(locale, 'passwordLabel')}</p>
            <p className="text-xs text-neutral-500">{ts(locale, state.hasPassword ? 'passwordIsSet' : 'passwordNotSet')}</p>
          </div>
          {!state.hasPassword && <Link href="/forgot-password" className="btn-ghost">{ts(locale, 'setPassword')}</Link>}
        </li>
        {providers.map((p) => {
          const rows = state.data.filter((i) => i.provider === p);
          const logo = <span className="flex h-6 w-6 items-center justify-center rounded bg-white ring-1 ring-neutral-200 dark:ring-neutral-700">{p === 'google' ? <GoogleLogo size={16} /> : <MicrosoftLogo size={16} />}</span>;
          if (!rows.length) {
            return (
              <li key={p} className="flex flex-wrap items-center gap-3 py-2">
                {logo}
                <div className="min-w-0 flex-1">
                  <p>{PROVIDER_NAME[p]}</p>
                  <p className="text-xs text-neutral-500">{ts(locale, 'notLinked')}</p>
                </div>
                {state.available.includes(p) && <button className="btn-ghost" disabled={busy} onClick={() => link(p)}>{ts(locale, 'link')}</button>}
              </li>
            );
          }
          return rows.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 py-2">
              {logo}
              <div className="min-w-0 flex-1">
                <p>{PROVIDER_NAME[p]}</p>
                <p className="truncate text-xs text-neutral-500"><span dir="ltr">{i.email}</span>{i.lastUsedAt && <> · {ts(locale, 'lastUsed')} {new Date(i.lastUsedAt).toLocaleDateString(locale)}</>}</p>
              </div>
              <button className="btn-ghost" disabled={busy || methods <= 1} title={methods <= 1 ? ts(locale, 'lastSignInMethod') : undefined} onClick={() => unlink(i)}>{ts(locale, 'unlink')}</button>
            </li>
          ));
        })}
      </ul>
    </section>
  );
}
