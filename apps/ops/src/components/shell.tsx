'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, onUnauthorized, post } from '@/lib/api';
import { getLocale, RTL, saveLocale, translate, type Key, type Locale } from '@/lib/i18n';
import { clearSession, getSession } from '@/lib/session';
import type { Me } from '@/lib/types';
import { Ctx, useShell, type ShellCtx, type ToastKind, type Vars } from './ctx';
import { Elapsed, errText } from './ui';

/** Pages reachable without a session (links from the welcome and reset mails land here). */
const PUBLIC_PATHS = ['/login', '/set-password', '/forgot-password'];
/** Full screen pages without the navigation. */
const BARE_PATHS = ['/terminal'];

const NAV: { href: string; key: Key; externalOnly?: boolean }[] = [
  { href: '/', key: 'navShift' },
  { href: '/alerts', key: 'navAlerts' },
  { href: '/tickets', key: 'navTickets' },
  { href: '/access', key: 'navAccess' },
  { href: '/maintenance', key: 'navMaintenance' },
  { href: '/timesheet', key: 'navTimesheet' },
  { href: '/runbooks', key: 'navRunbooks' },
  { href: '/postmortems', key: 'navPostmortems' },
  { href: '/handover', key: 'navHandover' },
  { href: '/payouts', key: 'navPayouts', externalOnly: true },
  { href: '/security', key: 'navSecurity' },
];

/** Heartbeats go at most this often, and only after the engineer did something in the app. */
const HEARTBEAT_MS = 60_000;

interface Toast { id: number; message: string; kind: ToastKind }

export function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [locale, setLocaleState] = useState<Locale>('en');
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const isPublic = PUBLIC_PATHS.includes(pathname);
  const bare = BARE_PATHS.some((p) => pathname.startsWith(p));

  const t = useCallback((key: Key, vars?: Vars) => translate(locale, key, vars), [locale]);

  const toast = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-4), { id, message, kind }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), kind === 'error' ? 8000 : 5000);
  }, []);

  const toLogin = useCallback(
    (expired: boolean) => {
      setAuthed(false);
      setMe(null);
      const next = typeof window !== 'undefined' ? window.location.pathname + window.location.search : '/';
      router.replace(`/login?${expired ? 'expired=1&' : ''}next=${encodeURIComponent(next)}`);
    },
    [router],
  );

  useEffect(() => {
    setLocaleState(getLocale());
    setReady(true);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = RTL[locale] ? 'rtl' : 'ltr';
  }, [locale]);

  // Sign in guard: read the session directly, state can lag one render behind a route change.
  useEffect(() => {
    if (!ready) return;
    const s = getSession();
    setAuthed(!!s);
    if (!s && !isPublic) toLogin(false);
  }, [ready, pathname, isPublic, toLogin]);

  useEffect(() => {
    onUnauthorized(() => toLogin(true));
    return () => onUnauthorized(null);
  }, [toLogin]);

  // The session lasts twelve hours; leave when it ends even if nothing calls the API.
  useEffect(() => {
    const s = getSession();
    if (!authed || !s) return;
    const ms = new Date(s.expiresAt).getTime() - Date.now();
    const id = setTimeout(() => {
      clearSession();
      toLogin(true);
    }, Math.max(0, Math.min(ms, 2 ** 31 - 1)));
    return () => clearTimeout(id);
  }, [authed, toLogin]);

  const reloadMe = useCallback(async () => {
    if (!getSession()) return;
    try {
      setMe(await api<Me>('/ops/v1/me'));
    } catch {
      /* 401 is handled by the client; other errors keep the last answer */
    }
  }, []);

  useEffect(() => {
    if (!authed || isPublic) return;
    void reloadMe();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void reloadMe();
    }, 30_000);
    return () => clearInterval(id);
  }, [authed, isPublic, pathname, reloadMe]);

  // Activity heartbeat: keeps the running timer from going idle while the engineer works here.
  const lastInput = useRef(0);
  const lastBeat = useRef(0);
  useEffect(() => {
    if (!authed || isPublic) return;
    const mark = () => {
      lastInput.current = Date.now();
    };
    const events = ['keydown', 'pointerdown', 'wheel', 'touchstart', 'scroll'] as const;
    events.forEach((e) => window.addEventListener(e, mark, { passive: true, capture: true }));
    const id = setInterval(() => {
      const now = Date.now();
      if (document.visibilityState !== 'visible' || now - lastInput.current > HEARTBEAT_MS || now - lastBeat.current < HEARTBEAT_MS) return;
      lastBeat.current = now;
      const m = /^\/tickets\/([^/]+)/.exec(window.location.pathname);
      post('/ops/v1/activity', m ? { ticketId: m[1] } : {}).catch(() => undefined);
    }, 10_000);
    return () => {
      clearInterval(id);
      events.forEach((e) => window.removeEventListener(e, mark, { capture: true }));
    };
  }, [authed, isPublic]);

  const setLocale = useCallback((l: Locale) => {
    saveLocale(l);
    setLocaleState(l);
  }, []);

  const signOut = useCallback(() => {
    post('/ops/v1/auth/logout').catch(() => undefined);
    clearSession();
    setAuthed(false);
    setMe(null);
    router.replace('/login');
  }, [router]);

  const ctx = useMemo<ShellCtx>(() => {
    const byId = new Map((me?.contracts ?? []).map((c) => [c.id, c]));
    return {
      locale, setLocale, t, me, reloadMe, toast, signOut,
      tz: me?.engineer.timezone ?? getSession()?.engineer.timezone,
      contractTz: (id) => (id ? byId.get(id)?.timeZone : undefined),
      contractName: (id) => (id ? byId.get(id)?.customer ?? '' : ''),
    };
  }, [locale, setLocale, t, me, reloadMe, toast, signOut]);

  const toastView = (
    <div className="pointer-events-none fixed bottom-4 end-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} dir="auto" role={x.kind === 'error' ? 'alert' : 'status'} className={`pointer-events-auto text-start rounded-md px-3 py-2 text-sm shadow-lg ${x.kind === 'error' ? 'bg-red-600 text-white' : x.kind === 'success' ? 'bg-green-700 text-white' : 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'}`}>
          {x.message}
        </div>
      ))}
    </div>
  );

  const langSelect = (
    <select className="input w-auto max-w-[7rem] py-1 pe-8" value={locale} onChange={(e) => setLocale(e.target.value as Locale)} aria-label={t('language')}>
      <option value="en">English</option>
      <option value="ar">العربية</option>
    </select>
  );

  const logo = (
    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <img src="/brand/progrid-mark.svg" width="19" height="24" alt="" aria-hidden className="dark:hidden" />
      <img src="/brand/progrid-mark-white.svg" width="19" height="24" alt="" aria-hidden className="hidden dark:block" />
      <span className="hidden sm:inline">Progrid</span>
      <span className="rounded bg-neutral-900 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white dark:bg-white dark:text-neutral-900">Ops</span>
    </Link>
  );

  if (!ready) return null;

  if (isPublic) {
    return (
      <Ctx.Provider value={ctx}>
        <header className="border-b border-neutral-200 dark:border-neutral-800">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">{logo}<div className="ms-auto">{langSelect}</div></div>
        </header>
        <main className="mx-auto max-w-md px-4 py-10">{children}</main>
        {toastView}
      </Ctx.Provider>
    );
  }

  if (!authed) return null;

  if (bare) {
    return (
      <Ctx.Provider value={ctx}>
        {children}
        {toastView}
      </Ctx.Provider>
    );
  }

  const active = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`));
  const nav = NAV.filter((n) => !n.externalOnly || me?.engineer.kind !== 'INTERNAL');
  const shift = me?.currentShift;
  const onCall = !!shift?.startedAt && !shift.endedAt;

  return (
    <Ctx.Provider value={ctx}>
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/95 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/95">
          <div className="flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
            {logo}
            <div className="ms-auto flex min-w-0 items-center gap-2 text-sm">
              <span className={`hidden items-center gap-1.5 whitespace-nowrap sm:flex ${onCall ? 'text-green-700 dark:text-green-400' : 'text-neutral-500'}`}>
                <span className={`inline-block h-2 w-2 rounded-full ${onCall ? 'bg-green-500' : 'bg-neutral-400'}`} />
                {onCall ? t('onCallNow') : t('offCall')}
              </span>
              {me?.runningTimer && (
                <Link href={me.runningTimer.ticketId ? `/tickets/${me.runningTimer.ticketId}` : '/timesheet'} className="badge flex items-center gap-1 bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300" title={t('timerRunning')}>
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-600" />
                  <Elapsed from={me.runningTimer.startedAt} />
                </Link>
              )}
              <span className="hidden whitespace-nowrap text-neutral-600 md:inline dark:text-neutral-300">{me?.user.name ?? getSession()?.user.name}</span>
              {langSelect}
              <button className="btn-ghost whitespace-nowrap" onClick={signOut}>{t('signOut')}</button>
            </div>
          </div>
          <nav className="flex gap-1 overflow-x-auto border-t border-neutral-100 px-2 py-1.5 lg:hidden dark:border-neutral-900" aria-label={t('menu')}>
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className={`whitespace-nowrap rounded-md px-2.5 py-1 text-sm ${active(n.href) ? 'bg-neutral-100 font-medium dark:bg-neutral-800' : 'text-neutral-600 dark:text-neutral-300'}`}>{t(n.key)}</Link>
            ))}
          </nav>
        </header>
        <div className="flex flex-1">
          <nav className="hidden w-52 shrink-0 border-e border-neutral-200 px-2 py-4 lg:block dark:border-neutral-800" aria-label={t('menu')}>
            <ul className="space-y-0.5">
              {nav.map((n) => (
                <li key={n.href}>
                  <Link href={n.href} className={`flex items-center justify-between rounded-md px-3 py-1.5 text-sm ${active(n.href) ? 'bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-white' : 'text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-900'}`}>
                    {t(n.key)}
                    {n.href === '/' && !!me?.openPages.length && <span className="badge bg-red-600 text-white">{me.openPages.length}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <main className="min-w-0 flex-1 px-4 py-6 lg:px-8">
            <IdleBanner />
            {children}
          </main>
        </div>
      </div>
      {toastView}
    </Ctx.Provider>
  );
}

/** The API marks the running timer when it saw no activity for the idle prompt time. */
function IdleBanner() {
  const { me, t, reloadMe, toast } = useShell();
  const [busy, setBusy] = useState(false);
  const timer = me?.runningTimer;
  if (!timer?.promptedAt) return null;
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok, 'success');
      await reloadMe();
    } catch (e) {
      toast(errText(e, t), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div role="alert" className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
      <p className="flex-1">{t('idlePrompt')}</p>
      <button className="btn-primary" disabled={busy} onClick={() => act(() => post('/ops/v1/activity', timer.ticketId ? { ticketId: timer.ticketId } : {}), t('idleKept'))}>{t('idleKeep')}</button>
      <button className="btn-ghost" disabled={busy} onClick={() => act(() => post('/ops/v1/timers/stop', {}), t('timerStopped'))}>{t('stopTimer')}</button>
    </div>
  );
}

