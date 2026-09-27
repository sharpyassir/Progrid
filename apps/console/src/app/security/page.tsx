'use client';

import { useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useShell } from '@/components/shell';

interface Me { user: { email: string; totpEnabled: boolean; emailVerified: boolean }; role: string }

type SessionRow = { id: string; createdAt: string; lastSeenAt: string; ip: string | null; userAgent: string | null; current: boolean };

function SecurityPage() {
  const { locale } = useShell();
  const welcome = useSearchParams().get('welcome') === '1';
  const [me, setMe] = useState<Me | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const load = useCallback(() => {
    api<Me>('/v1/account').then(setMe);
    api<{ data: SessionRow[] }>('/v1/account/sessions').then((r) => setSessions(r.data)).catch(() => setSessions([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function call<T>(fn: () => Promise<T>) {
    setError(null); setNotice(null);
    try { return await fn(); } catch (err) { setError(err instanceof ApiError ? err.message : String(err)); }
  }

  async function enable(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = new FormData(e.currentTarget).get('code');
    const res = await call(() => api<{ recoveryCodes: string[] }>('/v1/auth/totp/enable', { method: 'POST', body: JSON.stringify({ code }) }));
    if (res) { setRecovery(res.recoveryCodes); setSetup(null); load(); }
  }

  async function disable(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = new FormData(e.currentTarget).get('code');
    if (await call(() => api('/v1/auth/totp/disable', { method: 'POST', body: JSON.stringify({ code }) }))) { setNotice(t(locale, 'twoFactorOff')); load(); }
  }

  if (!me) return <p className="text-sm text-neutral-500">{t(locale, 'loading')}</p>;
  const qr = setup ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(setup.otpauthUrl)}` : null;

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold">{t(locale, 'security')}</h1>
      {welcome && <div className="card border-blue-200 bg-blue-50 text-sm dark:bg-blue-950/30">{t(locale, 'welcomeSecurity')}</div>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {notice && <p className="text-sm text-green-700">{notice}</p>}

      <section className="card space-y-2">
        <h2 className="font-medium">{t(locale, 'email')}</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">{me.user.email} {me.user.emailVerified ? <span className="ml-2 rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">{t(locale, 'confirmed')}</span> : <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{t(locale, 'notConfirmed')}</span>}</p>
        {!me.user.emailVerified && (
          <div className="text-sm">
            <p className="mb-2 text-neutral-500">{t(locale, 'needConfirmed')}</p>
            <button className="btn-ghost" onClick={() => call(() => api('/v1/auth/verify/request', { method: 'POST' })).then(() => setNotice(t(locale, 'sentAgain')))}>{t(locale, 'sendAgain')}</button>
          </div>
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="font-medium">{t(locale, 'twoFactor')}</h2>
        {me.user.totpEnabled ? (
          <>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">{t(locale, 'twoFactorOn')}</p>
            <form onSubmit={disable} className="flex gap-2">
              <input className="input max-w-[12rem]" name="code" inputMode="numeric" placeholder={t(locale, 'codeToTurnOff')} required autoComplete="one-time-code" />
              <button className="btn-danger">{t(locale, 'turnOff')}</button>
            </form>
          </>
        ) : setup ? (
          <div className="space-y-3 text-sm">
            <p>{t(locale, 'scanStep')}</p>
            <div className="flex flex-wrap items-start gap-4">
              {qr && <img src={qr} alt="QR code for your authenticator app" width={180} height={180} className="rounded bg-white p-1" />}
              <div className="space-y-1">
                <p className="text-neutral-500">{t(locale, 'typeKey')}</p>
                <code className="block break-all rounded bg-neutral-100 p-2 font-mono text-xs dark:bg-neutral-800">{setup.secret}</code>
              </div>
            </div>
            <p>{t(locale, 'confirmStep')}</p>
            <form onSubmit={enable} className="flex gap-2">
              <input className="input max-w-[12rem]" name="code" inputMode="numeric" placeholder="123456" required autoFocus autoComplete="one-time-code" />
              <button className="btn-primary">{t(locale, 'confirm')}</button>
            </form>
          </div>
        ) : (
          <>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">{t(locale, me.role === 'owner' ? 'twoFactorOffOwner' : 'twoFactorOffMember')}</p>
            <button className="btn-primary" onClick={() => call(() => api<{ secret: string; otpauthUrl: string }>('/v1/auth/totp/setup', { method: 'POST' })).then((r) => r && setSetup(r))}>{t(locale, 'setUp')}</button>
          </>
        )}
        {recovery && (
          <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
            <p className="mb-2 font-medium">{t(locale, 'recoveryTitle')}</p>
            <pre className="grid grid-cols-2 gap-x-6 font-mono text-xs">{recovery.join('\n')}</pre>
          </div>
        )}
      </section>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-medium">{t(locale, 'sessions')}</h2>
          {sessions.length > 1 && (
            <button className="btn-ghost ms-auto" onClick={() => call(() => api('/v1/account/sessions/revoke-others', { method: 'POST' })).then(() => { setNotice(t(locale, 'otherSessionsEnded')); load(); })}>{t(locale, 'endOtherSessions')}</button>
          )}
        </div>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">{t(locale, 'sessionsNote')}</p>
        <ul className="divide-y divide-neutral-200 text-sm dark:divide-neutral-800">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate">{s.userAgent || t(locale, 'unknownDevice')}{s.current && <span className="ms-2 rounded bg-green-100 px-2 py-0.5 text-xs text-green-800">{t(locale, 'thisDevice')}</span>}</p>
                <p className="text-xs text-neutral-500">{s.ip ?? ''} · {t(locale, 'lastActive')} {new Date(s.lastSeenAt).toLocaleString(locale)}</p>
              </div>
              {!s.current && <button className="btn-ghost" onClick={() => call(() => api(`/v1/account/sessions/${s.id}`, { method: 'DELETE' })).then(load)}>{t(locale, 'endSession')}</button>}
            </li>
          ))}
        </ul>
      </section>

      <section className="card space-y-2">
        <h2 className="font-medium">{t(locale, 'rateLimits')}</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">{t(locale, 'rateLimitsNote')}</p>
      </section>
    </div>
  );
}

export default function Page() {
  return <Suspense><SecurityPage /></Suspense>;
}
