'use client';

import { LEGAL_REQUIRED_EVENT, LegalGate, type LegalInfo } from './legal';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from '@/lib/api';
import { getLocale, Locale, RTL, t } from '@/lib/i18n';
import { AccountMenu, GroupMenus, LanguageSelect, MobileNav, TopLinks, type Me } from './main-nav';
import { ENTITY_NAME, type BillingEntityId } from '@/lib/countries';

interface Ctx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  authed: boolean;
  signOut: () => void;
}

const ShellCtx = createContext<Ctx>({ locale: 'en', setLocale: () => {}, authed: false, signOut: () => {} });
export const useShell = () => useContext(ShellCtx);

/** Pages reachable without a session (links sent by email land here). */
const PUBLIC_PATHS = ['/login', '/forgot-password', '/reset-password', '/verify', '/github/callback', '/invite', '/auth/callback', '/affiliates/portal'];

export function Shell({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');
  const [authed, setAuthed] = useState(false);
  const [ready, setReady] = useState(false);
  const [isStaff, setIsStaff] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  // The company that bills the signed in team, named in the footer.
  const [entity, setEntity] = useState<BillingEntityId | null>(null);
  // The current legal documents, when the person still has to accept them (components/legal).
  const [legal, setLegal] = useState<LegalInfo | null>(null);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    setLocaleState(getLocale());
    setAuthed(!!getToken());
    setReady(true);
    if (getToken()) {
      api<{ isStaff: boolean; user?: { name: string; email: string }; team?: { name: string; billingEntity?: BillingEntityId }; legal?: LegalInfo }>('/v1/account')
        .then((m) => { setIsStaff(!!m.isStaff); setMe(m.user ? { name: m.user.name, email: m.user.email, teamName: m.team?.name ?? '' } : null); setEntity(m.team?.billingEntity ?? null); setLegal(m.legal?.required ? m.legal : null); })
        .catch(() => setIsStaff(false));
    }
  }, [pathname]);

  // Any request refused with legal_acceptance_required brings up the acceptance screen.
  useEffect(() => {
    const onRequired = () => {
      api<{ legal?: LegalInfo }>('/v1/account').then((m) => setLegal(m.legal?.required ? m.legal : null)).catch(() => undefined);
    };
    window.addEventListener(LEGAL_REQUIRED_EVENT, onRequired);
    return () => window.removeEventListener(LEGAL_REQUIRED_EVENT, onRequired);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = RTL[locale] ? 'rtl' : 'ltr';
  }, [locale]);

  // Read the token directly: `authed` state can lag one render behind a route change.
  useEffect(() => {
    if (!ready) return;
    const has = !!getToken();
    const isPublic = PUBLIC_PATHS.includes(pathname);
    if (!has && !isPublic) router.replace('/login');
    if (has && pathname === '/login') router.replace('/');
  }, [ready, pathname, router]);

  const setLocale = (l: Locale) => {
    try { localStorage.setItem('prgd.locale', l); } catch { /* ignore */ }
    setLocaleState(l);
  };
  const signOut = () => {
    // End the session on the server too; clear locally whatever the answer.
    api('/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    setToken(null);
    setAuthed(false);
    router.replace('/login');
  };

  return (
    <ShellCtx.Provider value={{ locale, setLocale, authed, signOut }}>
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5">
          <Link href="/" className="me-2 flex shrink-0 items-center gap-2 font-semibold tracking-tight"><img src="/brand/progrid-mark.svg" width="19" height="24" alt="" aria-hidden className="dark:hidden" /><img src="/brand/progrid-mark-white.svg" width="19" height="24" alt="" aria-hidden className="hidden dark:block" /> Progrid</Link>
          {authed && (
            <nav className="hidden min-w-0 items-center gap-0.5 lg:flex" aria-label={t(locale, 'mainNavigation')}>
              <GroupMenus />
              <span aria-hidden className="mx-1 h-5 border-s border-neutral-200 dark:border-neutral-700" />
              <TopLinks isStaff={isStaff} />
            </nav>
          )}
          <div className="ms-auto flex items-center gap-2">
            {authed ? (
              <>
                <div className="hidden lg:block"><AccountMenu me={me} /></div>
                <MobileNav isStaff={isStaff} me={me} />
              </>
            ) : <LanguageSelect />}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{!ready ? null : legal && authed && !PUBLIC_PATHS.includes(pathname)
        ? <LegalGate locale={locale} info={legal} onAccepted={() => { setLegal(null); router.refresh(); }} onSignOut={signOut} />
        : children}</main>
      {ready && entity && (
        <footer className="mx-auto max-w-7xl px-4 pb-6 text-xs text-neutral-500">
          © {new Date().getFullYear()} Progrid · {t(locale, 'entityFooter').replace('{company}', ENTITY_NAME[entity])}
        </footer>
      )}
    </ShellCtx.Provider>
  );
}
