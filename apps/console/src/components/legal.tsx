'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { Locale } from '@/lib/i18n';
import { lt } from '@/lib/i18n-legal';
import { useUrls } from '@/lib/urls';

/** Fired by the API client when a request answers 428 legal_acceptance_required. */
export const LEGAL_REQUIRED_EVENT = 'prgd:legal-required';

export interface LegalInfo { version: string; required?: boolean; accepted?: string | null; documents: { slug: string; url: string }[]; related: { slug: string; url: string }[] }

/** The current version of the documents (public endpoint), for the signup forms. */
export function useLegalVersion() {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    api<LegalInfo>('/v1/legal').then((r) => setVersion(r.version)).catch(() => setVersion(null));
  }, []);
  return version;
}

/** Links to the website of this domain, in the person's language. */
function useDocUrl(locale: Locale) {
  const { www } = useUrls();
  return (slug: string) => `${www}${locale === 'en' ? '' : `/${locale}`}/legal/${slug}`;
}

/** The "I agree" checkbox of every form that creates an account. */
export function LegalAgree({ locale, checked, onChange }: { locale: Locale; checked: boolean; onChange: (v: boolean) => void }) {
  const url = useDocUrl(locale);
  const link = (slug: string, label: string) => <a className="underline" href={url(slug)} target="_blank" rel="noreferrer">{label}</a>;
  return (
    <label className="flex items-start gap-2 text-xs text-neutral-600 dark:text-neutral-300">
      <input type="checkbox" name="acceptTerms" className="mt-0.5 shrink-0" checked={checked} onChange={(e) => onChange(e.target.checked)} required />
      <span>
        {lt(locale, 'agreeLead')} {link('terms', lt(locale, 'terms'))}, {link('acceptable-use', lt(locale, 'aup'))} {lt(locale, 'and')} {link('privacy', lt(locale, 'privacy'))}{lt(locale, 'agreeTail')}
      </span>
    </label>
  );
}

const RELATED_LABEL: Record<string, Parameters<typeof lt>[1]> = { dpa: 'dpa', refunds: 'refunds', sla: 'sla', cookies: 'cookies', subprocessors: 'subprocessors', 'export-sanctions': 'exportSanctions' };

/**
 * Shown instead of the console when the signed in person has not accepted the current version
 * (a new account made without the checkbox, or after the documents changed). Nothing else works
 * until they accept or sign out.
 */
export function LegalGate({ locale, info, onAccepted, onSignOut }: { locale: Locale; info: LegalInfo | null; onAccepted: () => void; onSignOut: () => void }) {
  const url = useDocUrl(locale);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const doc = (slug: string, label: string) => <li key={slug}><a className="text-blue-600 underline" href={url(slug)} target="_blank" rel="noreferrer">{label}</a></li>;

  const accept = async () => {
    if (!info) return;
    setBusy(true);
    setError(null);
    try {
      await api('/v1/legal/accept', { method: 'POST', body: JSON.stringify({ accept: true, version: info.version }) });
      onAccepted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="card space-y-4">
        <h1 className="text-xl font-semibold">{lt(locale, 'gateTitle')}</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">{info?.accepted ? lt(locale, 'gateUpdated') : lt(locale, 'gateNew')}</p>
        <ul className="list-disc space-y-1 ps-5 text-sm">
          {doc('terms', lt(locale, 'terms'))}
          {doc('acceptable-use', lt(locale, 'aup'))}
          {doc('privacy', lt(locale, 'privacy'))}
        </ul>
        {info && info.related.length > 0 && (
          <p className="text-xs text-neutral-500">
            {lt(locale, 'gateAlso')}{' '}
            {info.related.map((r, i) => <span key={r.slug}>{i > 0 && ', '}<a className="underline" href={url(r.slug)} target="_blank" rel="noreferrer">{lt(locale, RELATED_LABEL[r.slug] ?? 'terms')}</a></span>)}
          </p>
        )}
        <LegalAgree locale={locale} checked={checked} onChange={setChecked} />
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary" disabled={!checked || busy || !info} onClick={accept}>{lt(locale, 'accept')}</button>
          <button className="text-sm text-neutral-500 hover:underline" onClick={onSignOut}>{lt(locale, 'signOut')}</button>
          {info && <span className="ms-auto text-xs text-neutral-400" dir="ltr">{lt(locale, 'version')} {info.version}</span>}
        </div>
      </div>
    </div>
  );
}
