'use client';

import { useCallback, useEffect, useState } from 'react';
import { capi, Page, Run } from '@/lib/connect';
import { useC } from './ui';

const STATUSES = ['queued', 'running', 'succeeded', 'failed', 'waiting_approval', 'cancelled'];
const SOURCES = ['api', 'webhook', 'test', 'schedule', 'manual'];

/** Paginated runs from a list endpoint with filters as query parameters. */
export function usePagedRuns(path: string, filters: Record<string, string>) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams(Object.entries({ ...filters, ...extra }).filter(([, v]) => v));
    const s = p.toString();
    return s ? `?${s}` : '';
  };
  const key = JSON.stringify(filters);
  useEffect(() => {
    setRuns(null);
    capi<Page<Run>>(`${path}${qs({})}`).then((r) => { setRuns(r.data); setCursor(r.meta?.next_cursor ?? null); setError(null); }).catch(setError);
  }, [path, key]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadMore = useCallback(() => {
    if (!cursor) return;
    capi<Page<Run>>(`${path}${qs({ cursor })}`).then((r) => { setRuns((x) => [...(x ?? []), ...r.data]); setCursor(r.meta?.next_cursor ?? null); }).catch(setError);
  }, [cursor, path, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return { runs, error, more: !!cursor, loadMore };
}

export function RunFilters({ value, onChange, agents, dates = true }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void; agents?: { id: string; name: string }[]; dates?: boolean }) {
  const { c, cd } = useC();
  const set = (k: string, v: string) => onChange({ ...value, [k]: v });
  const sel = 'input w-auto min-w-0 py-1.5';
  return (
    <fieldset className="flex flex-wrap items-end gap-2">
      <legend className="sr-only">{c('filters')}</legend>
      {agents && (
        <label className="text-xs text-neutral-500">{c('agent')}
          <select className={`${sel} mt-1 block`} value={value.agentId ?? ''} onChange={(e) => set('agentId', e.target.value)}>
            <option value="">{c('allAgents')}</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      )}
      <label className="text-xs text-neutral-500">{c('status')}
        <select className={`${sel} mt-1 block`} value={value.status ?? ''} onChange={(e) => set('status', e.target.value)}>
          <option value="">{c('allStatuses')}</option>{STATUSES.map((s) => <option key={s} value={s}>{cd('st_', s)}</option>)}
        </select>
      </label>
      {!agents && (
        <label className="text-xs text-neutral-500">{c('source')}
          <select className={`${sel} mt-1 block`} value={value.source ?? ''} onChange={(e) => set('source', e.target.value)}>
            <option value="">{c('allSources')}</option>{SOURCES.map((s) => <option key={s} value={s}>{cd('src_', s)}</option>)}
          </select>
        </label>
      )}
      {dates && (
        <>
          <label className="text-xs text-neutral-500">{c('from')}<input type="date" className={`${sel} mt-1 block`} value={value.from?.slice(0, 10) ?? ''} onChange={(e) => set('from', e.target.value ? new Date(e.target.value).toISOString() : '')} /></label>
          <label className="text-xs text-neutral-500">{c('to')}<input type="date" className={`${sel} mt-1 block`} value={value.to?.slice(0, 10) ?? ''} onChange={(e) => set('to', e.target.value ? new Date(`${e.target.value}T23:59:59`).toISOString() : '')} /></label>
        </>
      )}
    </fieldset>
  );
}
