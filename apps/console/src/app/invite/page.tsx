'use client';

import { FormEvent, Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError, getToken, setToken } from '@/lib/api';
import { Key, t, tf } from '@/lib/i18n';
import { useShell } from '@/components/shell';
import { SocialButtons } from '@/components/social-buttons';

interface InviteInfo { teamName: string; email: string; role: string; expiresAt: string; hasAccount: boolean }

/** Landing page for the emailed invitation link. Signed in people accept directly; others sign in or create an account. */
function InvitePage() {
  const { locale } = useShell();
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [me, setMe] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) { setInvalid(true); return; }
    api<InviteInfo>(`/v1/invitations?token=${encodeURIComponent(token)}`).then(setInfo).catch(() => setInvalid(true));
    if (getToken()) api<{ user: { email: string } }>('/v1/account').then((m) => setMe(m.user.email)).catch(() => setMe(null));
  }, [token]);

  async function finish(fn: () => Promise<{ session: string }>) {
    setBusy(true); setError(null);
    try {
      const r = await fn();
      setToken(r.session);
      router.replace('/team');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'totp_required') setNeedCode(true);
      else setError(err instanceof ApiError ? err.message : String(err));
    } finally { setBusy(false); }
  }
  const post = <T,>(path: string, body: unknown) => api<T>(path, { method: 'POST', body: JSON.stringify(body) });

  function signInAndAccept(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    finish(async () => {
      const login = await post<{ session: string }>('/v1/auth/login', { email: info!.email, password: f.get('password'), ...(f.get('totp') ? { totp: f.get('totp') } : {}) });
      setToken(login.session);
      return post<{ session: string }>('/v1/invitations/accept', { token });
    });
  }
  function signUpAndAccept(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    finish(() => post<{ session: string }>('/v1/invitations/accept-signup', { token, name: f.get('name'), password: f.get('password') }));
  }

  if (invalid) return <div className="mx-auto mt-16 max-w-sm card"><p className="text-sm">{t(locale, 'inviteInvalid')}</p></div>;
  if (!info) return <p className="text-sm text-neutral-500">{t(locale, 'loading')}</p>;
  const role = t(locale, `role_${info.role}` as Extract<Key, `role_${string}`>) || info.role;
  const signedInAs = getToken() ? me : null;

  return (
    <div className="mx-auto mt-16 max-w-sm space-y-4">
      <h1 className="text-2xl font-semibold">{t(locale, 'inviteAcceptTitle')}</h1>
      <div className="card space-y-3">
        <p>{tf(locale, 'inviteLead')(info.teamName, role)}</p>
        <p className="text-sm text-neutral-500">{tf(locale, 'inviteFor')(info.email)}</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {signedInAs && signedInAs === info.email && (
          <button className="btn-primary w-full" disabled={busy} onClick={() => finish(() => post('/v1/invitations/accept', { token }))}>{t(locale, 'acceptInvite')}</button>
        )}
        {signedInAs && signedInAs !== info.email && <p className="text-sm text-amber-700">{tf(locale, 'inviteWrongUser')(info.email)}</p>}
        {!signedInAs && <SocialButtons locale={locale} intent={info.hasAccount ? 'login' : 'signup'} invite={token} returnPath="/team" />}
        {!signedInAs && info.hasAccount && (
          <form onSubmit={signInAndAccept} className="space-y-3">
            <p className="text-sm">{t(locale, 'signInToAccept')}</p>
            <input className="input" type="email" value={info.email} readOnly dir="ltr" />
            <input className="input" name="password" type="password" placeholder={t(locale, 'password')} required autoComplete="current-password" />
            {needCode && <input className="input" name="totp" placeholder={t(locale, 'authCode')} autoComplete="one-time-code" required />}
            <button className="btn-primary w-full" disabled={busy}>{t(locale, 'acceptInvite')}</button>
          </form>
        )}
        {!signedInAs && !info.hasAccount && (
          <form onSubmit={signUpAndAccept} className="space-y-3">
            <p className="text-sm">{t(locale, 'createToAccept')}</p>
            <input className="input" name="name" placeholder={t(locale, 'name')} required maxLength={80} />
            <input className="input" name="password" type="password" placeholder={t(locale, 'newPassword')} required minLength={10} autoComplete="new-password" />
            <button className="btn-primary w-full" disabled={busy}>{t(locale, 'acceptInvite')}</button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return <Suspense><InvitePage /></Suspense>;
}
