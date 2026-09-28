'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useShell } from '@/components/shell';

interface Hook { id: string; url: string; events: string[]; active: boolean; secret?: string }

export default function WebhooksPage() {
  const { locale } = useShell();
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [secret, setSecret] = useState<string | null>(null);
  const load = useCallback(() => api<{ data: Hook[] }>('/v1/webhooks').then((r) => setHooks(r.data)), []);
  useEffect(() => { load(); api<{ data: string[] }>('/v1/webhooks/events').then((r) => setEvents(r.data)); }, [load]);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await api<Hook>('/v1/webhooks', { method: 'POST', body: JSON.stringify({ url: f.get('url'), events: f.getAll('event') }) });
    setSecret(r.secret ?? null);
    e.currentTarget.reset();
    load();
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{t(locale, 'webhooks')}</h1>
      {secret && <div className="card border-blue-300 text-sm dark:border-blue-800">{t(locale, 'tokenShownOnce')} <code className="ms-2 select-all text-xs">{secret}</code></div>}
      <div className="card p-0">
        <table className="w-full text-sm">
          <tbody>
            {hooks.length === 0 && <tr><td className="px-4 py-3 text-neutral-500">—</td></tr>}
            {hooks.map((h) => (
              <tr key={h.id} className="border-t border-neutral-100 first:border-0 dark:border-neutral-800">
                <td className="px-4 py-2 font-mono text-xs">{h.url}</td>
                <td className="px-4 py-2 text-xs text-neutral-500">{h.events.join(', ')}</td>
                <td className="px-4 py-2 text-end"><button className="btn-danger" onClick={() => api(`/v1/webhooks/${h.id}`, { method: 'DELETE' }).then(load)}>{t(locale, 'delete')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form onSubmit={create} className="card space-y-3">
        <input className="input" name="url" type="url" placeholder="https://example.com/hooks/prgd" required />
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          {events.map((ev) => <label key={ev} className="flex items-center gap-2 text-sm"><input type="checkbox" name="event" value={ev} defaultChecked={ev === 'server.active'} /> {ev}</label>)}
        </div>
        <button className="btn-primary">{t(locale, 'newWebhook')}</button>
      </form>
    </div>
  );
}
