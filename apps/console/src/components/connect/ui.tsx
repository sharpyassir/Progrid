'use client';

/** Small building blocks shared by the Connect pages. They reuse the console classes (card, btn-*, input, badge). */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { DependencyList, ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useShell } from '@/components/shell';
import { cdyn, CKey, ct, ctf, CStringKey } from '@/lib/i18n-connect';
import { pretty } from '@/lib/connect';

export function useC() {
  const { locale } = useShell();
  return {
    locale,
    c: (k: CStringKey) => ct(locale, k),
    cf: <K extends CKey>(k: K) => ctf(locale, k),
    cd: (prefix: string, v: string) => cdyn(locale, prefix, v),
  };
}

/** Load data with error state; `reload` refetches. */
export function useLoad<T>(fn: () => Promise<T>, deps: DependencyList) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const reload = useCallback(async () => {
    try { setData(await run()); setError(null); } catch (e) { setError(e); }
  }, [run]);
  useEffect(() => { reload(); }, [reload]);
  return { data, setData, error, reload };
}

/** Run an action with busy and error state. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true); setError(null);
    try { return await fn(); } catch (e) { setError(e); return undefined; } finally { setBusy(false); }
  }, []);
  return { busy, error, setError, run };
}

/** Errors in the person's language. 401, 402 and 403 get a clear next step. */
export function ErrorBox({ error, className = '' }: { error: unknown; className?: string }) {
  const { c } = useC();
  if (!error) return null;
  const e = error instanceof ApiError ? error : null;
  const plain = (error as { message?: unknown }).message;
  let body: ReactNode = e?.message || (typeof plain === 'string' && plain && !(error instanceof TypeError) ? plain : c('errGeneric'));
  if (e?.status === 401) body = <>{c('err401')} <Link href="/login" className="font-medium underline">{c('signIn')}</Link></>;
  else if (e?.status === 403) body = c('err403');
  else if (e?.status === 402 || e?.code === 'payment_required' || e?.code === 'spend_limit_reached') body = <>{c('err402')} <Link href="/billing" className="font-medium underline">{c('goBilling')}</Link></>;
  else if (e?.status === 429) body = c('err429');
  else if (e?.status === 404 && !e.message) body = c('errNotFound');
  return <div role="alert" className={`rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300 ${className}`}>{body}</div>;
}

export function Notice({ children, tone = 'green' }: { children: ReactNode; tone?: 'green' | 'amber' | 'blue' }) {
  const cls = { green: 'border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300', amber: 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200', blue: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200' }[tone];
  return <div role="status" className={`rounded-md border p-3 text-sm ${cls}`}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-5">
      {back && <Link href={back.href} className="text-sm text-neutral-500 hover:underline"><span aria-hidden className="inline-block rtl:rotate-180">←</span> {back.label}</Link>}
      <div className="mt-1 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-neutral-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

const SUBNAV: { href: string; key: CStringKey }[] = [
  { href: '/connect', key: 'nOverview' }, { href: '/connect/agents', key: 'nAgents' }, { href: '/connect/workflows', key: 'nWorkflows' },
  { href: '/connect/connections', key: 'nConnections' }, { href: '/connect/webhooks', key: 'nWebhooks' }, { href: '/connect/logs', key: 'nLogs' },
  { href: '/connect/usage', key: 'nUsage' }, { href: '/connect/keys', key: 'nKeys' }, { href: '/connect/templates', key: 'nTemplates' },
];

/** Section links across the top of every Connect page; scrolls sideways on phones. */
export function ConnectNav() {
  const { c } = useC();
  const pathname = usePathname();
  return (
    <div className="mb-6 border-b border-neutral-200 dark:border-neutral-800">
      <div className="flex items-center gap-3 pb-2">
        <span className="flex items-center gap-2 text-sm font-semibold"><ConnectMark /> {c('product')}</span>
        <span className="hidden text-xs text-neutral-500 sm:inline">{c('tagline')}</span>
      </div>
      <nav aria-label={c('connectSections')} className="-mb-px flex gap-1 overflow-x-auto text-sm">
        {SUBNAV.map((l) => {
          const active = l.href === '/connect' ? pathname === '/connect' : pathname.startsWith(l.href);
          return (
            <Link key={l.href} href={l.href} aria-current={active ? 'page' : undefined}
              className={`whitespace-nowrap border-b-2 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${active ? 'border-blue-600 font-medium' : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100'}`}>
              {c(l.key)}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function ConnectMark({ size = 18 }: { size?: number }) {
  return (
    <svg aria-hidden width={size} height={size} viewBox="0 0 24 24" fill="none" className="text-blue-600 dark:text-blue-400">
      <circle cx="5" cy="12" r="2.5" fill="currentColor" /><circle cx="19" cy="5" r="2.5" fill="currentColor" /><circle cx="19" cy="19" r="2.5" fill="currentColor" />
      <path d="M7.5 12h4l5-6M11.5 12l5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const TONE: Record<string, string> = {
  deployed: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300', succeeded: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300', ok: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300', error: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  paused: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200', waiting_approval: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200',
  running: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300', queued: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
};
export function Status({ status }: { status: string }) {
  const { cd } = useC();
  const pulse = status === 'running' || status === 'queued' ? ' animate-pulse' : '';
  return <span className={`badge whitespace-nowrap ${TONE[status] ?? 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'}${pulse}`}>{cd('st_', status)}</span>;
}

export function CopyButton({ text, label, className = '' }: { text: string; label?: string; className?: string }) {
  const { c } = useC();
  const [done, setDone] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard blocked: the text stays selectable */ }
    setDone(true); setTimeout(() => setDone(false), 1500);
  }
  return (
    <button type="button" onClick={copy} className={`btn-ghost px-2 py-1 text-xs ${className}`} aria-label={label ? `${c('copy')} ${label}` : c('copy')}>
      <span aria-live="polite">{done ? c('copied') : c('copy')}</span>
    </button>
  );
}

/** Monospace value that always reads left to right, with a copy button. */
export function CopyField({ value, label }: { value: string; label?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <code dir="ltr" className="min-w-0 flex-1 truncate rounded bg-neutral-100 px-2 py-1 font-mono text-xs dark:bg-neutral-800" title={value}>{value}</code>
      <CopyButton text={value} label={label} />
    </div>
  );
}

export function CodeBlock({ code, label, maxH = 'max-h-96' }: { code: string; label?: string; maxH?: string }) {
  return (
    <div className="relative min-w-0">
      <pre dir="ltr" className={`${maxH} overflow-auto rounded-md bg-neutral-950 p-3 pe-16 text-start font-mono text-xs leading-relaxed text-neutral-100`}><code>{code}</code></pre>
      <div className="absolute end-2 top-2"><CopyButton text={code} label={label} className="border-neutral-700 bg-neutral-900 text-neutral-200 hover:bg-neutral-800" /></div>
    </div>
  );
}

export const Json = ({ value, label, maxH }: { value: unknown; label?: string; maxH?: string }) => <CodeBlock code={value === undefined ? '' : pretty(value)} label={label} maxH={maxH} />;

/** Label, control and hint, wired with ids for screen readers. */
export function Field({ label, hint, children, error, className = '' }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; className?: string; children: (id: string, describedBy?: string) => ReactNode }) {
  const id = useId();
  const hintId = hint || error ? `${id}-hint` : undefined;
  return (
    <div className={`min-w-0 ${className}`}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">{label}</label>
      {children(id, hintId)}
      {(hint || error) && <p id={hintId} className={`mt-1 text-xs ${error ? 'text-red-700 dark:text-red-400' : 'text-neutral-500'}`}>{error || hint}</p>}
    </div>
  );
}

/** A JSON textarea that keeps the text and reports parse errors. */
export function JsonInput({ label, hint, value, onChange, rows = 6 }: { label: ReactNode; hint?: ReactNode; value: string; onChange: (text: string) => void; rows?: number }) {
  const { c } = useC();
  let bad = false;
  if (value.trim()) { try { JSON.parse(value); } catch { bad = true; } }
  return (
    <Field label={label} hint={hint} error={bad ? c('errBadJson') : undefined}>
      {(id, d) => <textarea id={id} aria-describedby={d} aria-invalid={bad} dir="ltr" spellCheck={false} rows={rows} className="input text-start font-mono text-xs" value={value} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

/** Rows of name and value, for headers and query parameters. */
export function KeyValueEditor({ label, value, onChange, keyPh = 'Name', valuePh = 'Value' }: { label: string; value: Record<string, string>; onChange: (v: Record<string, string>) => void; keyPh?: string; valuePh?: string }) {
  const { c } = useC();
  const [rows, setRows] = useState<[string, string][]>(() => Object.entries(value ?? {}));
  const update = (next: [string, string][]) => { setRows(next); onChange(Object.fromEntries(next.filter(([k]) => k.trim()))); };
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <div className="space-y-2">
        {rows.map(([k, v], i) => (
          <div key={i} className="flex gap-2">
            <input dir="ltr" aria-label={`${label} ${c('key')} ${i + 1}`} className="input min-w-0 flex-1 font-mono text-xs" placeholder={keyPh} value={k} onChange={(e) => update(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} />
            <input dir="ltr" aria-label={`${label} ${c('value')} ${i + 1}`} className="input min-w-0 flex-1 font-mono text-xs" placeholder={valuePh} value={v} onChange={(e) => update(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} />
            <button type="button" className="btn-ghost px-2" aria-label={`${c('remove')} ${k || i + 1}`} onClick={() => update(rows.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button type="button" className="btn-ghost text-xs" onClick={() => setRows([...rows, ['', '']])}>+ {c('addRow')}</button>
      </div>
    </fieldset>
  );
}

/** Password style input for write-only secrets. Shows the saved hint, never the value. */
export function SecretInput({ label, hint, value, onChange, required }: { label: string; hint?: string; value: string; onChange: (v: string) => void; required?: boolean }) {
  const { cf, c } = useC();
  return (
    <Field label={label} hint={hint ? cf('secretKept')(hint) : c('secretWriteOnlyNote')}>
      {(id, d) => <input id={id} aria-describedby={d} type="password" autoComplete="new-password" dir="ltr" className="input font-mono" value={value} required={required && !hint} placeholder={hint ?? ''} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

/** Side panel on desktop, full screen sheet on phones. Escape closes; focus moves in and back. */
export function Drawer({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; wide?: boolean }) {
  const { c } = useC();
  const panel = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); (opener.current as HTMLElement | null)?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
      <button type="button" aria-label={c('close')} tabIndex={-1} className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div ref={panel} tabIndex={-1} className={`relative flex h-full w-full flex-col bg-white shadow-2xl outline-none dark:bg-neutral-950 ${wide ? 'sm:max-w-3xl' : 'sm:max-w-xl'}`}>
        <div className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
          <h2 className="min-w-0 flex-1 truncate font-semibold">{title}</h2>
          <button type="button" className="btn-ghost px-2" onClick={onClose} aria-label={c('close')}>×</button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

/** Accessible tab list: arrow keys move between tabs. */
export function TabBar<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const rtl = document.documentElement.dir === 'rtl';
    const fwd = rtl ? 'ArrowLeft' : 'ArrowRight';
    const bwd = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (e.key !== fwd && e.key !== bwd) return;
    e.preventDefault();
    const n = (i + (e.key === fwd ? 1 : -1) + tabs.length) % tabs.length;
    refs.current[n]?.focus();
    onChange(tabs[n].id);
  };
  return (
    <div role="tablist" aria-label={label} className="mb-5 flex gap-1 overflow-x-auto border-b border-neutral-200 text-sm dark:border-neutral-800">
      {tabs.map((t, i) => (
        <button key={t.id} ref={(el) => { refs.current[i] = el; }} role="tab" type="button" id={`tab-${t.id}`} aria-selected={value === t.id} aria-controls={`panel-${t.id}`} tabIndex={value === t.id ? 0 : -1}
          onKeyDown={(e) => onKey(e, i)} onClick={() => onChange(t.id)}
          className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${value === t.id ? 'border-blue-600 font-medium' : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100'}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Small segmented switch, e.g. Message or JSON, or code languages. */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-md border border-neutral-300 p-0.5 text-sm dark:border-neutral-700">
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}
          className={`whitespace-nowrap rounded px-3 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${value === o.id ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <button id={id} type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} aria-describedby={hint ? `${id}-h` : undefined}
        className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:opacity-50 ${checked ? 'bg-blue-600' : 'bg-neutral-300 dark:bg-neutral-700'}`}>
        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition ${checked ? 'translate-x-4 rtl:-translate-x-4' : 'translate-x-0.5 rtl:-translate-x-0.5'}`} />
      </button>
      <label htmlFor={id} className="text-sm">
        <span className="font-medium">{label}</span>
        {hint && <span id={`${id}-h`} className="block text-xs text-neutral-500">{hint}</span>}
      </label>
    </div>
  );
}

/** One time secret: shown right after creation with a copy button, never again. */
export function SecretOnce({ secret, onDone }: { secret: string; onDone: () => void }) {
  const { c } = useC();
  return (
    <div role="status" className="rounded-md border border-blue-300 bg-blue-50 p-3 text-sm dark:border-blue-800 dark:bg-blue-950/30">
      <p className="mb-2 font-medium">{c('keyShownOnce')}</p>
      <CopyField value={secret} />
      <button type="button" className="btn-ghost mt-2 text-xs" onClick={onDone}>{c('close')}</button>
    </div>
  );
}

/** The four step guide: Create Agent, Connect Tools, Test, Deploy. */
export function FourSteps({ done, links }: { done?: boolean[]; links?: (string | undefined)[] }) {
  const { c, cf } = useC();
  const steps: [CStringKey, CStringKey][] = [['step1', 'step1d'], ['step2', 'step2d'], ['step3', 'step3d'], ['step4', 'step4d']];
  return (
    <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map(([t, d], i) => {
        const isDone = done?.[i];
        const inner = (
          <>
            <div className="flex items-center gap-2">
              <span aria-hidden className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${isDone ? 'bg-green-600 text-white' : 'bg-blue-600 text-white'}`}>{isDone ? '✓' : i + 1}</span>
              <span className="sr-only">{cf('stepN')(i + 1)}</span>
              <span className="font-medium">{c(t)}</span>
              {isDone && <span className="badge ms-auto bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">{c('stepDone')}</span>}
            </div>
            <p className="mt-2 text-sm text-neutral-500">{c(d)}</p>
          </>
        );
        const href = links?.[i];
        return (
          <li key={t} className="min-w-0">
            {href
              ? <Link href={href} className="card block h-full hover:border-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:border-blue-700">{inner}</Link>
              : <div className="card h-full">{inner}</div>}
          </li>
        );
      })}
    </ol>
  );
}

export function Empty({ title, body, action }: { title: ReactNode; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card py-10 text-center">
      <p className="font-medium">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-sm text-neutral-500">{body}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** Scrollable table wrapper so wide tables scroll inside the card, not the page. */
export function TableCard({ children }: { children: ReactNode }) {
  return <div className="card overflow-x-auto p-0"><table className="w-full text-sm">{children}</table></div>;
}
export const Th = ({ children, end }: { children?: ReactNode; end?: boolean }) => <th scope="col" className={`whitespace-nowrap px-4 py-2 text-xs font-medium uppercase text-neutral-500 rtl:normal-case ${end ? 'text-end' : 'text-start'}`}>{children}</th>;
export const Td = ({ children, className = '' }: { children?: ReactNode; className?: string }) => <td className={`px-4 py-2 align-middle ${className}`}>{children}</td>;

/** Agent status as a colored dot and a word, for cards and lists. */
export function AgentStatusDot({ status }: { status: string }) {
  const { cd } = useC();
  const color = status === 'deployed' ? 'bg-green-500' : status === 'paused' ? 'bg-amber-500' : 'bg-neutral-400';
  return <span className="flex shrink-0 items-center gap-1.5 text-xs text-neutral-500"><span aria-hidden className={`h-2 w-2 rounded-full ${color}`} />{cd('st_', status)}</span>;
}
