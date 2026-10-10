'use client';

import { LegalAgree, useLegalVersion } from '@/components/legal';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError, setToken } from '@/lib/api';
import { useUrls } from '@/lib/urls';
import { billingForCountry, countryOptions, vatNoteKey } from '@/lib/countries';
import { t, tf } from '@/lib/i18n';
import { captureRef, currentRef, normalizeCode, promoFromUrl, type PromoInfo } from '@/lib/referral';
import { useShell } from '@/components/shell';
import { SocialButtons } from '@/components/social-buttons';

export default function LoginPage() {
  const { locale } = useShell();
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [needCode, setNeedCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The "I agree" box: required to create an account, by email or with Google or Microsoft.
  const [agreed, setAgreed] = useState(false);
  // The website's signup box passes the address it collected (?email=).
  const [email, setEmail] = useState('');
  const legalVersion = useLegalVersion();
  const { www: WWW_URL, domain } = useUrls();
  // Billing country, prefilled from GET /v1/geo (the .sa domain suggests Saudi Arabia, .co the country of your address).
  const [country, setCountry] = useState('');
  // Partner code (docs/affiliates.md): only a customer who signs up with it is referred. A partner's
  // ?ref= link (to the website or here) prefills it while the click is recent; ?promo= always does.
  // Either link opens the signup form.
  const [promo, setPromo] = useState('');
  const [promoInfo, setPromoInfo] = useState<PromoInfo | 'checking' | null>(null);
  useEffect(() => {
    captureRef(domain);
    const q = new URLSearchParams(window.location.search);
    const fromUrl = promoFromUrl();
    if (fromUrl) { setPromo(fromUrl); checkPromo(fromUrl); }
    else {
      const ref = currentRef();
      // The API checks the click is within the cookie days and the partner is approved.
      if (ref) api<PromoInfo>(`/v1/affiliates/codes/${encodeURIComponent(ref)}`).then((p) => { if (p.valid && p.code) { setPromo(p.code); setPromoInfo(p); } }).catch(() => undefined);
    }
    if (q.get('mode') === 'signup' || q.get('ref') || fromUrl) setMode('signup');
    const fromSite = q.get('email');
    if (fromSite && fromSite.length <= 200) setEmail(fromSite);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain]);
  function checkPromo(raw: string) {
    const code = normalizeCode(raw);
    if (!raw.trim()) return setPromoInfo(null);
    if (!code) return setPromoInfo({ code: null, valid: false });
    setPromoInfo('checking');
    api<PromoInfo>(`/v1/affiliates/codes/${code}`).then(setPromoInfo).catch(() => setPromoInfo(null));
  }
  useEffect(() => {
    if (mode !== 'signup' || country) return;
    api<{ country: string }>('/v1/geo').then((g) => setCountry((c) => c || g.country)).catch(() => setCountry((c) => c || (domain?.endsWith('.sa') ? 'SA' : 'US')));
  }, [mode, country, domain]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    try {
      const body =
        mode === 'login'
          ? { email: f.get('email'), password: f.get('password'), ...(f.get('totp') ? { totp: f.get('totp') } : {}) }
          : { email: f.get('email'), password: f.get('password'), name: f.get('name'), teamName: f.get('teamName'), country: f.get('country') || undefined, locale, promoCode: normalizeCode(promo) ?? undefined, acceptTerms: agreed };
      const res = await api<{ session: string }>(`/v1/auth/${mode}`, { method: 'POST', body: JSON.stringify(body) });
      setToken(res.session);
      router.replace(mode === 'signup' ? '/security?welcome=1' : '/');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'totp_required') setNeedCode(true);
      else setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-16 max-w-sm">
      <h1 className="mb-6 text-2xl font-semibold">{t(locale, mode === 'login' ? 'login' : 'signup')}</h1>
      <form onSubmit={submit} className="card space-y-3">
        {mode === 'signup' && <LegalAgree locale={locale} checked={agreed} onChange={setAgreed} />}
        <SocialButtons locale={locale} intent={mode} country={mode === 'signup' ? country || undefined : undefined} promo={mode === 'signup' && promoInfo !== 'checking' && promoInfo?.valid ? promoInfo.code ?? undefined : undefined}
          needsLegal={mode === 'signup'} legal={mode === 'signup' && agreed ? legalVersion ?? undefined : undefined} />
        {mode === 'signup' && (
          <>
            <input className="input" name="name" placeholder={t(locale, 'name')} required />
            <input className="input" name="teamName" placeholder={t(locale, 'teamName')} required />
            <label className="block space-y-1 text-sm">
              <span>{t(locale, 'billingCountry')}</span>
              <select className="input" name="country" value={country} onChange={(e) => setCountry(e.target.value)} required>
                <option value="" disabled>…</option>
                {countryOptions(locale).map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
              <span className="block text-xs text-neutral-500">{t(locale, 'billingCountryHint')}{country && <> <strong>{t(locale, vatNoteKey(billingForCountry(country).vatCategory))}</strong></>}</span>
            </label>
            <label className="block space-y-1 text-sm">
              <span>{t(locale, 'promoCode')}</span>
              <input className="input uppercase" name="promoCode" value={promo} maxLength={20} autoComplete="off" dir="ltr"
                onChange={(e) => { setPromo(e.target.value); setPromoInfo(null); }} onBlur={(e) => checkPromo(e.target.value)} />
              {promoInfo === 'checking' && <span className="block text-xs text-neutral-500">{t(locale, 'promoChecking')}</span>}
              {promoInfo && promoInfo !== 'checking' && (promoInfo.valid
                ? <span className="block text-xs text-green-700 dark:text-green-400">{tf(locale, 'promoGives')(promoInfo.discountPercent ?? 0, promoInfo.discountMonths ?? 0)}</span>
                : <span className="block text-xs text-red-600">{t(locale, 'promoInvalid')}</span>)}
            </label>
          </>
        )}
        <input className="input" name="email" type="email" placeholder={t(locale, 'email')} required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="input" name="password" type="password" placeholder={t(locale, 'password')} required minLength={10} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        {needCode && (
          <div className="space-y-1">
            <input className="input" name="totp" inputMode="numeric" placeholder={t(locale, 'authCode')} autoFocus autoComplete="one-time-code" />
            <p className="text-xs text-neutral-500">{t(locale, 'authCodeHint')}</p>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-primary w-full justify-center" disabled={busy || (mode === 'signup' && !agreed)}>{t(locale, mode === 'login' ? 'login' : 'signup')}</button>
        <div className="flex items-center justify-between text-sm text-neutral-500">
          <button type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setNeedCode(false); }}>
            {t(locale, mode === 'login' ? 'signup' : 'login')} →
          </button>
          {mode === 'login' && <Link href="/forgot-password" className="hover:underline">{t(locale, 'forgotPassword')}</Link>}
        </div>
      </form>
    </div>
  );
}
