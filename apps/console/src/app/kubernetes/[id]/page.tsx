'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError, API_URL, getToken, Size } from '@/lib/api';
import { StatusBadge } from '@/components/status-badge';
import type { KubeCluster, KubeNode } from '@/lib/kubernetes';

export default function KubernetesClusterPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [c, setC] = useState<KubeCluster | null>(null);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setC(await api<KubeCluster>(`/v1/kubernetes/clusters/${id}`)); }
    catch (err) { if (err instanceof ApiError && err.status === 404) router.replace('/kubernetes'); else setError(err instanceof ApiError ? err.message : String(err)); }
  }, [id, router]);
  useEffect(() => { load(); api<{ data: Size[] }>('/v1/sizes').then((r) => setSizes(r.data.filter((s) => s.memoryMb >= 2048))); const h = setInterval(load, 6000); return () => clearInterval(h); }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await fn(); await load(); } catch (err) { setError(err instanceof ApiError ? err.message : String(err)); } finally { setBusy(false); }
  }
  async function downloadKubeconfig() {
    setError(null);
    const res = await fetch(`${API_URL}/v1/kubernetes/clusters/${id}/kubeconfig`, { headers: { authorization: `Bearer ${getToken()}` } });
    if (!res.ok) { setError((await res.json().catch(() => ({ error: { message: res.statusText } }))).error?.message ?? 'Not ready'); return; }
    const blob = await res.blob();
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${c?.name ?? 'cluster'}-kubeconfig.yaml`; a.click();
  }
  if (!c) return <p className="text-sm text-neutral-500">{error ?? 'Loading…'}</p>;
  const settled = ['active', 'failed'].includes(c.status);

  const NodeRows = ({ nodes }: { nodes: KubeNode[] }) => (
    <table className="w-full"><tbody>
      {nodes.map((n) => <tr key={n.id} className="border-t border-neutral-100 first:border-0 dark:border-neutral-800"><td className="py-1.5 font-mono text-xs">{n.name}</td><td className="py-1.5"><StatusBadge status={n.status} /></td><td className="py-1.5">{n.ready ? <span className="text-green-700">Ready</span> : <span className="text-neutral-500">not ready</span>}</td><td className="py-1.5 font-mono text-xs text-neutral-500">{n.kubeVersion ?? ''}</td><td className="py-1.5 font-mono text-xs text-neutral-500">{n.ip ?? ''} {n.privateIp ? `· ${n.privateIp}` : ''}</td></tr>)}
    </tbody></table>
  );

  return (
    <div className="space-y-6">
      <div>
        <Link href="/kubernetes" className="text-sm text-neutral-500 hover:underline">← Kubernetes</Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{c.name}</h1>
          <StatusBadge status={c.status} />
          <span className="text-sm text-neutral-500">Kubernetes {c.version} · {c.ha ? '3 control plane nodes' : '1 control plane node'} · {c.workers} workers · {c.readyNodes} ready · config v{c.configVersion}</span>
          <button className="btn-ghost ms-auto" onClick={downloadKubeconfig}>Download kubeconfig</button>
          <button className="btn-danger" disabled={busy || c.status === 'deleting'} onClick={() => confirm(`Delete cluster ${c.name}, its nodes, and the load balancers and volumes it created?`) && run(() => api(`/v1/kubernetes/clusters/${id}`, { method: 'DELETE' }).then(() => router.replace('/kubernetes')))}>Delete cluster</button>
        </div>
        {c.statusMessage && <p className="mt-1 text-sm text-red-600">{c.statusMessage}</p>}
      </div>
      {error && <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/30">{error}</p>}

      <section className="card space-y-2 text-sm">
        <h2 className="font-medium">Connect</h2>
        <table className="w-full"><tbody>
          <tr><td className="py-1 w-40 text-neutral-500">API endpoint</td><td className="py-1 font-mono">{c.endpoint ?? 'pending'}</td></tr>
          <tr><td className="py-1 text-neutral-500">Pod network</td><td className="py-1 font-mono">{c.podCidr}</td></tr>
          <tr><td className="py-1 text-neutral-500">Service network</td><td className="py-1 font-mono">{c.serviceCidr}</td></tr>
          <tr><td className="py-1 text-neutral-500">Region</td><td className="py-1">{c.region.name}</td></tr>
        </tbody></table>
        <pre className="overflow-x-auto rounded bg-neutral-100 p-2 font-mono text-xs dark:bg-neutral-800">{`prgd kubernetes kubeconfig ${c.id} > ~/.kube/${c.name}.yaml\nexport KUBECONFIG=~/.kube/${c.name}.yaml\nkubectl get nodes`}</pre>
        <p className="text-xs text-neutral-500">The kubeconfig holds the cluster admin credentials. Keep it as safe as a password.</p>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card space-y-2 text-sm">
          <h2 className="font-medium">Control plane</h2>
          <NodeRows nodes={c.controlPlane} />
          <p className="text-xs text-neutral-500">{c.controlSize.vcpu} vCPU · {c.controlSize.memoryMb / 1024} GB each. The address stays with a healthy API server.</p>
        </section>
        <section className="card space-y-2 text-sm">
          <h2 className="font-medium">Cloud resources</h2>
          <table className="w-full"><tbody>
            {c.cloud.loadBalancers.map((l) => <tr key={l.service} className="border-t border-neutral-100 first:border-0 dark:border-neutral-800"><td className="py-1.5 text-neutral-500">Service</td><td className="py-1.5 font-mono text-xs">{l.service}</td><td className="py-1.5"><Link href={`/load-balancers/${l.loadBalancerId}`} className="text-blue-600 hover:underline">load balancer</Link></td><td className="py-1.5 font-mono text-xs">{l.ip ?? 'pending'}</td></tr>)}
            {c.cloud.volumes.map((v) => <tr key={v.claim} className="border-t border-neutral-100 first:border-0 dark:border-neutral-800"><td className="py-1.5 text-neutral-500">Claim</td><td className="py-1.5 font-mono text-xs">{v.claim}</td><td className="py-1.5"><Link href="/volumes" className="text-blue-600 hover:underline">{v.sizeGb} GB volume</Link></td><td className="py-1.5 font-mono text-xs">{v.node}{v.mounted ? '' : ' (attaching)'}</td></tr>)}
            {c.cloud.loadBalancers.length + c.cloud.volumes.length === 0 && <tr><td className="py-1.5 text-neutral-500" colSpan={4}>Nothing yet. A Service of type LoadBalancer gets a load balancer; a PersistentVolumeClaim with the prgd-block class gets a volume.</td></tr>}
          </tbody></table>
        </section>
      </div>

      {c.pools.map((p) => (
        <section key={p.id} className="card space-y-2 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-medium">Pool {p.name}</h2>
            <span className="text-neutral-500">{p.size.vcpu} vCPU · {p.size.memoryMb / 1024} GB · {p.count} node{p.count === 1 ? '' : 's'}{Object.keys(p.labels).length ? ` · labels ${Object.entries(p.labels).map(([k, v]) => `${k}=${v}`).join(', ')}` : ''}</span>
            <form className="ms-auto flex items-center gap-2" onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const count = Number(new FormData(e.currentTarget).get('count')); run(() => api(`/v1/kubernetes/clusters/${id}/pools/${p.id}`, { method: 'PATCH', body: JSON.stringify({ count }) })); }}>
              <input className="input w-20" name="count" type="number" min={0} max={50} defaultValue={p.count} />
              <button className="btn-ghost" disabled={busy || !settled}>Scale</button>
              {c.pools.length > 1 && <button type="button" className="btn-danger" disabled={busy || !settled} onClick={() => confirm(`Remove pool ${p.name} and its nodes?`) && run(() => api(`/v1/kubernetes/clusters/${id}/pools/${p.id}`, { method: 'DELETE' }))}>Remove</button>}
            </form>
          </div>
          <NodeRows nodes={p.nodes} />
        </section>
      ))}

      <form className="card space-y-2 text-sm" onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); const form = e.currentTarget; run(() => api(`/v1/kubernetes/clusters/${id}/pools`, { method: 'POST', body: JSON.stringify({ name: f.get('name'), size: f.get('size'), count: Number(f.get('count')) }) }).then(() => form.reset())); }}>
        <h2 className="font-medium">Add a pool</h2>
        <div className="grid gap-2 sm:grid-cols-4">
          <input className="input" name="name" placeholder="Pool name" pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?" required />
          <select className="input" name="size" defaultValue="s-2vcpu-4gb">{sizes.map((s) => <option key={s.id} value={s.id}>{s.vcpu} vCPU · {s.memoryMb / 1024} GB</option>)}</select>
          <input className="input" name="count" type="number" min={1} max={50} defaultValue={1} />
          <button className="btn-primary" disabled={busy || !settled}>Add pool</button>
        </div>
      </form>
    </div>
  );
}
