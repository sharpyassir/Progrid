'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from '@/lib/api';
import { getLocale, Locale, RTL, t } from '@/lib/i18n';
import { DesktopNav, MobileNav } from './main-nav';

interface Ctx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  authed: boolean;
  signOut: () => void;
}

const ShellCtx = createContext<Ctx>({ locale: 'en', setLocale: () => {}, authed: false, signOut: () => {} });
export const useShell = () => useContext(ShellCtx);

/** Pages reachable without a session (links sent by email land here). */
const PUBLIC_PATHS = ['/login', '/forgot-password', '/reset-password', '/verify', '/github/callback', '/invite', '/auth/callback'];

export function Shell({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en');
  const [authed, setAuthed] = useState(false);
  const [ready, setReady] = useState(false);
  const [isStaff, setIsStaff] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    setLocaleState(getLocale());
    setAuthed(!!getToken());
    setReady(true);
    if (getToken()) api<{ isStaff: boolean }>('/v1/account').then((m) => setIsStaff(!!m.isStaff)).catch(() => setIsStaff(false));
  }, [pathname]);

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
    if (has && pathname === '/login') router.replace('/servers');
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

  const account = (
    <div className="flex items-center gap-3 text-sm">
      {isStaff && <Link href="/admin" className={pathname.startsWith('/admin') ? 'font-medium text-amber-700' : 'text-amber-700 hover:text-amber-900'}>Back office</Link>}
      <Link href="/support" className={pathname.startsWith('/support') ? 'font-medium' : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100'}>{t(locale, 'support')}</Link>
      <Link href="/billing" className={pathname.startsWith('/billing') ? 'font-medium' : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100'}>{t(locale, 'billing')}</Link>
      <Link href="/team" className={pathname.startsWith('/team') ? 'font-medium' : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100'}>{t(locale, 'teamNav')}</Link>
      <select className="input w-auto py-1" value={locale} onChange={(e) => setLocale(e.target.value as Locale)} aria-label="Language">
        <option value="en">EN</option>
        <option value="tr">TR</option>
        <option value="ar">AR</option>
      </select>
      <button className="btn-ghost" onClick={signOut}>{t(locale, 'signOut')}</button>
    </div>
  );

  return (
    <ShellCtx.Provider value={{ locale, setLocale, authed, signOut }}>
      <header className="border-b border-neutral-200 dark:border-neutral-800">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5">
          <Link href="/servers" className="me-2 flex items-center gap-2 font-semibold tracking-tight"><img src="/brand/progrid-mark.svg" width="19" height="24" alt="" aria-hidden className="dark:hidden" /><img src="/brand/progrid-mark-white.svg" width="19" height="24" alt="" aria-hidden className="hidden dark:block" /> Progrid</Link>
          {authed && <DesktopNav />}
          <div className="ms-auto flex items-center gap-2">
            {authed ? (
              <>
                <div className="hidden lg:block">{account}</div>
                <MobileNav extra={account} />
              </>
            ) : (
              <select className="input w-auto py-1" value={locale} onChange={(e) => setLocale(e.target.value as Locale)} aria-label="Language">
                <option value="en">EN</option>
                <option value="tr">TR</option>
                <option value="ar">AR</option>
              </select>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{ready ? children : null}</main>
    </ShellCtx.Provider>
  );
}
