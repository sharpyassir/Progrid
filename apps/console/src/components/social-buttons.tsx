'use client';

import { useEffect, useState } from 'react';
import { api, API_URL } from '@/lib/api';
import type { Locale } from '@/lib/i18n';
import { ts, type SocialProvider } from '@/lib/i18n-social';

export type SocialIntent = 'login' | 'signup' | 'link';

let providersCache: Promise<SocialProvider[]> | null = null;

/** Providers the API has credentials for; the buttons only show for these. */
export function configuredProviders(): Promise<SocialProvider[]> {
  providersCache ??= api<{ providers: { id: SocialProvider }[] }>('/v1/auth/providers')
    .then((r) => r.providers.map((p) => p.id))
    .catch(() => {
      providersCache = null;
      return [];
    });
  return providersCache;
}

/**
 * Sends the browser to the API, which redirects to Google or Microsoft. Linking needs the
 * console session, which a redirect cannot carry, so it first trades it for a one time ticket.
 */
export async function startSocial(provider: SocialProvider, opts: { intent: SocialIntent; locale: Locale; returnPath?: string; invite?: string }) {
  const q = new URLSearchParams({ intent: opts.intent, locale: opts.locale });
  if (opts.returnPath) q.set('return', opts.returnPath);
  if (opts.invite) q.set('invite', opts.invite);
  if (opts.intent === 'link') {
    const { ticket } = await api<{ ticket: string }>('/v1/auth/oauth/link-ticket', { method: 'POST' });
    q.set('ticket', ticket);
  }
  window.location.assign(`${API_URL}/v1/auth/oauth/${provider}/start?${q.toString()}`);
}

/** Google "G" mark, full color, as Google's branding guidelines require. */
export function GoogleLogo({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/** Microsoft logo: the four squares, as in Microsoft's sign in button guidance. */
export function MicrosoftLogo({ size = 21 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 21 21" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

/**
 * White buttons per each brand's guidance: Google's light theme (border #747775, text #1F1F1F,
 * Roboto medium) and Microsoft's light theme (border #8C8C8C, text #5E5E5E, Segoe UI semibold).
 */
export function SocialButton({ provider, locale, onClick, disabled }: { provider: SocialProvider; locale: Locale; onClick: () => void; disabled?: boolean }) {
  const google = provider === 'google';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex h-10 w-full items-center justify-center gap-3 border bg-white px-3 text-sm transition hover:bg-neutral-50 disabled:opacity-60 ${google ? 'rounded-md border-[#747775] font-medium text-[#1F1F1F]' : 'rounded-sm border-[#8C8C8C] font-semibold text-[#5E5E5E]'}`}
      style={{ fontFamily: google ? 'Roboto, Arial, sans-serif' : '"Segoe UI", Arial, sans-serif' }}
    >
      {google ? <GoogleLogo /> : <MicrosoftLogo size={20} />}
      <span>{ts(locale, google ? 'continueGoogle' : 'continueMicrosoft')}</span>
    </button>
  );
}

/** The buttons for every configured provider, then an "or" divider above the email form. */
export function SocialButtons({ locale, intent, invite, returnPath, divider = true }: { locale: Locale; intent: SocialIntent; invite?: string; returnPath?: string; divider?: boolean }) {
  const [providers, setProviders] = useState<SocialProvider[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { configuredProviders().then(setProviders); }, []);
  if (!providers.length) return null;
  return (
    <div className="space-y-3">
      {providers.map((p) => (
        <SocialButton key={p} provider={p} locale={locale} disabled={busy} onClick={() => { setBusy(true); startSocial(p, { intent, locale, invite, returnPath }).catch(() => setBusy(false)); }} />
      ))}
      {divider && (
        <div className="flex items-center gap-3 text-xs uppercase text-neutral-500" role="separator">
          <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
          {ts(locale, 'or')}
          <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
        </div>
      )}
    </div>
  );
}
