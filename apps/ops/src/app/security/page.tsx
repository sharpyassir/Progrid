'use client';

import { useState, type FormEvent } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import QRCode from 'qrcode';
import { api, del, post } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { useShell } from '@/components/ctx';
import { Card, Empty, ErrorNote, Field, Loading, PageTitle, Time, useAction } from '@/components/ui';

interface Credentials { totp: boolean; webauthn: { id: string; name: string; deviceType: string; backedUp: boolean; createdAt: string; lastUsedAt: string | null }[] }

/** Second factors of the signed in engineer: add a passkey or an authenticator app, remove a key. */
export default function SecurityPage() {
  const { t } = useShell();
  const creds = useLoad(() => api<Credentials>('/ops/v1/auth/credentials'), []);
  const { busy, run } = useAction();
  const [totp, setTotp] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState<string[] | null>(null);

  const addPasskey = () =>
    run('passkey', async () => {
      const optionsJSON = await post<Parameters<typeof startRegistration>[0]['optionsJSON']>('/ops/v1/auth/webauthn/register/options', {});
      const response = await startRegistration({ optionsJSON });
      await post('/ops/v1/auth/webauthn/register/verify', { response, name: t('passkeyDefaultName') });
    }, t('passkeyAdded')).then(() => creds.reload());

  const startTotp = () =>
    run('totp', async () => {
      const r = await post<{ secret: string; otpauthUrl: string }>('/ops/v1/auth/totp/setup', {});
      setTotp({ secret: r.secret, qr: await QRCode.toDataURL(r.otpauthUrl, { margin: 1, width: 200 }) });
    });

  const enableTotp = (e: FormEvent) => {
    e.preventDefault();
    void run('enable', () => post<{ recoveryCodes: string[] }>('/ops/v1/auth/totp/enable', { code: code.trim() }), t('totpEnabled')).then((r) => {
      if (r) {
        setCodes(r.recoveryCodes);
        setTotp(null);
        void creds.reload();
      }
    });
  };

  return (
    <div className="max-w-3xl space-y-5">
      <PageTitle title={t('navSecurity')} sub={t('securityLead')} />
      <ErrorNote error={creds.error} />
      {!creds.data ? <Loading /> : (
        <>
          <Card title={t('passkeys')} actions={<button className="btn-ghost" disabled={!!busy} onClick={addPasskey}>{t('addPasskey')}</button>}>
            {creds.data.webauthn.length ? (
              <ul className="divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
                {creds.data.webauthn.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-neutral-500">{t('added')} <Time value={c.createdAt} mode="date" />{c.lastUsedAt && <> · {t('lastUsed')} <Time value={c.lastUsedAt} /></>}</span>
                    <button className="ms-auto text-xs text-red-600 hover:underline" disabled={!!busy} onClick={() => confirm(t('removeKeyConfirm')) && run(c.id, () => del(`/ops/v1/auth/webauthn/credentials/${c.id}`), t('keyRemoved')).then(() => creds.reload())}>{t('remove')}</button>
                  </li>
                ))}
              </ul>
            ) : <Empty>{t('noPasskeys')}</Empty>}
          </Card>
          <Card title={t('authenticatorApp')}>
            {creds.data.totp ? <p className="text-sm">{t('totpOn')}</p> : totp ? (
              <form onSubmit={enableTotp} className="space-y-3">
                <p className="text-sm">{t('scanStep')}</p>
                <img src={totp.qr} alt={t('qrAlt')} width={200} height={200} className="rounded bg-white p-1" />
                <p className="text-xs text-neutral-500">{t('typeKey')} <code dir="ltr" className="break-all font-mono">{totp.secret}</code></p>
                <Field label={t('confirmStep')}><input className="input max-w-48 font-mono" dir="ltr" inputMode="numeric" required minLength={6} maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
                <button className="btn-primary" disabled={busy === 'enable'}>{t('turnOn')}</button>
              </form>
            ) : (
              <div className="flex items-center gap-3"><p className="text-sm text-neutral-500">{t('totpOff')}</p><button className="btn-ghost" disabled={!!busy} onClick={startTotp}>{t('setUp')}</button></div>
            )}
            {codes && (
              <div className="mt-3 space-y-2">
                <p className="text-sm font-medium">{t('recoveryTitle')}</p>
                <ul dir="ltr" className="grid grid-cols-2 gap-2 rounded-md bg-neutral-50 p-3 font-mono text-sm dark:bg-neutral-800">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
              </div>
            )}
          </Card>
          <p className="text-xs text-neutral-500">{t('sessionPolicy')}</p>
        </>
      )}
    </div>
  );
}
