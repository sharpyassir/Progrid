'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, API_URL, ApiError } from '@/lib/api';
import { useShell } from '@/components/shell';
import type { Zone } from '../page';

interface Rec { id: string; name: string; type: string; content: string; ttl: number; priority: number | null }
const TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA'];
const HINT: Record<string, string> = { A: 'IPv4 address', AAAA: 'IPv6 address', CNAME: 'Hostname this name points to', MX: 'Mail server hostname', TXT: 'Text, for example v=spf1 mx -all', NS: 'Nameserver for a subdomain', SRV: 'weight port target, for example 5 5060 sip.example.com', CAA: 'flags tag value, for example 0 issue letsencrypt.org' };

/** One zone: records table with add, edit and delete, plus the zone file. */
export default function ZonePage() {
  const { name } = useParams<{ name: string }>();
  const router = useRouter();
  const { locale } = useShell();
  const [zone, setZone] = useState<(Zone & { records: Rec[] }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [type, setType] = useState('A');
  const [editing, setEditing] = useState<string | null>(null);
  const [zoneFile, setZoneFile] = useState<string | null>(null);

  const load = useCallback(() => api<Zone & { records: Rec[] }>(`/v1/domains/${name}`).then(setZone).catch((err) => { if (err instanceof ApiError && err.status === 404) router.replace('/dns'); else setError(String(err.message ?? err)); }), [name, router]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (zone && !zone.synced) { const h = setInterval(load, 5000); return () => clearInterval(h); } }, [zone, load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); await load(); } catch (err) { setError(err instanceof ApiError ? err.message : String(err)); } finally { setBusy(false); }
  }
  function submit(e: FormEvent<HTMLFormElement>, id?: string) {
    e.preventDefault();
    const f = new FormData(e.currentTarget); const form = e.currentTarget;
    const body: Record<string, unknown> = { name: String(f.get('name') || '@'), content: String(f.get('content')), ttl: Number(f.get('ttl') || 3600) };
    if (!id) body.type = f.get('type');
    if (f.get('priority')) body.priority = Number(f.get('priority'));
    run(() => api(id ? `/v1/domains/${name}/records/${id}` : `/v1/domains/${name}/records`, { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) }).then(() => { if (!id) form.reset(); setEditing(null); }));
  }
  if (!zone) return <p className="text-sm text-neutral-500">{error ?? 'Loading…'}</p>;
  const needsPriority = (t: string) => t === 'MX' || t === 'SRV';

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dns" className="text-sm text-neutral-500 hover:underline">← DNS</Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{zone.name}</h1>
          <span className={`badge ${zone.synced ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'}`}>{zone.synced ? 'published' : zone.status === 'error' ? 'nameserver error' : 'publishing'}</span>
          <span className="text-sm text-neutral-500">serial {zone.serial} · nameservers {zone.nameservers.join(', ')}</span>
          <button className="btn-ghost ms-auto" onClick={() => zoneFile === null ? fetch(`${API_URL}/v1/domains/${name}/zone-file`, { headers: { Authorization: `Bearer ${localStorage.getItem('prgd.session')}` } }).then((r) => r.text()).then(setZoneFile) : setZoneFile(null)}>{zoneFile === null ? 'Zone file' : 'Hide zone file'}</button>
          <button className="btn-danger" disabled={busy} onClick={() => confirm(`Delete ${zone.name} and all its records?`) && run(() => api(`/v1/domains/${name}`, { method: 'DELETE' }).then(() => router.replace('/dns')))}>Delete domain</button>
        </div>
        {zone.statusMessage && <p className="mt-1 text-sm text-red-600">{zone.statusMessage}</p>}
      </div>
      {error && <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/30">{error}</p>}
      {zoneFile !== null && <pre className="card overflow-auto text-xs">{zoneFile}</pre>}

      <div className="card p-0">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-neutral-500"><tr><th className="px-4 py-2 text-start">Type</th><th className="px-4 py-2 text-start">Name</th><th className="px-4 py-2 text-start">Content</th><th className="px-4 py-2 text-start">TTL</th><th /></tr></thead>
          <tbody>
            <tr className="border-t border-neutral-100 text-neutral-500 dark:border-neutral-800"><td className="px-4 py-2">NS</td><td className="px-4 py-2">@</td><td className="px-4 py-2">{zone.nameservers.join(', ')}</td><td className="px-4 py-2">3600</td><td className="px-4 py-2 text-end text-xs">managed</td></tr>
            {zone.records.map((r) => editing === r.id ? (
              <tr key={r.id} className="border-t border-neutral-100 dark:border-neutral-800"><td colSpan={5} className="px-4 py-2">
                <form onSubmit={(e) => submit(e, r.id)} className="flex flex-wrap items-center gap-2">
                  <span className="w-16 font-medium">{r.type}</span>
                  <input className="input" style={{ width: '10rem' }} name="name" defaultValue={r.name} />
                  {needsPriority(r.type) && <input className="input" style={{ width: '5rem' }} name="priority" type="number" defaultValue={r.priority ?? 10} />}
                  <input className="input" style={{ width: '22rem' }} name="content" defaultValue={r.content} required />
                  <input className="input" style={{ width: '6rem' }} name="ttl" type="number" defaultValue={r.ttl} min={30} />
                  <button className="btn-primary" disabled={busy}>Save</button><button type="button" className="btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                </form>
              </td></tr>
            ) : (
              <tr key={r.id} className="border-t border-neutral-100 dark:border-neutral-800">
                <td className="px-4 py-2 font-medium">{r.type}</td><td className="px-4 py-2">{r.name}</td>
                <td className="px-4 py-2 font-mono text-xs break-all">{r.priority != null ? `${r.priority} ` : ''}{r.content}</td><td className="px-4 py-2">{r.ttl}</td>
                <td className="px-4 py-2 text-end whitespace-nowrap"><button className="btn-ghost me-1" onClick={() => setEditing(r.id)}>Edit</button><button className="btn-danger" disabled={busy} onClick={() => run(() => api(`/v1/domains/${name}/records/${r.id}`, { method: 'DELETE' }))}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={(e) => submit(e)} className="card space-y-2">
        <h2 className="font-medium">Add a record</h2>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select className="input" style={{ width: '6rem' }} name="type" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          <input className="input" style={{ width: '10rem' }} name="name" placeholder="@ or www" />
          {needsPriority(type) && <input className="input" style={{ width: '5rem' }} name="priority" type="number" placeholder="10" />}
          <input className="input" style={{ width: '22rem' }} name="content" placeholder={HINT[type]} required />
          <input className="input" style={{ width: '6rem' }} name="ttl" type="number" placeholder="TTL 3600" min={30} />
          <button className="btn-primary" disabled={busy}>Add</button>
        </div>
        <p className="text-xs text-neutral-500">Changes reach the nameservers within seconds; resolvers pick them up after the old TTL expires. Updated {zone.records.length ? new Date(Math.max(...zone.records.map((r) => +new Date((r as Rec & { updatedAt?: string }).updatedAt ?? 0)))).toLocaleString(locale) : 'never'}.</p>
      </form>
    </div>
  );
}
