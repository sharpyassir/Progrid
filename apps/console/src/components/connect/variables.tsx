'use client';

import { useState } from 'react';
import { Variable } from '@/lib/connect';
import { useC } from './ui';

type Var = Omit<Variable, 'hasValue'> & { hasValue?: boolean };

/**
 * Variable definitions: key, description, required and secret. With `onSetValue`, each row also
 * takes a value; secret values are write-only, so the field is always empty and only says whether one is set.
 */
export function VariablesEditor({ value, onChange, onSetValue }: { value: Var[]; onChange: (v: Var[]) => void; onSetValue?: (key: string, value: string) => Promise<void> }) {
  const { c } = useC();
  const set = (i: number, p: Partial<Var>) => onChange(value.map((v, j) => (j === i ? { ...v, ...p } : v)));
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="space-y-2">
          {value.map((v, i) => (
            <li key={i} className="rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
              <div className="grid gap-2 sm:grid-cols-[12rem_1fr_auto]">
                <input dir="ltr" aria-label={`${c('key')} ${i + 1}`} className="input font-mono text-xs" placeholder="API_KEY" value={v.key}
                  onChange={(e) => set(i, { key: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })} />
                <input aria-label={`${c('description')} ${i + 1}`} className="input" placeholder={c('description')} value={v.description} onChange={(e) => set(i, { description: e.target.value })} />
                <button type="button" className="btn-danger justify-self-start" onClick={() => onChange(value.filter((_, j) => j !== i))}>{c('remove')}</button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={v.required} onChange={(e) => set(i, { required: e.target.checked })} /> {c('required')}</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={v.secret} onChange={(e) => set(i, { secret: e.target.checked })} /> {c('secret')}</label>
                {onSetValue && v.key && <ValueSetter v={v} onSetValue={onSetValue} />}
              </div>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn-ghost text-xs" onClick={() => onChange([...value, { key: '', description: '', required: false, secret: false }])}>+ {c('addVariable')}</button>
      <p className="text-xs text-neutral-500">{c('varHint')} {c('varKeyHint')}</p>
    </div>
  );
}

function ValueSetter({ v, onSetValue }: { v: Var; onSetValue: (key: string, value: string) => Promise<void> }) {
  const { c } = useC();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      <span className={`badge ${v.hasValue ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'}`}>{v.hasValue ? c('valueSet') : c('noValue')}</span>
      {v.hasValue && !v.secret && v.value !== undefined && !open && <code dir="ltr" className="max-w-xs truncate font-mono text-xs text-neutral-600 dark:text-neutral-300">{v.value}</code>}
      {!open && <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => { setVal(!v.secret && v.value ? v.value : ''); setOpen(true); }}>{v.hasValue ? c('replaceValue') : c('setValue')}</button>}
      {open && (
        <form className="flex min-w-0 flex-1 gap-2" onSubmit={async (e) => { e.preventDefault(); setBusy(true); try { await onSetValue(v.key, val); setVal(''); setOpen(false); } finally { setBusy(false); } }}>
          <input aria-label={`${c('newValue')} ${v.key}`} dir="ltr" type={v.secret ? 'password' : 'text'} autoComplete="off" className="input min-w-0 flex-1 py-1 font-mono text-xs" value={val} onChange={(e) => setVal(e.target.value)} required />
          <button className="btn-primary px-2 py-1 text-xs" disabled={busy}>{c('save')}</button>
          <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setOpen(false)}>{c('cancel')}</button>
        </form>
      )}
    </div>
  );
}
