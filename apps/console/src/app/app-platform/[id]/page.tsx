'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useShell } from '@/components/shell';
import { StatusBadge } from '@/components/status-badge';
import { APP_STATUS_BADGE, AppSize, PlatformApp } from '@/lib/app-platform';
import { RunConsole } from '@/components/app-platform/run-console';
import { DatabaseLinks } from '@/components/app-platform/database-links';
import { regionLabel } from '@/lib/i18n';

interface Logs { id: string; type: string; log: string; live: boolean; updatedAt: string }

export default function PlatformAppPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { locale } = useShell();
  const [a, setA] = useState<PlatformApp | null>(null);
  const [sizes, setSizes] = useState<AppSize[]>([]);
  const [logs, setLogs] = useState<Logs | null>(null);
  const [logType, setLogType] = useState<'build' | 'runtime'>('build');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setA(await api<PlatformApp>(`/v1/app-platform/apps/${id}`)); }
    catch (err) { if (err instanceof ApiError && err.status === 404) router.replace('/app-platform'); else setError(err instanceof ApiError ? err.message : String(err)); }
  }, [id, router]);
  useEffect(() => { load(); api<{ data: AppSize[] }>('/v1/app-platform/sizes').then((r) => setSizes(r.data)); const h = setInterval(load, 5000); return () => clearInterval(h); }, [load]);
  useEffect(() => {
    const fetchLogs = () => api<Logs>(`/v1/app-platform/apps/${id}/logs?type=${logType}`).then(setLogs).catch(() => undefined);
    fetchLogs();
    const h = setInterval(fetchLogs, 5000);
    return () => clearInterval(h);
  }, [id, logType]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); await load(); } catch (err) { setError(err instanceof ApiError ? err.message : String(err)); } finally { setBusy(false); }
  }
  if (!a) return <p className="text-sm text-neutral-500">{error ?? 'Loading…'}</p>;
  const settled = ['live', 'failed', 'stopped'].includes(a.status);

  function saveConfig(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const env: Record<string, string> = {};
    String(f.get('env') ?? '').split('\n').forEach((l) => { const [k, ...v] = l.split('='); if (k.trim()) env[k.trim()] = v.join('=').trim(); });
    run(() => api(`/v1/app-platform/apps/${id}`, { method: 'PATCH', body: JSON.stringify({ branch: f.get('branch') || undefined, port: Number(f.get('port') || a!.port), size: f.get('size'), instances: Number(f.get('instances')), env, healthPath: f.get('healthPath') || undefined, preDeployCommand: String(f.get('preDeployCommand') ?? '').trim() }) }));
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/app-platform" className="text-sm text-neutral-500 hover:underline">← App Platform</Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{a.name}</h1>
          <StatusBadge status={APP_STATUS_BADGE[a.status] ?? a.status} />
          <a className="font-mono text-sm text-blue-600" href={a.url} target="_blank" rel="noreferrer">{a.hostname}</a>
          <span className="text-sm text-neutral-500">{a.size.id} × {a.instances} · {regionLabel(locale, a.region.name)}</span>
          <div className="ms-auto flex gap-1">
            <button className="btn-ghost" disabled={busy || !settled} onClick={() => run(() => api(`/v1/app-platform/apps/${id}/deploy`, { method: 'POST', idempotent: true }))}>Deploy now</button>
            {a.status === 'stopped'
              ? <button className="btn-primary" disabled={busy} onClick={() => run(() => api(`/v1/app-platform/apps/${id}/start`, { method: 'POST' }))}>Start</button>
              : <button className="btn-ghost" disabled={busy || !settled} onClick={() => run(() => api(`/v1/app-platform/apps/${id}/stop`, { method: 'POST' }))}>Stop</button>}
            <button className="btn-danger" disabled={busy || a.status === 'deleting'} onClick={() => confirm(`Delete app ${a.name}?`) && run(() => api(`/v1/app-platform/apps/${id}`, { method: 'DELETE' }).then(() => router.replace('/app-platform')))}>Delete</button>
          </div>
        </div>
        {a.statusMessage && <p className="mt-1 text-sm text-red-600">{a.statusMessage}</p>}
      </div>
      {error && <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/30">{error}</p>}

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card space-y-2 text-sm">
          <h2 className="font-medium">Source</h2>
          <table className="w-full"><tbody>
            <tr><td className="w-32 py-1 text-neutral-500">Repository</td><td className="py-1 font-mono text-xs">{a.repo ?? a.repoUrl}</td></tr>
            <tr><td className="py-1 text-neutral-500">Branch</td><td className="py-1 font-mono text-xs">{a.branch}</td></tr>
            <tr><td className="py-1 text-neutral-500">Last commit</td><td className="py-1 font-mono text-xs">{a.lastCommit?.slice(0, 12) ?? '—'}</td></tr>
            <tr><td className="py-1 text-neutral-500">Last deploy</td><td className="py-1">{a.lastDeployAt ? new Date(a.lastDeployAt).toLocaleString(locale) : '—'}</td></tr>
            <tr><td className="py-1 text-neutral-500">Redeploys</td><td className="py-1">{a.source === 'github_app' ? 'on every push through the GitHub App' : 'with Deploy now, or the API'}</td></tr>
          </tbody></table>
        </section>
        <section className="card space-y-2 text-sm">
          <h2 className="font-medium">Domains</h2>
          <p className="font-mono text-xs">{a.hostname} <span className="text-neutral-500">(included, TLS on)</span></p>
          {a.customDomains.map((d) => <p key={d} className="flex items-center gap-2 font-mono text-xs">{d}<button className="btn-ghost" disabled={busy} onClick={() => run(() => api(`/v1/app-platform/apps/${id}/domains/${d}`, { method: 'DELETE' }))}>Remove</button></p>)}
          <form className="flex gap-2" onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const domain = String(new FormData(e.currentTarget).get('domain')); const form = e.currentTarget; run(() => api(`/v1/app-platform/apps/${id}/domains`, { method: 'POST', body: JSON.stringify({ domain }) }).then(() => form.reset())); }}>
            <input className="input" name="domain" placeholder="app.example.com" required />
            <button className="btn-ghost" disabled={busy}>Add</button>
          </form>
          <p className="text-xs text-neutral-500">Point a CNAME at <span className="font-mono">{a.hostname}</span>{a.hostIp ? <> or an A record at <span className="font-mono">{a.hostIp}</span></> : ''}. The certificate is issued on the first request.</p>
        </section>
      </div>

      <section className="card space-y-2 text-sm">
        <div className="flex items-center gap-3">
          <h2 className="font-medium">Logs</h2>
          <div className="flex rounded-md border border-neutral-300 p-0.5 text-xs dark:border-neutral-700">
            {(['build', 'runtime'] as const).map((tp) => <button key={tp} type="button" onClick={() => setLogType(tp)} className={`rounded px-3 py-1 ${logType === tp ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900' : 'text-neutral-600'}`}>{tp}</button>)}
          </div>
          <span className="text-xs text-neutral-500">{logs ? (logs.live ? 'live from the host' : `cached ${new Date(logs.updatedAt).toLocaleString(locale)}`) : ''}</span>
        </div>
        <pre className="max-h-96 overflow-auto rounded bg-neutral-950 p-3 font-mono text-xs leading-relaxed text-neutral-100">{logs ? logs.log || 'Nothing yet. The build log appears once the host starts building.' : 'Loading…'}</pre>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <DatabaseLinks appId={a.id} projectId={a.projectId} canChange={settled && !busy} onChanged={load} />
        <RunConsole appId={a.id} locale={locale} canRun={a.status !== 'deleting' && a.deploys.some((d) => d.status === 'live')} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <form onSubmit={saveConfig} className="card space-y-2 text-sm">
          <h2 className="font-medium">Configuration</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block"><span className="text-xs text-neutral-500">Branch</span><input className="input" name="branch" defaultValue={a.branch} /></label>
            <label className="block"><span className="text-xs text-neutral-500">Port</span><input className="input" name="port" type="number" defaultValue={a.port} /></label>
            <label className="block"><span className="text-xs text-neutral-500">Size</span><select className="input" name="size" defaultValue={a.size.id}>{sizes.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.memoryMb} MB · {s.cpus} vCPU</option>)}</select></label>
            <label className="block"><span className="text-xs text-neutral-500">Instances</span><select className="input" name="instances" defaultValue={a.instances}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            <label className="block sm:col-span-2"><span className="text-xs text-neutral-500">Health path</span><input className="input" name="healthPath" defaultValue={a.healthPath ?? ''} placeholder="/" /></label>
            <label className="block sm:col-span-2"><span className="text-xs text-neutral-500">Pre-deploy command</span><input className="input font-mono text-xs" dir="ltr" name="preDeployCommand" defaultValue={a.preDeployCommand ?? ''} placeholder="npx prisma migrate deploy" maxLength={1000} />
              <span className="mt-0.5 block text-xs text-neutral-500">Runs on every deploy in a container from the new image, before it replaces the running version, e.g. <code className="font-mono" dir="ltr">npx prisma migrate deploy</code>. If it fails, the deploy fails and the running version stays.</span></label>
          </div>
          <label className="block"><span className="text-xs text-neutral-500">Environment variables, one per line</span><textarea className="input font-mono text-xs" name="env" rows={5} defaultValue={Object.entries(a.env).map(([k, v]) => `${k}=${v}`).join('\n')} /></label>
          <button className="btn-primary" disabled={busy || !settled}>Save and deploy</button>
        </form>
        <section className="card space-y-2 text-sm">
          <h2 className="font-medium">Deploys</h2>
          <table className="w-full"><tbody>
            {a.deploys.map((d) => <tr key={d.id} className="border-t border-neutral-100 first:border-0 dark:border-neutral-800"><td className="py-1.5"><StatusBadge status={d.status === 'live' ? 'active' : d.status === 'building' || d.status === 'queued' ? 'provisioning' : d.status} /></td><td className="py-1.5 text-neutral-500">{d.trigger}</td><td className="py-1.5 font-mono text-xs">{d.commit?.slice(0, 7) ?? ''}</td><td className="py-1.5 text-xs text-neutral-500">{new Date(d.startedAt).toLocaleString(locale)}</td></tr>)}
            {a.deploys.length === 0 && <tr><td className="py-1.5 text-neutral-500">No deploys yet.</td></tr>}
          </tbody></table>
        </section>
      </div>
    </div>
  );
}
