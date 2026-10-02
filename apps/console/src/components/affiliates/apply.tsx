'use client';

import Link from 'next/link';
import { FormEvent, useMemo, useState } from 'react';
import { api, setToken } from '@/lib/api';
import { useUrls } from '@/lib/urls';
import { countryOptions } from '@/lib/countries';
import { ErrorBox, useAction } from '@/components/connect/ui';
import { useA, type AffiliateInfo, type Program } from './common';

const AUDIENCE = ['under_1k', '1k_10k', '10k_50k', '50k_250k', 'over_250k'] as const;
const LANGUAGES = ['ar', 'en', 'ar_en', 'other'] as const;

/**
 * The application. Signed out visitors also create their Progrid account here (the same signup
 * as the console), then the application is sent with the new session. Bot protection: a hidden
 * field and the time the form was opened, checked by the API, plus its rate limits.
 */
export function ApplyForm({ program, signedIn, defaultName, onDone }: { program: Program; signedIn: boolean; defaultName?: string; onDone: (a: AffiliateInfo) => void }) {
  const { a, locale } = useA();
  const { www, domain } = useUrls();
  const prefix = locale === 'en' ? '' : `/${locale}`;
  const [startedAt] = useState(() => Date.now());
  const [country, setCountry] = useState(domain?.endsWith('.sa') ? 'SA' : '');
  const { busy, error, run } = useAction();
  const countries = useMemo(() => countryOptions(locale), [locale]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get('name') ?? '').trim();
    await run(async () => {
      if (!signedIn) {
        const s = await api<{ session: string }>('/v1/auth/signup', { method: 'POST', body: JSON.stringify({ email: f.get('email'), password: f.get('password'), name, teamName: name, country, locale }) });
        setToken(s.session);
      }
      const r = await api<{ affiliate: AffiliateInfo }>('/v1/affiliates/apply', {
        method: 'POST',
        body: JSON.stringify({
          name, country,
          channels: String(f.get('channels') ?? '').split(/\s+/).map((x) => x.trim()).filter(Boolean),
          audienceSize: f.get('audienceSize'), contentLanguage: f.get('contentLanguage'), promotionPlan: f.get('promotionPlan'),
          preferredCode: String(f.get('preferredCode') ?? '').trim() || undefined,
          acceptTerms: f.get('acceptTerms') === 'on', website: f.get('website') || undefined, formStartedAt: startedAt,
        }),
      });
      onDone(r.affiliate);
    });
  }

  if (!program.applicationsOpen) return <div className="card text-sm">{a('applicationsClosed')}</div>;
  return (
    <form onSubmit={submit} className="card max-w-2xl space-y-4">
      <div>
        <h2 className="font-medium">{a('applyTitle')}</h2>
        <p className="mt-1 text-sm text-neutral-500">{a('applyLead')}</p>
      </div>
      {!signedIn && (
        <fieldset className="space-y-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
          <legend className="px-1 text-sm font-medium">{a('accountH')}</legend>
          <p className="text-xs text-neutral-500">{a('accountNote')} <Link href="/login" className="underline">{a('signInFirst')}</Link></p>
          <label className="block space-y-1 text-sm"><span>{a('email')}</span><input className="input" name="email" type="email" required autoComplete="email" dir="ltr" /></label>
          <label className="block space-y-1 text-sm"><span>{a('password')}</span><input className="input" name="password" type="password" required minLength={10} autoComplete="new-password" /><span className="block text-xs text-neutral-500">{a('passwordHint')}</span></label>
        </fieldset>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-sm"><span>{a('name')}</span><input className="input" name="name" required minLength={2} maxLength={80} defaultValue={defaultName} autoComplete="name" /></label>
        <label className="block space-y-1 text-sm"><span>{a('country')}</span>
          <select className="input" name="country" value={country} onChange={(e) => setCountry(e.target.value)} required>
            <option value="" disabled>{a('choose')}</option>
            {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </label>
      </div>
      <label className="block space-y-1 text-sm"><span>{a('channels')}</span>
        <textarea className="input min-h-[5rem]" name="channels" required dir="ltr" placeholder="https://youtube.com/@yourchannel" />
        <span className="block text-xs text-neutral-500">{a('channelsHint')}</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-sm"><span>{a('audience')}</span>
          <select className="input" name="audienceSize" required defaultValue=""><option value="" disabled>{a('choose')}</option>{AUDIENCE.map((v) => <option key={v} value={v}>{a(`aud_${v}`)}</option>)}</select>
        </label>
        <label className="block space-y-1 text-sm"><span>{a('language')}</span>
          <select className="input" name="contentLanguage" required defaultValue=""><option value="" disabled>{a('choose')}</option>{LANGUAGES.map((v) => <option key={v} value={v}>{a(`lang_${v}`)}</option>)}</select>
        </label>
      </div>
      <label className="block space-y-1 text-sm"><span>{a('plan')}</span>
        <textarea className="input min-h-[6rem]" name="promotionPlan" required minLength={20} maxLength={2000} />
        <span className="block text-xs text-neutral-500">{a('planHint')}</span>
      </label>
      <label className="block space-y-1 text-sm"><span>{a('preferredCode')}</span>
        <input className="input block max-w-xs uppercase" name="preferredCode" pattern="[A-Za-z0-9]{4,20}" maxLength={20} dir="ltr" autoComplete="off" />
        <span className="block text-xs text-neutral-500">{a('preferredCodeHint')}</span>
      </label>
      {/* Hidden from people; a bot that fills it is refused. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label>Website<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="acceptTerms" required className="mt-1" />
        <span>{a('acceptTerms')} <a href={`${www}${prefix}/affiliates/terms`} target="_blank" rel="noreferrer" className="underline">{a('termsLink')}</a></span>
      </label>
      <ErrorBox error={error} />
      <button className="btn-primary" disabled={busy}>{busy ? a('sending') : a('submit')}</button>
    </form>
  );
}
