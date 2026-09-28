'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import QRCode from 'qrcode';
import { post } from '@/lib/api';
import { safeNext, storeSignIn } from '@/lib/auth';
import { getSession } from '@/lib/session';
import type { SignInAnswer } from '@/lib/types';
import { useShell } from '@/components/ctx';
import { ErrorNote, Field } from '@/components/ui';

type LoginAnswer = { challenge: string; expiresAt: string; methods: ('totp' | 'webauthn')[]; enroll: boolean };

type Step =
  | { kind: 'password' }
  | { kind: 'factor'; challenge: string; methods: LoginAnswer['methods'] }
  | { kind: 'enroll'; challenge: string }
  | { kind: 'totp-setup'; challenge: string; secret: string; qr: string }
  | { kind: 'recovery'; codes: string[]; answer: SignInAnswer };

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}

function Login() {
  const { t } = useShell();
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const [step, setStep] = useState<Step>({ kind: 'password' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (getSession()) router.replace(next);
  }, [router, next]);

  const done = (a: SignInAnswer) => {
    storeSignIn(a);
    router.replace(next);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      // A cancelled passkey prompt is not an error worth shouting about.
      if (e instanceof Error && e.name === 'NotAllowedError') setError(new Error(t('passkeyCancelled')));
      else setError(e);
    } finally {
      setBusy(false);
    }
  };

  const signIn = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await post<LoginAnswer>('/ops/v1/auth/login', { email, password });
      setPassword('');
      setStep(r.enroll ? { kind: 'enroll', challenge: r.challenge } : { kind: 'factor', challenge: r.challenge, methods: r.methods });
    });
  };

  const withTotp = (challenge: string) => (e: FormEvent) => {
    e.preventDefault();
    void run(async () => done(await post<SignInAnswer>('/ops/v1/auth/totp', { challenge, code: code.trim() })));
  };

  const withPasskey = (challenge: string) =>
    run(async () => {
      const optionsJSON = await post<Parameters<typeof startAuthentication>[0]['optionsJSON']>('/ops/v1/auth/webauthn/authenticate/options', { challenge });
      const response = await startAuthentication({ optionsJSON });
      done(await post<SignInAnswer>('/ops/v1/auth/webauthn/authenticate/verify', { challenge, response }));
    });

  const enrollTotp = (challenge: string) =>
    run(async () => {
      const r = await post<{ secret: string; otpauthUrl: string }>('/ops/v1/auth/totp/setup', { challenge });
      // Rendered here, never by a QR service: the secret must not leave the browser.
      const qr = await QRCode.toDataURL(r.otpauthUrl, { margin: 1, width: 200, errorCorrectionLevel: 'M' });
      setCode('');
      setStep({ kind: 'totp-setup', challenge, secret: r.secret, qr });
    });

  const confirmTotp = (challenge: string) => (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const r = await post<SignInAnswer & { recoveryCodes: string[] }>('/ops/v1/auth/totp/enable', { challenge, code: code.trim() });
      setStep({ kind: 'recovery', codes: r.recoveryCodes, answer: r });
    });
  };

  const enrollPasskey = (challenge: string) =>
    run(async () => {
      const optionsJSON = await post<Parameters<typeof startRegistration>[0]['optionsJSON']>('/ops/v1/auth/webauthn/register/options', { challenge });
      const response = await startRegistration({ optionsJSON });
      done(await post<SignInAnswer>('/ops/v1/auth/webauthn/register/verify', { challenge, response, name: t('passkeyDefaultName') }));
    });

  const restart = () => {
    setStep({ kind: 'password' });
    setCode('');
    setError(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('signInTitle')}</h1>
        <p className="mt-1 text-sm text-neutral-500">{t('signInLead')}</p>
      </div>
      {params.get('expired') && step.kind === 'password' && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">{t('sessionEnded')}</p>}
      <ErrorNote error={error} />

      {step.kind === 'password' && (
        <form onSubmit={signIn} className="card space-y-4">
          <Field label={t('email')}>
            <input className="input" type="email" autoComplete="username" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label={t('password')}>
            <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <button className="btn-primary w-full" disabled={busy}>{busy ? t('working') : t('continue')}</button>
          <p className="text-center text-sm"><Link className="text-blue-600 hover:underline dark:text-blue-400" href="/forgot-password">{t('forgotPassword')}</Link></p>
        </form>
      )}

      {step.kind === 'factor' && (
        <div className="card space-y-4">
          <p className="text-sm">{t('secondFactorLead')}</p>
          {step.methods.includes('webauthn') && (
            <button className="btn-primary w-full" disabled={busy} onClick={() => withPasskey(step.challenge)}>{t('usePasskey')}</button>
          )}
          {step.methods.includes('totp') && (
            <form onSubmit={withTotp(step.challenge)} className="space-y-3">
              {step.methods.includes('webauthn') && <p className="text-center text-xs uppercase text-neutral-500">{t('or')}</p>}
              <Field label={t('authCode')} hint={t('authCodeHint')}>
                <input className="input font-mono tracking-widest" dir="ltr" inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={20} value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
              </Field>
              <button className={step.methods.includes('webauthn') ? 'btn-ghost w-full' : 'btn-primary w-full'} disabled={busy}>{t('verify')}</button>
            </form>
          )}
          <button className="text-sm text-neutral-500 hover:underline" onClick={restart}>{t('startOver')}</button>
        </div>
      )}

      {step.kind === 'enroll' && (
        <div className="card space-y-4">
          <h2 className="font-semibold">{t('enrollTitle')}</h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">{t('enrollLead')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <button className="rounded-lg border border-neutral-300 p-4 text-start hover:border-blue-500 disabled:opacity-50 dark:border-neutral-700" disabled={busy} onClick={() => enrollPasskey(step.challenge)}>
              <span className="block font-medium">{t('enrollPasskey')}</span>
              <span className="mt-1 block text-xs text-neutral-500">{t('enrollPasskeyNote')}</span>
            </button>
            <button className="rounded-lg border border-neutral-300 p-4 text-start hover:border-blue-500 disabled:opacity-50 dark:border-neutral-700" disabled={busy} onClick={() => enrollTotp(step.challenge)}>
              <span className="block font-medium">{t('enrollTotp')}</span>
              <span className="mt-1 block text-xs text-neutral-500">{t('enrollTotpNote')}</span>
            </button>
          </div>
          <button className="text-sm text-neutral-500 hover:underline" onClick={restart}>{t('startOver')}</button>
        </div>
      )}

      {step.kind === 'totp-setup' && (
        <form onSubmit={confirmTotp(step.challenge)} className="card space-y-4">
          <p className="text-sm">{t('scanStep')}</p>
          <img src={step.qr} alt={t('qrAlt')} width={200} height={200} className="mx-auto rounded bg-white p-1" />
          <p className="text-xs text-neutral-500">{t('typeKey')} <code dir="ltr" className="break-all rounded bg-neutral-100 px-1 font-mono dark:bg-neutral-800">{step.secret}</code></p>
          <Field label={t('confirmStep')}>
            <input className="input font-mono tracking-widest" dir="ltr" inputMode="numeric" autoComplete="one-time-code" required minLength={6} maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
          </Field>
          <button className="btn-primary w-full" disabled={busy}>{t('turnOnAndSignIn')}</button>
        </form>
      )}

      {step.kind === 'recovery' && (
        <div className="card space-y-4">
          <p className="text-sm font-medium">{t('recoveryTitle')}</p>
          <ul dir="ltr" className="grid grid-cols-2 gap-2 rounded-md bg-neutral-50 p-3 font-mono text-sm dark:bg-neutral-800">
            {step.codes.map((c) => <li key={c}>{c}</li>)}
          </ul>
          <button className="btn-primary w-full" onClick={() => done(step.answer)}>{t('savedCodes')}</button>
        </div>
      )}
    </div>
  );
}
