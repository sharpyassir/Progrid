'use client';

import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError, money, Price, Size } from '@/lib/api';
import { useShell } from '@/components/shell';
import { StatusBadge } from '@/components/status-badge';
import type { KubeCluster } from '@/lib/kubernetes';

const SETTLED = ['active', 'failed'];

/** Managed Kubernetes: clusters we bootstrap and keep joined; workers are billed as servers. */
export default function KubernetesPage() {
  const { locale } = useShell();
  const [rows, setRows] = useState<KubeCluster[]>([]);
  const [versions, setVersions] = useState<{ version: string; default: boolean }[]>([]);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [currency, setCurrency] = useState<'USD' | 'SAR'>('USD');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState('s-2vcpu-4gb');
  const [count, setCount] = useState(2);
  const [ha, setHa] = useState(false);

  const load = useCallback(() => api<{ data: KubeCluster[] }>('/v1/kubernetes/clusters').then((r) => setRows(r.data)), []);
  useEffect(() => {
    load();
    api<{ data: { version: string; default: boolean }[] }>('/v1/kubernetes/versions').then((r) => setVersions(r.data));
    api<{ data: Size[] }>('/v1/sizes').then((r) => setSizes(r.data.filter((s) => s.memoryMb >= 2048)));
    api<{ currency: 'USD' | 'SAR' }>('/v1/billing/balance').then(async (b) => { setCurrency(b.currency); setPrices((await api<{ data: Price[] }>(`/v1/pricing?currency=${b.currency}`)).data); }).catch(() => undefined);
  }, [load]);
  useEffect(() => {
    if (!rows.some((r) => !SETTLED.includes(r.status))) return;
    const h = setInterval(load, 5000);
    return () => clearInterval(h);
  }, [rows, load]);

  const priceOf = (sku: string) => prices.find((p) => p.sku === sku)?.monthlyMinor ?? 0;
  const estimate = priceOf(size) * count + (ha ? priceOf('k8s-ha') : 0);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(null);
    const f = new FormData(e.currentTarget); const form = e.currentTarget;
    const body = { name: String(f.get('name')).trim(), version: f.get('version'), ha, pools: [{ name: 'default', size, count }] };
    try { await api('/v1/kubernetes/clusters', { method: 'POST', idempotent: true, body: JSON.stringify(body) }); form.reset(); await load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : String(err)); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Kubernetes</h1>
        <p className="text-sm text-neutral-500">Clusters we bootstrap and keep healthy. A single control plane is included; three control plane nodes behind one address cost a flat fee. Worker nodes are billed as servers. Services of type LoadBalancer get a load balancer, and prgd-block claims get a volume, on their own.</p>
      </div>
      {error && <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/30">{error}</p>}

      <div className="card p-0">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-neutral-500"><tr><th className="px-4 py-2 text-start">Name</th><th className="px-4 py-2 text-start">Version</th><th className="px-4 py-2 text-start">Status</th><th className="px-4 py-2 text-start">Control plane</th><th className="px-4 py-2 text-start">Workers</th><th className="px-4 py-2 text-start">Endpoint</th><th className="px-4 py-2 text-start">Monthly</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td className="px-4 py-3 text-neutral-500" colSpan={7}>No clusters yet.</td></tr>}
            {rows.map((c) => (
              <tr key={c.id} className="border-t border-neutral-100 dark:border-neutral-800">
                <td className="px-4 py-2 font-medium"><Link href={`/kubernetes/${c.id}`} className="text-blue-600 hover:underline">{c.name}</Link></td>
                <td className="px-4 py-2">{c.version}</td>
                <td className="px-4 py-2"><StatusBadge status={c.status} />{c.statusMessage && <div className="mt-1 max-w-[16rem] text-xs text-red-600">{c.statusMessage}</div>}</td>
                <td className="px-4 py-2">{c.ha ? '3 nodes (HA)' : '1 node'}</td>
                <td className="px-4 py-2">{c.readyNodes}/{c.workers + c.controlPlane.length} ready · {c.workers} workers</td>
                <td className="px-4 py-2 font-mono text-xs">{c.endpoint ?? ''}</td>
                <td className="px-4 py-2">{money(c.pools.reduce((n, p) => n + priceOf(p.size.id) * p.count, 0) + (c.ha ? priceOf('k8s-ha') : 0), currency, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={create} className="card space-y-3">
        <h2 className="font-medium">New cluster</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <input className="input" name="name" placeholder="Name, for example prod" pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?" maxLength={40} required />
          <select className="input" name="version" defaultValue={versions.find((v) => v.default)?.version}>{versions.map((v) => <option key={v.version} value={v.version}>Kubernetes {v.version}</option>)}</select>
          <select className="input" value={size} onChange={(e) => setSize(e.target.value)}>{sizes.map((s) => <option key={s.id} value={s.id}>{s.vcpu} vCPU · {s.memoryMb / 1024} GB · {money(priceOf(s.id), currency, locale)}/node</option>)}</select>
          <select className="input" value={count} onChange={(e) => setCount(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n} worker{n > 1 ? 's' : ''}</option>)}</select>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ha} onChange={(e) => setHa(e.target.checked)} /> Three control plane nodes ({money(priceOf('k8s-ha'), currency, locale)} per month)</label>
        <div className="flex items-center gap-4 text-sm text-neutral-500"><span>{money(estimate, currency, locale)} per month, workers billed by the hour like servers</span><button className="btn-primary" disabled={busy}>Create cluster</button></div>
      </form>
    </div>
  );
}
