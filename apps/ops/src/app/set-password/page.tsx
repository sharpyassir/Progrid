'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { post } from '@/lib/api';
import { useShell } from '@/components/ctx';
import { ErrorNote, Field } from '@/components/ui';

/** Where the welcome mail and the reset mail land: /set-password?token=... */
export default function SetPasswordPage() {
  return (
    <Suspense>
      <SetPassword />
    </Suspense>
  );
}

function SetPassword() {
  const { t } = useShell();
  const token = useSearchParams().get('token');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== repeat) return setError(new Error(t('passwordsDiffer')));
    setBusy(true);
    try {
      await post('/ops/v1/auth/password/reset', { token, password });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('setPasswordTitle')}</h1>
        <p className="mt-1 text-sm text-neutral-500">{t('setPasswordLead')}</p>
      </div>
      {!token ? (
        <p className="card text-sm">{t('missingToken')} <Link className="text-blue-600 hover:underline" href="/forgot-password">{t('requestNewLink')}</Link></p>
      ) : done ? (
        <div className="card space-y-3 text-sm">
          <p>{t('passwordSet')}</p>
          <Link className="btn-primary" href="/login">{t('goToSignIn')}</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="card space-y-4">
          <ErrorNote error={error} />
          <Field label={t('newPassword')} hint={t('passwordRule')}>
            <input className="input" type="password" autoComplete="new-password" required minLength={10} maxLength={200} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Field label={t('repeatPassword')}>
            <input className="input" type="password" autoComplete="new-password" required minLength={10} maxLength={200} value={repeat} onChange={(e) => setRepeat(e.target.value)} />
          </Field>
          <button className="btn-primary w-full" disabled={busy}>{busy ? t('working') : t('savePassword')}</button>
        </form>
      )}
    </div>
  );
}
