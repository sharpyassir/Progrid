'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, type Server } from '@/lib/api';
import { t, tf } from '@/lib/i18n';
import { useShell } from '@/components/shell';
import { AssetStatusBadge, Cell, ErrorBox, Field, HealthBadge, Loading, ManagedFrame, OkBox, Row, Table, tk, useAccount } from '@/components/managed';
import { ASSET_KINDS, errText, fmtDateTime, fmtRelative, type Asset, type AssetKind, type Contract } from '@/lib/managed';

/** Assets under management. Owners can ask for a new one; an engineer approves or rejects it. */
export default function ManagedAssetsPage() {
  const { locale } = useShell();
  const { account, error: accountError } = useAccount();
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [contract, setContract] = useState<Contract | null>(null);
  const [servers, setServers] = useState<Server[]>([]);
  const [kind, setKind] = useState<AssetKind>('EXTERNAL_SERVER');
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const owner = account?.role === 'owner';

  const load = useCallback(async () => {
    if (!account) return;
    setAssets((await api<{ data: Asset[] }>('/v1/managed/assets')).data);
    if (account.role === 'owner') {
      const cs = (await api<{ data: Contract[] }>('/v1/managed/contracts')).data;
      setContract(cs.find((c) => c.status !== 'CANCELLED') ?? null);
    }
  }, [account]);
  useEffect(() => { load().catch((e) => setError(errText(e))); }, [load]);
  useEffect(() => { if (showNew && kind === 'PLATFORM_SERVER') api<{ data: Server[] }>('/v1/servers').then((r) => setServers(r.data)).catch(() => setServers([])); }, [showNew, kind]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!contract) return;
    const form = e.currentTarget;
    const f = new FormData(form);
    const s = (k: string) => String(f.get(k) ?? '').trim() || undefined;
    const serverId = s('serverId');
    const server = servers.find((x) => x.id === serverId);
    const body = { kind, name: s('name') ?? server?.name, serverId: kind === 'PLATFORM_SERVER' ? serverId : undefined, address: kind === 'PLATFORM_SERVER' ? undefined : s('address'), provider: kind === 'PLATFORM_SERVER' ? undefined : s('provider'), os: s('os'), notes: s('notes') };
    setBusy(true); setError(null); setOk(null);
    try {
      await api(`/v1/managed/contracts/${contract.id}/assets`, { method: 'POST', body: JSON.stringify(body) });
      form.reset(); setShowNew(false); setOk(t(locale, 'mcAssetRequested'));
      await load();
    } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  }

  const canRequest = owner && contract && contract.status !== 'DRAFT';
  const title = t(locale, 'mcAssets');
  if (accountError) return <ManagedFrame title={title} owner={owner}><ErrorBox error={accountError} /></ManagedFrame>;

  return (
    <ManagedFrame title={title} owner={owner} actions={canRequest ? <button className="btn-primary" onClick={() => setShowNew((v) => !v)}>{t(locale, 'mcRequestAsset')}</button> : undefined}>
      <ErrorBox error={error} />
      <OkBox msg={ok} />
      {owner && contract?.status === 'DRAFT' && <p className="text-sm text-neutral-500">{t(locale, 'mcAssetsAfterSigning')}</p>}
      {contract && contract.maxAssets !== null && <p className="text-xs text-neutral-500">{tf(locale, 'mcAssetLimit')((assets ?? []).filter((a) => a.status !== 'REJECTED').length, contract.maxAssets)}</p>}

      {showNew && canRequest && (
        <form onSubmit={submit} className="card space-y-3">
          <fieldset className="space-y-2">
            <legend className="text-sm text-neutral-500">{t(locale, 'mcKind')}</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {ASSET_KINDS.map((k) => (
                <label key={k} className={`cursor-pointer rounded-md border p-3 text-sm ${kind === k ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20' : 'border-neutral-300 dark:border-neutral-700'}`}>
                  <input type="radio" className="sr-only" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
                  <div className="font-medium">{tk(locale, `mcKind_${k}`)}</div>
                  <div className="text-xs text-neutral-500">{tk(locale, `mcKindHint_${k}`)}</div>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            {kind === 'PLATFORM_SERVER' ? (
              <Field label={t(locale, 'server')}>
                <select className="input" name="serverId" required defaultValue="">
                  <option value="" disabled>{t(locale, 'mcPickServer')}</option>
                  {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            ) : (
              <Field label={t(locale, kind === 'SITE' ? 'mcSiteUrl' : 'mcAddress')} hint={t(locale, kind === 'SITE' ? 'mcSiteUrlHint' : 'mcAddressHint')}>
                <input className="input" name="address" required maxLength={300} dir="ltr" placeholder={kind === 'SITE' ? 'https://example.sa' : '203.0.113.10'} />
              </Field>
            )}
            <Field label={t(locale, 'name')} hint={kind === 'PLATFORM_SERVER' ? t(locale, 'mcNameDefaultsToServer') : undefined}>
              <input className="input" name="name" required={kind !== 'PLATFORM_SERVER'} maxLength={120} />
            </Field>
            {kind !== 'PLATFORM_SERVER' && <Field label={t(locale, 'mcProvider')} hint={t(locale, 'mcProviderHint')}><input className="input" name="provider" maxLength={80} /></Field>}
            {kind !== 'SITE' && <Field label={t(locale, 'mcOs')}><input className="input" name="os" maxLength={80} placeholder="Ubuntu 24.04" dir="ltr" /></Field>}
          </div>
          <Field label={t(locale, 'notes')} hint={t(locale, 'mcAssetNotesHint')}><textarea className="input min-h-24" name="notes" maxLength={2000} /></Field>
          <div className="flex gap-2"><button className="btn-primary" disabled={busy}>{t(locale, 'mcSendRequest')}</button><button type="button" className="btn-ghost" onClick={() => setShowNew(false)}>{t(locale, 'cancel')}</button></div>
        </form>
      )}

      {!assets ? <Loading /> : (
        <Table head={[t(locale, 'name'), t(locale, 'mcKind'), t(locale, 'mcProvider'), t(locale, 'status'), t(locale, 'mcHealth'), t(locale, 'mcMonitoringBackups')]} empty={assets.length === 0 ? t(locale, 'mcNoAssets') : undefined}>
          {assets.map((a) => (
            <Row key={a.id}>
              <Cell><span className="font-medium">{a.name}</span>{a.address && <div className="font-mono text-xs text-neutral-500" dir="ltr">{a.address}</div>}{a.os && <div className="text-xs text-neutral-500">{a.os}</div>}</Cell>
              <Cell className="text-neutral-500">{tk(locale, `mcKind_${a.kind}`, a.kind)}</Cell>
              <Cell className="text-neutral-500">{a.provider ?? '—'}</Cell>
              <Cell>
                <AssetStatusBadge s={a.status} />
                {a.status === 'REJECTED' && a.rejectedReason && <div className="mt-1 max-w-xs text-xs text-red-700 dark:text-red-400">{tf(locale, 'mcRejectedBecause')(a.rejectedReason)}</div>}
                {a.status === 'PENDING' && <div className="mt-1 text-xs text-neutral-500">{t(locale, 'mcPendingNote')}</div>}
              </Cell>
              <Cell>
                {a.status === 'APPROVED' ? <><HealthBadge h={a.health} />{a.lastHeartbeatAt && <div className="text-xs text-neutral-500" title={fmtDateTime(a.lastHeartbeatAt, locale)}>{tf(locale, 'mcLastSeen')(fmtRelative(a.lastHeartbeatAt, locale))}</div>}{!!a.openAlerts && <div className="text-xs font-medium text-red-700 dark:text-red-400">{tf(locale, 'mcOpenAlertsCount')(a.openAlerts)}</div>}</> : '—'}
              </Cell>
              <Cell className="text-xs text-neutral-500">{a.status === 'APPROVED' ? `${a.monitoringEnabled ? t(locale, 'on') : t(locale, 'off')} / ${a.backupEnabled ? t(locale, 'on') : t(locale, 'off')}` : '—'}</Cell>
            </Row>
          ))}
        </Table>
      )}
    </ManagedFrame>
  );
}
