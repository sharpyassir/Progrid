'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { GROUPS, Group, PRODUCTS, phaseLabel } from '@/lib/products';
import { groupDescription, groupLabel, Locale, t } from '@/lib/i18n';
import { useShell } from '@/components/shell';

const GROUP_HOME: Partial<Record<Group, string>> = {
  Projects: '/projects', 'Managed Agents': '/agents', 'Core Cloud': '/servers', Marketplace: '/apps', Security: '/firewalls',
};

/** Paths reached from the always visible header links; everything else under a product counts as "Products". */
const TOP_LINKS = ['/managed', '/support', '/billing', '/team', '/admin'];

function GroupList({ group, onNavigate, compact, columns }: { group: Group; onNavigate?: () => void; compact?: boolean; columns?: boolean }) {
  return (
    <ul className={columns ? 'grid grid-cols-2 gap-x-4 gap-y-0.5' : 'space-y-0.5'}>
      {PRODUCTS.filter((p) => p.group === group).map((p) => (
        <li key={p.slug}>
          <Link href={p.href ?? `/products/${p.slug}`} onClick={onNavigate} title={p.blurb}
            className={`flex items-center justify-between gap-3 rounded px-2 ${compact ? 'py-1' : 'py-1.5'} text-sm hover:bg-neutral-100 focus-visible:bg-neutral-100 focus-visible:outline-none dark:hover:bg-neutral-800 dark:focus-visible:bg-neutral-800 ${p.href ? '' : 'text-neutral-500'}`}>
            <span>{p.name}</span>
            {p.phase && <span className="badge shrink-0 whitespace-nowrap bg-neutral-100 text-neutral-500 dark:bg-neutral-800">{phaseLabel(p.phase)}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Open and close state for a header dropdown: closes on a route change, a click outside,
 * Escape (focus goes back to the button) and when focus leaves the dropdown. ArrowDown on the
 * button opens it and focuses the first item; ArrowDown and ArrowUp then move between items.
 */
function useDropdown() {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false); button.current?.focus(); }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const focusables = () => [...(panel.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), select') ?? [])];
  const focusFirst = useCallback(() => requestAnimationFrame(() => focusables()[0]?.focus()), []);

  const buttonProps = {
    ref: button,
    'aria-expanded': open,
    onClick: () => setOpen((o) => !o),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); focusFirst(); }
    },
  };
  const panelProps = {
    ref: panel,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      if ((e.target as HTMLElement).tagName === 'SELECT') return;
      const items = focusables();
      const i = items.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    },
  };
  const wrapProps = {
    ref: wrap,
    onBlur: (e: React.FocusEvent) => { if (e.relatedTarget && !wrap.current?.contains(e.relatedTarget as Node)) setOpen(false); },
  };
  return { open, setOpen, buttonProps, panelProps, wrapProps };
}

const Chevron = ({ open }: { open: boolean }) => (
  <svg aria-hidden width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" className={`transition ${open ? 'rotate-180' : ''}`}><path d="M3 4.5 6 7.5 9 4.5" /></svg>
);

/** Groups with many products take two columns of the panel and list them in two columns. */
const WIDE: Group[] = ['Core Cloud'];
const groupId = (g: Group) => `pg-${g.replace(/\W+/g, '-')}`;

/**
 * Desktop: one "Products" button opening a panel with every product area, a short description
 * of each and its products. Keeps the header to a single line on laptop widths.
 */
export function ProductsMenu() {
  const { locale } = useShell();
  const pathname = usePathname();
  const { open, setOpen, buttonProps, panelProps, wrapProps } = useDropdown();
  const inProducts = !TOP_LINKS.some((p) => pathname.startsWith(p)) && PRODUCTS.some((p) => p.href && pathname.startsWith(p.href.split(/[?#]/)[0]));

  return (
    <div className="relative" {...wrapProps}>
      <button id="products-menu-button" type="button" aria-controls="products-menu" {...buttonProps}
        className={`flex items-center gap-1 rounded px-2.5 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800 ${inProducts || open ? 'font-medium text-neutral-900 dark:text-neutral-100' : 'text-neutral-600 dark:text-neutral-300'}`}>
        {t(locale, 'products')}<Chevron open={open} />
      </button>
      {open && (
        <div id="products-menu" role="region" aria-label={t(locale, 'products')} {...panelProps}
          className="absolute start-0 z-30 mt-2 max-h-[calc(100vh-5rem)] w-[min(60rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border border-neutral-200 bg-white p-4 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900">
          <div className="grid grid-cols-2 gap-x-4 gap-y-5 xl:grid-cols-4">
            {GROUPS.map((g) => (
              <section key={g} aria-labelledby={groupId(g)} className={`min-w-0 ${WIDE.includes(g) ? 'col-span-2' : ''}`}>
                {GROUP_HOME[g]
                  ? <Link id={groupId(g)} href={GROUP_HOME[g]!} onClick={() => setOpen(false)} className="block rounded px-2 text-xs font-semibold uppercase tracking-wide text-blue-700 hover:underline focus-visible:underline focus-visible:outline-none dark:text-blue-400">{groupLabel(locale, g)}</Link>
                  : <h3 id={groupId(g)} className="px-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{groupLabel(locale, g)}</h3>}
                <p className="mb-1.5 mt-0.5 px-2 text-xs leading-snug text-neutral-500">{groupDescription(locale, g)}</p>
                <GroupList group={g} onNavigate={() => setOpen(false)} compact columns={WIDE.includes(g)} />
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Links that stay visible next to the Products menu (and head the mobile menu). */
export function TopLinks({ isStaff, stacked }: { isStaff: boolean; stacked?: boolean }) {
  const { locale } = useShell();
  const pathname = usePathname();
  const links: { href: string; label: string; staff?: boolean }[] = [
    { href: '/managed', label: t(locale, 'mcNav') },
    { href: '/support', label: t(locale, 'support') },
    { href: '/billing', label: t(locale, 'billing') },
    { href: '/team', label: t(locale, 'teamNav') },
    ...(isStaff ? [{ href: '/admin', label: t(locale, 'backOffice'), staff: true }] : []),
  ];
  return (
    <>
      {links.map((l) => {
        const active = pathname.startsWith(l.href);
        const tone = l.staff
          ? active ? 'font-medium text-amber-800 dark:text-amber-300' : 'text-amber-700 hover:text-amber-900 dark:text-amber-400'
          : active ? 'font-medium text-neutral-900 dark:text-neutral-100' : 'text-neutral-600 hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100';
        return <Link key={l.href} href={l.href} aria-current={active ? 'page' : undefined} className={`whitespace-nowrap rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 ${stacked ? 'block px-2 py-2 text-lg' : 'px-2.5 py-1.5 text-sm'} ${tone}`}>{l.label}</Link>;
      })}
    </>
  );
}

export interface Me { name: string; email: string; teamName: string }

/** "Faisal Al Harbi" to "FA", "Sara" to "SA", no name to the first letter of the email. */
export function initials(me: Me | null) {
  const words = (me?.name ?? '').trim().split(/\s+/).filter(Boolean);
  const s = words.length ? (words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2)) : (me?.email?.[0] ?? '?');
  return s.toUpperCase();
}

export function LanguageSelect({ id }: { id?: string }) {
  const { locale, setLocale } = useShell();
  return (
    <select id={id} className="input w-auto py-1" value={locale} onChange={(e) => setLocale(e.target.value as Locale)} aria-label={t(locale, 'language')}>
      <option value="en">English</option>
      <option value="tr">Türkçe</option>
      <option value="ar">العربية</option>
    </select>
  );
}

/** Who is signed in, the language and sign out; the account menu on desktop and the foot of the mobile menu. */
function AccountItems({ me, onNavigate }: { me: Me | null; onNavigate?: () => void }) {
  const { locale, signOut } = useShell();
  const item = 'block rounded px-2 py-1.5 text-sm hover:bg-neutral-100 focus-visible:bg-neutral-100 focus-visible:outline-none dark:hover:bg-neutral-800 dark:focus-visible:bg-neutral-800';
  return (
    <>
      {me && (
        <div className="border-b border-neutral-100 px-2 pb-2 pt-1 dark:border-neutral-800">
          <div className="truncate text-sm font-medium">{me.name}</div>
          <div className="truncate text-xs text-neutral-500" dir="ltr">{me.email}</div>
          <div className="truncate text-xs text-neutral-500">{me.teamName}</div>
        </div>
      )}
      <Link href="/security" onClick={onNavigate} className={`mt-1 ${item}`}>{t(locale, 'security')}</Link>
      <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-sm">
        <label htmlFor={onNavigate ? 'account-language' : 'mobile-language'}>{t(locale, 'language')}</label>
        <LanguageSelect id={onNavigate ? 'account-language' : 'mobile-language'} />
      </div>
      <button type="button" onClick={signOut} className={`mt-1 w-full text-start text-red-700 dark:text-red-400 ${item}`}>{t(locale, 'signOut')}</button>
    </>
  );
}

/** Account menu: the user's initials open a panel with who is signed in, the language and sign out. */
export function AccountMenu({ me }: { me: Me | null }) {
  const { locale } = useShell();
  const { open, setOpen, buttonProps, panelProps, wrapProps } = useDropdown();
  return (
    <div className="relative" {...wrapProps}>
      <button id="account-menu-button" type="button" aria-controls="account-menu" aria-label={me ? `${t(locale, 'accountMenu')}: ${me.name}` : t(locale, 'accountMenu')} {...buttonProps}
        className="flex items-center gap-1 rounded-full p-0.5 pe-1.5 text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800">
        <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-900 text-xs font-semibold text-white dark:bg-white dark:text-neutral-900">{initials(me)}</span>
        <Chevron open={open} />
      </button>
      {open && (
        <div id="account-menu" role="region" aria-label={t(locale, 'accountMenu')} {...panelProps}
          className="absolute end-0 z-30 mt-2 w-72 rounded-xl border border-neutral-200 bg-white p-2 shadow-2xl dark:border-neutral-800 dark:bg-neutral-900">
          <AccountItems me={me} onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

/**
 * Mobile: hamburger to a full height "Menu" sheet: the main links, each product group as an
 * expandable row, then the account items. Escape closes it and focus returns to the button.
 */
export function MobileNav({ isStaff, me }: { isStaff: boolean; me: Me | null }) {
  const { locale } = useShell();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Group | null>(null);
  const pathname = usePathname();
  const opener = useRef<HTMLButtonElement>(null);
  const closer = useRef<HTMLButtonElement>(null);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    closer.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); opener.current?.focus(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="lg:hidden">
      <button ref={opener} className="btn-ghost px-2" aria-label={t(locale, 'menu')} aria-expanded={open} onClick={() => setOpen(true)}>
        <svg aria-hidden width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 5h14M3 10h14M3 15h14" /></svg>
      </button>
      {open && (
        <div className="fixed inset-0 z-30 flex flex-col bg-white dark:bg-neutral-950" role="dialog" aria-modal="true" aria-label={t(locale, 'menu')}>
          <div className="flex items-center border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
            <span className="mx-auto text-lg font-semibold">{t(locale, 'menu')}</span>
            <button ref={closer} className="absolute end-4 text-2xl leading-none text-neutral-500" aria-label={t(locale, 'close')} onClick={() => { setOpen(false); opener.current?.focus(); }}>×</button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <nav className="border-b border-neutral-100 px-3 py-2 dark:border-neutral-800" aria-label={t(locale, 'menu')}><TopLinks isStaff={isStaff} stacked /></nav>
            {GROUPS.map((g) => (
              <div key={g} className="border-b border-neutral-100 dark:border-neutral-800">
                <button className="flex w-full items-center justify-between gap-3 px-5 py-3 text-start" aria-expanded={expanded === g} onClick={() => setExpanded(expanded === g ? null : g)}>
                  <span><span className="block text-lg">{groupLabel(locale, g)}</span><span className="block text-xs text-neutral-500">{groupDescription(locale, g)}</span></span>
                  <span className={`text-neutral-400 transition ${expanded === g ? 'rotate-90' : 'rtl:rotate-180'}`} aria-hidden>›</span>
                </button>
                {expanded === g && (
                  <div className="px-4 pb-3">
                    {GROUP_HOME[g] && <Link href={GROUP_HOME[g]!} onClick={() => setOpen(false)} className="mb-1 block px-2 text-xs font-medium uppercase tracking-wider text-blue-600">{groupLabel(locale, g)} <span aria-hidden className="inline-block rtl:rotate-180">→</span></Link>}
                    <GroupList group={g} onNavigate={() => setOpen(false)} />
                  </div>
                )}
              </div>
            ))}
            <div className="px-3 py-3"><AccountItems me={me} /></div>
          </div>
        </div>
      )}
    </div>
  );
}
