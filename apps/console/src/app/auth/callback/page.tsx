'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useEffect, useRef, useState } from 'react';
import { api, ApiError, setToken } from '@/lib/api';
import { t } from '@/lib/i18n';
import { socialError, ts } from '@/lib/i18n-social';
import { useShell } from '@/components/shell';

type SignIn = { session: string; returnTo?: string };
type Step = SignIn | { totpRequired: true; ticket: string };

/** Only paths inside the console; anything else lands on the servers list. */
function safePath(p: string | null | undefined, fallback: string) {
  return p && p.startsWith('/') && !p.startsWith('//') && !p.includes('\\') ? p : fallback;
}

/**
 * Where the API sends the browser back after Google or Microsoft: redeems the one time code,
 * asks for the second factor when the account has one, stores the session and moves on.
 */
function CallbackPage() {
  const { locale } = useShell();
  const router = useRouter();
  const params = useSearchParams();
  const [ticket, setTicket] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const errorCode = params.get('error');
  const linked = params.get('linked');
  const isLink = params.get('intent') === 'link' || !!linked;
  const back = isLink ? safePath(params.get('return'), '/security') : '/login';

  function done(r: SignIn) {
    setToken(r.session);
    router.replace(safePath(r.returnTo, '/'));
  }

  useEffect(() => {
    if (started.current) return; // one exchange, also under React strict mode
    started.current = true;
    if (errorCode) { setError(socialError(locale, errorCode)); return; }
    if (linked) {
      const to = safePath(params.get('return'), '/security');
      router.replace(`${to}${to.includes('?') ? '&' : '?'}linked=${encodeURIComponent(linked)}`);
      return;
    }
    const code = params.get('code');
    if (!code) { setError(socialError(locale, 'code_invalid')); return; }
    api<Step>('/v1/auth/oauth/exchange', { method: 'POST', body: JSON.stringify({ code }) })
      .then((r) => ('totpRequired' in r ? setTicket(r.ticket) : done(r)))
      .catch((err) => setError(err instanceof ApiError && err.code !== 'error' ? (err.code === 'code_invalid' ? socialError(locale, err.code) : err.message) : socialError(locale, 'generic')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const code = new FormData(e.currentTarget).get('totp');
    try {
      done(await api<SignIn>('/v1/auth/oauth/totp', { method: 'POST', body: JSON.stringify({ ticket, code }) }));
    } catch (err) {
      if (err instanceof ApiError && err.code === 'ticket_invalid') { setTicket(null); setError(socialError(locale, 'state_invalid')); }
      else setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (ticket) {
    return (
      <div className="mx-auto mt-16 max-w-sm">
        <h1 className="mb-6 text-2xl font-semibold">{ts(locale, 'twoFactorTitle')}</h1>
        <form onSubmit={submitCode} className="card space-y-3">
          <div className="space-y-1">
            <input className="input" name="totp" inputMode="numeric" placeholder={t(locale, 'authCode')} autoFocus autoComplete="one-time-code" required dir="ltr" />
            <p className="text-xs text-neutral-500">{t(locale, 'authCodeHint')}</p>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button className="btn-primary w-full justify-center" disabled={busy}>{ts(locale, 'continue')}</button>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <div className="card space-y-3">
        {error ? (
          <>
            <p className="text-sm text-red-600">{error}</p>
            <Link href={back} className="btn-ghost w-full justify-center">{ts(locale, isLink ? 'backToSecurity' : 'backToSignIn')}</Link>
          </>
        ) : (
          <p className="text-sm text-neutral-500">{ts(locale, 'signingIn')}</p>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return <Suspense><CallbackPage /></Suspense>;
}
