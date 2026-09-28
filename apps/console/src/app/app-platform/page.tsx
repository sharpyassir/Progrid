'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError, money, Price } from '@/lib/api';
import { useShell } from '@/components/shell';
import { StatusBadge } from '@/components/status-badge';
import { APP_STATUS_BADGE, AppSize, PlatformApp } from '@/lib/app-platform';

interface Installation { id: string; accountLogin: string; accountType: string; suspendedAt: string | null }
interface Repo { id: number; fullName: string; private: boolean; defaultBranch: string }

/** App Platform: push code, get a URL. Containers on shared hosts, sized and billed per instance. */
export default function AppPlatformPage() {
  const { locale } = useShell();
  const [rows, setRows] = useState<PlatformApp[]>([]);
  const [sizes, setSizes] = useState<AppSize[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [currency, setCurrency] = useState<'USD' | 'SAR'>('USD');
  const [installs, setInstalls] = useState<Installation[]>([]);
  const [installation, setInstallation] = useState('');
  const [repos, setRepos] = useState<Repo[]>([]);
  const [mode, setMode] = useState<'github' | 'url'>('url');
  const [appEnabled, setAppEnabled] = useState(false);
  const [size, setSize] = useState('app-xs');
  const [instances, setInstances] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api<{ data: PlatformApp[] }>('/v1/app-platform/apps').then((r) => setRows(r.data)), []);
  useEffect(() => {
    load();
    api<{ data: AppSize[] }>('/v1/app-platform/sizes').then((r) => setSizes(r.data));
    api<{ currency: 'USD' | 'SAR' }>('/v1/billing/balance').then(async (b) => { setCurrency(b.currency); setPrices((await api<{ data: Price[] }>(`/v1/pricing?currency=${b.currency}`)).data); }).catch(() => undefined);
    api<{ enabled: boolean }>('/v1/github/app').then(async (a) => {
      setAppEnabled(a.enabled);
      if (!a.enabled) return;
      const r = await api<{ data: Installation[] }>('/v1/github/installations').catch(() => ({ data: [] }));
      setInstalls(r.data);
      if (r.data.length) { setInstallation(r.data[0].id); setMode('github'); }
    }).catch(() => undefined);
  }, [load]);
  useEffect(() => {
    if (!installation) return;
    api<{ data: Repo[] }>(`/v1/github/installations/${installation}/repos`).then((r) => setRepos(r.data)).catch(() => undefined);
  }, [installation]);
  useEffect(() => {
    if (!rows.some((r) => ['creating', 'building', 'deleting'].includes(r.status))) return;
    const h = setInterval(load, 5000);
    return () => clearInterval(h);
  }, [rows, load]);

  const priceOf = (sku: string) => prices.find((p) => p.sku === sku)?.monthlyMinor ?? 0;

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(null);
    const f = new FormData(e.currentTarget); const form = e.currentTarget;
    const env: Record<string, string> = {};
    String(f.get('env') ?? '').split('\n').forEach((l) => { const [k, ...v] = l.split('='); if (k.trim()) env[k.trim()] = v.join('=').trim(); });
    const body = {
      name: String(f.get('name')).trim(), branch: f.get('branch') || undefined, port: Number(f.get('port') || 3000), size, instances, env, healthPath: f.get('healthPath') || undefined,
      ...(mode === 'github' ? { installationId: installation, repo: f.get('repo') } : { repoUrl: f.get('repoUrl'), gitToken: f.get('gitToken') || undefined }),
    };
    try { await api('/v1/app-platform/apps', { method: 'POST', idempotent: true, body: JSON.stringify(body) }); form.reset(); await load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : String(err)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">App Platform</h1>
        <p className="text-sm text-neutral-500">Push code, get a URL. We build your repository, run it in containers on shared hosts with TLS, and deploy again on every push. Priced per instance per month; no server to manage.</p>
      </div>
      {error && <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/30">{error}</p>}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-neutral-500"><tr><th className="px-4 py-2 text-start">App</th><th className="px-4 py-2 text-start">Status</th><th className="px-4 py-2 text-start">URL</th><th className="px-4 py-2 text-start">Source</th><th className="px-4 py-2 text-start">Size</th><th className="px-4 py-2 text-start">Last deploy</th><th className="px-4 py-2 text-start">Monthly</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td className="px-4 py-3 text-neutral-500" colSpan={7}>No apps yet.</td></tr>}
            {rows.map((a) => (
              <tr key={a.id} className="border-t border-neutral-100 dark:border-neutral-800">
                <td className="px-4 py-2 font-medium"><Link href={`/app-platform/${a.id}`} className="text-blue-600 hover:underline">{a.name}</Link></td>
                <td className="px-4 py-2"><StatusBadge status={APP_STATUS_BADGE[a.status] ?? a.status} />{a.statusMessage && <div className="mt-1 max-w-[16rem] text-xs text-red-600">{a.statusMessage}</div>}</td>
                <td className="px-4 py-2 font-mono text-xs"><a className="text-blue-600" href={a.url} target="_blank" rel="noreferrer">{a.hostname}</a></td>
                <td className="px-4 py-2 text-xs text-neutral-500">{a.repo ?? a.repoUrl}@{a.branch}{a.lastCommit ? ` · ${a.lastCommit.slice(0, 7)}` : ''}</td>
                <td className="px-4 py-2">{a.size.id} × {a.instances}</td>
                <td className="px-4 py-2 text-xs text-neutral-500">{a.lastDeployAt ? new Date(a.lastDeployAt).toLocaleString(locale) : '—'}</td>
                <td className="px-4 py-2">{money(priceOf(a.size.id) * a.instances, currency, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={create} className="card space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-medium">New app</h2>
          {appEnabled && (
            <div className="ms-auto flex rounded-md border border-neutral-300 p-0.5 text-xs dark:border-neutral-700">
              <button type="button" onClick={() => setMode('github')} className={`rounded px-3 py-1 ${mode === 'github' ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'text-neutral-600'}`}>GitHub</button>
              <button type="button" onClick={() => setMode('url')} className={`rounded px-3 py-1 ${mode === 'url' ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'text-neutral-600'}`}>Repository URL</button>
            </div>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <input className="input" name="name" placeholder="App name, becomes the hostname" pattern="[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?" maxLength={40} required />
          {mode === 'github' && installs.length > 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <select className="input" value={installation} onChange={(e) => setInstallation(e.target.value)}>{installs.map((i) => <option key={i.id} value={i.id}>{i.accountLogin}</option>)}</select>
              <select className="input" name="repo" required>{repos.map((r) => <option key={r.id} value={r.fullName}>{r.fullName}{r.private ? ' (private)' : ''}</option>)}</select>
            </div>
          ) : (
            <input className="input" name="repoUrl" type="url" placeholder="https://github.com/you/app" required />
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-5">
          <input className="input" name="branch" placeholder="Branch (main)" />
          <input className="input" name="port" type="number" placeholder="App port (3000)" min={1} max={65535} />
          <select className="input" value={size} onChange={(e) => setSize(e.target.value)}>{sizes.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.memoryMb} MB · {s.cpus} vCPU · {money(priceOf(s.id), currency, locale)}</option>)}</select>
          <select className="input" value={instances} onChange={(e) => setInstances(Number(e.target.value))}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} instance{n > 1 ? 's' : ''}</option>)}</select>
          <input className="input" name="healthPath" placeholder="Health path (/)" />
        </div>
        <textarea className="input font-mono text-xs" name="env" rows={3} placeholder={'Environment variables, one per line\nDATABASE_URL=postgres://…'} />
        {mode === 'url' && <input className="input" name="gitToken" type="password" placeholder="Token for a private repository (optional)" autoComplete="off" />}
        <div className="flex items-center gap-4 text-sm text-neutral-500"><span>{money(priceOf(size) * instances, currency, locale)} per month</span><button className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create app'}</button></div>
        <p className="text-xs text-neutral-500">A Dockerfile at the root is used as is. Without one, Node, Python, Go and static sites are detected. Or from your terminal: <code>prgd app create hello https://github.com/you/app --wait</code></p>
      </form>
    </div>
  );
}
