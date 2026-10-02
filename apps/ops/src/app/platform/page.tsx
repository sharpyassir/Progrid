'use client';

import { useState } from 'react';
import { api, post } from '@/lib/api';
import type { Key } from '@/lib/i18n';
import { useLoad } from '@/lib/use-load';
import { useShell } from '@/components/ctx';
import { Badge, Card, Empty, ErrorNote, Field, Loading, PageTitle, Time, useAction } from '@/components/ui';

type Cadence = 'weekly' | 'monthly' | 'quarterly';
type RunStatus = 'open' | 'passed' | 'attention' | 'done' | 'overdue';
type CheckStatus = 'pass' | 'warn' | 'fail';

interface PlatformRun {
  id: string; taskKey: string; cadence: Cadence; mode: 'auto' | 'assisted' | 'manual'; hasCheck: boolean; evidenceRequired: boolean; estimateMinutes: number;
  periodKey: string; periodStart: string; dueAt: string; status: RunStatus;
  check: { status: CheckStatus; summary: string; items: { label: string; status: CheckStatus; detail: string }[]; at: string } | null;
  note: string | null; evidence: string | null; minutes: number; completedBy: { id: string; name: string | null } | null; completedAt: string | null;
}
interface Overview { current: PlatformRun[]; backlog: PlatformRun[]; history: PlatformRun[]; month: { minutes: number; closed: number; estimateMinutes: number } }

const runTone: Record<RunStatus, 'green' | 'amber' | 'red' | 'gray' | 'blue'> = { open: 'gray', passed: 'green', done: 'green', attention: 'amber', overdue: 'red' };
const checkTone: Record<CheckStatus, 'green' | 'amber' | 'red'> = { pass: 'green', warn: 'amber', fail: 'red' };
const tk = (r: PlatformRun, part: 't' | 's') => `plt_${r.taskKey.replace('.', '_')}_${part}` as Key;
const closed = (r: PlatformRun) => r.status === 'done' || r.status === 'passed';

/**
 * Recurring maintenance of the platform itself (docs/platform-maintenance.md). The system opens
 * each period's tasks, runs the checks every morning and closes the automatic ones that pass;
 * the engineer handles the rest and closes them with a note and evidence.
 */
export default function PlatformPage() {
  const { t } = useShell();
  const data = useLoad(() => api<Overview>('/ops/v1/platform'), [], { pollMs: 60_000 });
  const o = data.data;
  const hours = (m: number) => (m / 60).toFixed(1);

  return (
    <div className="space-y-5">
      <PageTitle title={t('navPlatform')} sub={t('platformLead')} />
      <ErrorNote error={data.error} />
      {!o ? <Loading /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label={t('pltOpenNow')} value={String(o.current.filter((r) => !closed(r)).length + o.backlog.length)} />
            <Stat label={t('pltClosedMonth')} value={String(o.month.closed)} />
            <Stat label={t('pltTimeMonth')} value={`${hours(o.month.minutes)} h`} hint={t('pltTimeExpected', { h: hours(o.month.estimateMinutes) })} />
          </div>
          {o.backlog.length > 0 && (
            <Card title={t('pltBacklog')}>
              <p className="mb-3 text-sm text-red-700 dark:text-red-300">{t('pltBacklogLead')}</p>
              <div className="space-y-3">{o.backlog.map((r) => <TaskRow key={r.id} run={r} onChange={data.reload} showPeriod />)}</div>
            </Card>
          )}
          {(['weekly', 'monthly', 'quarterly'] as Cadence[]).map((c) => {
            const runs = o.current.filter((r) => r.cadence === c);
            return (
              <Card key={c} title={<span>{t(`plt_${c}` as Key)} <span className="ms-1 font-mono text-xs font-normal text-neutral-500" dir="ltr">{runs[0]?.periodKey}</span></span>}
                actions={runs[0] && <span className="text-xs text-neutral-500">{t('pltDue')} <Time value={runs[0].dueAt} mode="date" /></span>}>
                <div className="space-y-3">{runs.map((r) => <TaskRow key={r.id} run={r} onChange={data.reload} />)}</div>
              </Card>
            );
          })}
          <Card title={t('pltHistory')}>
            {o.history.length ? (
              <div className="-mx-2 overflow-x-auto">
                <table className="table">
                  <thead><tr><th>{t('task')}</th><th>{t('pltPeriod')}</th><th>{t('status')}</th><th>{t('pltClosedBy')}</th><th>{t('pltMinutes')}</th><th>{t('finished')}</th></tr></thead>
                  <tbody>
                    {o.history.map((r) => (
                      <tr key={r.id}>
                        <td><div className="font-medium">{t(tk(r, 't'))}</div>{r.note && <div className="max-w-md truncate text-xs text-neutral-500" title={r.note}>{r.note}</div>}</td>
                        <td className="font-mono text-xs" dir="ltr">{r.periodKey}</td>
                        <td><Badge color={runTone[r.status]}>{t(`pst_${r.status}` as Key)}</Badge></td>
                        <td>{r.completedBy?.name ?? <span className="text-neutral-500">{t('pltSystem')}</span>}</td>
                        <td>{r.minutes || ''}</td>
                        <td><Time value={r.completedAt} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Empty>{t('pltNoHistory')}</Empty>}
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="mt-1 text-lg font-semibold" dir="ltr" style={{ unicodeBidi: 'isolate' }}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-neutral-500">{hint}</div>}
    </div>
  );
}

function TaskRow({ run: r, onChange, showPeriod }: { run: PlatformRun; onChange: () => unknown; showPeriod?: boolean }) {
  const { t } = useShell();
  const { busy, run } = useAction();
  const [details, setDetails] = useState(false);
  const [closing, setClosing] = useState(false);
  const [form, setForm] = useState({ note: '', evidence: '', minutes: String(r.estimateMinutes) });

  const check = () => run(`check-${r.id}`, () => post(`/ops/v1/platform/runs/${r.id}/check`), t('pltChecked')).then(() => onChange());
  const complete = () => run(`done-${r.id}`, () => post(`/ops/v1/platform/runs/${r.id}/complete`, { note: form.note, evidence: form.evidence, minutes: Number(form.minutes) || 0 }), t('pltClosed')).then((x) => {
    if (x) {
      setClosing(false);
      void onChange();
    }
  });

  return (
    <div className={`rounded-lg border p-3 ${r.status === 'overdue' ? 'border-red-300 dark:border-red-900' : 'border-neutral-200 dark:border-neutral-800'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{t(tk(r, 't'))}</span>
            <Badge color={runTone[r.status]}>{t(`pst_${r.status}` as Key)}</Badge>
            <Badge color={r.mode === 'auto' ? 'blue' : r.mode === 'assisted' ? 'violet' : 'gray'} title={t(`pltMode_${r.mode}_hint` as Key)}>{t(`pltMode_${r.mode}` as Key)}</Badge>
            {showPeriod && <span className="font-mono text-xs text-neutral-500" dir="ltr">{r.periodKey}</span>}
          </div>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-300">{t(tk(r, 's'))}</p>
        </div>
        {!closed(r) && (
          <div className="flex shrink-0 gap-2">
            {r.hasCheck && <button className="btn-ghost py-1" disabled={busy === `check-${r.id}`} onClick={check}>{busy === `check-${r.id}` ? t('pltChecking') : t('pltRunCheck')}</button>}
            <button className="btn-primary py-1" onClick={() => setClosing((v) => !v)}>{t('pltClose')}</button>
          </div>
        )}
      </div>

      {r.check && (
        <div className="mt-2 text-sm">
          <button className="flex w-full items-start gap-2 text-start" onClick={() => setDetails((v) => !v)}>
            <Badge color={checkTone[r.check.status]}>{t(`pchk_${r.check.status}` as Key)}</Badge>
            <span className="flex-1 text-neutral-600 dark:text-neutral-300" dir="ltr" style={{ unicodeBidi: 'plaintext' }}>{r.check.summary}</span>
            <span className="whitespace-nowrap text-xs text-neutral-500">{details ? t('pltHide') : t('pltDetails')}</span>
          </button>
          {details && (
            <ul className="mt-2 space-y-1 border-s-2 border-neutral-200 ps-3 dark:border-neutral-800" dir="ltr">
              {r.check.items.map((i, n) => (
                <li key={n} className="flex items-start gap-2 text-xs">
                  <span className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${i.status === 'pass' ? 'bg-green-500' : i.status === 'warn' ? 'bg-amber-500' : 'bg-red-500'}`} />
                  <span><span className="font-medium">{i.label}</span>: {i.detail}</span>
                </li>
              ))}
              <li className="pt-1 text-xs text-neutral-500"><Time value={r.check.at} /></li>
            </ul>
          )}
        </div>
      )}

      {closed(r) && (
        <p className="mt-2 text-xs text-neutral-500">
          {r.status === 'passed' ? t('pltPassedNote') : <>{t('pltDoneBy', { name: r.completedBy?.name ?? '' })}{r.minutes ? ` · ${r.minutes} min` : ''}</>} · <Time value={r.completedAt} />
          {r.note && <span className="mt-1 block whitespace-pre-wrap text-neutral-600 dark:text-neutral-300">{r.note}</span>}
        </p>
      )}

      {closing && !closed(r) && (
        <div className="mt-3 grid gap-3 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          <Field label={t('pltNote')} hint={r.mode === 'auto' && r.check && r.check.status !== 'pass' ? t('pltNoteWarnHint') : t('pltNoteHint')}>
            <textarea className="input min-h-20" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </Field>
          <Field label={<>{t('pltEvidence')}{r.evidenceRequired && <span className="text-red-600"> *</span>}</>} hint={t('pltEvidenceHint')}>
            <textarea className="input min-h-24 font-mono text-xs" dir="ltr" value={form.evidence} onChange={(e) => setForm({ ...form, evidence: e.target.value })} />
          </Field>
          <Field label={t('pltMinutes')}>
            <input className="input w-32" type="number" min={0} max={1440} value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} />
          </Field>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy === `done-${r.id}`} onClick={complete}>{t('pltConfirmClose')}</button>
            <button className="btn-ghost" onClick={() => setClosing(false)}>{t('cancel')}</button>
          </div>
        </div>
      )}
    </div>
  );
}
