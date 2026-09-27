'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useShell } from '@/components/shell';
import { AdminShell } from '@/components/admin-shell';

interface Image { id: string; kind: string; name: string; distribution: string | null; version: string | null; regionId: string | null; templateId: number | null; available: boolean; _count: { servers: number } }

export default function AdminImages() {
  const { locale } = useShell();
  const [rows, setRows] = useState<Image[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => api<{ data: Image[] }>('/admin/v1/images').then((r) => setRows(r.data)), []);
  useEffect(() => { load(); }, [load]);
  const fail = (err: unknown) => setError(err instanceof ApiError ? err.message : String(err));
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(null);
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      await api('/admin/v1/images', { method: 'POST', body: JSON.stringify({ name: f.get('name'), slug: f.get('slug'), distribution: f.get('distribution'), version: f.get('version'), regionId: f.get('regionId') || undefined, templateId: Number(f.get('templateId')), available: f.get('available') === 'on' }) });
      form.reset(); load();
    } catch (err) { fail(err); }
  }
  async function patch(img: Image, body: Record<string, unknown>) {
    setError(null);
    try { await api(`/admin/v1/images/${img.id}`, { method: 'PATCH', body: JSON.stringify(body) }); load(); } catch (err) { fail(err); }
  }
  return (
    <AdminShell title={t(locale, 'admImages')}>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-sm text-neutral-500">{t(locale, 'admImagesNote')}</p>
      <section className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-neutral-500"><tr><th className="px-4 py-2 text-start">{t(locale, 'name')}</th><th className="px-4 py-2 text-start">{t(locale, 'admSlug')}</th><th className="px-4 py-2 text-start">{t(locale, 'region')}</th><th className="px-4 py-2 text-start">{t(locale, 'admTemplateId')}</th><th className="px-4 py-2 text-start">{t(locale, 'admServersUsing')}</th><th className="px-4 py-2 text-start">{t(locale, 'status')}</th><th /></tr></thead>
          <tbody>
            {rows.map((img) => (
              <tr key={img.id} className="border-t border-neutral-100 dark:border-neutral-800">
                <td className="px-4 py-2"><div className="font-medium">{img.name}</div><div className="text-xs text-neutral-500">{img.kind}{img.distribution ? ` · ${img.distribution} ${img.version ?? ''}` : ''}</div></td>
                <td className="px-4 py-2 font-mono text-xs">{img.id}</td>
                <td className="px-4 py-2">{img.regionId ?? t(locale, 'admAllRegions')}</td>
                <td className="px-4 py-2">
                  <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); const v = Number(new FormData(e.currentTarget).get('templateId')); if (v) patch(img, { templateId: v }); }}>
                    <input name="templateId" type="number" className="input w-24 py-1 text-xs" defaultValue={img.templateId ?? ''} /><button className="btn-ghost text-xs">{t(locale, 'save')}</button>
                  </form>
                </td>
                <td className="px-4 py-2">{img._count.servers}</td>
                <td className="px-4 py-2">{img.available ? t(locale, 'admAvailable') : t(locale, 'admHidden')}</td>
                <td className="px-4 py-2 text-end"><button className="btn-ghost text-xs" onClick={() => patch(img, { available: !img.available })}>{img.available ? t(locale, 'admHide') : t(locale, 'admMakeAvailable')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <form onSubmit={add} className="card space-y-3">
        <h2 className="font-medium">{t(locale, 'admAddImage')}</h2>
        <div className="grid gap-2 sm:grid-cols-4">
          <input className="input" name="name" placeholder="Ubuntu 24.04 LTS" required />
          <input className="input font-mono" name="slug" placeholder="ubuntu-24-04" pattern="[a-z0-9-]+" required />
          <input className="input" name="distribution" placeholder={t(locale, 'admDistribution')} required />
          <input className="input" name="version" placeholder={t(locale, 'admVersion')} required />
          <input className="input" name="templateId" type="number" min={100} placeholder={t(locale, 'admTemplateId')} required />
          <input className="input" name="regionId" placeholder={t(locale, 'admAllRegions')} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="available" defaultChecked /> {t(locale, 'admAvailable')}</label>
        </div>
        <button className="btn-primary">{t(locale, 'admAddImage')}</button>
      </form>
    </AdminShell>
  );
}
