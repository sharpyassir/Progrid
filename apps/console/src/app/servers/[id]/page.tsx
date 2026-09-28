'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError, Firewall, Image, money, Price, Server, ServerAction, Size, Snapshot, Volume } from '@/lib/api';
import { Locale, t, tf } from '@/lib/i18n';
import { useShell } from '@/components/shell';
import { StatusBadge } from '@/components/status-badge';
import { ServerMetrics } from '@/components/server-metrics';

type Tab = 'overview' | 'metrics' | 'power' | 'networking' | 'snapshots' | 'volumes' | 'activity';
const TABS: { id: Tab; key: 'tabOverview' | 'tabMetrics' | 'tabPower' | 'tabNetworking' | 'tabSnapshots' | 'tabVolumes' | 'tabActivity' }[] = [
  { id: 'overview', key: 'tabOverview' }, { id: 'metrics', key: 'tabMetrics' }, { id: 'power', key: 'tabPower' }, { id: 'networking', key: 'tabNetworking' },
  { id: 'snapshots', key: 'tabSnapshots' }, { id: 'volumes', key: 'tabVolumes' }, { id: 'activity', key: 'tabActivity' },
];
const SETTLED = ['active', 'off', 'failed'];

export default function ServerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { locale } = useShell();
  const [server, setServer] = useState<Server | null>(null);
  const [actions, setActions] = useState<ServerAction[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [firewalls, setFirewalls] = useState<Firewall[]>([]);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [images, setImages] = useState<Image[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [currency, setCurrency] = useState<'USD' | 'SAR'>('USD');
  const [spent, setSpent] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, a] = await Promise.all([api<Server>(`/v1/servers/${id}`), api<{ data: ServerAction[] }>(`/v1/servers/${id}/actions`)]);
      setServer(s); setActions(a.data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) router.replace('/servers');
      else setError(err instanceof ApiError ? err.message : String(err));
    }
  }, [id, router]);

  const loadSide = useCallback(async () => {
    const bal = await api<{ currency: 'USD' | 'SAR' }>('/v1/billing/balance').catch(() => ({ currency: 'USD' as const }));
    setCurrency(bal.currency);
    const [sn, fw, sz, im, pr, us, vo] = await Promise.all([
      api<{ data: Snapshot[] }>('/v1/snapshots').catch(() => ({ data: [] })),
      api<{ data: Firewall[] }>('/v1/firewalls').catch(() => ({ data: [] })),
      api<{ data: Size[] }>('/v1/sizes'),
      api<{ data: Image[] }>('/v1/images'),
      api<{ data: Price[] }>(`/v1/pricing?currency=${bal.currency}`),
      api<{ data: { resourceId: string; amountMinor: number }[] }>('/v1/billing/usage').catch(() => ({ data: [] })),
      api<{ data: Volume[] }>('/v1/volumes').catch(() => ({ data: [] })),
    ]);
    setVolumes(vo.data);
    setSnapshots(sn.data.filter((x) => x.serverId === id)); setFirewalls(fw.data); setSizes(sz.data); setImages(im.data); setPrices(pr.data);
    setSpent(us.data.filter((r) => r.resourceId === id).reduce((n, r) => n + (r.amountMinor ?? 0), 0));
  }, [id]);

  useEffect(() => { load(); loadSide(); }, [load, loadSide]);
  // Poll while the server or its last action is still moving.
  useEffect(() => {
    const moving = server && (!SETTLED.includes(server.status) || actions[0]?.status === 'running' || actions[0]?.status === 'queued');
    if (!moving) return;
    const h = setInterval(() => { load(); if (actions[0]?.type === 'snapshot' || volumes.some((v) => !['available', 'attached', 'failed'].includes(v.status))) loadSide(); }, 2000);
    return () => clearInterval(h);
  }, [server, actions, volumes, load, loadSide]);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true); setError(null); setNotice(null);
    try { await fn(); if (ok) setNotice(ok); await load(); }
    catch (err) { setError(err instanceof ApiError ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  const act = (body: Record<string, unknown>, ok?: string) => run(() => api(`/v1/servers/${id}/actions`, { method: 'POST', idempotent: true, body: JSON.stringify(body) }), ok);

  const priceOf = (sku: string) => prices.find((p) => p.sku === sku);
  const ip = server?.networks.v4[0]?.ipAddress;
  const monthly = useMemo(() => {
    if (!server) return 0;
    const plan = priceOf(server.size.id)?.monthlyMinor ?? 0;
    const managedPrice = server.managed ? priceOf(`managed-${server.size.id}`)?.monthlyMinor ?? 0 : 0;
    const backupsPct = server.backupsEnabled && !server.managed ? priceOf('backups_pct')?.monthlyMinor ?? 20 : 0;
    return plan + (priceOf('public_ip')?.monthlyMinor ?? 0) + managedPrice + Math.round((plan * backupsPct) / 100);
  }, [server, prices]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!server) return <p className="text-sm text-neutral-500">{error ?? t(locale, 'loading')}</p>;
  const settled = SETTLED.includes(server.status);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/servers" className="text-sm text-neutral-500 hover:underline">← {t(locale, 'servers')}</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{server.name}</h1>
          <StatusBadge status={server.status} />
          {ip && <code className="rounded bg-neutral-100 px-2 py-0.5 font-mono text-sm dark:bg-neutral-800">{ip}</code>}
          <span className="text-sm text-neutral-500">{server.size.vcpu} vCPU · {server.size.memoryMb / 1024} GB · {server.size.diskGb} GB SSD · {server.region.name}</span>
          <div className="ms-auto flex gap-1">
            {server.status === 'active' && <button className="btn-ghost" disabled={busy} onClick={() => act({ type: 'reboot' })}>{t(locale, 'reboot')}</button>}
            {server.status === 'active' && <button className="btn-ghost" disabled={busy} onClick={() => act({ type: 'stop' })}>{t(locale, 'stop')}</button>}
            {server.status === 'off' && <button className="btn-primary" disabled={busy} onClick={() => act({ type: 'start' })}>{t(locale, 'start')}</button>}
          </div>
        </div>
        {server.statusMessage && <p className="mt-1 text-sm text-amber-700">{server.statusMessage}</p>}
      </div>

      {error && <p className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:bg-red-950/30">{error}</p>}
      {notice && <p className="rounded border border-green-200 bg-green-50 p-2 text-sm text-green-800 dark:bg-green-950/30">{notice}</p>}

      <nav className="flex gap-1 overflow-x-auto border-b border-neutral-200 text-sm dark:border-neutral-800">
        {TABS.map((x) => (
          <button key={x.id} onClick={() => setTab(x.id)} className={`whitespace-nowrap px-3 py-2 ${tab === x.id ? 'border-b-2 border-blue-600 font-medium' : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100'}`}>{t(locale, x.key)}</button>
        ))}
      </nav>

      {tab === 'overview' && (
        <div className="grid gap-4 md:grid-cols-2">
          <section className="card space-y-2 text-sm">
            <h2 className="font-medium">{t(locale, 'details')}</h2>
            <Row k="ID"><code className="font-mono text-xs">{server.id}</code></Row>
            <Row k={t(locale, 'image')}>{server.image.name}</Row>
            <Row k={t(locale, 'size')}>{server.size.id}</Row>
            <Row k={t(locale, 'region')}>{server.region.name}</Row>
            <Row k={t(locale, 'privateIp')}>{server.networks.private[0]?.ipAddress ?? '—'}</Row>
            <Row k={t(locale, 'backups')}>{t(locale, server.backupsEnabled ? 'on' : 'off')} <button className="btn-ghost ms-2" disabled={busy} onClick={() => run(() => api(`/v1/servers/${id}`, { method: 'PATCH', body: JSON.stringify({ backups: !server.backupsEnabled }) }))}>{t(locale, server.backupsEnabled ? 'backupsOff' : 'backupsOn')}</button><div className="text-xs text-neutral-500">{tf(locale, 'backupsNote')(`${priceOf('backups_pct')?.monthlyMinor ?? 20}%`)}</div></Row>
            <Row k={t(locale, 'managedTier')}>{t(locale, server.managed ? 'on' : 'off')} <button className="btn-ghost ms-2" disabled={busy} onClick={() => run(() => api(`/v1/servers/${id}`, { method: 'PATCH', body: JSON.stringify({ managed: !server.managed }) }))}>{t(locale, server.managed ? 'managedOff' : 'managedOn')}</button><div className="text-xs text-neutral-500">{priceOf(`managed-${server.size.id}`) ? tf(locale, 'managedNote')(`${money((priceOf(server.size.id)?.monthlyMinor ?? 0) + (priceOf(`managed-${server.size.id}`)?.monthlyMinor ?? 0), currency, locale)}${t(locale, 'perMonth')}`) : t(locale, 'managedNotOnPlan')}</div></Row>
            <Row k={t(locale, 'created')}>{new Date(server.createdAt).toLocaleString(locale)}</Row>
            {server.tags.length > 0 && <Row k={t(locale, 'tags')}>{server.tags.join(', ')}</Row>}
          </section>
          <section className="card space-y-2 text-sm">
            <h2 className="font-medium">{t(locale, 'cost')}</h2>
            <Row k={t(locale, 'price')}>{money(monthly, currency, locale)}{t(locale, 'perMonth')} <span className="text-neutral-500">({money(priceOf(server.size.id)?.hourlyMinor ?? 0, currency, locale)}{t(locale, 'perHour')} {t(locale, 'plusPublicIp')})</span></Row>
            <Row k={t(locale, 'mtd')}>{spent === null ? '…' : money(spent, currency, locale)}</Row>
            <p className="text-xs text-neutral-500">{t(locale, 'costNote')}</p>
          </section>
          {server.managed && <ManagedCard id={id} locale={locale} health={server.managedHealth} />}
          <section className="card space-y-2 text-sm md:col-span-2">
            <h2 className="font-medium">{t(locale, 'connect')}</h2>
            <p className="text-neutral-500">{t(locale, 'connectNote')}</p>
            <pre className="overflow-x-auto rounded bg-neutral-900 p-3 font-mono text-xs text-neutral-100">{ip ? `ssh root@${ip}` : t(locale, 'waitingIp')}</pre>
            <p className="text-neutral-500">{t(locale, 'fromCli')}</p>
            <pre className="overflow-x-auto rounded bg-neutral-900 p-3 font-mono text-xs text-neutral-100">{`prgd servers get ${server.id}\nprgd ssh ${server.name}`}</pre>
          </section>
        </div>
      )}

      {tab === 'metrics' && <ServerMetrics serverId={server.id} />}

      {tab === 'power' && (
        <div className="grid gap-4 md:grid-cols-2">
          <section className="card space-y-3 text-sm">
            <h2 className="font-medium">{t(locale, 'power')}</h2>
            <p className="text-neutral-500">{t(locale, 'powerNote')}</p>
            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost" disabled={busy || server.status !== 'off'} onClick={() => act({ type: 'start' })}>{t(locale, 'start')}</button>
              <button className="btn-ghost" disabled={busy || server.status !== 'active'} onClick={() => act({ type: 'reboot' })}>{t(locale, 'reboot')}</button>
              <button className="btn-ghost" disabled={busy || server.status !== 'active'} onClick={() => act({ type: 'stop' })}>{t(locale, 'stop')}</button>
              <button className="btn-danger" disabled={busy || server.status !== 'active'} onClick={() => confirm(t(locale, 'forceStopConfirm')) && act({ type: 'stop', force: true })}>{t(locale, 'forceStop')}</button>
            </div>
          </section>
          <ResizeCard server={server} sizes={sizes} prices={prices} currency={currency} locale={locale} busy={busy || !settled} onResize={(size) => act({ type: 'resize', size }, t(locale, 'resizeStarted'))} />
          <section className="card space-y-3 text-sm">
            <h2 className="font-medium">{t(locale, 'rebuild')}</h2>
            <p className="text-neutral-500">{t(locale, 'rebuildNote')}</p>
            <form className="flex gap-2" onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const image = new FormData(e.currentTarget).get('image'); if (confirm(tf(locale, 'rebuildConfirm')(String(image)))) act({ type: 'rebuild', image }, t(locale, 'rebuildStarted')); }}>
              <select name="image" className="input" defaultValue={server.image.id}>{images.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
              <button className="btn-danger whitespace-nowrap" disabled={busy || !settled}>{t(locale, 'rebuild')}</button>
            </form>
          </section>
          <section className="card space-y-3 text-sm">
            <h2 className="font-medium text-red-700">{t(locale, 'deleteServer')}</h2>
            <p className="text-neutral-500">{t(locale, 'deleteNote')}</p>
            <button className="btn-danger" disabled={busy || !settled} onClick={() => confirm(t(locale, 'confirmDelete')) && run(() => api(`/v1/servers/${id}`, { method: 'DELETE', idempotent: true }).then(() => router.replace('/servers')))}>{t(locale, 'delete')}</button>
          </section>
        </div>
      )}

      {tab === 'networking' && (
        <div className="grid gap-4 md:grid-cols-2">
          <section className="card space-y-2 text-sm">
            <h2 className="font-medium">{t(locale, 'addresses')}</h2>
            <table className="w-full"><tbody>
              {server.networks.v4.map((a) => (
                <tr key={a.ipAddress}><td className="py-1 font-mono">{a.ipAddress}</td><td className="py-1 text-neutral-500">{t(locale, a.floating ? 'reservedIp' : 'publicIpv4')}</td><td className="py-1 text-neutral-500">{a.reverseDns ?? ''}</td></tr>
              ))}
              {server.networks.private.map((a) => (
                <tr key={a.ipAddress}><td className="py-1 font-mono">{a.ipAddress}</td><td className="py-1 text-neutral-500">{t(locale, 'privateNetwork')}</td><td /></tr>
              ))}
            </tbody></table>
            <p className="text-xs text-neutral-500">{t(locale, 'addressesNote')} <Link href="/public-ips" className="text-blue-600 hover:underline">{t(locale, 'publicIps')}</Link>.</p>
          </section>
          <section className="card space-y-3 text-sm">
            <h2 className="font-medium">{t(locale, 'firewalls')}</h2>
            {firewalls.length === 0 && <p className="text-neutral-500">{t(locale, 'noFirewalls')} <Link href="/firewalls" className="text-blue-600 hover:underline">{t(locale, 'createOne')}</Link> {t(locale, 'noFirewallsTail')}</p>}
            {firewalls.map((f) => {
              const attached = server.firewalls.includes(f.id);
              return (
                <div key={f.id} className="flex items-center gap-3 border-t border-neutral-100 pt-2 first:border-0 first:pt-0 dark:border-neutral-800">
                  <div className="flex-1"><Link href="/firewalls" className="font-medium hover:underline">{f.name}</Link><span className="ms-2 text-neutral-500">{f.rules.length} {t(locale, 'rules')}</span></div>
                  {attached
                    ? <button className="btn-ghost" disabled={busy} onClick={() => run(() => api(`/v1/firewalls/${f.id}/servers/${id}`, { method: 'DELETE' }), tf(locale, 'detached')(f.name))}>{t(locale, 'detach')}</button>
                    : <button className="btn-ghost" disabled={busy} onClick={() => run(() => api(`/v1/firewalls/${f.id}/servers`, { method: 'POST', body: JSON.stringify({ serverId: id }) }), tf(locale, 'attached')(f.name))}>{t(locale, 'attach')}</button>}
                </div>
              );
            })}
          </section>
        </div>
      )}

      {tab === 'snapshots' && (
        <section className="card space-y-3 text-sm">
          <div className="flex items-center gap-3">
            <h2 className="font-medium">{t(locale, 'snapshots')}</h2>
            <form className="ms-auto flex gap-2" onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const name = new FormData(e.currentTarget).get('name') || undefined; act({ type: 'snapshot', ...(name ? { name } : {}) }, t(locale, 'snapshotStarted')).then(loadSide); e.currentTarget.reset(); }}>
              <input name="name" className="input max-w-[14rem]" placeholder={t(locale, 'snapshotName')} />
              <button className="btn-primary whitespace-nowrap" disabled={busy || !settled}>{t(locale, 'takeSnapshot')}</button>
            </form>
          </div>
          <p className="text-neutral-500">{tf(locale, 'snapshotNote')(money(priceOf('snapshot_gb')?.monthlyMinor ?? 0, currency, locale))}</p>
          {snapshots.length === 0 ? <p className="text-neutral-500">{t(locale, 'noSnapshots')}</p> : (
            <table className="w-full"><tbody>
              {snapshots.map((s) => (
                <tr key={s.id} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="py-2 font-medium">{s.name}{s.kind === 'backup' && <span className="badge ms-2 bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">{t(locale, 'backupKind')}</span>}</td><td className="py-2"><StatusBadge status={s.status} /></td><td className="py-2">{s.sizeGb} GB</td>
                  <td className="py-2 text-neutral-500">{new Date(s.createdAt).toLocaleString(locale)}</td>
                  <td className="py-2 text-end"><button className="btn-danger" disabled={busy} onClick={() => confirm(t(locale, 'deleteSnapshotConfirm')) && run(() => api(`/v1/snapshots/${s.id}`, { method: 'DELETE' }).then(loadSide))}>{t(locale, 'delete')}</button></td>
                </tr>
              ))}
            </tbody></table>
          )}
        </section>
      )}

      {tab === 'volumes' && (() => {
        const mine = volumes.filter((v) => v.serverId === id);
        const free = volumes.filter((v) => v.status === 'available');
        return (
          <section className="card space-y-3 text-sm">
            <div className="flex items-center gap-3">
              <h2 className="font-medium">{t(locale, 'volumes')}</h2>
              <Link href="/volumes" className="ms-auto text-blue-600 hover:underline">{t(locale, 'newVolume')}</Link>
            </div>
            <p className="text-neutral-500">{tf(locale, 'volumeNote')(money(priceOf('volume_gb')?.monthlyMinor ?? 0, currency, locale))}</p>
            {mine.length === 0 ? <p className="text-neutral-500">{t(locale, 'noVolumesOnServer')}</p> : (
              <table className="w-full"><tbody>
                {mine.map((v) => (
                  <tr key={v.id} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="py-2 font-medium">{v.name}</td><td className="py-2"><StatusBadge status={v.status} /></td><td className="py-2">{v.sizeGb} GB</td>
                    <td className="py-2 font-mono text-xs text-neutral-500">{v.device ?? ''}</td>
                    <td className="py-2 text-end"><button className="btn-ghost" disabled={busy || v.status !== 'attached'} title={t(locale, 'detachNote')} onClick={() => run(() => api(`/v1/volumes/${v.id}/detach`, { method: 'POST' }).then(loadSide))}>{t(locale, 'detach')}</button></td>
                  </tr>
                ))}
              </tbody></table>
            )}
            {free.length > 0 && settled && (
              <form className="flex flex-wrap items-center gap-2" onSubmit={(e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const vid = String(new FormData(e.currentTarget).get('volume')); run(() => api(`/v1/volumes/${vid}/attach`, { method: 'POST', body: JSON.stringify({ serverId: id }) }).then(loadSide)); }}>
                <label className="text-neutral-500">{t(locale, 'attachExisting')}</label>
                <select name="volume" className="input max-w-[16rem]">{free.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.sizeGb} GB)</option>)}</select>
                <button className="btn-primary" disabled={busy}>{t(locale, 'attach')}</button>
              </form>
            )}
          </section>
        );
      })()}

      {tab === 'activity' && (
        <section className="card p-0 text-sm">
          <table className="w-full">
            <thead className="text-xs uppercase text-neutral-500"><tr><th className="px-4 py-2 text-start">{t(locale, 'action')}</th><th className="px-4 py-2 text-start">{t(locale, 'status')}</th><th className="px-4 py-2 text-start">{t(locale, 'started')}</th><th className="px-4 py-2 text-start">{t(locale, 'took')}</th><th className="px-4 py-2 text-start">{t(locale, 'notes')}</th></tr></thead>
            <tbody>
              {actions.length === 0 && <tr><td className="px-4 py-3 text-neutral-500" colSpan={5}>{t(locale, 'nothingYet')}</td></tr>}
              {actions.map((a) => (
                <tr key={a.id} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="px-4 py-2 font-medium">{a.type}{a.params && <span className="ms-2 font-normal text-neutral-500">{Object.entries(a.params).filter(([k, v]) => k !== 'op' && v !== null && v !== undefined && v !== '' && v !== false).map(([k, v]) => `${k}=${v}`).join(' ')}</span>}</td>
                  <td className="px-4 py-2"><StatusBadge status={a.status} /></td>
                  <td className="px-4 py-2 text-neutral-500">{new Date(a.startedAt).toLocaleString(locale)}</td>
                  <td className="px-4 py-2 text-neutral-500">{a.finishedAt ? `${Math.max(1, Math.round((new Date(a.finishedAt).getTime() - new Date(a.startedAt).getTime()) / 1000))}s` : '…'}</td>
                  <td className="px-4 py-2 text-red-700">{a.error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-neutral-100 px-4 py-2 text-xs text-neutral-500 dark:border-neutral-800">{t(locale, 'auditNote')} <Link href="/audit" className="text-blue-600 hover:underline">{t(locale, 'auditLog')}</Link>.</p>
        </section>
      )}
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex gap-3"><span className="w-28 shrink-0 text-neutral-500">{k}</span><span>{children}</span></div>;
}

function ResizeCard({ server, sizes, prices, currency, locale, busy, onResize }: { server: Server; sizes: Size[]; prices: Price[]; currency: string; locale: Locale; busy: boolean; onResize: (size: string) => void }) {
  const [size, setSize] = useState(server.size.id);
  const target = sizes.find((s) => s.id === size);
  const price = (id: string) => prices.find((p) => p.sku === id)?.monthlyMinor ?? 0;
  const delta = price(size) - price(server.size.id);
  const shrinks = !!target && target.diskGb < server.size.diskGb;
  return (
    <section className="card space-y-3 text-sm">
      <h2 className="font-medium">{t(locale, 'resize')}</h2>
      <p className="text-neutral-500">{t(locale, 'resizeNote')}</p>
      <select className="input" value={size} onChange={(e) => setSize(e.target.value)}>
        {sizes.map((s) => <option key={s.id} value={s.id} disabled={s.diskGb < server.size.diskGb}>{s.id} · {s.vcpu} vCPU · {s.memoryMb / 1024} GB · {s.diskGb} GB · {money(price(s.id), currency, locale)}{t(locale, 'perMonth')}</option>)}
      </select>
      {size !== server.size.id && !shrinks && <p>{delta >= 0 ? '+' : ''}{money(delta, currency, locale)}{t(locale, 'perMonth')} {t(locale, 'comparedToday')}</p>}
      <button className="btn-primary" disabled={busy || size === server.size.id || shrinks} onClick={() => confirm(tf(locale, 'resizeConfirm')(server.name, size)) && onResize(size)}>{t(locale, 'resize')}</button>
    </section>
  );
}

interface ManagedStatus { health: 'ok' | 'warn' | 'stale' | 'pending' | null; issues: string[]; reportedAt: string | null; installCommand: string | null; report: { uptimeSec?: number; load1?: number; memUsedMb?: number; memTotalMb?: number; diskUsedGb?: number; diskTotalGb?: number; diskUsedPct?: number; pendingUpdates?: number; securityUpdates?: number; rebootRequired?: boolean; lastUpgradeAt?: string | null; failedUnits?: string[]; sshBanned?: number; kernel?: string } | null }

/** Managed care: what the in VM agent reported last, and how to install it when it is not reporting. */
function ManagedCard({ id, locale, health }: { id: string; locale: Locale; health: string | null }) {
  const [st, setSt] = useState<ManagedStatus | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => api<ManagedStatus>(`/v1/servers/${id}/managed`).then((s) => { if (live) setSt(s); }).catch(() => {});
    load();
    const iv = setInterval(load, 30_000);
    return () => { live = false; clearInterval(iv); };
  }, [id, health]);
  const r = st?.report;
  const tone = st?.health === 'ok' ? 'text-green-700' : st?.health === 'warn' ? 'text-amber-700' : 'text-neutral-500';
  return (
    <section className="card space-y-2 text-sm md:col-span-2">
      <h2 className="font-medium">{t(locale, 'managedCare')} <span className={`ms-2 text-xs ${tone}`}>{st ? t(locale, `health_${st.health ?? 'pending'}` as Parameters<typeof t>[1]) : '…'}</span></h2>
      {st?.issues.map((i) => <p key={i} className="text-amber-700">{i}</p>)}
      {st?.installCommand && (
        <div>
          <p className="text-neutral-500">{t(locale, 'managedInstallNote')}</p>
          <pre className="mt-1 overflow-x-auto rounded bg-neutral-100 p-2 font-mono text-xs dark:bg-neutral-800">{st.installCommand}</pre>
        </div>
      )}
      {r && (
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <Row k={t(locale, 'lastReport')}>{st?.reportedAt ? new Date(st.reportedAt).toLocaleString(locale) : '—'}</Row>
          <Row k={t(locale, 'uptime')}>{r.uptimeSec !== undefined ? `${Math.floor(r.uptimeSec / 86400)}d ${Math.floor((r.uptimeSec % 86400) / 3600)}h` : '—'} · load {r.load1?.toFixed(2) ?? '—'}</Row>
          <Row k={t(locale, 'memory')}>{r.memUsedMb ?? '—'} / {r.memTotalMb ?? '—'} MB</Row>
          <Row k={t(locale, 'disk')}>{r.diskUsedGb ?? '—'} / {r.diskTotalGb ?? '—'} GB ({r.diskUsedPct ?? 0}%)</Row>
          <Row k={t(locale, 'updates')}>{r.pendingUpdates ?? 0} {t(locale, 'pendingOf')} {r.securityUpdates ?? 0} {t(locale, 'securityUpdates')}{r.rebootRequired ? ` · ${t(locale, 'rebootAt4')}` : ''}</Row>
          <Row k={t(locale, 'lastPatched')}>{r.lastUpgradeAt ? new Date(r.lastUpgradeAt).toLocaleString(locale) : '—'}</Row>
          <Row k={t(locale, 'sshBans')}>{r.sshBanned ?? 0}</Row>
          <Row k={t(locale, 'failedServices')}>{r.failedUnits?.length ? r.failedUnits.join(', ') : t(locale, 'none')}</Row>
        </div>
      )}
      <p className="text-xs text-neutral-500">{t(locale, 'managedCareNote')}</p>
    </section>
  );
}
