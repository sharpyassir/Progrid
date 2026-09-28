'use client';

import { FormEvent, Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { useShell } from '@/components/shell';
import { StatusBadge } from '@/components/status-badge';

interface Deploy { id: string; name: string; repoUrl: string; repo: string | null; source: 'github_app' | 'url'; branch: string; port: number; status: string; url: string | null; serverStatus: string; lastCommit: string | null; lastDeployAt: string | null; createdAt: string }
interface Created extends Deploy { webhook: { url: string; secret: string } | null }
interface Installation { id: string; accountLogin: string; accountType: string; suspendedAt: string | null }
interface Repo { id: number; fullName: string; private: boolean; defaultBranch: string; pushedAt: string | null }
interface Logs { status: string; commit: string | null; log: string; updatedAt: string | null; live: boolean }

/** Git Deploy: connect GitHub once, pick a repository, get a URL, push to redeploy. */
function DeploysPage() {
  const { locale } = useShell();
  const justConnected = useSearchParams().get('connected') === '1';
  const [rows, setRows] = useState<Deploy[]>([]);
  const [created, setCreated] = useState<Created | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [appEnabled, setAppEnabled] = useState(false);
  const [installs, setInstalls] = useState<Installation[]>([]);
  const [installation, setInstallation] = useState<string>('');
  const [repos, setRepos] = useState<Repo[]>([]);
  const [mode, setMode] = useState<'github' | 'url'>('url');
  const [logsFor, setLogsFor] = useState<string | null>(null);
  const [logs, setLogs] = useState<Logs | null>(null);

  const load = useCallback(() => api<{ data: Deploy[] }>('/v1/deploys').then((r) => setRows(r.data)), []);
  const loadInstalls = useCallback(async () => {
    const app = await api<{ enabled: boolean }>('/v1/github/app').catch(() => ({ enabled: false }));
    setAppEnabled(app.enabled);
    if (!app.enabled) return;
    const r = await api<{ data: Installation[] }>('/v1/github/installations').catch(() => ({ data: [] }));
    setInstalls(r.data);
    if (r.data.length) { setInstallation((cur) => cur || r.data[0].id); setMode('github'); }
  }, []);
  useEffect(() => { load(); loadInstalls(); }, [load, loadInstalls]);
  useEffect(() => {
    const id = setInterval(() => { if (rows.some((d) => ['creating', 'deploying'].includes(d.status))) load(); }, 3000);
    return () => clearInterval(id);
  }, [load, rows]);
  useEffect(() => {
    if (!installation) return;
    api<{ data: Repo[] }>(`/v1/github/installations/${installation}/repos`).then((r) => setRepos(r.data)).catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, [installation]);
  useEffect(() => {
    if (!logsFor) return;
    const fetchLogs = () => api<Logs>(`/v1/deploys/${logsFor}/logs`).then(setLogs).catch(() => undefined);
    fetchLogs();
    const id = setInterval(fetchLogs, 4000);
    return () => clearInterval(id);
  }, [logsFor]);

  async function connectGithub() {
    setError(null);
    try { const r = await api<{ url: string }>('/v1/github/connect'); window.location.href = r.url; }
    catch (err) { setError(err instanceof ApiError ? err.message : String(err)); }
  }

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(null);
    const f = new FormData(e.currentTarget);
    const env: Record<string, string> = {};
    String(f.get('env') ?? '').split('\n').forEach((l) => { const [k, ...v] = l.split('='); if (k.trim()) env[k.trim()] = v.join('=').trim(); });
    const common = { branch: f.get('branch') || undefined, port: Number(f.get('port') || 3000), size: f.get('size') || undefined, env };
    const body = mode === 'github'
      ? { ...common, installationId: installation, repo: f.get('repo'), branch: f.get('branch') || repos.find((r) => r.fullName === f.get('repo'))?.defaultBranch || 'main' }
      : { ...common, repoUrl: f.get('repoUrl'), gitToken: f.get('gitToken') || undefined, branch: f.get('branch') || 'main' };
    try {
      const r = await api<Created>('/v1/deploys', { method: 'POST', idempotent: true, body: JSON.stringify(body) });
      setCreated(r); e.currentTarget.reset(); load();
    } catch (err) { setError(err instanceof ApiError ? err.message : String(err)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Git Deploy</h1>
        <p className="text-sm text-neutral-500">Link a repository with a Dockerfile or docker-compose.yml. We build it on a server in Saudi Arabia and redeploy on every push.</p>
      </div>
      {justConnected && <p className="rounded border border-green-200 bg-green-50 p-2 text-sm text-green-800 dark:bg-green-950/30">GitHub is connected. Pick a repository below.</p>}
      {error && <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/30">{error}</p>}

      {created?.webhook && (
        <div className="card border-blue-300 text-sm dark:border-blue-800">
          <div className="font-medium">Add this webhook in GitHub → Settings → Webhooks so pushes redeploy (secret shown once):</div>
          <dl className="mt-2 grid gap-1 font-mono text-xs sm:grid-cols-[110px_1fr]">
            <dt className="text-neutral-500">Payload URL</dt><dd className="select-all break-all">{created.webhook.url}</dd>
            <dt className="text-neutral-500">Content type</dt><dd>application/json</dd>
            <dt className="text-neutral-500">Secret</dt><dd className="select-all break-all">{created.webhook.secret}</dd>
            <dt className="text-neutral-500">Events</dt><dd>push</dd>
          </dl>
        </div>
      )}
      {created && !created.webhook && <p className="card text-sm">Deployment started. Pushes to <span className="font-mono">{created.repo}@{created.branch}</span> redeploy automatically through the GitHub App.</p>}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-neutral-500"><tr><th className="px-4 py-2 text-start">App</th><th className="px-4 py-2 text-start">Status</th><th className="px-4 py-2 text-start">URL</th><th className="px-4 py-2 text-start">Repo</th><th className="px-4 py-2 text-start">Last deploy</th><th /></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td className="px-4 py-3 text-neutral-500" colSpan={6}>No deployments yet.</td></tr>}
            {rows.map((d) => (
              <tr key={d.id} className="border-t border-neutral-100 dark:border-neutral-800">
                <td className="px-4 py-2 font-medium">{d.name}</td>
                <td className="px-4 py-2"><StatusBadge status={d.status === 'live' ? 'active' : d.status} /></td>
                <td className="px-4 py-2 font-mono text-xs">{d.url ? <a className="text-blue-600" href={d.url} target="_blank" rel="noreferrer">{d.url}</a> : '—'}</td>
                <td className="px-4 py-2 text-xs text-neutral-500">{d.repo ?? d.repoUrl}@{d.branch}{d.lastCommit ? ` · ${d.lastCommit.slice(0, 7)}` : ''} {d.source === 'github_app' && <span className="badge bg-neutral-100 text-neutral-600 dark:bg-neutral-800">app</span>}</td>
                <td className="px-4 py-2 text-xs text-neutral-500">{d.lastDeployAt ? new Date(d.lastDeployAt).toLocaleString(locale) : '—'}</td>
                <td className="px-4 py-2 text-end whitespace-nowrap">
                  <button className="btn-ghost me-1" onClick={() => { setLogsFor(logsFor === d.id ? null : d.id); setLogs(null); }}>{logsFor === d.id ? 'Hide logs' : 'Logs'}</button>
                  <button className="btn-ghost" disabled={d.serverStatus !== 'active'} onClick={() => api(`/v1/deploys/${d.id}/redeploy`, { method: 'POST', idempotent: true }).then(load)}>Redeploy</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {logsFor && (
          <div className="border-t border-neutral-200 p-4 dark:border-neutral-800">
            <div className="mb-2 flex items-center gap-3 text-xs text-neutral-500">
              <span className="font-medium text-neutral-700 dark:text-neutral-200">Build log</span>
              {logs && <><StatusBadge status={logs.status === 'live' ? 'active' : logs.status} />{logs.commit && <span className="font-mono">{logs.commit.slice(0, 7)}</span>}<span>{logs.live ? 'live from the server' : logs.updatedAt ? `cached ${new Date(logs.updatedAt).toLocaleString(locale)}` : 'no log yet'}</span></>}
            </div>
            <pre className="max-h-96 overflow-auto rounded bg-neutral-950 p-3 font-mono text-xs leading-relaxed text-neutral-100">{logs ? logs.log || 'The server has not written a build log yet. Logs appear once the first build starts.' : 'Loading…'}</pre>
          </div>
        )}
      </div>

      <form onSubmit={create} className="card space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="font-medium">Deploy a repository</h2>
          {appEnabled && (
            <div className="ms-auto flex rounded-md border border-neutral-300 p-0.5 text-xs dark:border-neutral-700">
              <button type="button" onClick={() => setMode('github')} className={`rounded px-3 py-1 ${mode === 'github' ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'text-neutral-600'}`}>GitHub</button>
              <button type="button" onClick={() => setMode('url')} className={`rounded px-3 py-1 ${mode === 'url' ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'text-neutral-600'}`}>Repository URL</button>
            </div>
          )}
        </div>
        {mode === 'github' ? (
          installs.length === 0 ? (
            <div className="rounded-md border border-dashed border-neutral-300 p-4 text-sm dark:border-neutral-700">
              <p className="mb-3 text-neutral-600 dark:text-neutral-300">Install the Progrid GitHub App on your account or organization. You choose which repositories it can see. Private repositories work without any token, and every push redeploys.</p>
              <button type="button" className="btn-primary" onClick={connectGithub}>Connect GitHub</button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <select className="input" value={installation} onChange={(e) => setInstallation(e.target.value)}>
                {installs.map((i) => <option key={i.id} value={i.id}>{i.accountLogin} ({i.accountType.toLowerCase()})</option>)}
              </select>
              <select className="input" name="repo" required>
                {repos.length === 0 && <option value="">Loading repositories…</option>}
                {repos.map((r) => <option key={r.id} value={r.fullName}>{r.fullName}{r.private ? ' (private)' : ''}</option>)}
              </select>
              <p className="text-xs text-neutral-500 sm:col-span-2">Missing a repository? <button type="button" className="text-blue-600 hover:underline" onClick={connectGithub}>Change which repositories the app can see</button>.</p>
            </div>
          )
        ) : (
          <input className="input" name="repoUrl" type="url" placeholder="https://github.com/you/app" required />
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <input className="input" name="branch" placeholder={mode === 'github' ? 'Branch (default branch)' : 'main'} />
          <input className="input" name="port" type="number" placeholder="App port (3000)" min={1} max={65535} />
          <select className="input" name="size" defaultValue=""><option value="">Starter, 1 vCPU 2 GB (default)</option><option value="s-2vcpu-4gb">Standard, 2 vCPU 4 GB</option><option value="s-4vcpu-8gb">Pro, 4 vCPU 8 GB</option><option value="s-8vcpu-16gb">Business, 8 vCPU 16 GB</option></select>
        </div>
        <textarea className="input font-mono text-xs" name="env" rows={3} placeholder={'Environment variables, one per line\nDATABASE_URL=postgres://…'} />
        {mode === 'url' && <input className="input" name="gitToken" type="password" placeholder="GitHub token for private repos (optional, never stored by us)" autoComplete="off" />}
        <button className="btn-primary" disabled={busy || (mode === 'github' && !installation)}>{busy ? 'Creating…' : 'Deploy'}</button>
        <p className="text-xs text-neutral-500">Or from your terminal: <code>prgd deploy https://github.com/you/app --wait</code></p>
      </form>
    </div>
  );
}

export default function Page() {
  return <Suspense><DeploysPage /></Suspense>;
}
