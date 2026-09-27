'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { t, tf } from '@/lib/i18n';
import { useShell } from '@/components/shell';
import { AdminShell } from '@/components/admin-shell';

interface Block { id: string; cidr: string; regionId: string; gateway: string; owned: boolean; total: number; free: number; allocated: number }

export default function AdminIpBlocks() {
  const { locale } = useShell();
  const [rows, setRows] = useState<Block[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<{ data: Block[] }>('/admin/v1/ip-blocks').then((r) => setRows(r.data)), []);
  useEffect(() => { load(); }, [load]);
  const fail = (err: unknown) => setError(err instanceof ApiError ? err.message : String(err));
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(null);
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      await api('/admin/v1/ip-blocks', { method: 'POST', body: JSON.stringify({ cidr: f.get('cidr'), regionId: f.get('regionId'), gateway: f.get('gateway'), owned: f.get('owned') === 'on' }) });
      form.reset(); load();
    } catch (err) { fail(err); }
  }
  async function remove(b: Block) {
    if (!confirm(tf(locale, 'admDeleteBlockConfirm')(b.cidr))) return;
    setError(null);
    try { await api(`/admin/v1/ip-blocks/${b.id}`, { method: 'DELETE' }); load(); } catch (err) { fail(err); }
  }
  return (
    <AdminShell title={t(locale, 'admIpBlocks')}>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-sm text-neutral-500">{t(locale, 'admIpBlocksNote')}</p>
      <section className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-neutral-500"><tr><th className="px-4 py-2 text-start">{t(locale, 'admCidr')}</th><th className="px-4 py-2 text-start">{t(locale, 'region')}</th><th className="px-4 py-2 text-start">{t(locale, 'admGateway')}</th><th className="px-4 py-2 text-start">{t(locale, 'admFree')}</th><th className="px-4 py-2 text-start">{t(locale, 'admAllocated')}</th><th /></tr></thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id} className="border-t border-neutral-100 dark:border-neutral-800">
                <td className="px-4 py-2 font-mono">{b.cidr}{b.owned ? <span className="ms-2 text-xs text-neutral-500">RIPE</span> : null}</td>
                <td className="px-4 py-2">{b.regionId}</td>
                <td className="px-4 py-2 font-mono">{b.gateway}</td>
                <td className="px-4 py-2">{b.free} / {b.total}</td>
                <td className="px-4 py-2">{b.allocated}</td>
                <td className="px-4 py-2 text-end"><button className="btn-ghost text-xs text-red-600 disabled:opacity-40" disabled={b.allocated > 0} onClick={() => remove(b)}>{t(locale, 'delete')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <form onSubmit={add} className="card space-y-3">
        <h2 className="font-medium">{t(locale, 'admAddBlock')}</h2>
        <div className="grid gap-2 sm:grid-cols-4">
          <input className="input font-mono" name="cidr" placeholder="203.0.113.0/24" required />
          <input className="input font-mono" name="gateway" placeholder="203.0.113.1" required />
          <input className="input" name="regionId" placeholder="sa1" defaultValue="sa1" required />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="owned" /> RIPE</label>
        </div>
        <button className="btn-primary">{t(locale, 'admAddBlock')}</button>
      </form>
    </AdminShell>
  );
}
