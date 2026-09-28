'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { post } from '@/lib/api';
import { useShell } from '@/components/ctx';
import { ErrorNote, Field } from '@/components/ui';

export default function ForgotPasswordPage() {
  const { t } = useShell();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/ops/v1/auth/password/forgot', { email });
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('resetTitle')}</h1>
        <p className="mt-1 text-sm text-neutral-500">{t('resetLead')}</p>
      </div>
      {sent ? (
        <p className="card text-sm">{t('resetSent')}</p>
      ) : (
        <form onSubmit={submit} className="card space-y-4">
          <ErrorNote error={error} />
          <Field label={t('email')}>
            <input className="input" type="email" dir="ltr" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <button className="btn-primary w-full" disabled={busy}>{t('sendResetLink')}</button>
        </form>
      )}
      <p className="text-center text-sm"><Link className="text-blue-600 hover:underline dark:text-blue-400" href="/login">{t('backToSignIn')}</Link></p>
    </div>
  );
}
