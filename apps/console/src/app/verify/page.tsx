'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { api, ApiError, getToken } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useShell } from '@/components/shell';

function Verify() {
  const { locale } = useShell();
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<'working' | 'ok' | 'error'>('working');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) { setState('error'); setMessage(t(locale, 'missingToken')); return; }
    api('/v1/auth/verify', { method: 'POST', body: JSON.stringify({ token }) })
      .then(() => setState('ok'))
      .catch((err) => { setState('error'); setMessage(err instanceof ApiError ? err.message : String(err)); });
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (state === 'working') return <p className="card text-sm text-neutral-500">{t(locale, 'verifying')}</p>;
  if (state === 'ok') return (
    <div className="card space-y-3 text-sm">
      <p>{t(locale, 'verified')}</p>
      <Link href={getToken() ? '/' : '/login'} className="btn-primary inline-flex">{t(locale, 'continue')}</Link>
    </div>
  );
  return (
    <div className="card space-y-3 text-sm">
      <p className="text-red-600">{message}</p>
      <p><Link href="/security" className="text-blue-600 hover:underline">{t(locale, 'verifyFailedHint')}</Link></p>
    </div>
  );
}

export default function VerifyPage() {
  const { locale } = useShell();
  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="mb-6 text-2xl font-semibold">{t(locale, 'verifyTitle')}</h1>
      <Suspense><Verify /></Suspense>
    </div>
  );
}
