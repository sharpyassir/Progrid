'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError, Server } from '@/lib/api';
import { useShell } from '@/components/shell';

interface Policy { id: string; name: string; metric: string; comparator: 'above' | 'below'; threshold: number; windowMinutes: number; serverIds: string[]; tags: string[]; emails: string[]; enabled: boolean; createdAt: string; _count: { incidents: number } }
interface Incident { id: string; serverId: string; value: number; peakValue: number; startedAt: string; resolvedAt: string | null; policy: { name: string; metric: string; comparator: string; threshold: number; windowMinutes: number } }

const METRICS: [string, string, string][] = [['cpu', 'CPU', '%'], ['memory', 'Memory', '%'], ['disk', 'Disk used', '%'], ['net_in', 'Inbound bandwidth', 'Mbps'], ['net_out', 'Outbound bandwidth', 'Mbps'], ['db_node_unreachable', 'Database node unreachable (any database)', ''], ['app_deploy_failed', 'App deploy failed (any app)', '']];
const unit = (m: string) => METRICS.find((x) => x[0] === m)?.[2] ?? '';
const label = (m: string) => METRICS.find((x) => x[0] === m)?.[1] ?? m;

/** Monitoring: resource alert rules and their incidents. Graphs live on each server's page. */
export default function MonitoringPage() {
  const { locale } = useShell();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [servers, setServers] = useState<Server[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => Promise.all([
    api<{ data: Policy[] }>('/v1/alerts').then((r) => setPolicies(r.data)),
    api<{ data: Incident[] }>('/v1/alerts/incidents').then((r) => setIncidents(r.data)),
    api<{ data: Server[] }>('/v1/servers').then((r) => setServers(r.data)),
  ]), []);
  useEffect(() => { load(); const h = setInterval(load, 30_000); return () => clearInterval(h); }, [load]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(null);
    const f = new FormData(e.currentTarget);
    const body = {
      name: f.get('name'), metric: f.get('metric'), comparator: f.get('comparator'), threshold: Number(f.get('threshold')), windowMinutes: Number(f.get('window') || 5),
      serverIds: f.getAll('serverIds').map(String).filter(Boolean),
      tags: String(f.get('tags') ?? '').split(',').map((t) => t.trim()).filter(Boolean),
      emails: String(f.get('emails') ?? '').split(',').map((t) => t.trim()).filter(Boolean),
    };
    try { await api('/v1/alerts', { method: 'POST', idempotent: true, body: JSON.stringify(body) }); e.currentTarget.reset(); await load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : String(err)); } finally { setBusy(false); }
  }
  const toggle = (p: Policy) => api(`/v1/alerts/${p.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: !p.enabled }) }).then(load);
  const remove = (p: Policy) => confirm(`Delete the rule "${p.name}"?`) && api(`/v1/alerts/${p.id}`, { method: 'DELETE' }).then(load);
  const serverName = (id: string) => servers.find((s) => s.id === id)?.name ?? id.slice(-6);
  const open = incidents.filter((i) => !i.resolvedAt);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Monitoring</h1>
        <p className="text-sm text-neutral-500">Every server reports CPU, memory, disk and network once a minute; graphs are on each server page under Metrics. Alert rules below send one email when a threshold holds for the window and one when it clears, plus webhook events.</p>
      </div>
      {error && <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/30">{error}</p>}

      <section className="space-y-2">
        <h2 className="font-medium">Firing now {open.length > 0 && <span className="badge bg-red-100 text-red-800">{open.length}</span>}</h2>
        {open.length === 0 ? <p className="card text-sm text-neutral-500">Nothing is firing. All monitored servers are within their limits.</p> : (
          <div className="card p-0"><table className="w-full text-sm"><tbody>
            {open.map((i) => <tr key={i.id} className="border-t border-neutral-100 first:border-0 dark:border-neutral-800">
              <td className="px-4 py-2 font-medium">{i.policy.name}</td>
              <td className="px-4 py-2"><Link href={`/servers/${i.serverId}`} className="text-blue-600 hover:underline">{serverName(i.serverId)}</Link></td>
              <td className="px-4 py-2">{label(i.policy.metric)} {i.value}{unit(i.policy.metric)} <span className="text-neutral-500">(peak {i.peakValue}{unit(i.policy.metric)}, limit {i.policy.comparator} {i.policy.threshold}{unit(i.policy.metric)})</span></td>
              <td className="px-4 py-2 text-xs text-neutral-500">since {new Date(i.startedAt).toLocaleString(locale)}</td>
            </tr>)}
          </tbody></table></div>
        )}
      </section>

      <section className="card p-0">
        <h2 className="border-b border-neutral-100 px-4 py-2 font-medium dark:border-neutral-800">Alert rules</h2>
        <table className="w-full text-sm"><tbody>
          {policies.length === 0 && <tr><td className="px-4 py-3 text-neutral-500">No rules yet. Create one below; a good first rule is CPU above 90% for 10 minutes on every server.</td></tr>}
          {policies.map((p) => <tr key={p.id} className="border-t border-neutral-100 first:border-0 dark:border-neutral-800">
            <td className="px-4 py-2"><div className="font-medium">{p.name}</div><div className="text-xs text-neutral-500">{p.serverIds.length || p.tags.length ? [...p.serverIds.map(serverName), ...p.tags.map((t) => `tag ${t}`)].join(', ') : 'every server'}{p.emails.length ? ` · also ${p.emails.join(', ')}` : ''}</div></td>
            <td className="px-4 py-2">{label(p.metric)} {p.comparator} {p.threshold}{unit(p.metric)} for {p.windowMinutes} min</td>
            <td className="px-4 py-2">{p._count.incidents > 0 ? <span className="badge bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">firing</span> : p.enabled ? <span className="badge bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">watching</span> : <span className="badge bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">muted</span>}</td>
            <td className="px-4 py-2 text-end whitespace-nowrap"><button className="btn-ghost me-1" onClick={() => toggle(p)}>{p.enabled ? 'Mute' : 'Enable'}</button><button className="btn-danger" onClick={() => remove(p)}>Delete</button></td>
          </tr>)}
        </tbody></table>
      </section>

      <form onSubmit={create} className="card space-y-3">
        <h2 className="font-medium">New alert rule</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <input className="input lg:col-span-2" name="name" placeholder="Rule name, for example High CPU" required />
          <select className="input" name="metric" defaultValue="cpu">{METRICS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select className="input" name="comparator" defaultValue="above"><option value="above">above</option><option value="below">below</option></select>
          <input className="input" name="threshold" type="number" step="0.1" min={0} placeholder="Threshold (% or Mbps)" required />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input className="input" name="window" type="number" min={1} max={1440} placeholder="For how many minutes (5)" />
          <select className="input" name="serverIds" multiple size={3}>{servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <input className="input" name="tags" placeholder="Tags, comma separated (optional)" />
          <input className="input" name="emails" placeholder="Extra emails, comma separated" />
        </div>
        <p className="text-xs text-neutral-500">Leave servers and tags empty to watch every server in the team. Team owners and admins always get the email.</p>
        <button className="btn-primary" disabled={busy}>Create rule</button>
      </form>

      {incidents.some((i) => i.resolvedAt) && (
        <section className="card p-0">
          <h2 className="border-b border-neutral-100 px-4 py-2 font-medium dark:border-neutral-800">History</h2>
          <table className="w-full text-sm"><tbody>
            {incidents.filter((i) => i.resolvedAt).slice(0, 30).map((i) => <tr key={i.id} className="border-t border-neutral-100 first:border-0 dark:border-neutral-800">
              <td className="px-4 py-2">{i.policy.name}</td><td className="px-4 py-2"><Link href={`/servers/${i.serverId}`} className="hover:underline">{serverName(i.serverId)}</Link></td>
              <td className="px-4 py-2 text-neutral-500">peak {i.peakValue}{unit(i.policy.metric)}</td>
              <td className="px-4 py-2 text-xs text-neutral-500">{new Date(i.startedAt).toLocaleString(locale)} to {new Date(i.resolvedAt!).toLocaleTimeString(locale)}</td>
            </tr>)}
          </tbody></table>
        </section>
      )}
    </div>
  );
}
