'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { AppDatabaseLink } from '@/lib/app-platform';

interface ManagedDb { id: string; name: string; engine: string; status: string }

/**
 * Managed databases attached to an app: a user and a database for the app on the cluster, the
 * connection URL in an environment variable. Attaching and detaching deploy the app again.
 */
export function DatabaseLinks({ appId, projectId, canChange, onChanged }: { appId: string; projectId: string; canChange: boolean; onChanged: () => void }) {
  const [links, setLinks] = useState<AppDatabaseLink[]>([]);
  const [dbs, setDbs] = useState<ManagedDb[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/v1/app-platform/apps/${appId}/databases`;

  const load = useCallback(() => api<{ data: AppDatabaseLink[] }>(base).then((r) => setLinks(r.data)).catch(() => undefined), [base]);
  useEffect(() => {
    load();
    api<{ data: ManagedDb[] }>(`/v1/databases?project=${encodeURIComponent(projectId)}`).then((r) => setDbs(r.data)).catch(() => setDbs([]));
  }, [load, projectId]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); await load(); onChanged(); } catch (err) { setError(err instanceof ApiError ? err.message : String(err)); } finally { setBusy(false); }
  }

  function attach(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const database = String(f.get('database') ?? '').trim();
    act(() => api(base, { method: 'POST', idempotent: true, body: JSON.stringify({ databaseId: f.get('databaseId'), envName: String(f.get('envName') || 'DATABASE_URL').trim(), ...(database ? { database } : {}) }) }).then(() => form.reset()));
  }

  async function showUrl(id: string) {
    if (urls[id]) { setUrls(({ [id]: _, ...rest }) => rest); return; }
    setError(null);
    try { const r = await api<{ url: string }>(`${base}/${id}/credentials`); setUrls((u) => ({ ...u, [id]: r.url })); }
    catch (err) { setError(err instanceof ApiError ? err.message : String(err)); }
  }

  const available = dbs.filter((d) => d.status === 'active' || d.status === 'updating');
  return (
    <section className="card space-y-3 text-sm">
      <div>
        <h2 className="font-medium">Database</h2>
        <p className="text-xs text-neutral-500">Attach a managed database of this project: the app gets its own user and database on it, the connection URL (TLS required) in an environment variable, and the database&apos;s trusted sources let the app&apos;s host in. Attaching or detaching deploys the app again.</p>
      </div>
      {links.map((l) => (
        <div key={l.id} className="space-y-1 border-t border-neutral-100 pt-2 first:border-0 first:pt-0 dark:border-neutral-800">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{l.databaseName}</span>
            <span className="badge bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">{l.engine}</span>
            <span className="font-mono text-xs" dir="ltr">{l.envName}</span>
            <span className="text-xs text-neutral-500" dir="ltr">{l.dbName ? `${l.dbName} · ` : ''}{l.dbUser}</span>
            <div className="ms-auto flex gap-1">
              <button type="button" className="btn-ghost" onClick={() => showUrl(l.id)}>{urls[l.id] ? 'Hide URL' : 'Show connection URL'}</button>
              <button type="button" className="btn-danger" disabled={busy || !canChange} onClick={() => confirm(`Detach ${l.databaseName}? ${l.envName} is removed with a new deploy and the user ${l.dbUser} loses access; the data stays on the database.`) && act(() => api(`${base}/${l.id}`, { method: 'DELETE' }))}>Detach</button>
            </div>
          </div>
          {urls[l.id] && <p className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all rounded bg-neutral-100 p-2 font-mono text-xs dark:bg-neutral-900" dir="ltr">{urls[l.id]}</code><button type="button" className="btn-ghost" onClick={() => navigator.clipboard?.writeText(urls[l.id]).catch(() => undefined)}>Copy</button></p>}
        </div>
      ))}
      {links.length === 0 && <p className="text-neutral-500">No database attached.</p>}
      <form className="grid gap-2 sm:grid-cols-3" onSubmit={attach}>
        <label className="block"><span className="text-xs text-neutral-500">Managed database</span>
          <select className="input" name="databaseId" required defaultValue="">
            <option value="" disabled>{available.length ? 'Choose…' : 'No active database in this project'}</option>
            {available.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.engine}</option>)}
          </select>
        </label>
        <label className="block"><span className="text-xs text-neutral-500">Variable</span><input className="input font-mono text-xs" dir="ltr" name="envName" defaultValue="DATABASE_URL" pattern="[A-Z_][A-Z0-9_]*" /></label>
        <label className="block"><span className="text-xs text-neutral-500">Database name (optional)</span><input className="input font-mono text-xs" dir="ltr" name="database" placeholder="named after the app" pattern="[a-z_][a-z0-9_]*" /></label>
        <div className="sm:col-span-3"><button className="btn-primary" disabled={busy || !canChange || !available.length}>Attach</button></div>
      </form>
      {error && <p className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/30">{error}</p>}
    </section>
  );
}
